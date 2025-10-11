<?php
namespace Tarot;

class RoomFactory
{
    public static function create(string $game, string $roomId): GameRoom
    {
        $g = strtolower(trim($game));
        switch ($g) {
            case 'tarot':
            case '':
                return new TarotRoom($roomId);
            case 'belote':
                return new BeloteRoom($roomId);
            case 'holdem':
            case 'texas':
            case "texas hold'em":
                return new HoldemRoom($roomId);
            default:
                // Par défaut, fallback vers Tarot pour éviter les erreurs tant que les autres jeux ne sont pas implémentés
                return new TarotRoom($roomId);
        }
    }
}
