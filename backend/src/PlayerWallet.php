<?php
// Gestion centralisée des jetons et de l'or pour chaque joueur (par id ou pseudo)
namespace Tarot;

class PlayerWallet {
    private static $wallets = [];
    private static $golds = [];

    // Gestion des jetons
    public static function getJetons($playerId) {
        return isset(self::$wallets[$playerId]) ? self::$wallets[$playerId] : 0;
    }

    public static function addJetons($playerId, $amount) {
        if (!isset(self::$wallets[$playerId])) self::$wallets[$playerId] = 0;
        self::$wallets[$playerId] += $amount;
    }

    public static function removeJetons($playerId, $amount) {
        if (!isset(self::$wallets[$playerId])) self::$wallets[$playerId] = 0;
        if (self::$wallets[$playerId] < $amount) return false;
        self::$wallets[$playerId] -= $amount;
        return true;
    }

    public static function setJetons($playerId, $amount) {
        self::$wallets[$playerId] = max(0, (int)$amount);
    }

    // Gestion de l'or (gold)
    public static function getGold($playerId) {
        $val = isset(self::$golds[$playerId]) ? self::$golds[$playerId] : 0;
        // Log debug
        echo "[PlayerWallet] getGold($playerId) => $val\n";
        return $val;
    }

    public static function addGold($playerId, $amount) {
        if (!isset(self::$golds[$playerId])) self::$golds[$playerId] = 0;
        self::$golds[$playerId] += $amount;
        echo "[PlayerWallet] addGold($playerId, $amount) => " . self::$golds[$playerId] . "\n";
    }

    public static function removeGold($playerId, $amount) {
        if (!isset(self::$golds[$playerId])) self::$golds[$playerId] = 0;
        if (self::$golds[$playerId] < $amount) {
            echo "[PlayerWallet] removeGold($playerId, $amount) FAILED (have=" . self::$golds[$playerId] . ")\n";
            return false;
        }
        self::$golds[$playerId] -= $amount;
        echo "[PlayerWallet] removeGold($playerId, $amount) => " . self::$golds[$playerId] . "\n";
        return true;
    }

    public static function setGold($playerId, $amount) {
        self::$golds[$playerId] = max(0, (int)$amount);
        echo "[PlayerWallet] setGold($playerId) => " . self::$golds[$playerId] . "\n";
    }

    /**
     * Convertit l'or en jetons selon le taux 50 gold = 1 jeton.
     * @param string|int $playerId
     * @param int $jetonsDemandes Nombre de jetons à convertir
     * @return bool true si conversion réussie, false sinon
     */
    public static function convertGoldToJetons($playerId, $jetonsDemandes) {
        $goldRequis = $jetonsDemandes * 10;
        $have = self::getGold($playerId);
        echo "[PlayerWallet] convertGoldToJetons($playerId, $jetonsDemandes): required=$goldRequis, have=$have\n";
        if ($have < $goldRequis) {
            echo "[PlayerWallet] convert FAILED for $playerId\n";
            return false;
        }
        self::removeGold($playerId, $goldRequis);
        self::addJetons($playerId, $jetonsDemandes);
        echo "[PlayerWallet] convert SUCCESS for $playerId => jetons=" . self::getJetons($playerId) . " gold=" . self::getGold($playerId) . "\n";
        return true;
    }

    /**
     * Envoie le solde de jetons au joueur via la connexion WebSocket
     * @param $conn ConnectionInterface
     * @param $playerId string|int
     */
    public static function sendJetonsToPlayer($conn, $playerId) {
        if (method_exists($conn, 'send')) {
            $conn->send(json_encode([
                'type' => 'jetons_update',
                'jetons' => self::getJetons($playerId)
            ]));
        }
    }
}
