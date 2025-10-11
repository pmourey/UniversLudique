# Plateforme Multijeux de Cartes en Temps Réel : Tarot, Belote & Texas Hold'em (Backend PHP + Frontend React)

<!-- Vous pouvez ajouter d'autres titres ici si nécessaire -->

## Quickstart

```bash
# Terminal 1 — serveur WebSocket (backend)
php backend/bin/server.php

# Terminal 2 — serveur de dev Vite (frontend)
npm run frontend:dev
# Ouvrir: http://localhost:5173
```

## Architecture (dev)

```
Navigateur (React UI)
   │  HTTP 5173
   ├────────────────────→ Vite Dev Server (host 0.0.0.0, port 5173)
   │                         │
   │  WS ws(s)://<host>:5173/ws
   └─────────────────────────┴─→ Proxy Vite /ws → ws://127.0.0.1:8090
                                 ↓
                           PHP Ratchet WS (0.0.0.0:8090)
```

— Le frontend se connecte à `/ws` (auto‑détection via `window.location`), Vite proxifie vers le backend.
— En externe, il suffit d’exposer le port Vite (5173). Le backend 8090 reste non exposé.

---

## Sommaire
- [Aperçu](#aperçu)
- [Prérequis](#prérequis)
- [Installation](#installation)
- [Démarrage (local)](#démarrage-local)
- [Accès LAN/NAT](#accès-lannat)
- [Déploiement (pistes)](#déploiement-pistes)
- [Scripts utiles](#scripts-utiles)
- [Protocole WebSocket](#protocole-websocket)
- [Règles du Tarot (résumé)](#règles-du-tarot-résumé)
- [Règles de la Belote (résumé)](#règles-de-la-belote-résumé)
- [Règles du Texas Hold’em (résumé)](#règles-du-texas-holdem-résumé)
- [Roadmap](#roadmap)
- [Dépannage](#dépannage)

## Aperçu
- Salons: création, rejoindre/quitter, chat.
- Machine à états (proto): waiting → bidding (enchères) → discarding (écart) → playing (plis) → scoring → finished.
- Logs serveur: `[WS] OPEN/RECV/CLOSE/ERROR` et `[ROOM …] startGame/bid/discard/play/scoring`.
- UI: indicateur de tour, affichage des plis gagnés (tricksWon), bouton “Relancer la donne” en fin de partie et “Terminer la donne” si bloqué.

## Prérequis
- PHP ≥ 8.1 (CLI) + Composer
- Node.js 20.x (≥ 20.11) + npm (Vite 5 épinglé pour compatibilité)
- macOS/Unix ok (pare‑feu: autoriser php/node au premier lancement)

## Installation
```bash
# Backend
cd backend
composer install

# Frontend
cd ../frontend
npm install
```

## Démarrage (local)
```bash
# Terminal 1 — backend WS (logs en console)
php backend/bin/server.php

# Terminal 2 — frontend (Vite)
npm run frontend:dev
# Naviguer: http://localhost:5173
```
— L’UI détecte automatiquement `ws(s)://<host>:5173/ws` (proxy Vite → backend).
— Reconnexion automatique côté UI en cas de redémarrage backend.

## Accès LAN/NAT
Objectif: exposer uniquement Vite (5173) et laisser le backend interne (8090)

1) Backend (écoute LAN):
```bash
php backend/bin/server.php   # écoute 0.0.0.0:8090
```
2) Frontend (Vite): vite.config.js est déjà configuré pour:
- `server.host = '0.0.0.0'`, `server.port = 5173`
- `server.allowedHosts` (ajoutez votre domaine si besoin)
- proxy `/ws` → `ws://127.0.0.1:8090`

3) Routeur/NAT:
- Rediriger le port WAN → LAN 5173 vers `<IP_LAN>:5173`
- Accès externe: `http://votre-domaine:5173` (WS passe via `/ws`)

## Déploiement (pistes)
- Build frontend et servir statiquement (Nginx/Apache), proxy WebSocket → backend.
```bash
cd frontend
npm run build
# Servir le dossier dist/ via un serveur HTTP
```
- Reverse proxy (Nginx/Caddy/Traefik) en HTTPS, upstream WS vers Ratchet (8090).
- Supervision backend (systemd/supervisor) pour le run en service.

## Scripts utiles
```bash
# Frontend
npm run frontend:dev        # Vite (dev)
npm run frontend:build      # Build
npm run frontend:preview    # Preview du build
npm run frontend:ws:test    # Bot simple: welcome/register/create_room/chat/rooms
npm run frontend:ws:sim3    # Simulation 3 joueurs: enchères/écart/1 pli
npm run frontend:ws:simfull # Simulation 3 joueurs: donne complète → game_over
npm run frontend:ws:belote  # Simulation Belote (4 joueurs)
npm run frontend:ws:holdem  # Simulation Texas Hold’em (4 joueurs, enchères automatiques)

# Simulations (racine)
npm run belote:simulate     # Simule Belote (WS_URL=ws://127.0.0.1:8090)
npm run belote:e2e          # Démarre backend + simule Belote, puis stoppe backend
npm run holdem:simulate     # Simule Hold’em (WS_URL=ws://127.0.0.1:8090)
npm run holdem:e2e          # Démarre backend + simule Hold’em, puis stoppe backend

# Backend
npm run backend:serve       # php backend/bin/server.php
```

## Protocole WebSocket
Format: `{ type: string, payload?: object }`
- Client → Serveur:
  - `register { name }`
  - `create_room`, `join_room { roomId }`, `leave_room`, `list_rooms`
  - `chat { text }`
  - `start_game`
  - `action { action: 'bid'|'discard'|'play_card'|'choose_trump'|'restart'|'finish'|'check'|'call'|'bet'|'raise_to'|'fold', params?: {...} }`
    - Hold’em:
      - `bet { amount: number }` (ouverture de mise quand currentBet=0)
      - `raise_to { to: number }` (relance “vers” un montant total sur la street)
      - `check`, `call`, `fold` selon le contexte
- Serveur → Client:
  - `welcome { connectionId }`, `registered { name }`
  - `room_joined`, `room_update`, `state`, `your_hand { ... }`
    - Tarot: `your_hand { hand, isYourTurn, youAreTaker, dogCount }`
    - Belote: `your_hand { hand, isYourTurn, playable? }`
    - Hold’em: `your_hand { hand, isYourTurn, allowed? }` avec `allowed = { fold: bool, check: bool, call: number, minBet: number, minRaiseTo: number }`
  - `rooms`, `chat`, `error`, `notice`
  - `game_over { ... }`
    - Tarot: `{ result, takerId, winners, winnersNames, wonCounts }`
    - Belote: `{ result, winners, winnersNames }`
    - Hold’em: `{ result: 'showdown'|'folds', winners, winnersNames }`

État `state` expose aussi:
- `players[]` avec `handCount`, `wonCount` (cartes ramassées) et `tricksWon` (plis gagnés) selon le jeu; pour Hold’em: `stack`, `bet`, `folded`, `allin`.
- `currentPlayerId` nul hors phases actives.
- Hold’em: `round` ('preflop'|'flop'|'turn'|'river'), `currentBet`, `minRaise`, `smallBlind`, `bigBlind`, `potTotal`, `community` (révélée progressivement: 0/3/4/5).

## Règles du Tarot (résumé)
- Joueurs: 3 à 5. Paquet: 78 cartes (4 couleurs 1..14, atouts T1..T21, Excuse).
- Chien: 6 cartes à 3/4 joueurs, 3 cartes à 5 joueurs.
- Enchères (ordre croissant): passe, prise, garde, garde sans, garde contre.
- Écart (si prise/garde): le preneur prend le chien et écarte le même nombre (règles détaillées non implémentées ici).
- Plis (règles réelles): suivre la couleur, sinon couper, sinon défausser; Excuse spéciale; gagnant = plus fort dans la couleur demandée ou atout le plus fort.
- Scoring (réel): seuils selon bouts (21, 1, Excuse), petit au bout, poignées, etc. (proto simplifié présent).

## Règles de la Belote (résumé)
- Joueurs: 4, équipes fixes en alternance: sièges 0 et 2 vs 1 et 3.
- Paquet: 32 cartes, couleurs `S`/`H`/`D`/`C` (Pique, Cœur, Carreau, Trèfle), rangs `7,8,9,10,J,Q,K,A`.
- Phases (implémentation): `waiting` → `choosing_trump` → `playing` → `finished`.
  - Le donneur tourne à chaque donne; le joueur à gauche du donneur choisit l’atout (`choose_trump`).
- Hiérarchie des cartes:
  - À l’atout: `J` > `9` > `A` > `10` > `K` > `Q` > `8` > `7`.
  - Hors atout (dans la couleur demandée): `A` > `10` > `K` > `Q` > `J` > `9` > `8` > `7`.
- Règles de pose (implémentées par `playable`):
  - Suivre la couleur si possible; sinon couper si possible.
  - Si l’atout est demandé, fournir atout et surcouper si possible.
  - Sinon, défausser librement.
- Pli: gagné par la carte la plus forte selon les règles ci‑dessus; le gagnant ouvre le pli suivant.
- Fin de donne: quand toutes les mains sont vides; l’équipe gagnante est celle qui a ramassé le plus de cartes (simplifié). En cas d’égalité, l’équipe du dernier pli l’emporte.
- État exposé: `trumpSuit`, `leaderId`, `trick` en cours; côté joueurs: `team`, `handCount`, `wonCount`, `tricksWon`.
- Actions supportées: `choose_trump`, `play_card`, `restart`, `finish`.

— Simulation Belote:
```bash
npm run frontend:ws:belote   # 4 bots WS contre le backend
# ou
npm run belote:e2e           # démarrage backend + simulation + arrêt backend
```

## Règles du Texas Hold’em (résumé)
- Joueurs: 2 à 9 (simulations prêtes à 4 joueurs par défaut).
- Paquet: 52 cartes classiques, couleurs `S/H/D/C`, rangs `2..10,J,Q,K,A`.
- Phases & blinds:
  - `waiting` → `dealing` (round = `preflop` → `flop` → `turn` → `river`) → `showdown` → `finished`.
  - Blinds affichées: `smallBlind`/`bigBlind`; préflop, l’action commence UTG (à gauche du BB). Aux streets suivantes, à gauche du donneur.
- Actions & mises:
  - `check` si `currentBet=0` ou déjà égalisé; `call` sinon (montant indiqué dans `allowed.call`).
  - `bet { amount }` pour ouvrir quand `currentBet=0` (min = big blind).
  - `raise_to { to }` pour relancer jusqu’à un total sur la street (minRaise affiché).
  - `fold` à tout moment si un paiement est requis.
  - All-in géré; side-pots constitués automatiquement et partagés équitablement.
- État & infos clients:
  - `state`: `round`, `currentPlayerId`, `currentBet`, `minRaise`, `smallBlind`, `bigBlind`, `potTotal`, `community` (0/3/4/5).
  - `players[]`: `stack`, `bet`, `folded`, `allin`.
  - `your_hand`: `allowed = { fold, check, call, minBet, minRaiseTo }` quand c’est votre tour.

— Simulation Hold’em:
```bash
npm run frontend:ws:holdem   # 4 bots WS (check/call/bet/raise automatiques jusqu’au showdown)
# ou
npm run holdem:e2e           # démarrage backend + simulation + arrêt backend
```

## Roadmap
- Règles de pli complètes + calcul des scores correct.
- UX cartes (tri, rendu, validations) et historique.
- Timers, reprise après déconnexion, persistance.
- Tests unitaires (PHP & UI) et e2e multi‑joueurs.

## Dépannage
- "WebSocket is closed…": backend lancé? Vite relancé? L’UI retente (backoff 1→10s).
- "Blocked request. host not allowed": ajouter votre host dans `vite.config.js > server.allowedHosts`.
- Hairpin NAT (OPEN/CLOSE répétés): proxy `/ws` cible `127.0.0.1:8090` (déjà configuré).
- Vite/Node: Vite 5 (Node 20.11+) — si mise à jour de Vite, envisager Node ≥ 20.19.
