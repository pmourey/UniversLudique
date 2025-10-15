<?php
namespace Tarot;

use Ratchet\ConnectionInterface;
use Ratchet\MessageComponentInterface;
use SplObjectStorage;

class GameServer implements MessageComponentInterface
{
    private $clients; // SplObjectStorage<ConnectionInterface, array>
    private $rooms = [];

    public function __construct()
    {
        $this->clients = new SplObjectStorage();
    }

    public function onOpen(ConnectionInterface $conn)
    {
        // Récupération de l'adresse IP
        $ip = isset($conn->remoteAddress) ? $conn->remoteAddress : 'unknown';
        // Ajout : récupération de l'IP réelle si transmise par le proxy (X-Forwarded-For)
        if (isset($conn->httpRequest) && method_exists($conn->httpRequest, 'getHeader') && $conn->httpRequest->hasHeader('X-Forwarded-For')) {
            $xff = $conn->httpRequest->getHeader('X-Forwarded-For');
            if (is_array($xff) && count($xff) > 0) {
                $ip = trim(explode(',', $xff[0])[0]);
            }
        }
        // Récupération du User-Agent
        $userAgent = method_exists($conn, 'httpRequest') && $conn->httpRequest && $conn->httpRequest->hasHeader('User-Agent')
            ? $conn->httpRequest->getHeader('User-Agent')[0]
            : (isset($conn->httpRequest) && method_exists($conn->httpRequest, 'getHeader') && $conn->httpRequest->getHeader('User-Agent')
                ? $conn->httpRequest->getHeader('User-Agent')[0]
                : 'unknown');
        // Affichage dans la console (OPEN uniquement)
        echo "[WS] OPEN #" . (isset($conn->resourceId) ? $conn->resourceId : 'unknown') .
            " | IP: $ip | UA: $userAgent\n";
        $this->clients[$conn] = [
            'id' => $conn->resourceId,
            'name' => null,
            'roomId' => null,
            'ip' => $ip,
            'userAgent' => $userAgent,
        ];
        $this->send($conn, [
            'type' => 'welcome',
            'payload' => [
                'connectionId' => $conn->resourceId,
            ],
        ]);
    }

    public function onMessage(ConnectionInterface $from, $msg)
    {
        $data = json_decode($msg, true);
        if (!is_array($data) || !isset($data['type'])) {
            $this->send($from, $this->error('Malformed message'));
            return;
        }

        $type = $data['type'];
        $payload = isset($data['payload']) ? $data['payload'] : array();
        $client = $this->clients[$from];

        // Log minimal de chaque message reçu
        $cid = isset($client['id']) ? $client['id'] : (isset($from->resourceId) ? $from->resourceId : 'unknown');
        $info = '';
        if ($type === 'action') {
            $info = ' action=' . (isset($payload['action']) ? (string)$payload['action'] : '');
        } elseif ($type === 'chat') {
            $t = isset($payload['text']) ? (string)$payload['text'] : '';
            $info = ' text=' . substr($t, 0, 80);
        } elseif ($type === 'register') {
            $info = ' name=' . (isset($payload['name']) ? (string)$payload['name'] : '');
        } elseif ($type === 'join_room') {
            $info = ' roomId=' . (isset($payload['roomId']) ? (string)$payload['roomId'] : '');
        } elseif ($type === 'start_game') {
            $info = ' start';
        } elseif ($type === 'create_room') {
            $info = ' game=' . (isset($payload['game']) ? (string)$payload['game'] : 'tarot');
        }
        echo "[WS] RECV #{$cid} type={$type}{$info}\n";

        try {
            switch ($type) {
                case 'register':
                    $name = isset($payload['name']) ? trim((string)$payload['name']) : '';
                    if ($name === '') {
                        throw new \InvalidArgumentException('Name required');
                    }
                    // Vérifier unicité du pseudo
                    foreach ($this->clients as $c) {
                        if (isset($this->clients[$c]['name']) && $this->clients[$c]['name'] === $name && $from !== $c) {
                            $this->send($from, [ 'type' => 'error', 'payload' => [ 'message' => 'Ce pseudo est déjà utilisé.' ] ]);
                            return;
                        }
                    }
                    $client['name'] = $name;
                    $this->clients[$from] = $client; // persist change

                    // Si le client envoie un solde de jetons local, l'initialiser côté serveur
                    if (isset($payload['jetons']) && is_numeric($payload['jetons'])) {
                        $val = (int)$payload['jetons'];
                        // Stocker le solde à la fois sous le pseudo et sous l'ID de connexion
                        PlayerWallet::setJetons($name, $val);
                        PlayerWallet::setJetons($from->resourceId, $val);
                    }

                    // Renvoyer également le solde connu côté serveur afin que le client soit synchronisé (par pseudo)
                    $serverJetons = PlayerWallet::getJetons($name);
                    $this->send($from, [ 'type' => 'registered', 'payload' => [ 'name' => $name, 'jetons' => $serverJetons ] ]);
                    break;

                case 'unregister':
                    // Retirer le joueur de tous les salons où il est inscrit
                    foreach ($this->rooms as $room) {
                        if (method_exists($room, 'remove')) {
                            $room->remove($from);
                        }
                    }
                    $client['name'] = null;
                    $client['roomId'] = null;
                    $this->clients[$from] = $client;
                    $this->send($from, [ 'type' => 'unregistered', 'payload' => [] ]);
                    break;

                case 'create_room':
                    $roomId = $this->createRoomId();
                    $game = isset($payload['game']) ? (string)$payload['game'] : 'tarot';
                    $room = RoomFactory::create($game, $roomId);
                    $this->rooms[$roomId] = $room;
                    // Suppression de l'ajout automatique pour DnD : le joueur doit cliquer sur 'Rejoindre' comme pour les autres jeux
                    $this->send($from, [ 'type' => 'room_created', 'payload' => [ 'roomId' => $roomId, 'game' => $game ] ]);
                    break;

                case 'join_room':
                    $roomId = isset($payload['roomId']) ? (string)$payload['roomId'] : '';
                    if ($roomId === '' || !isset($this->rooms[$roomId])) {
                        throw new \InvalidArgumentException('Room not found');
                    }
                    $room = $this->rooms[$roomId];
                    $playerName = $client['name'];

                    // --- Synchronisation des jetons entre resourceId et pseudo ---
                    $rid = $from->resourceId;
                    // Valeurs actuelles
                    $jetonsByName = PlayerWallet::getJetons($playerName);
                    $jetonsByRid = PlayerWallet::getJetons($rid);
                    // Si une clé a la valeur et l'autre non, copier pour garantir cohérence
                    if ($jetonsByName <= 0 && $jetonsByRid > 0) {
                        PlayerWallet::setJetons($playerName, $jetonsByRid);
                        // Envoyer la MAJ au client (clef pseudo) pour que le frontend sauvegarde en localStorage
                        PlayerWallet::sendJetonsToPlayer($from, $playerName);
                        $jetonsByName = $jetonsByRid;
                    } elseif ($jetonsByRid <= 0 && $jetonsByName > 0) {
                        PlayerWallet::setJetons($rid, $jetonsByName);
                        PlayerWallet::sendJetonsToPlayer($from, $playerName);
                        $jetonsByRid = $jetonsByName;
                    }
                    // --- Fin sync ---

                    // Récupérer le type de jeu du salon cible
                    $targetGameType = method_exists($room, 'getGameType') ? $room->getGameType() : null;
                    // Vérifier si le joueur est déjà inscrit dans un autre salon du même type de jeu
                    $alreadyInRoom = false;
                    foreach ($this->rooms as $rid => $r) {
                        if ($rid === $roomId) continue;
                        $gameType = method_exists($r, 'getGameType') ? $r->getGameType() : null;
                        if ($gameType !== $targetGameType) continue;
                        if (method_exists($r, 'serializeState')) {
                            $state = $r->serializeState();
                            if (isset($state['players'])) {
                                foreach ($state['players'] as $p) {
                                    if ((isset($p['name']) && $p['name'] === $playerName) || (isset($p['id']) && $p['id'] === $from->resourceId)) {
                                        $alreadyInRoom = true;
                                        break 3;
                                    }
                                }
                            }
                        }
                    }
                    if ($alreadyInRoom) {
                        $this->send($from, [
                            'type' => 'error',
                            'payload' => [
                                'message' => 'Vous êtes déjà inscrit dans un autre salon de ce jeu. Quittez-le avant de rejoindre un nouveau salon.'
                            ]
                        ]);
                        break;
                    }
                    // S'assurer que le client n'a plus d'ancien roomId
                    $client['roomId'] = null;
                    $this->clients[$from] = $client;
                    // Ajouter au nouveau salon
                    $room->add($from, $client['name']);
                    $client['roomId'] = $roomId;
                    $this->clients[$from] = $client;
                    $room->broadcast([ 'type' => 'room_update', 'payload' => $room->serializeState() ]);
                    break;

                case 'leave_room':
                    if (!empty($client['roomId'])) {
                        $roomId = $client['roomId'];
                        $room = isset($this->rooms[$roomId]) ? $this->rooms[$roomId] : null;
                        if ($room) {
                            $room->remove($from);
                            // Désactiver la suppression automatique du salon
                            // if ($room->isEmpty()) {
                            //     unset($this->rooms[$roomId]);
                            // } else {
                                $room->broadcast([ 'type' => 'room_update', 'payload' => $room->serializeState() ]);
                            // }
                        }
                        $client['roomId'] = null;
                        $this->clients[$from] = $client;
                        $this->send($from, [ 'type' => 'left_room', 'payload' => [ 'roomId' => $roomId ] ]);
                    }
                    break;

                case 'chat':
                    $text = isset($payload['text']) ? (string)$payload['text'] : '';
                    if ($text === '') { break; }
                    $room = $this->getClientRoom($from);
                    if ($room) {
                        $room->broadcast([
                            'type' => 'chat',
                            'payload' => [
                                'from' => isset($client['name']) && $client['name'] !== null ? $client['name'] : ('#'.$client['id']),
                                'text' => $text,
                                'ts' => time(),
                            ],
                        ]);
                    }
                    break;

                case 'start_game':
                    $room = $this->getClientRoom($from);
                    if ($room === null) { throw new \RuntimeException('Join a room first'); }
                    $room->startGame();
                    $room->broadcast([ 'type' => 'state', 'payload' => $room->serializeState() ]);
                    break;

                case 'action':
                    $room = $this->getClientRoom($from);
                    if ($room === null) { throw new \RuntimeException('Join a room first'); }
                    $action = isset($payload['action']) ? (string)$payload['action'] : '';
                    $params = isset($payload['params']) ? $payload['params'] : array();
                    $room->handleAction($from, $action, $params);
                    break;

                case 'list_rooms':
                    $summaries = array();
                    $filterGame = isset($payload['game']) ? (string)$payload['game'] : null;
                    foreach ($this->rooms as $r) {
                        $summary = $r->serializeSummary();
                        if ($filterGame && isset($summary['game']) && $summary['game'] !== $filterGame) continue;
                        $summaries[] = $summary;
                    }
                    $this->send($from, [
                        'type' => 'rooms',
                        'payload' => array_values($summaries)
                    ]);
                    break;

                case 'sync_jetons':
                    $val = isset($payload['jetons']) && is_numeric($payload['jetons']) ? (int)$payload['jetons'] : 0;
                    $name = $client['name'] ?? null;
                    if ($name) {
                        PlayerWallet::setJetons($name, $val);
                        PlayerWallet::setJetons($from->resourceId, $val);
                        // Envoyer la mise à jour au client
                        PlayerWallet::sendJetonsToPlayer($from, $name);
                        $this->send($from, [ 'type' => 'registered', 'payload' => [ 'name' => $name, 'jetons' => PlayerWallet::getJetons($name) ] ]);
                    } else {
                        // Si pas de pseudo enregistré, renseigner uniquement par resourceId
                        PlayerWallet::setJetons($from->resourceId, $val);
                        PlayerWallet::sendJetonsToPlayer($from, $from->resourceId);
                        $this->send($from, [ 'type' => 'registered', 'payload' => [ 'name' => null, 'jetons' => PlayerWallet::getJetons($from->resourceId) ] ]);
                    }
                    break;

                default:
                    throw new \InvalidArgumentException('Unknown type: ' . $type);
            }
        } catch (\Exception $e) {
            $this->send($from, $this->error($e->getMessage()));
        }
    }

    public function onClose(ConnectionInterface $conn)
    {
        // Affichage simplifié (plus d'IP/UA)
        echo "[WS] CLOSE #" . (isset($conn->resourceId) ? $conn->resourceId : 'unknown') . "\n";
        $client = isset($this->clients[$conn]) ? $this->clients[$conn] : null;
        if ($client) {
            $roomId = isset($client['roomId']) ? $client['roomId'] : null;
            if ($roomId && isset($this->rooms[$roomId])) {
                $room = $this->rooms[$roomId];
                $room->remove($conn);
                // Désactiver la suppression automatique du salon
                // if ($room->isEmpty()) {
                //     unset($this->rooms[$roomId]);
                // } else {
                    $room->broadcast([ 'type' => 'room_update', 'payload' => $room->serializeState() ]);
                // }
            }
            unset($this->clients[$conn]);
        }
    }

    public function onError(ConnectionInterface $conn, \Exception $e)
    {
        // Log d'erreur
        $id = isset($conn->resourceId) ? $conn->resourceId : 'unknown';
        echo "[WS] ERROR #{$id}: " . $e->getMessage() . "\n";
        $this->send($conn, $this->error($e->getMessage()));
        $conn->close();
    }

    private function error($message)
    {
        return [ 'type' => 'error', 'payload' => [ 'message' => (string)$message ] ];
    }

    private function send(ConnectionInterface $to, array $data)
    {
        $to->send(json_encode($data));
    }

    private function createRoomId()
    {
        do {
            if (function_exists('random_bytes')) {
                $bytes = random_bytes(3);
            } elseif (function_exists('openssl_random_pseudo_bytes')) {
                $bytes = openssl_random_pseudo_bytes(3);
            } else {
                $bytes = chr(mt_rand(0,255)).chr(mt_rand(0,255)).chr(mt_rand(0,255));
            }
            $id = substr(bin2hex($bytes), 0, 6);
        } while (isset($this->rooms[$id]));
        return $id;
    }

    private function getClientRoom(ConnectionInterface $conn)
    {
        $client = isset($this->clients[$conn]) ? $this->clients[$conn] : null;
        if (!$client) return null;
        $roomId = isset($client['roomId']) ? $client['roomId'] : null;
        return $roomId ? (isset($this->rooms[$roomId]) ? $this->rooms[$roomId] : null) : null;
    }
}
