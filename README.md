# Tarot multijoueur (PHP + React)

> Prototype temps réel — Backend: PHP (Ratchet WS) • Frontend: React (Vite) • WebSocket via proxy Vite (/ws)

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
  - `action { action: 'bid'|'discard'|'play_card'|'restart'|'finish', params?: {...} }`
- Serveur → Client:
  - `welcome { connectionId }`, `registered { name }`
  - `room_joined`, `room_update`, `state`, `your_hand { hand, isYourTurn, youAreTaker }`
  - `rooms`, `chat`, `error`, `notice`
  - `game_over { result, takerId, winners, winnersNames, wonCounts }`

État `state` expose aussi:
- `players[]` avec `handCount`, `wonCount` (cartes ramassées) et `tricksWon` (plis gagnés).
- `currentPlayerId` nul hors phases actives.

## Règles du Tarot (résumé)
- Joueurs: 3 à 5. Paquet: 78 cartes (4 couleurs 1..14, atouts T1..T21, Excuse).
- Chien: 6 cartes à 3/4 joueurs, 3 cartes à 5 joueurs.
- Enchères (ordre croissant): passe, prise, garde, garde sans, garde contre.
- Écart (si prise/garde): le preneur prend le chien et écarte le même nombre (règles détaillées non implémentées ici).
- Plis (règles réelles): suivre la couleur, sinon couper, sinon défausser; Excuse spéciale; gagnant = plus fort dans la couleur demandée ou atout le plus fort.
- Scoring (réel): seuils selon bouts (21, 1, Excuse), petit au bout, poignées, etc. (proto simplifié présent).

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
