#!/usr/bin/env php
<?php
require __DIR__ . '/../vendor/autoload.php';

use Ratchet\Http\HttpServer;
use Ratchet\Server\IoServer;
use Ratchet\WebSocket\WsServer;
use Tarot\GameServer;

$port = (int) (getenv('PORT') ?: 8090);
$addr = getenv('HOST') ?: '0.0.0.0';

$server = IoServer::factory(
    new HttpServer(
        new WsServer(new GameServer())
    ),
    $port,
    $addr
);

echo sprintf("Tarot WebSocket server listening on %s:%d\n", $addr, $port);
$server->run();
