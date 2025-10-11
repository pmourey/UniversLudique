<?php
namespace Tarot;

use Ratchet\ConnectionInterface;
use SplObjectStorage;

class BeloteRoom implements GameRoom
{
    private $game = 'belote';
    private $id;
    private $players; // SplObjectStorage<ConnectionInterface, array>
    private $status = 'waiting';

    private $seats = array();

    public function __construct($id)
    {
        $this->id = (string)$id;
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
        $this->broadcast([ 'type' => 'room_update', 'payload' => $this->serializeState() ]);
    }

    public function remove(ConnectionInterface $conn)
    {
        if (!isset($this->players[$conn])) return;
        $info = $this->players[$conn];
        unset($this->players[$conn]);
        $this->seats = array_values(array_filter($this->seats, function($p) use ($info){ return $p['id'] !== $info['id']; }));
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
        return [
            'roomId' => $this->id,
            'game' => $this->game,
            'status' => $this->status,
            'players' => $this->publicPlayers(),
        ];
    }

    public function serializeSummary()
    {
        return [
            'roomId' => $this->id,
            'players' => count($this->players),
            'status' => $this->status,
            'game' => $this->game,
        ];
    }

    public function startGame()
    {
        // Placeholder: non implémenté pour l'instant
        $this->broadcast([ 'type' => 'notice', 'payload' => [ 'message' => 'Belote: jeu non implémenté pour le moment.' ] ]);
    }

    public function handleAction(ConnectionInterface $from, $action, array $params = array())
    {
        // Placeholder actions
        $this->broadcast([ 'type' => 'notice', 'payload' => [ 'message' => 'Belote: action non implémentée.' ] ]);
    }

    private function publicPlayers()
    {
        $out = [];
        foreach ($this->players as $conn) {
            $p = $this->players[$conn];
            $out[] = [ 'id' => $p['id'], 'name' => $p['name'], 'seat' => isset($p['seat']) ? $p['seat'] : null ];
        }
        usort($out, function($a,$b){ return ($a['seat'] - $b['seat']); });
        return $out;
    }
}

