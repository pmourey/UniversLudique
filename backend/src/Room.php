<?php
namespace Tarot;

use Ratchet\ConnectionInterface;
use SplObjectStorage;

class Room
{
    protected $id;
    private $players; // SplObjectStorage<ConnectionInterface, array>

    private $status = 'waiting'; // waiting | bidding | discarding | playing | scoring | finished
    private $dealerId = null;

    // Game state
    private $seats = array(); // ordered list of [id,name]
    private $order = array(); // ordered list of player ids (by seats)
    private $hands = array(); // id => array of cards (strings)
    private $dog = array();
    private $bids = array(); // id => bid string ('pass','prise','garde','garde_sans','garde_contre')
    private $currentTurnIndex = 0; // index in $order
    private $takerId = null;
    private $highestBid = null; // null|'prise'|'garde'|'garde_sans'|'garde_contre'

    private $trick = array(); // array of [playerId, card]
    private $leaderId = null; // who leads current trick
    private $won = array(); // id => array of won cards
    // Nouveau: nombre de plis gagnés par joueur
    private $tricksWon = array(); // id => int

    public function __construct($id)
    {
        $this->id = (string)$id;
        $this->players = new SplObjectStorage();
    }

    public function getId() { return $this->id; }

    public function add(ConnectionInterface $conn, $name)
    {
//        if (!$name) {
//            throw new \InvalidArgumentException('Un pseudo est requis pour rejoindre la partie.');
//        }
        $info = array(
            'id' => $conn->resourceId,
            'name' => (string)$name,
            'seat' => count($this->seats),
        );
        $this->players[$conn] = $info;
        $this->seats[] = array('id' => $info['id'], 'name' => $info['name']);
        $this->rebuildOrder();
        $this->broadcast(array(
            'type' => 'player_joined',
            'payload' => array('roomId' => $this->id, 'player' => $info),
        ));
        $this->broadcastState();
        $this->sendPrivateStates();
    }

    public function remove(ConnectionInterface $conn)
    {
        if (isset($this->players[$conn])) {
            $info = $this->players[$conn];
            unset($this->players[$conn]);
            // remove seat/order entry
            $this->seats = array_values(array_filter($this->seats, function($p) use ($info){ return $p['id'] !== $info['id']; }));
            $this->rebuildOrder();
            unset($this->hands[$info['id']]);
            unset($this->bids[$info['id']]);
            unset($this->won[$info['id']]);
            unset($this->tricksWon[$info['id']]);

            $this->broadcast(array(
                'type' => 'player_left',
                'payload' => array(
                    'roomId' => $this->id,
                    'player' => $info,
                ),
            ));
            // If a game was running, reset to waiting for simplicity
            if (in_array($this->status, array('bidding','discarding','playing','scoring'))) {
                $this->resetGame();
            }
            $this->broadcastState();
            $this->sendPrivateStates();
        }
    }

    public function isEmpty()
    {
        return count($this->players) === 0;
    }

    public function broadcast(array $message)
    {
        $json = json_encode($message);
        foreach ($this->players as $conn) {
            $conn->send($json);
        }
    }

    public function serializeState()
    {
        return array(
            'roomId' => $this->id,
            'status' => $this->status,
            'dealerId' => $this->dealerId,
            'players' => $this->publicPlayers(),
            'order' => $this->order,
            'currentPlayerId' => $this->currentPlayerId(),
            'takerId' => $this->takerId,
            'highestBid' => $this->highestBid,
            'trick' => $this->trick,
            'leaderId' => $this->leaderId,
            'dogCount' => count($this->dog),
        );
    }

    public function serializeSummary()
    {
        return array(
            'roomId' => $this->id,
            'players' => count($this->players),
            'status' => $this->status,
        );
    }

    public function startGame()
    {
        if ($this->status !== 'waiting') {
            return;
        }
        $count = count($this->seats);
        if ($count < 3) {
            throw new \RuntimeException('Au moins 3 joueurs requis pour commencer.');
        }
        // rotate dealer
        if ($this->dealerId === null) {
            $this->dealerId = $this->seats[0]['id'];
        } else {
            $idx = $this->indexOf($this->order, $this->dealerId);
            $this->dealerId = $this->order[($idx + 1) % $count];
        }

        $this->setupNewDeal();
        $this->status = 'bidding';
        $this->leaderId = null;
        echo "[ROOM {$this->id}] startGame dealer={$this->dealerId} status={$this->status} firstTurn={$this->order[$this->currentTurnIndex]}\n";
        $this->broadcastState();
        $this->sendPrivateStates();
    }

    public function handleAction(ConnectionInterface $from, $action, array $params = array())
    {
        $pid = $from->resourceId;
        switch ($action) {
            case 'ping':
                $this->broadcast(array( 'type' => 'pong', 'payload' => array( 'from' => $pid, 'ts' => time() ) ));
                break;

            case 'bid':
                $bid = isset($params['bid']) ? (string)$params['bid'] : '';
                $this->handleBid($pid, $bid);
                break;

            case 'reveal_dog':
                $this->handleRevealDog($pid);
                break;

            case 'discard':
                $cards = isset($params['cards']) && is_array($params['cards']) ? $params['cards'] : array();
                $this->handleDiscard($pid, $cards);
                break;

            case 'play_card':
                $card = isset($params['card']) ? (string)$params['card'] : '';
                $this->handlePlayCard($pid, $card);
                break;

            case 'restart':
                // Permettre de relancer une donne (rotation de donneur conservée par startGame)
                if (count($this->seats) < 3) return;
                $this->resetGame();
                $this->broadcast(array('type' => 'notice', 'payload' => array('message' => 'Nouvelle donne…')));
                $this->startGame();
                break;

            case 'finish':
                // Force la fin si condition atteinte (mains vides / pli partiel)
                $done = $this->checkAndFinishIfOver();
                if (!$done) {
                    $this->broadcast(array('type' => 'notice', 'payload' => array('message' => "Impossible de terminer: donne non terminée.")));
                }
                break;

            default:
                $this->broadcast(array( 'type' => 'notice', 'payload' => array( 'message' => 'Action inconnue: ' . $action ) ));
        }
    }

    // --------------------- Game internals ---------------------

    private function resetGame()
    {
        $this->status = 'waiting';
        $this->hands = array();
        $this->dog = array();
        $this->bids = array();
        $this->currentTurnIndex = 0;
        $this->takerId = null;
        $this->highestBid = null;
        $this->trick = array();
        $this->leaderId = null;
        $this->won = array();
        $this->tricksWon = array();
    }

    private function setupNewDeal()
    {
        // initialize structures
        $this->hands = array();
        $this->dog = array();
        $this->bids = array();
        $this->takerId = null;
        $this->highestBid = null;
        $this->trick = array();
        $this->won = array();
        $this->tricksWon = array();

        $deck = $this->generateDeck();
        shuffle($deck);

        // Recalculer l'ordre actuel des joueurs
        $this->rebuildOrder();
        $n = count($this->order);
        if ($n < 3) { throw new \RuntimeException('Au moins 3 joueurs requis'); }

        // dog (taille en fonction du nombre de joueurs)
        $dogSize = $this->dogSizeFor($n);
        for ($i=0; $i<$dogSize; $i++) {
            $this->dog[] = array_pop($deck);
        }

        // determine first bidder: next after dealer
        $idxDealer = $this->indexOf($this->order, $this->dealerId);
        $this->currentTurnIndex = ($idxDealer + 1) % $n;

        // deal remaining evenly
        $this->hands = array();
        foreach ($this->order as $pid) { $this->hands[$pid] = array(); $this->won[$pid] = array(); $this->tricksWon[$pid] = 0; }
        $i = 0;
        while (!empty($deck)) {
            $pid = $this->order[$i % $n];
            $this->hands[$pid][] = array_pop($deck);
            $i++;
        }
    }

    private function generateDeck()
    {
        $cards = array();
        $suits = array('S','H','D','C'); // Spades, Hearts, Diamonds, Clubs
        for ($v=1; $v<=14; $v++) {
            foreach ($suits as $s) { $cards[] = $s.$v; }
        }
        for ($t=1; $t<=21; $t++) { $cards[] = 'T'.$t; }
        $cards[] = 'EXCUSE';
        return $cards;
    }

    private function dogSizeFor($n)
    {
        if ($n === 5) return 3;
        return 6; // 3 or 4 players
    }

    private function handleBid($pid, $bid)
    {
        if ($this->status !== 'bidding') return;
        if ($this->order[$this->currentTurnIndex] !== $pid) return; // not your turn
        $allowed = array('pass','prise','garde','garde_sans','garde_contre');
        if (!in_array($bid, $allowed, true)) return;

        $this->bids[$pid] = $bid;
        $this->updateHighestBid($pid, $bid);
        echo "[ROOM {$this->id}] bid pid={$pid} bid={$bid} highest=" . ($this->highestBid ?: 'null') . " taker=" . ($this->takerId ?: 'null') . "\n";

        // advance turn
        $this->currentTurnIndex = ($this->currentTurnIndex + 1) % count($this->order);

        if ($this->biddingEnded()) {
            if ($this->highestBid === null || $this->takerId === null) {
                echo "[ROOM {$this->id}] bidding end: all pass -> redeal\n";
                $this->broadcast(array('type' => 'notice', 'payload' => array('message' => 'Tous passent, nouvelle donne.')));
                // Correction: reset puis relancer une donne
                $this->resetGame();
                $this->startGame();
                return;
            }
            if ($this->highestBid === 'prise' || $this->highestBid === 'garde') {
                $this->status = 'discarding';
                foreach ($this->dog as $c) { $this->hands[$this->takerId][] = $c; }
                $this->dog = array();
                echo "[ROOM {$this->id}] bidding end: taker={$this->takerId} status={$this->status} (needs discard)\n";
            } else {
                $this->status = 'playing';
                $this->leaderId = $this->takerId;
                $this->currentTurnIndex = $this->indexOf($this->order, $this->leaderId);
                echo "[ROOM {$this->id}] bidding end: taker={$this->takerId} status={$this->status} leader={$this->leaderId}\n";
            }
            $this->broadcastState();
            $this->sendPrivateStates();
            return;
        }

        $this->broadcastState();
        $this->sendPrivateStates();
    }

    private function updateHighestBid($pid, $bid)
    {
        if ($bid === 'pass') return;
        $ranks = array('prise' => 1, 'garde' => 2, 'garde_sans' => 3, 'garde_contre' => 4);
        if ($this->highestBid === null || $ranks[$bid] > $ranks[$this->highestBid]) {
            $this->highestBid = $bid;
            $this->takerId = $pid;
        }
    }

    private function biddingEnded()
    {
        // ends when all have acted at least once and no further overbid possible (simplifié):
        // if everyone has at least 'pass' and the turn returned to dealer.
        $n = count($this->order);
        if (count($this->bids) < $n) return false;
        // stop when a full round after last highest bidder without change
        // Simplification: stop when every player has bid once
        return true;
    }

    private function handleRevealDog($pid)
    {
        // In this simplified proto, reveal_dog is not needed because we grant dog instantly on end of bidding for prise/garde.
        // Kept for API completeness.
    }

    private function handleDiscard($pid, $cards)
    {
        if ($this->status !== 'discarding') return;
        if ($pid !== $this->takerId) return;
        $target = $this->dogSizeFor(count($this->order));
        if (count($cards) !== $target) return;
        // remove these cards from taker hand
        $hand = isset($this->hands[$pid]) ? $this->hands[$pid] : array();
        foreach ($cards as $c) {
            $idx = array_search($c, $hand, true);
            if ($idx === false) return; // invalid card
            array_splice($hand, $idx, 1);
        }
        $this->hands[$pid] = $hand;
        // dog devient l'écart (ignoré pour le score ici)
        $this->dog = array();
        $this->status = 'playing';
        $this->leaderId = $this->takerId;
        $this->currentTurnIndex = $this->indexOf($this->order, $this->leaderId);
        echo "[ROOM {$this->id}] discard by={$pid} count=" . count($cards) . " -> status={$this->status} leader={$this->leaderId}\n";
        $this->broadcastState();
        $this->sendPrivateStates();
    }

    private function handlePlayCard($pid, $card)
    {
        if ($this->status !== 'playing') return;
        if ($this->order[$this->currentTurnIndex] !== $pid) return; // not your turn
        $hand = isset($this->hands[$pid]) ? $this->hands[$pid] : array();
        $idx = array_search($card, $hand, true);
        if ($idx === false) return; // not in hand
        // play it
        array_splice($hand, $idx, 1);
        $this->hands[$pid] = $hand;
        $this->trick[] = array('playerId' => $pid, 'card' => $card);
        echo "[ROOM {$this->id}] play pid={$pid} card={$card} trickSize=" . count($this->trick) . "\n";

        // advance turn
        $this->currentTurnIndex = ($this->currentTurnIndex + 1) % count($this->order);

        $nPlayers = count($this->order);
        $trickComplete = (count($this->trick) === $nPlayers);

        // if trick complete
        if ($trickComplete) {
            $winnerId = $this->determineTrickWinner($this->trick);
            foreach ($this->trick as $entry) {
                $this->won[$winnerId][] = $entry['card'];
            }
            if (!isset($this->tricksWon[$winnerId])) { $this->tricksWon[$winnerId] = 0; }
            $this->tricksWon[$winnerId]++;

            $this->trick = array();
            $this->leaderId = $winnerId;
            $this->currentTurnIndex = $this->indexOf($this->order, $winnerId);
            echo "[ROOM {$this->id}] trick complete winner={$winnerId} nextLeader={$this->leaderId}\n";
        }

        // Vérifier et terminer si la donne est finie
        if ($this->checkAndFinishIfOver()) {
            $this->broadcastState();
            $this->sendPrivateStates();
            return;
        }

        $this->broadcastState();
        $this->sendPrivateStates();
    }

    private function checkAndFinishIfOver()
    {
        if ($this->status !== 'playing') return false;
        $empty = true;
        foreach ($this->hands as $h) { if (!empty($h)) { $empty = false; break; } }
        if (!$empty) return false;

        // Si un pli est en cours mais non complet, l'attribuer quand même
        if (count($this->trick) > 0) {
            $winnerId = $this->determineTrickWinner($this->trick);
            foreach ($this->trick as $entry) { $this->won[$winnerId][] = $entry['card']; }
            if (!isset($this->tricksWon[$winnerId])) { $this->tricksWon[$winnerId] = 0; }
            $this->tricksWon[$winnerId]++;
            $this->trick = array();
            $this->leaderId = $winnerId;
            $this->currentTurnIndex = $this->indexOf($this->order, $winnerId);
            echo "[ROOM {$this->id}] end-of-hand partial trick assigned to winner={$winnerId}\n";
        }
        $this->status = 'scoring';
        echo "[ROOM {$this->id}] all hands empty -> scoring\n";
        $this->computeScore();
        return true;
    }

    private function computeScore()
    {
        $takerWon = isset($this->won[$this->takerId]) ? count($this->won[$this->takerId]) : 0;
        $maxDef = 0;
        $defenders = array();
        foreach ($this->won as $pid => $cards) {
            if ($pid === $this->takerId) continue;
            $defenders[] = $pid;
            if (count($cards) > $maxDef) $maxDef = count($cards);
        }
        $result = ($takerWon > $maxDef) ? 'taker_wins' : 'defense_wins';
        echo "[ROOM {$this->id}] scoring result={$result} takerWon={$takerWon} maxDef={$maxDef}\n";
        // Construire un message clair avec gagnant(s)
        $winners = ($result === 'taker_wins') ? array($this->takerId) : $defenders;
        $winnersNames = array_map(function($id){ return $this->playerNameById($id); }, $winners);
        $msg = 'Fin de partie — Gagnant(s): ' . implode(', ', $winnersNames);
        $this->broadcast(array('type' => 'notice', 'payload' => array('message' => $msg)));
        $this->status = 'finished';
        // Émettre un événement dédié de fin de partie avec gagnant(s)
        $payload = array(
            'result' => $result,
            'takerId' => $this->takerId,
            'winners' => $winners,
            'winnersNames' => $winnersNames,
            'wonCounts' => $this->wonCounts(),
        );
        $this->broadcast(array('type' => 'game_over', 'payload' => $payload));
        $this->broadcastState();
    }

    private function wonCounts()
    {
        $out = array();
        foreach ($this->won as $pid => $cards) { $out[$pid] = count($cards); }
        return $out;
    }

    // Détermination du gagnant du pli (simplifiée):
    // - Si au moins un atout (T1..T21) a été joué, l'atout le plus fort gagne (EXCUSE ignorée)
    // - Sinon, carte la plus forte de la couleur demandée (1..14, 14 le plus fort)
    // - EXCUSE ne peut pas gagner un pli ici (règle simplifiée)
    private function determineTrickWinner(array $trick)
    {
        if (empty($trick)) return $this->leaderId ?: $this->order[0];
        $leadCard = $trick[0]['card'];
        $leadInfo = $this->cardInfo($leadCard);
        $best = $trick[0];
        $bestInfo = $leadInfo;

        // Chercher trumps
        $hasTrump = false; $bestTrump = null; $bestTrumpVal = -1;
        foreach ($trick as $entry) {
            $info = $this->cardInfo($entry['card']);
            if ($info['isExcuse']) continue;
            if ($info['isTrump']) {
                $hasTrump = true;
                if ($info['rank'] > $bestTrumpVal) { $bestTrumpVal = $info['rank']; $bestTrump = $entry; }
            }
        }
        if ($hasTrump && $bestTrump !== null) {
            return $bestTrump['playerId'];
        }

        // Sinon, comparer au sein de la couleur demandée
        $bestSuitVal = $leadInfo['rank'];
        foreach ($trick as $entry) {
            $info = $this->cardInfo($entry['card']);
            if ($info['isExcuse'] || $info['isTrump']) continue;
            if ($info['suit'] === $leadInfo['suit']) {
                if ($info['rank'] > $bestSuitVal) { $bestSuitVal = $info['rank']; $best = $entry; }
            }
        }
        return $best['playerId'];
    }

    private function cardInfo($card)
    {
        if ($card === 'EXCUSE') return array('isTrump' => false, 'isExcuse' => true, 'suit' => null, 'rank' => 0);
        if (strlen($card) >= 2 && $card[0] === 'T') {
            $rank = (int)substr($card, 1);
            return array('isTrump' => true, 'isExcuse' => false, 'suit' => null, 'rank' => $rank);
        }
        // Suits S/H/D/C + numeric rank
        $suit = $card[0];
        $rank = (int)substr($card, 1);
        return array('isTrump' => false, 'isExcuse' => false, 'suit' => $suit, 'rank' => $rank);
    }

    private function publicPlayers()
    {
        $out = array();
        foreach ($this->players as $conn) {
            $p = $this->players[$conn];
            $out[] = array(
                'id' => $p['id'],
                'name' => $p['name'],
                'seat' => isset($p['seat']) ? $p['seat'] : null,
                'handCount' => isset($this->hands[$p['id']]) ? count($this->hands[$p['id']]) : 0,
                'wonCount' => isset($this->won[$p['id']]) ? count($this->won[$p['id']]) : 0,
                'tricksWon' => isset($this->tricksWon[$p['id']]) ? (int)$this->tricksWon[$p['id']] : 0,
            );
        }
        // sort by seat
        usort($out, function($a,$b){ return ($a['seat'] - $b['seat']); });
        return $out;
    }

    private function broadcastState()
    {
        $this->broadcast(array('type' => 'state', 'payload' => $this->serializeState() ));
    }

    private function sendPrivateStates()
    {
        foreach ($this->players as $conn) {
            $p = $this->players[$conn];
            $pid = $p['id'];
            $hand = isset($this->hands[$pid]) ? $this->hands[$pid] : array();
            $payload = array(
                'hand' => $hand,
                'isYourTurn' => ($this->currentPlayerId() === $pid),
                'youAreTaker' => ($this->takerId === $pid),
                'dogCount' => count($this->dog),
            );
            $conn->send(json_encode(array('type' => 'your_hand', 'payload' => $payload)));
        }
    }

    private function currentPlayerId()
    {
        // Hors phases actives, personne n'est attendu à jouer
        if (!in_array($this->status, array('bidding','discarding','playing'), true)) return null;
        if (empty($this->order)) return null;
        return $this->order[$this->currentTurnIndex];
    }

    private function indexOf($list, $value)
    {
        $idx = array_search($value, $list, true);
        return ($idx === false) ? 0 : (int)$idx;
    }

    private function rebuildOrder()
    {
        // order players by seat
        $tmp = array();
        foreach ($this->players as $conn) { $tmp[] = $this->players[$conn]; }
        usort($tmp, function($a,$b){ return ($a['seat'] - $b['seat']); });
        $this->order = array_map(function($p){ return $p['id']; }, $tmp);
    }

    private function playerNameById($id)
    {
        foreach ($this->players as $conn) {
            $p = $this->players[$conn];
            if ($p['id'] === $id) return $p['name'];
        }
        return (string)$id;
    }
}
