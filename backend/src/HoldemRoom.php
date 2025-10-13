<?php
namespace Tarot;

require_once __DIR__ . '/lib/PokerEvaluator.php';

use Ratchet\ConnectionInterface;
use SplObjectStorage;

class HoldemRoom implements GameRoom
{
    private $game = 'holdem';
    private $id;
    private $players; // SplObjectStorage<ConnectionInterface, array>

    private $status = 'waiting'; // waiting | dealing | showdown | finished
    private $dealerId = null;

    // Propriétés de table et distribution
    private $seats = array(); // ordered list of [id,name]
    private $order = array(); // ordered list of player ids (pour la donne en cours)
    private $hands = array(); // id => [card, card]
    private $community = array(); // 5 cards

    // Ajouts Hold'em étendu
    private $round = null; // 'preflop'|'flop'|'turn'|'river'
    private $smallBlind = 5;
    private $bigBlind = 10;
    private $initialStack = 1000; // mise initiale à l'arrivée dans la salle
    private $stacks = array();      // id => int (tapis restants)
    private $betsThisRound = array(); // id => int (mise courante de la street)
    private $totalContrib = array(); // id => int (mise cumulée du coup)
    private $folded = array();      // id => bool
    private $allin = array();       // id => bool
    private $currentTurnIndex = 0;  // index dans $order (prochain à parler)
    private $currentBet = 0;        // mise à atteindre sur la street
    private $minRaise = 0;          // relance minimum (BB ou dernière relance)
    private $lastAggressorId = null; // dernier relanceur
    private $acted = array();       // id => bool (a agi depuis la dernière relance)
    private $communityRevealed = 0; // 0,3,4,5
    private $name = '';

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
            'name' => $name ? (string)$name : ('Player#' . $conn->resourceId),
            'seat' => count($this->seats),
        );
        $this->players[$conn] = $info;
        $this->seats[] = array('id' => $info['id'], 'name' => $info['name']);
        // Mise initiale à l'arrivée si pas déjà assignée
        if (!isset($this->stacks[$info['id']])) { $this->stacks[$info['id']] = $this->initialStack; }
        $this->rebuildOrder();
        $this->broadcast([ 'type' => 'room_update', 'payload' => $this->serializeState() ]);
    }

    public function remove(ConnectionInterface $conn)
    {
        if (!isset($this->players[$conn])) return;
        $info = $this->players[$conn];
        unset($this->players[$conn]);
        $this->seats = array_values(array_filter($this->seats, function($p) use ($info){ return $p['id'] !== $info['id']; }));
        $this->rebuildOrder();
        unset($this->hands[$info['id']]);
        if (in_array($this->status, array('dealing','showdown'))) {
            $this->resetGame();
        }
        $this->broadcast([ 'type' => 'room_update', 'payload' => $this->serializeState() ]);
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
        // community visible selon la street
        $visibleCommunity = array_slice($this->community, 0, max(0, (int)$this->communityRevealed));
        return [
            'roomId' => $this->id,
            'game' => $this->game,
            'status' => $this->status,
            'dealerId' => $this->dealerId,
            'players' => $this->publicPlayers(),
            'community' => $visibleCommunity,
            // Infos Hold'em étendu
            'round' => $this->round,
            'currentPlayerId' => $this->currentPlayerId(),
            'currentBet' => $this->currentBet,
            'minRaise' => $this->minRaise,
            'smallBlind' => $this->smallBlind,
            'bigBlind' => $this->bigBlind,
            'potTotal' => $this->potTotal(),
        ];
    }

    public function serializeSummary()
    {
        return [
            'roomId' => $this->id,
            'name' => $this->name,
            'game' => $this->game,
            'players' => count($this->seats),
            'status' => $this->status,
        ];
    }

    public function startGame()
    {
        if ($this->status !== 'waiting' && $this->status !== 'finished') return;

        // Construire la liste des joueurs éligibles (>0 jetons) selon l'ordre des sièges
        $eligible = $this->eligibleOrder();
        if (count($eligible) < 2) { throw new \RuntimeException("Texas Hold'em: au moins deux joueurs doivent avoir des jetons pour démarrer."); }

        // Rotation du donneur parmi les éligibles
        if ($this->dealerId === null || !in_array($this->dealerId, $eligible, true)) {
            $this->dealerId = $eligible[0];
        } else {
            $idx = array_search($this->dealerId, $eligible, true);
            $this->dealerId = $eligible[($idx + 1) % count($eligible)];
        }

        // Restreindre l'ordre de la donne aux joueurs éligibles
        $this->order = $eligible;

        $this->setupNewDeal();
        $this->status = 'dealing';
        $this->round = 'preflop';
        $this->communityRevealed = 0;

        // Préparer structures de mise pour la donne (sans toucher aux stacks)
        $this->initBettingStructures();
        $this->prepareStacksForNewDeal();
        $this->postBlindsAndSetTurn();

        $this->broadcast([ 'type' => 'state', 'payload' => $this->serializeState() ]);
        $this->sendPrivateStates();
    }

    public function handleAction(ConnectionInterface $from, $action, array $params = array())
    {
        $pid = $from->resourceId;
        // Traiter restart et finish quel que soit le statut ou le joueur
        if ($action === 'restart') {
            error_log('[HoldemRoom] Action restart reçue pour la salle ' . $this->id);
            if (count($this->seats) < 2) return;
            $this->resetGame();
            $this->broadcast([ 'type' => 'notice', 'payload' => [ 'message' => 'Nouvelle donne…' ] ]);
            $this->startGame();
            $this->broadcast([ 'type' => 'state', 'payload' => $this->serializeState() ]);
            error_log('[HoldemRoom] Nouvelle donne lancée et état diffusé pour la salle ' . $this->id);
            return;
        }
        if ($action === 'finish') {
            if ($this->status !== 'finished') {
                $this->status = 'finished';
                $this->broadcast([ 'type' => 'state', 'payload' => $this->serializeState() ]);
            }
            return;
        }
        if ($this->status !== 'dealing') { return; }
        if ($this->currentPlayerId() !== $pid) { return; }
        if ($this->isFolded($pid) || $this->isAllin($pid)) { $this->advanceTurn(); return; }

        switch ($action) {
            case 'check':
                if ($this->currentBet == 0 || ($this->betsThisRound[$pid] ?? 0) === $this->currentBet) {
                    $this->acted[$pid] = true;
                    $this->advanceTurn();
                }
                break;
            case 'call':
                $toPay = max(0, $this->currentBet - ($this->betsThisRound[$pid] ?? 0));
                if ($toPay <= 0) { $this->acted[$pid] = true; $this->advanceTurn(); break; }
                $this->contribute($pid, $toPay); // gère all-in si stack insuffisant
                $this->acted[$pid] = true;
                $this->advanceTurn();
                break;
            case 'bet': { // uniquement si currentBet == 0
                $amt = isset($params['amount']) ? (int)$params['amount'] : 0;
                if ($this->currentBet !== 0) break;
                $min = $this->bigBlind; // mise minimale d'ouverture
                $amt = max($amt, $min);
                $amt = min($amt, ($this->stacks[$pid] ?? 0) + ($this->betsThisRound[$pid] ?? 0));
                $delta = $amt - ($this->betsThisRound[$pid] ?? 0);
                if ($delta <= 0) break;
                $this->contribute($pid, $delta);
                $this->minRaise = $amt; // première mise fixe la relance minimale
                $this->currentBet = $amt;
                $this->lastAggressorId = $pid;
                $this->resetActedExcept($pid);
                $this->acted[$pid] = true;
                $this->advanceTurn();
                break; }
            case 'raise_to': {
                $to = isset($params['to']) ? (int)$params['to'] : 0;
                $curr = ($this->betsThisRound[$pid] ?? 0);
                if ($to <= $this->currentBet) break; // doit dépasser
                $minTo = $this->currentBet + max($this->minRaise, $this->bigBlind);
                if ($to < $minTo) $to = $minTo;
                $delta = $to - $curr;
                $this->contribute($pid, $delta);
                $this->minRaise = $to - $this->currentBet; // nouvelle relance minimale
                $this->currentBet = max($this->currentBet, ($this->betsThisRound[$pid] ?? 0));
                $this->lastAggressorId = $pid;
                $this->resetActedExcept($pid);
                $this->acted[$pid] = true;
                $this->advanceTurn();
                break; }
            case 'fold':
                $this->folded[$pid] = true;
                $this->acted[$pid] = true;
                // Si un seul joueur reste non couché → gagne tout de suite
                if ($this->activePlayersCount() <= 1) { $this->awardAllToLastStanding(); return; }
                $this->advanceTurn();
                break;
            default:
                $this->broadcast([ 'type' => 'notice', 'payload' => [ 'message' => "Texas Hold'em: action non reconnue." ] ]);
        }
    }

    private function resetGame()
    {
        $this->status = 'waiting';
        $this->hands = array();
        $this->community = array();
        $this->round = null;
        $this->betsThisRound = array();
        $this->totalContrib = array();
        $this->folded = array();
        $this->allin = array();
        $this->currentBet = 0;
        $this->minRaise = 0;
        $this->lastAggressorId = null;
        $this->acted = array();
        $this->communityRevealed = 0;
        // Remettre l'ordre global des sièges pour la prochaine éligibilité
        $this->rebuildOrder();
    }

    private function setupNewDeal()
    {
        $deck = $this->generateDeck52();
        shuffle($deck);
        $this->hands = array();
        foreach ($this->order as $pid) { $this->hands[$pid] = array(); }

        // Deal 2 cartes à chaque joueur éligible
        for ($r=0; $r<2; $r++) { foreach ($this->order as $pid) { $this->hands[$pid][] = array_pop($deck); } }
        // Préparer les 5 communes (révélées progressivement)
        $this->community = array(array_pop($deck), array_pop($deck), array_pop($deck), array_pop($deck), array_pop($deck));
    }

    private function prepareStacksForNewDeal()
    {
        foreach ($this->order as $pid) {
            // Ne pas toucher au montant du stack; réinitialiser l'état de la donne
            $this->folded[$pid] = false;
            $this->allin[$pid] = ($this->stacks[$pid] ?? 0) <= 0; // à tapis si 0
            $this->totalContrib[$pid] = 0;
        }
    }

    private function initBettingStructures()
    {
        $this->betsThisRound = array();
        $this->acted = array();
        foreach ($this->order as $pid) { $this->betsThisRound[$pid] = 0; $this->acted[$pid] = false; }
        $this->currentBet = 0;
        $this->minRaise = $this->bigBlind;
        $this->lastAggressorId = null;
    }

    private function postBlindsAndSetTurn()
    {
        $n = count($this->order);
        $dIdx = $this->indexOf($this->order, $this->dealerId);
        $sbIdx = ($dIdx + 1) % $n; $sbId = $this->order[$sbIdx];
        $bbIdx = ($dIdx + 2) % $n; $bbId = $this->order[$bbIdx];
        $this->postBlind($sbId, $this->smallBlind);
        $this->postBlind($bbId, $this->bigBlind);
        $this->currentBet = $this->bigBlind;
        $this->minRaise = $this->bigBlind;
        $this->lastAggressorId = $bbId;
        // UTG: joueur à gauche du BB
        $this->currentTurnIndex = $this->nextActiveIndex($bbIdx);
    }

    private function postBlind($pid, $amt)
    {
        $this->contribute($pid, min($amt, $this->stacks[$pid] ?? 0));
        $this->acted[$pid] = false; // le blindeur n'a pas encore "agi"
    }

    private function contribute($pid, $delta)
    {
        if ($delta <= 0) return;
        $stack = $this->stacks[$pid] ?? 0;
        $pay = min($delta, $stack);
        $this->stacks[$pid] = $stack - $pay;
        $this->betsThisRound[$pid] = ($this->betsThisRound[$pid] ?? 0) + $pay;
        $this->totalContrib[$pid] = ($this->totalContrib[$pid] ?? 0) + $pay;
        if ($this->stacks[$pid] <= 0) { $this->allin[$pid] = true; }
    }

    private function advanceTurn()
    {
        // Fin de street si tout le monde a agi et égalisé la mise (ou all-in/fold)
        if ($this->isBettingRoundOver()) {
            $this->finishStreetOrShowdown();
            return;
        }
        // Sinon, passer au prochain joueur actif non couché et non all-in
        $this->currentTurnIndex = $this->nextActiveIndex($this->currentTurnIndex);
        $this->broadcast([ 'type' => 'state', 'payload' => $this->serializeState() ]);
        $this->sendPrivateStates();
    }

    private function isBettingRoundOver()
    {
        $active = $this->activePlayers();
        if (count($active) <= 1) return true;
        foreach ($active as $pid) {
            if ($this->isAllin($pid)) continue;
            $b = $this->betsThisRound[$pid] ?? 0;
            if ($b !== $this->currentBet) return false;
            if (!($this->acted[$pid] ?? false)) return false;
        }
        return true;
    }

    private function finishStreetOrShowdown()
    {
        // Tout le monde a égalisé ou est à tapis / couché
        // Si pas river, révéler la prochaine carte et démarrer une nouvelle street
        if ($this->round === 'preflop') {
            $this->communityRevealed = 3; $this->round = 'flop';
            $this->startNewStreetFromDealer();
            $this->broadcast([ 'type' => 'state', 'payload' => $this->serializeState() ]);
            $this->evaluateHands(); // Ajouté : envoie la probabilité après le flop
            $this->sendPrivateStates();
        } elseif ($this->round === 'flop') {
            $this->communityRevealed = 4; $this->round = 'turn';
            $this->startNewStreetFromDealer();
            $this->broadcast([ 'type' => 'state', 'payload' => $this->serializeState() ]);
            $this->evaluateHands(); // Ajouté : envoie la probabilité après le turn
            $this->sendPrivateStates();
        } elseif ($this->round === 'turn') {
            $this->communityRevealed = 5; $this->round = 'river';
            $this->startNewStreetFromDealer();
            $this->broadcast([ 'type' => 'state', 'payload' => $this->serializeState() ]);
            $this->evaluateHands(); // Ajouté : envoie la probabilité après la river
            $this->sendPrivateStates();
        } else { // river → showdown
            $this->status = 'showdown';
            $this->broadcast([ 'type' => 'state', 'payload' => $this->serializeState() ]);
            $this->announceWinnersSidePots();
            $this->evaluateHands(); // Évaluer les mains des joueurs restants
            $this->status = 'finished';
            $this->broadcast([ 'type' => 'state', 'payload' => $this->serializeState() ]);
            return;
        }
    }

    private function startNewStreetFromDealer()
    {
        // Réinitialiser la street
        $this->betsThisRound = array(); $this->acted = array();
        foreach ($this->order as $pid) { $this->betsThisRound[$pid] = 0; $this->acted[$pid] = $this->isFolded($pid) || $this->isAllin($pid); }
        $this->currentBet = 0; $this->minRaise = $this->bigBlind; $this->lastAggressorId = null;
        // Premier à parler: joueur actif à gauche du donneur
        $dIdx = $this->indexOf($this->order, $this->dealerId);
        $this->currentTurnIndex = $this->nextActiveIndex($dIdx);
    }

    private function awardAllToLastStanding()
    {
        // Un seul joueur reste non couché: il gagne tout le pot sans showdown
        $winner = null; foreach ($this->order as $pid) { if (!$this->isFolded($pid)) { $winner = $pid; break; } }
        if ($winner === null) { $this->status = 'finished'; return; }
        $sum = 0; foreach ($this->totalContrib as $v) { $sum += (int)$v; }
        $this->stacks[$winner] = ($this->stacks[$winner] ?? 0) + $sum;
        $winnersNames = array($this->playerNameById($winner));
        $this->broadcast(array('type' => 'notice', 'payload' => array('message' => "Texas Hold'em — Gagnant par abandon: " . implode(', ', $winnersNames))));
        $this->broadcast(array('type' => 'game_over', 'payload' => array('result' => 'folds', 'winners' => array($winner), 'winnersNames' => $winnersNames)));
        $this->status = 'finished';
        $this->broadcast([ 'type' => 'state', 'payload' => $this->serializeState() ]);
    }

    private function announceWinnersSidePots()
    {
        // Construire les contributions restantes (copie)
        $contrib = $this->totalContrib;
        // Participants encore en lice
        $eligible = array(); foreach ($this->order as $pid) { if (!$this->isFolded($pid)) $eligible[$pid] = true; }
        $pots = array();
        while (true) {
            // Vérifier s'il reste de la contribution
            $positive = array_filter($contrib, function($v){ return $v > 0; });
            if (empty($positive)) break;
            // Trouver le plus petit niveau d'all-in/contrib (>0)
            $cap = min($positive);
            // Montant du pot
            $amount = 0; $eligibleForPot = array();
            foreach ($contrib as $pid => $v) {
                $take = min($v, $cap);
                if ($take > 0) {
                    $amount += $take;
                    $contrib[$pid] -= $take;
                    if (!$this->isFolded($pid)) { $eligibleForPot[$pid] = true; }
                }
            }
            if ($amount > 0) {
                $pots[] = array('amount' => $amount, 'eligible' => array_keys($eligibleForPot));
            } else break;
        }
        // Évaluer les mains des joueurs non couchés
        $scores = array(); foreach ($eligible as $pid => $_) { $scores[$pid] = $this->evaluateHoldem($this->hands[$pid] ?? array(), $this->community); }
        // Attribuer chaque pot au(x) meilleur(s) parmi éligibles
        foreach ($pots as $pot) {
            $cands = $pot['eligible']; if (empty($cands)) continue;
            $best = null; $winners = array();
            foreach ($cands as $pid) {
                $sc = $scores[$pid] ?? array(0);
                if ($best === null || $this->compareScores($sc, $best) > 0) { $best = $sc; $winners = array($pid); }
                elseif ($this->compareScores($sc, $best) === 0) { $winners[] = $pid; }
            }
            // Split équitable (reste perdu ou donné au premier)
            $share = intdiv($pot['amount'], max(1, count($winners)));
            $rem = $pot['amount'] - $share * count($winners);
            foreach ($winners as $i => $pid) {
                $gain = $share + (($i === 0) ? $rem : 0);
                $this->stacks[$pid] = ($this->stacks[$pid] ?? 0) + $gain;
            }
            $winnerNames = array_map(function($id){ return $this->playerNameById($id); }, $winners);
            $this->broadcast(array('type' => 'notice', 'payload' => array('message' => "Pot " . $pot['amount'] . " → " . implode(', ', $winnerNames))));
        }
        // Annonce finale
        // Déterminer les gagnants globaux (dernier pot)
        if (!empty($pots)) {
            $last = end($pots); $w = array();
            // recompute winners of last pot for message
            $best = null; foreach ($last['eligible'] as $pid) { $sc = $scores[$pid] ?? array(0); if ($best === null || $this->compareScores($sc,$best)>0) { $best=$sc; $w=array($pid);} elseif ($this->compareScores($sc,$best)===0) { $w[]=$pid; } }
            $names = array_map(function($id){ return $this->playerNameById($id); }, $w);
            $this->broadcast(array('type' => 'game_over', 'payload' => array('result' => 'showdown', 'winners' => $w, 'winnersNames' => $names)));
        }
    }

    private function currentPlayerId()
    {
        if ($this->status !== 'dealing') return null;
        $n = count($this->order); if ($n === 0) return null;
        $i = $this->currentTurnIndex % $n;
        // Vérifier que le joueur est actif
        $loops = 0;
        while ($loops < $n && ($this->isFolded($this->order[$i]) || $this->isAllin($this->order[$i]))) { $i = ($i + 1) % $n; $loops++; }
        return $this->order[$i];
    }

    private function isFolded($pid) { return isset($this->folded[$pid]) && $this->folded[$pid]; }
    private function isAllin($pid) { return isset($this->allin[$pid]) && $this->allin[$pid]; }

    private function nextActiveIndex($fromIdx)
    {
        $n = count($this->order); if ($n === 0) return 0;
        $i = ($fromIdx + 1) % $n; $loops = 0;
        while ($loops < $n) {
            $pid = $this->order[$i];
            if (!$this->isFolded($pid) && !$this->isAllin($pid)) return $i;
            $i = ($i + 1) % $n; $loops++;
        }
        return $i;
    }

    private function potTotal()
    {
        $sum = 0; foreach ($this->totalContrib as $v) { $sum += (int)$v; } return $sum;
    }

    private function resetActedExcept($pid)
    {
        foreach ($this->order as $id) { $this->acted[$id] = ($this->isFolded($id) || $this->isAllin($id) || $id === $pid); }
    }

    private function activePlayers()
    {
        $out = array(); foreach ($this->order as $pid) { if (!$this->isFolded($pid)) $out[] = $pid; } return $out;
    }
    private function activePlayersCount() { return count($this->activePlayers()); }

    private function sendPrivateStates()
    {
        foreach ($this->players as $conn) {
            $p = $this->players[$conn]; $pid = $p['id'];
            $hand = isset($this->hands[$pid]) ? $this->hands[$pid] : array();
            $isTurn = ($this->currentPlayerId() === $pid);
            $payload = array('hand' => $hand, 'isYourTurn' => $isTurn);
            if ($this->status === 'dealing' && $isTurn && !$this->isFolded($pid) && !$this->isAllin($pid)) {
                $payload['allowed'] = $this->allowedActionsFor($pid);
            }
            $conn->send(json_encode(array('type' => 'your_hand', 'payload' => $payload)));
        }
    }

    private function allowedActionsFor($pid)
    {
        $allowed = array('fold' => false, 'check' => false, 'call' => 0, 'minBet' => 0, 'minRaiseTo' => 0);
        $b = $this->betsThisRound[$pid] ?? 0;
        if ($this->currentBet == 0) {
            $allowed['check'] = true;
            $allowed['minBet'] = min(max($this->bigBlind, 1), ($this->stacks[$pid] ?? 0) + $b);
        } else {
            $toPay = max(0, $this->currentBet - $b);
            $allowed['fold'] = $toPay > 0;
            $allowed['call'] = min($toPay, $this->stacks[$pid] ?? 0);
            // Autoriser "check" si déjà égalisé (ex: big blind quand personne n'a relancé)
            if ($toPay === 0) { $allowed['check'] = true; }
            $allowed['minRaiseTo'] = $this->currentBet + max($this->minRaise, $this->bigBlind);
        }
        return $allowed;
    }

    private function publicPlayers()
    {
        $out = [];
        foreach ($this->players as $conn) {
            $p = $this->players[$conn]; $pid = $p['id'];
            $out[] = [
                'id' => $pid,
                'name' => $p['name'],
                'seat' => isset($p['seat']) ? $p['seat'] : null,
                'handCount' => isset($this->hands[$pid]) ? count($this->hands[$pid]) : 0,
                'stack' => $this->stacks[$pid] ?? null,
                'bet' => $this->betsThisRound[$pid] ?? 0,
                'folded' => $this->folded[$pid] ?? false,
                'allin' => $this->allin[$pid] ?? false,
            ];
        }
        usort($out, function($a,$b){ return ($a['seat'] - $b['seat']); });
        return $out;
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

    private function eligibleOrder()
    {
        // Basé sur $this->seats (ordre stable), filtrer par stack > 0
        $eligible = array();
        foreach ($this->seats as $s) {
            $pid = $s['id'];
            if (($this->stacks[$pid] ?? 0) > 0) { $eligible[] = $pid; }
        }
        return $eligible;
    }

    private function generateDeck52()
    {
        $cards = array();
        $suits = array('S','H','D','C');
        $ranks = array('2','3','4','5','6','7','8','9','10','J','Q','K','A');
        foreach ($suits as $s) { foreach ($ranks as $r) { $cards[] = $s.$r; } }
        return $cards;
    }

    // Évaluation simplifiée d'une main Hold'em
    private function evaluateHoldem(array $hand, array $board)
    {
        $all = array_merge($hand, $board);
        // Extraire rangs et couleurs
        $rvals = array_map(function($c){ return $this->rankVal(substr($c, 1)); }, $all);
        $suits = array_map(function($c){ return $c[0]; }, $all);

        // Comptes par rang
        $rankCounts = array();
        foreach ($all as $c) {
            $r = substr($c,1);
            $v = $this->rankVal($r);
            $rankCounts[$v] = isset($rankCounts[$v]) ? ($rankCounts[$v]+1) : 1;
        }
        krsort($rankCounts); // rangs décroissants

        // Flush?
        $suitCounts = array();
        foreach ($suits as $s) { $suitCounts[$s] = isset($suitCounts[$s]) ? ($suitCounts[$s]+1) : 1; }
        $flushSuit = null;
        foreach ($suitCounts as $s=>$cnt) { if ($cnt >= 5) { $flushSuit = $s; break; } }
        $flushRanks = array();
        if ($flushSuit !== null) {
            foreach ($all as $c) { if ($c[0] === $flushSuit) { $flushRanks[] = $this->rankVal(substr($c,1)); } }
            rsort($flushRanks);
            $flushRanks = array_values(array_unique($flushRanks));
            $flushTop5 = array_slice($flushRanks, 0, 5);
        } else { $flushTop5 = array(); }

        // Straight?
        $uniqRanks = array_values(array_unique(array_map(function($c){ return $this->rankVal(substr($c,1)); }, $all)));
        sort($uniqRanks);
        // Ajouter As bas (1) pour wheel
        if (in_array(14, $uniqRanks, true)) { $uniqRanks[] = 1; sort($uniqRanks); }
        $straightHigh = $this->findStraightHigh($uniqRanks);

        // Straight flush?
        $sfHigh = null;
        if ($flushSuit !== null) {
            $ranksInFlush = array();
            foreach ($all as $c) { if ($c[0] === $flushSuit) { $rv = $this->rankVal(substr($c,1)); $ranksInFlush[$rv]=true; } }
            $fr = array_keys($ranksInFlush);
            sort($fr);
            if (in_array(14, $fr, true)) { $fr[] = 1; sort($fr); }
            $sfHigh = $this->findStraightHigh($fr);
        }

        // Catégorisation par occurrences
        $quads = array_keys(array_filter($rankCounts, function($n){ return $n===4; }));
        $trips = array_keys(array_filter($rankCounts, function($n){ return $n===3; }));
        $pairs = array_keys(array_filter($rankCounts, function($n){ return $n===2; }));
        $singles = array_keys(array_filter($rankCounts, function($n){ return $n===1; }));

        // Déterminer la meilleure catégorie avec tiebreakers (heurstique suffisante pour proto)
        // 8: straight flush
        if ($sfHigh !== null) return array(8, $sfHigh);
        // 7: four of a kind
        if (!empty($quads)) {
            $kicker = $this->topFrom(array_merge($trips, $pairs, $singles), 1);
            return array(7, max($quads), $kicker[0] ?? 0);
        }
        // 6: full house (trip + pair/trip)
        if (!empty($trips) && (count($pairs) > 0 || count($trips) > 1)) {
            rsort($trips); rsort($pairs);
            $trip = $trips[0];
            $pair = (count($trips) > 1) ? $trips[1] : $pairs[0];
            return array(6, $trip, $pair);
        }
        // 5: flush
        if ($flushSuit !== null && count($flushTop5) >= 5) {
            return array_merge(array(5), $flushTop5);
        }
        // 4: straight
        if ($straightHigh !== null) return array(4, $straightHigh);
        // 3: three of a kind
        if (!empty($trips)) {
            $k = $this->topFrom(array_merge($pairs, $singles), 2);
            return array(3, max($trips), $k[0] ?? 0, $k[1] ?? 0);
        }
        // 2: two pairs
        if (count($pairs) >= 2) {
            rsort($pairs);
            $k = $this->topFrom($singles, 1);
            return array(2, $pairs[0], $pairs[1], $k[0] ?? 0);
        }
        // 1: one pair
        if (count($pairs) === 1) {
            rsort($singles);
            $k = array_slice($singles, 0, 3);
            return array_merge(array(1, $pairs[0]), $k);
        }
        // 0: high card
        rsort($singles);
        $k = array_slice($singles, 0, 5);
        return array_merge(array(0), $k);
    }

    private function topFrom(array $vals, $n)
    {
        rsort($vals);
        $vals = array_values(array_unique($vals));
        return array_slice($vals, 0, $n);
    }

    private function rankVal($r)
    {
        switch ($r) {
            case 'J': return 11;
            case 'Q': return 12;
            case 'K': return 13;
            case 'A': return 14;
            default: return (int)$r; // '2'..'10'
        }
    }

    private function findStraightHigh(array $sortedVals)
    {
        $bestHigh = null; $run = 1; $last = null;
        foreach ($sortedVals as $v) {
            if ($last === null || $v === $last) { $run = 1; }
            elseif ($v === $last + 1) { $run++; }
            else { $run = 1; }
            if ($run >= 5) { $bestHigh = $v; }
            $last = $v;
        }
        return $bestHigh;
    }

    private function compareScores(array $a, array $b)
    {
        $na = count($a); $nb = count($b); $n = max($na, $nb);
        for ($i=0; $i<$n; $i++) {
            $va = $a[$i] ?? 0; $vb = $b[$i] ?? 0;
            if ($va === $vb) continue;
            return ($va > $vb) ? 1 : -1;
        }
        return 0;
    }

    // Simulation Monte Carlo pour estimer la probabilité de gagner de chaque joueur
    private function simulateWinProbabilities($numSimulations = 500)
    {
        $playerIds = [];
        $playerHands = [];
        foreach ($this->players as $conn) {
            $id = $conn->resourceId;
            if (!empty($this->folded[$id])) continue;
            if (!isset($this->hands[$id]) || count($this->hands[$id]) < 2) continue;
            $playerIds[] = $id;
            $playerHands[$id] = $this->hands[$id];
        }
        if (count($playerIds) < 2) return array();
        $community = $this->community;
        $revealed = $this->communityRevealed;
        $knownCommunity = array_slice($community, 0, $revealed);
        $unknownCount = 5 - $revealed;
        // Construire le deck restant
        $deck = $this->generateDeck52();
        // Retirer toutes les cartes déjà distribuées
        foreach ($playerHands as $hand) foreach ($hand as $c) {
            $idx = array_search($c, $deck); if ($idx !== false) unset($deck[$idx]);
        }
        foreach ($knownCommunity as $c) {
            $idx = array_search($c, $deck); if ($idx !== false) unset($deck[$idx]);
        }
        $deck = array_values($deck);
        // Compteur de victoires
        $winCounts = array_fill_keys($playerIds, 0);
        for ($sim = 0; $sim < $numSimulations; $sim++) {
            $simDeck = $deck;
            shuffle($simDeck);
            $simCommunity = $knownCommunity;
            for ($i = 0; $i < $unknownCount; $i++) {
                $simCommunity[] = array_pop($simDeck);
            }
            // Évaluer chaque main
            $scores = [];
            foreach ($playerIds as $id) {
                $fullHand = array_merge($playerHands[$id], $simCommunity);
                $result = \PokerEvaluator::evaluate($fullHand);
                $scores[$id] = $result['value'];
            }
            $maxScore = max($scores);
            $winners = array_keys(array_filter($scores, function($v) use ($maxScore) { return $v === $maxScore; }));
            foreach ($winners as $id) {
                $winCounts[$id] += 1.0 / count($winners); // split pot
            }
        }
        // Calcul du pourcentage
        $probs = [];
        foreach ($winCounts as $id => $count) {
            $probs[$id] = round(100 * $count / $numSimulations, 1);
        }
        // DEBUG TEMP : journaliser les joueurs et les probabilités calculées
        error_log('simulateWinProbabilities: playerIds=' . json_encode($playerIds));
        error_log('simulateWinProbabilities: playerHands=' . json_encode($playerHands));
        error_log('simulateWinProbabilities: probs=' . json_encode($probs));
        return $probs;
    }

    private function evaluateHands()
    {
        // On suppose que $this->community contient les 5 cartes du board
        // et $this->hands[id] contient les 2 cartes du joueur
        // Détermination du ou des gagnants au showdown
        $scores = [];
        foreach ($this->players as $conn) {
            $id = $conn->resourceId;
            if (!empty($this->folded[$id])) continue;
            if (!isset($this->hands[$id]) || count($this->hands[$id]) < 2) continue;
            $playerHand = $this->hands[$id];
            $fullHand = array_merge($playerHand, $this->community);
            $result = \PokerEvaluator::evaluate($fullHand);
            $scores[$id] = $result['value'];
        }
        $maxScore = empty($scores) ? null : max($scores);
        // Correction : synchroniser communityRevealed avec le nombre de cartes du board si besoin
        if (count($this->community) === 5 && $this->communityRevealed < 5) {
            $this->communityRevealed = 5;
        }
        // Calculer les probabilités si pas showdown
        $probs = ($this->round !== 'showdown') ? $this->simulateWinProbabilities(500) : [];
        foreach ($this->players as $conn) {
            $id = $conn->resourceId;
            if (!empty($this->folded[$id])) continue;
            if (!isset($this->hands[$id]) || count($this->hands[$id]) < 2) continue;
            $playerHand = $this->hands[$id];
            $fullHand = array_merge($playerHand, $this->community);
            $result = \PokerEvaluator::evaluate($fullHand);
            // Probabilité de gagner : simulation Monte Carlo ou 100%/0% au showdown
            $winProb = ($this->round === 'showdown')
                ? (($scores[$id] === $maxScore) ? 100 : 0)
                : (isset($probs[$id]) ? $probs[$id] : '—');
            $conn->send(json_encode([
                'type' => 'hand_evaluation',
                'payload' => [
                    'playerId' => $id,
                    'hand' => $fullHand,
                    'rank' => $result['handTypeString'] ?? '',
                    'value' => $result['value'],
                    'winProb' => $winProb,
                    'allWinProbs' => $probs, // Ajout : toutes les probabilités
                    'round' => $this->round,
                ]
            ]));
        }
    }
}
