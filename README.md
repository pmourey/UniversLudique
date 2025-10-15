# UniversLudique — Guide rapide

Plateforme de jeux en ligne (Tarot, Belote, Texas Hold'em, DnD 5e).
Backend PHP (Ratchet WebSocket), frontend React (Vite).

## Démarrage rapide
1. Installer les dépendances :
   - Backend : `cd backend && composer install`
   - Frontend : `cd frontend && npm install`
2. Ouvrir deux terminaux :
   - Backend : `php backend/bin/server.php`
   - Frontend : `npm run frontend:dev` puis ouvrir http://localhost:5173

## Structure du dépôt
- `backend/` — serveur PHP, logique des jeux
- `frontend/` — UI React, scripts de simulation
- `tests/` — tests PHP
- `scripts/` — bots/simulations

## Fonctionnalités principales
- Salons, chat, parties tour par tour
- Jeux : Tarot, Belote, Hold'em, DnD (voir code pour détails)
- Simulations bots (voir `frontend/scripts/`)

## Jetons (monnaie virtuelle)
- Solde affiché via `tokenBalance`
- Usage : buy-in, objets/cosmétiques, tests/dev
- Opérations critiques côté serveur (`buy_in`, `grant_tokens`, `token_balance`, `token_change`)
- Voir README_DETAILED.md pour toutes les règles

## Protocole WebSocket (essentiel)
- Messages JSON `{ type: string, payload?: object }`
- Actions : `register`, `create_room`, `join_room`, `chat`, `action`, etc.
- Voir scripts de simulation pour exemples

## Commandes utiles
- `npm run frontend:dev` — démarre le frontend
- `npm run frontend:ws:belote` — simulateur Belote
- `npm run frontend:ws:holdem` — simulateur Hold'em
- `npm run backend:serve` — lance le backend

## Pour aller plus loin
- Voir `README_DETAILED.md` pour la documentation complète (règles jetons, protocole WS, structure avancée, FAQ, etc.)

---

Besoin d’exemples WS, d’une version anglaise ou d’aide ? Voir README_DETAILED.md ou contacter le mainteneur.
