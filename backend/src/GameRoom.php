<?php
namespace Tarot;

use Ratchet\ConnectionInterface;

interface GameRoom
{
    public function getId();
    public function add(ConnectionInterface $conn, $name);
    public function remove(ConnectionInterface $conn);
    public function isEmpty();
    public function broadcast(array $message);

    public function serializeState();
    public function serializeSummary();

    public function startGame();
    public function handleAction(ConnectionInterface $from, $action, array $params = array());
}

