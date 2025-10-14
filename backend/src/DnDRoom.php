<?php
namespace Tarot;

require_once __DIR__ . '/Room.php';
require_once __DIR__ . '/GameRoom.php';

use Ratchet\ConnectionInterface;

class DnDRoom extends Room implements GameRoom {
    public $game = 'dnd5e';
    public $dndPlayers = [];
    public $monsters = [];
    public $initiativeOrder = [];
    public $turnIndex = 0;
    public $log = [];
    public $status = 'waiting'; // waiting | fighting | finished
    private $minPlayers = 2;
    private $maxPlayers = 6;

    public function __construct($roomId) {
        parent::__construct($roomId);
        $this->game = 'dnd5e';
        $this->dndPlayers = [];
        $this->monsters = [];
        $this->initiativeOrder = [];
        $this->turnIndex = 0;
        $this->log = [];
        $this->status = 'waiting';
    }

    public function addPlayer($player) {
        // Empêcher l'ajout d'un joueur mort
        if (isset($player['status']) && $player['status'] === 'Dead') {
            return;
        }
        $player['level'] = 1;
        $player['xp'] = 0; // Ajout XP
        $player['hp'] = $player['max_hp'] = 20;
        $player['dmg'] = 5;
        $player['ac'] = 12;
        $player['dex'] = 13;
        $player['status'] = 'OK';
        $player['gold'] = 0; // Ajout or
        $player['potions'] = 0; // Ajout potions
        $this->dndPlayers[$player['id']] = $player;
    }

    public function setMonsters($monsters) {
        $this->monsters = [];
        foreach ($monsters as $i => $m) {
            $id = 'M' . $i;
            $this->monsters[$id] = [
                'id' => $id,
                'name' => $m['name'],
                'hp' => $m['hp'],
                'max_hp' => $m['max_hp'],
                'dmg' => $m['dmg'],
                'ac' => $m['ac'],
                'cr' => $m['cr'], // Utilisé comme niveau du monstre
                'dex' => $m['dex'],
                'xp' => $m['xp'] ?? 50, // XP par défaut si non fourni
                'status' => 'OK',
            ];
        }
    }

    // Remet tous les monstres à leur état initial (hp, status)
    public function resetMonsters() {
        foreach ($this->monsters as &$m) {
            $m['hp'] = $m['max_hp'];
            $m['status'] = 'OK';
        }
    }

    public function startCombat() {
        // Retirer les joueurs morts de l'ordre d'initiative
        foreach ($this->dndPlayers as $id => $p) {
            if ($p['status'] === 'Dead') {
                unset($this->dndPlayers[$id]);
            }
        }
        $this->status = 'fighting';
        $this->rollInitiative();
        $this->turnIndex = 0;
        $this->log[] = ['system', 'Début du combat !'];
        $this->nextTurn(); // Démarre le tour immédiatement
    }

    public function rollInitiative() {
        $order = [];
        foreach ($this->dndPlayers as $p) {
            if ($p['status'] === 'OK') {
                $order[] = [
                    'id' => $p['id'],
                    'type' => 'player',
                    'roll' => rand(1, 20) + $p['dex'],
                ];
            }
        }
        foreach ($this->monsters as $m) {
            if ($m['status'] === 'OK') {
                $order[] = [
                    'id' => $m['id'],
                    'type' => 'monster',
                    'roll' => rand(1, 20) + $m['dex'],
                ];
            }
        }
        usort($order, function($a, $b) { return $b['roll'] <=> $a['roll']; });
        $this->initiativeOrder = $order;
    }

    public function nextTurn() {
        if ($this->status !== 'fighting') return;
        $n = count($this->initiativeOrder);
        $looped = 0;
        while ($looped < $n) {
            $entity = $this->initiativeOrder[$this->turnIndex];
            if ($entity['type'] === 'player' && $this->dndPlayers[$entity['id']]['status'] === 'OK') {
                // C'est au tour d'un joueur vivant : on attend l'action du joueur
                $this->broadcast(['type' => 'state', 'payload' => $this->serializeState()]);
                // On ne fait PAS avancer le tour ici, on attend l'action du joueur
                return;
            }
            if ($entity['type'] === 'monster' && $this->monsters[$entity['id']]['status'] === 'OK') {
                // Tour d'un monstre : il attaque automatiquement un joueur vivant
                $targets = array_filter($this->dndPlayers, function($p) { return $p['status'] === 'OK'; });
                if (!empty($targets)) {
                    $target = $targets[array_rand($targets)];
                    $this->attack($entity['id'], $target['id']);
                }
                $this->broadcast(['type' => 'state', 'payload' => $this->serializeState()]);
                $this->turnIndex = ($this->turnIndex + 1) % $n;
                $looped++;
                // Continue la boucle pour traiter le prochain monstre ou joueur
                continue;
            }
            // Si l'entité courante est morte, passer à la suivante
            $this->turnIndex = ($this->turnIndex + 1) % $n;
            $looped++;
        }
        // Si plus personne n'est vivant
        $this->status = 'finished';
        $this->log[] = ['system', 'Fin du combat.'];
        $this->broadcast(['type' => 'state', 'payload' => $this->serializeState()]);
    }

    public function attack($attackerId, $targetId) {
        // Détermine si c'est un joueur ou un monstre qui attaque
        $attacker = null;
        $attackerType = null;
        if (isset($this->dndPlayers[$attackerId])) {
            $attacker = &$this->dndPlayers[$attackerId];
            $attackerType = 'player';
        } elseif (isset($this->monsters[$attackerId])) {
            $attacker = &$this->monsters[$attackerId];
            $attackerType = 'monster';
        }
        $target = null;
        if (isset($this->dndPlayers[$targetId])) {
            $target = &$this->dndPlayers[$targetId];
        } elseif (isset($this->monsters[$targetId])) {
            $target = &$this->monsters[$targetId];
        }
        if (!$attacker || !$target || $attacker['status'] !== 'OK' || $target['status'] !== 'OK') return;
        // Jet d'attaque avec modificateur de niveau
        $attackerLevel = isset($attacker['level']) ? $attacker['level'] : (isset($attacker['cr']) ? $attacker['cr'] : 1);
        $attackerDex = $attacker['dex'] ?? 0;
        $attackBonus = floor($attackerLevel / 2) + $attackerDex;
        $roll = rand(1, 20);
        $hit = ($roll + $attackBonus) >= $target['ac'];
        if ($hit) {
            $target['hp'] -= $attacker['dmg'];
            $this->log[] = [$attacker['name'], "attaque {$target['name']} (touché, -{$attacker['dmg']} PV)"];
            if ($target['hp'] <= 0) {
                $target['hp'] = 0;
                $target['status'] = 'Dead';
                $this->log[] = ['system', "{$target['name']} est mort !"];
                // Attribution de l'XP si un joueur tue un monstre
                if ($attackerType === 'player' && isset($this->monsters[$targetId])) {
                    $xpGain = $this->monsters[$targetId]['xp'] ?? 0;
                    $attacker['xp'] += $xpGain;
                    $this->log[] = ['system', "{$attacker['name']} gagne {$xpGain} XP !"];
                    $this->checkLevelUp($attackerId);
                }
            }
        } else {
            $this->log[] = [$attacker['name'], "attaque {$target['name']} (raté)"];
        }
        // Vérifier si tous les monstres sont morts
        $monstresVivants = array_filter($this->monsters, function($m) { return $m['status'] === 'OK'; });
        if (count($this->monsters) > 0 && count($monstresVivants) === 0) {
            $this->status = 'finished';
            $this->grantTreasure(); // Ajout du trésor
            $this->broadcast(['type' => 'state', 'payload' => $this->serializeState()]);
        }
    }

    // Système de montée de niveau
    public function checkLevelUp($playerId) {
        if (!isset($this->dndPlayers[$playerId])) return;
        $player = &$this->dndPlayers[$playerId];
        $xp = $player['xp'];
        $level = $player['level'];
        // Table de progression simple : niveau 2 à 100 XP, 3 à 300, 4 à 600, etc.
        $levelThresholds = [1 => 0, 2 => 100, 3 => 300, 4 => 600, 5 => 1000, 6 => 1500, 7 => 2100, 8 => 2800, 9 => 3600, 10 => 4500];
        $newLevel = $level;
        foreach ($levelThresholds as $lvl => $thresh) {
            if ($xp >= $thresh) {
                $newLevel = $lvl;
            }
        }
        if ($newLevel > $level) {
            $player['level'] = $newLevel;
            // Amélioration des stats à chaque niveau
            $player['max_hp'] += 5 * ($newLevel - $level);
            $player['hp'] = $player['max_hp'];
            $player['dmg'] += 1 * ($newLevel - $level);
            $player['ac'] += 1 * ($newLevel - $level);
            $this->log[] = ['system', "{$player['name']} passe niveau {$newLevel} ! Stats augmentées."];
        }
    }

    public function handleAction($from, $action, $params = array()) {
        switch ($action) {
            case 'start_combat':
                // Autoriser le redémarrage si le combat est fini ou en attente
                if ($this->status === 'waiting' || $this->status === 'finished') {
                    $monstresVivants = array_filter($this->monsters, function($m) { return $m['status'] === 'OK'; });
                    if (count($this->monsters) === 0) {
                        $this->log[] = ['system', 'Aucun monstre présent. Veuillez configurer les monstres avant de lancer le combat.'];
                    } else {
                        // Si tous les monstres sont morts, on les réinitialise
                        $this->resetMonsters();
                        $this->startCombat();
                    }
                }
                $this->broadcast(['type' => 'state', 'payload' => $this->serializeState()]);
                break;
            case 'attack':
                $attackerId = $params['attacker'] ?? null;
                $targetId = $params['target'] ?? null;
                $this->attack($attackerId, $targetId);
                // Avancer le tour après l'action du joueur
                $n = count($this->initiativeOrder);
                $this->turnIndex = ($this->turnIndex + 1) % $n;
                $this->nextTurn();
                $this->broadcast(['type' => 'state', 'payload' => $this->serializeState()]);
                break;
            case 'next_turn':
                $this->nextTurn();
                $this->broadcast(['type' => 'state', 'payload' => $this->serializeState()]);
                break;
            case 'set_monsters':
                if (isset($params['monsters'])) {
                    $this->setMonsters($params['monsters']);
                }
                $this->broadcast(['type' => 'state', 'payload' => $this->serializeState()]);
                break;
            case 'restart':
                // Réinitialise les monstres, l'initiative, le tour, le log, le statut
                $this->resetMonsters();
                $this->initiativeOrder = [];
                $this->turnIndex = 0;
                $this->log = [];
                $this->status = 'waiting';
                $this->startCombat();
                $this->broadcast(['type' => 'state', 'payload' => $this->serializeState()]);
                break;
            case 'drink_potion':
                $playerId = $from->{'resourceId'};
                if (isset($this->dndPlayers[$playerId]) && $this->dndPlayers[$playerId]['potions'] > 0) {
                    $heal = 10; // Valeur fixe ou calculée selon CR
                    $this->dndPlayers[$playerId]['potions'] -= 1;
                    $this->dndPlayers[$playerId]['hp'] = min($this->dndPlayers[$playerId]['hp'] + $heal, $this->dndPlayers[$playerId]['max_hp']);
                    $this->log[] = ['system', $this->dndPlayers[$playerId]['name'] . ' boit une potion et récupère ' . $heal . ' PV.'];
                }
                $this->broadcast(['type' => 'state', 'payload' => $this->serializeState()]);
                break;
            default:
                // action inconnue
                break;
        }
    }

    public function getState() {
        // Correction : extraire les infos des joueurs depuis le SplObjectStorage
        $players = array_values($this->dndPlayers);
        return [
            'game' => $this->game,
            'players' => $players,
            'monsters' => array_values($this->monsters),
            'initiative' => $this->initiativeOrder,
            'turn' => $this->initiativeOrder[$this->turnIndex]['id'] ?? null,
            'log' => $this->log,
            'status' => $this->status,
        ];
    }
    // Ajout des méthodes requises par GameRoom
    public function getId() {
        return $this->id;
    }
    public function add(ConnectionInterface $conn, $name) {
        // Appel de la logique parente (ajout dans SplObjectStorage)
        parent::add($conn, $name);
        // Ajout dans le tableau $this->players pour DnD
        $playerId = $conn->{'resourceId'};
        $player = [
            'id' => $playerId,
            'name' => $name ? (string)$name : ('Player#' . $playerId),
        ];
        $this->addPlayer($player);
    }
    public function remove(ConnectionInterface $conn) {
        parent::remove($conn);
        $playerId = $conn->{'resourceId'};
        // Supprimer le joueur du tableau dndPlayers
        if (isset($this->dndPlayers[$playerId])) {
            unset($this->dndPlayers[$playerId]);
        }
        // Supprimer le joueur de l'ordre d'initiative si présent
        $this->initiativeOrder = array_values(array_filter(
            $this->initiativeOrder,
            function($entity) use ($playerId) {
                return !($entity['type'] === 'player' && $entity['id'] == $playerId);
            }
        ));
        // Si le joueur quittant était le tour courant, avancer le tour
        if (isset($this->initiativeOrder[$this->turnIndex]) && $this->initiativeOrder[$this->turnIndex]['id'] == $playerId) {
            $this->turnIndex = $this->turnIndex % max(1, count($this->initiativeOrder));
        }
        // Diffuser l'état mis à jour
        $this->broadcast(['type' => 'state', 'payload' => $this->serializeState()]);
    }
    public function isEmpty() {
        return parent::isEmpty();
    }
    public function broadcast(array $message) {
        parent::broadcast($message);
    }
    public function serializeState() {
        // Retourne l'état complet pour le frontend
        return $this->getState();
    }
    public function serializeSummary() {
        // Résumé pour la liste des salons
        return [
            'roomId' => $this->id,
            'game' => $this->game,
            'players' => count($this->dndPlayers),
            'status' => $this->status,
            'minPlayers' => $this->minPlayers,
        ];
    }
    public function startGame() {
        // Pour DnD, démarrer le combat = startCombat
        $this->startCombat();
    }
    // Ajoute le trésor (or et potions) aux joueurs vivants à la fin du combat
    private function grantTreasure() {
        $totalGold = 0;
        $totalPotions = 0;
        foreach ($this->monsters as $m) {
            if ($m['status'] === 'Dead') {
                $cr = isset($m['cr']) ? $m['cr'] : 1;
                $totalGold += $cr * 10; // 10 or par CR
                $totalPotions += 1; // 1 potion par monstre tué
            }
        }
        $alivePlayers = array_filter($this->dndPlayers, function($p) { return $p['status'] === 'OK'; });
        $n = count($alivePlayers);
        if ($n > 0) {
            $goldPerPlayer = intval($totalGold / $n);
            $potionsPerPlayer = intval($totalPotions / $n);
            foreach ($alivePlayers as &$p) {
                $p['gold'] += $goldPerPlayer;
                $p['potions'] += $potionsPerPlayer;
            }
        }
    }
    public function getGameType() {
        return $this->game;
    }
}
