<?php
namespace Tarot;

use Ratchet\ConnectionInterface;
use SplObjectStorage;

class BeloteRoom implements GameRoom
{
    private $game = 'belote';
    private $id;
    private $name = '';
    private $players; // SplObjectStorage<ConnectionInterface, array>

    private $status = 'waiting'; // waiting | choosing_trump | playing | finished
    private $dealerId = null;

    private $seats = array(); // ordered list of [id,name]
    private $order = array(); // ordered list of player ids (by seats)
    private $hands = array(); // id => array of cards (e.g., 'S7','S8','S9','S10','SJ','SQ','SK','SA')
    private $currentTurnIndex = 0; // index in $order

    private $trick = array(); // array of [playerId, card]
    private $leaderId = null; // who leads current trick
    private $trumpSuit = null; // 'S'|'H'|'D'|'C'
    private $won = array(); // id => array of won cards
    private $tricksWon = array(); // id => int
    private $lastTrickWinnerId = null;

    private $minPlayers = 4;
    private $maxPlayers = 4;

    public function __construct($id, $name = '')
    {
        $this->id = (string)$id;
        $this->name = (string)$name;
        $this->players = new SplObjectStorage();
    }

    public function getId() { return $this->id; }

    public function add(ConnectionInterface $conn, $name)
    {
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
            $this->seats = array_values(array_filter($this->seats, function($p) use ($info){ return $p['id'] !== $info['id']; }));
            $this->rebuildOrder();
            unset($this->hands[$info['id']]);
            unset($this->won[$info['id']]);
            unset($this->tricksWon[$info['id']]);
            if (in_array($this->status, array('choosing_trump','playing'))) {
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
        foreach ($this->players as $conn) { $conn->send($json); }
    }

    public function serializeState()
    {
        return array(
            'roomId' => $this->id,
            'game' => $this->game,
            'status' => $this->status,
            'dealerId' => $this->dealerId,
            'players' => $this->publicPlayers(),
            'order' => $this->order,
            'currentPlayerId' => $this->currentPlayerId(),
            'trick' => $this->trick,
            'leaderId' => $this->leaderId,
            'trumpSuit' => $this->trumpSuit,
        );
    }

    public function serializeSummary()
    {
        return [
            'roomId' => $this->id,
            'name' => $this->name,
            'game' => $this->game,
            'players' => count($this->seats),
            'status' => $this->status,
            'minPlayers' => $this->minPlayers,
            'maxPlayers' => $this->maxPlayers,
        ];
    }

    public function startGame()
    {
        if ($this->status !== 'waiting') { return; }
        $count = count($this->seats);
        if ($count !== 4) { throw new \RuntimeException('Belote se joue à 4 joueurs.'); }
        // rotate dealer
        if ($this->dealerId === null) {
            $this->dealerId = $this->seats[0]['id'];
        } else {
            $idx = $this->indexOf($this->order, $this->dealerId);
            $this->dealerId = $this->order[($idx + 1) % $count];
        }
        $this->setupNewDeal();
        $this->status = 'choosing_trump';
        $idxDealer = $this->indexOf($this->order, $this->dealerId);
        $this->currentTurnIndex = ($idxDealer + 1) % 4; // first chooser
        $this->leaderId = null;
        echo "[BELOTE {$this->id}] startGame dealer={$this->dealerId} status={$this->status} chooser={$this->order[$this->currentTurnIndex]}\n";
        $this->broadcastState();
        $this->sendPrivateStates();
    }

    public function handleAction(ConnectionInterface $from, $action, array $params = array())
    {
        $pid = $from->resourceId;
        switch ($action) {
            case 'choose_trump':
                $suit = isset($params['suit']) ? (string)$params['suit'] : '';
                $this->handleChooseTrump($pid, $suit);
                break;

            case 'play_card':
                $card = isset($params['card']) ? (string)$params['card'] : '';
                $this->handlePlayCard($pid, $card);
                break;

            case 'restart':
                if (count($this->seats) !== 4) return;
                $this->resetGame();
                $this->broadcast(array('type' => 'notice', 'payload' => array('message' => 'Nouvelle donne…')));
                $this->startGame();
                break;

            case 'finish':
                $this->finishIfOver(true);
                break;

            default:
                $this->broadcast(array('type' => 'notice', 'payload' => array('message' => 'Belote: action inconnue.')));
        }
    }

    private function resetGame()
    {
        $this->status = 'waiting';
        $this->hands = array();
        $this->currentTurnIndex = 0;
        $this->trick = array();
        $this->leaderId = null;
        $this->trumpSuit = null;
        $this->won = array();
        $this->tricksWon = array();
        $this->lastTrickWinnerId = null;
    }

    private function setupNewDeal()
    {
        $this->hands = array();
        $this->currentTurnIndex = 0;
        $this->trick = array();
        $this->leaderId = null;
        $this->trumpSuit = null;
        $this->won = array();
        $this->tricksWon = array();
        $this->lastTrickWinnerId = null;

        $deck = $this->generateDeck32();
        shuffle($deck);
        $this->rebuildOrder();
        foreach ($this->order as $pid) { $this->hands[$pid] = array(); $this->won[$pid] = array(); $this->tricksWon[$pid] = 0; }
        $i = 0; $n=4;
        while (!empty($deck)) {
            $pid = $this->order[$i % $n];
            $this->hands[$pid][] = array_pop($deck);
            $i++;
        }
    }

    private function generateDeck32()
    {
        $cards = array();
        $suits = array('S','H','D','C');
        $ranks = array('7','8','9','10','J','Q','K','A');
        foreach ($suits as $s) {
            foreach ($ranks as $r) { $cards[] = $s.$r; }
        }
        return $cards;
    }

    private function handleChooseTrump($pid, $suit)
    {
        if ($this->status !== 'choosing_trump') return;
        if ($this->order[$this->currentTurnIndex] !== $pid) return;
        if (!in_array($suit, array('S','H','D','C'), true)) return;
        $this->trumpSuit = $suit;
        $this->status = 'playing';
        $this->leaderId = $pid;
        $this->currentTurnIndex = $this->indexOf($this->order, $pid);
        echo "[BELOTE {$this->id}] trump={$this->trumpSuit} leader={$this->leaderId}\n";
        $this->broadcastState();
        $this->sendPrivateStates();
    }

    private function handlePlayCard($pid, $card)
    {
        if ($this->status !== 'playing') return;
        if ($this->order[$this->currentTurnIndex] !== $pid) return;
        $hand = isset($this->hands[$pid]) ? $this->hands[$pid] : array();
        $idx = array_search($card, $hand, true);
        if ($idx === false) return;

        // Règles: vérifier si la carte est jouable
        $allowed = $this->playableCardsFor($pid);
        if (!in_array($card, $allowed, true)) {
            // Coup illégal ignoré
            return;
        }

        // play
        array_splice($hand, $idx, 1);
        $this->hands[$pid] = $hand;
        $this->trick[] = array('playerId' => $pid, 'card' => $card);
        echo "[BELOTE {$this->id}] play pid={$pid} card={$card} trickSize=" . count($this->trick) . "\n";
        $this->currentTurnIndex = ($this->currentTurnIndex + 1) % 4;

        if (count($this->trick) === 4) {
            $winnerId = $this->determineTrickWinnerBelote($this->trick, $this->trumpSuit);
            foreach ($this->trick as $entry) { $this->won[$winnerId][] = $entry['card']; }
            if (!isset($this->tricksWon[$winnerId])) { $this->tricksWon[$winnerId] = 0; }
            $this->tricksWon[$winnerId]++;
            $this->trick = array();
            $this->leaderId = $winnerId;
            $this->currentTurnIndex = $this->indexOf($this->order, $winnerId);
            $this->lastTrickWinnerId = $winnerId;
            echo "[BELOTE {$this->id}] trick winner={$winnerId}\n";
        }

        if ($this->finishIfOver(false)) {
            $this->broadcastState();
            $this->sendPrivateStates();
            return;
        }

        $this->broadcastState();
        $this->sendPrivateStates();
    }

    private function finishIfOver($force)
    {
        if ($this->status !== 'playing' && !$force) return false;
        $empty = true;
        foreach ($this->hands as $h) { if (!empty($h)) { $empty = false; break; } }
        if (!$empty && !$force) return false;
        // Si un pli en cours partiel, l'attribuer
        if (count($this->trick) > 0) {
            $winnerId = $this->determineTrickWinnerBelote($this->trick, $this->trumpSuit);
            foreach ($this->trick as $entry) { $this->won[$winnerId][] = $entry['card']; }
            if (!isset($this->tricksWon[$winnerId])) { $this->tricksWon[$winnerId] = 0; }
            $this->tricksWon[$winnerId]++;
            $this->lastTrickWinnerId = $winnerId;
            $this->trick = array();
            $this->leaderId = $winnerId;
            $this->currentTurnIndex = $this->indexOf($this->order, $winnerId);
        }
        $this->status = 'finished';
        $this->announceWinners();
        return true;
    }

    private function announceWinners()
    {
        // Team 0: seats 0 & 2; Team 1: seats 1 & 3
        $team0 = array(); $team1 = array();
        $team0Cards = 0; $team1Cards = 0;
        foreach ($this->order as $index => $pid) {
            $team = ($index % 2 === 0) ? 0 : 1;
            $count = isset($this->won[$pid]) ? count($this->won[$pid]) : 0;
            if ($team === 0) { $team0[] = $pid; $team0Cards += $count; }
            else { $team1[] = $pid; $team1Cards += $count; }
        }
        $winnerTeam = null;
        if ($team0Cards > $team1Cards) $winnerTeam = 0;
        elseif ($team1Cards > $team0Cards) $winnerTeam = 1;
        else {
            // Égalité: équipe du dernier pli l'emporte
            if ($this->lastTrickWinnerId !== null) {
                $idx = $this->indexOf($this->order, $this->lastTrickWinnerId);
                $winnerTeam = ($idx % 2 === 0) ? 0 : 1;
            } else {
                $winnerTeam = 0;
            }
        }
        $winners = ($winnerTeam === 0) ? $team0 : $team1;
        $winnersNames = array_map(function($id){ return $this->playerNameById($id); }, $winners);
        $msg = 'Belote — Gagnants (équipe ' . $winnerTeam . '): ' . implode(', ', $winnersNames);
        $this->broadcast(array('type' => 'notice', 'payload' => array('message' => $msg)));
        $payload = array(
            'result' => 'team_' . $winnerTeam,
            'winners' => $winners,
            'winnersNames' => $winnersNames,
        );
        $this->broadcast(array('type' => 'game_over', 'payload' => $payload));
    }

    private function determineTrickWinnerBelote(array $trick, $trump)
    {
        if (empty($trick)) return $this->leaderId ?: $this->order[0];
        $leadCard = $trick[0]['card'];
        $leadSuit = $leadCard[0];

        $best = $trick[0];
        $bestVal = $this->beloteCardRank($leadCard, $leadSuit, $trump);

        foreach ($trick as $entry) {
            $card = $entry['card'];
            $val = $this->beloteCardRank($card, $leadSuit, $trump);
            if ($val > $bestVal) { $best = $entry; $bestVal = $val; }
        }
        return $best['playerId'];
    }

    private function beloteCardRank($card, $leadSuit, $trump)
    {
        $suit = $card[0];
        $rankCode = substr($card, 1); // '7','8','9','10','J','Q','K','A'
        // Atout order: J(7), 9(6), A(5), 10(4), K(3), Q(2), 8(1), 7(0)
        // Non-atout order (lead suit only considered): A(7), 10(6), K(5), Q(4), J(3), 9(2), 8(1), 7(0)
        $trumpOrder = array('7'=>0,'8'=>1,'9'=>6,'10'=>4,'J'=>7,'Q'=>2,'K'=>3,'A'=>5);
        $nonOrder = array('7'=>0,'8'=>1,'9'=>2,'10'=>6,'J'=>3,'Q'=>4,'K'=>5,'A'=>7);
        if ($suit === $trump) {
            return 100 + $trumpOrder[$rankCode];
        }
        if ($suit === $leadSuit) {
            return 10 + $nonOrder[$rankCode];
        }
        return -1; // not winning
    }

    private function publicPlayers()
    {
        $out = array();
        foreach ($this->players as $conn) {
            $p = $this->players[$conn];
            $idx = $this->indexOf($this->order, $p['id']);
            $team = ($idx % 2 === 0) ? 0 : 1;
            $out[] = array(
                'id' => $p['id'],
                'name' => $p['name'],
                'seat' => isset($p['seat']) ? $p['seat'] : null,
                'team' => $team,
                'handCount' => isset($this->hands[$p['id']]) ? count($this->hands[$p['id']]) : 0,
                'wonCount' => isset($this->won[$p['id']]) ? count($this->won[$p['id']]) : 0,
                'tricksWon' => isset($this->tricksWon[$p['id']]) ? (int)$this->tricksWon[$p['id']] : 0,
            );
        }
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
            $isTurn = ($this->currentPlayerId() === $pid);
            $payload = array(
                'hand' => $hand,
                'isYourTurn' => $isTurn,
            );
            if ($this->status === 'playing' && $isTurn) {
                $payload['playable'] = $this->playableCardsFor($pid);
            }
            // Belote n'a pas de preneur ici
            $conn->send(json_encode(array('type' => 'your_hand', 'payload' => $payload)));
        }
    }

    private function currentPlayerId()
    {
        if (!in_array($this->status, array('choosing_trump','playing'), true)) return null;
        if (empty($this->order)) return null;
        return $this->order[$this->currentTurnIndex];
    }

    // Détermine les cartes jouables pour le joueur courant selon les règles de la Belote
    private function playableCardsFor($pid)
    {
        $hand = isset($this->hands[$pid]) ? $this->hands[$pid] : array();
        if ($this->status !== 'playing' || empty($hand)) return array();
        if (empty($this->trick)) {
            // Premier à jouer
            return $hand;
        }
        $leadCard = $this->trick[0]['card'];
        $leadSuit = $leadCard[0];
        $trump = $this->trumpSuit;

        $suitCards = array_values(array_filter($hand, function($c) use ($leadSuit){ return $c[0] === $leadSuit; }));
        $trumps = array_values(array_filter($hand, function($c) use ($trump){ return $trump !== null && $c[0] === $trump; }));

        // Si on doit suivre la couleur
        if ($leadSuit !== $trump) {
            if (!empty($suitCards)) {
                return $suitCards; // obligation de fournir la couleur demandée
            }
            // Pas de carte à la couleur demandée: obligation de couper si possible
            if (!empty($trumps)) {
                $highestTrumpInTrick = $this->highestTrumpInTrick($this->trick, $trump);
                if ($highestTrumpInTrick !== null) {
                    // Surcouper si possible
                    $overTrumps = array_values(array_filter($trumps, function($c) use ($leadSuit, $trump, $highestTrumpInTrick){
                        return $this->beloteCardRank($c, $leadSuit, $trump) > $this->beloteCardRank($highestTrumpInTrick, $leadSuit, $trump);
                    }));
                    return !empty($overTrumps) ? $overTrumps : $trumps;
                }
                return $trumps; // aucun atout encore joué dans le pli: n'importe quel atout
            }
            // Sinon, défausser n'importe quelle carte
            return $hand;
        } else { // Couleur demandée = atout
            if (!empty($trumps)) {
                // Obligation de fournir l'atout demandé et surcouper si possible
                $highestTrumpInTrick = $this->highestTrumpInTrick($this->trick, $trump);
                if ($highestTrumpInTrick !== null) {
                    $overTrumps = array_values(array_filter($trumps, function($c) use ($leadSuit, $trump, $highestTrumpInTrick){
                        return $this->beloteCardRank($c, $leadSuit, $trump) > $this->beloteCardRank($highestTrumpInTrick, $leadSuit, $trump);
                    }));
                    return !empty($overTrumps) ? $overTrumps : $trumps;
                }
                return $trumps;
            }
            // Pas d'atout: défausser n'importe quelle carte
            return $hand;
        }
    }

    private function highestTrumpInTrick(array $trick, $trump)
    {
        if ($trump === null) return null;
        $leadSuit = $trick[0]['card'][0];
        $bestCard = null; $bestVal = -INF;
        foreach ($trick as $entry) {
            $card = $entry['card'];
            if ($card[0] !== $trump) continue;
            $val = $this->beloteCardRank($card, $leadSuit, $trump);
            if ($val > $bestVal) { $bestVal = $val; $bestCard = $card; }
        }
        return $bestCard;
    }

    private function playerNameById($id)
    {
        foreach ($this->players as $conn) {
            $p = $this->players[$conn];
            if ($p['id'] === $id) return $p['name'];
        }
        return (string)$id;
    }

    private function indexOf($list, $value)
    {
        $idx = array_search($value, $list, true);
        return ($idx === false) ? 0 : (int)$idx;
    }

    private function rebuildOrder()
    {
        $tmp = array();
        foreach ($this->players as $conn) { $tmp[] = $this->players[$conn]; }
        usort($tmp, function($a,$b){ return ($a['seat'] - $b['seat']); });
        $this->order = array_map(function($p){ return $p['id']; }, $tmp);
    }

    public function getGameType() {
        return $this->game;
    }
}
