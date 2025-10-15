# UniversLudique — Guide rapide

Un projet de plateforme de jeux en ligne (Tarot, Belote, Texas Hold'em, DnD 5e).
Backend en PHP (Ratchet WebSocket) et frontend en React (Vite).

But de ce README : donner à un nouvel arrivant tout ce qu'il faut pour démarrer en local rapidement.

---

## En un coup d'œil
- Tech stack : PHP 8.1+ (Composer), Node.js 20+ (Vite)
- Frontend : React + Vite
- Backend : PHP + Ratchet (WebSocket)
- Démarrage local : lancer le backend (WS) et le frontend (Vite)

## Quickstart (2 commandes)
Ouvrir deux terminaux.

Terminal 1 — backend (WebSocket) :

```bash
php backend/bin/server.php
```

Terminal 2 — frontend (dev Vite) :

```bash
npm run frontend:dev
# puis ouvrir http://localhost:5173
```

---

## Structure utile du dépôt
- `backend/` — code PHP, serveur WS, logique des rooms
- `frontend/` — UI React + scripts de simulation
- `tests/` — quelques tests PHP
- `scripts/` — scripts de simulation (bots)

---

## Aperçu fonctionnel
- Salons (création, rejoindre/quitter), chat, parties tour par tour.
- Jeux supportés : Tarot, Belote, Texas Hold'em, Arène DnD (résumés implémentés dans le code).
- Simulations frontales (bots) pour tester les flows sans UI manuelle.

---

## Démarrage local — détails rapides
1. Installer les dépendances :

```bash
# Backend
cd backend && composer install

# Frontend
cd frontend && npm install
```

2. Lancer le backend puis le frontend (voir Quickstart).
3. Le frontend se connecte automatiquement au WS via `/ws` (Vite proxifie vers `ws://127.0.0.1:8090`).

---

## Protocole WebSocket (essentiel)
Messages JSON simples : `{ type: string, payload?: object }`.
Actions clients courantes :
- `register { name }`
- `create_room`, `join_room { roomId }`, `leave_room`
- `chat { text }`
- `action { action: 'play_card'|'bet'|'fold'|..., params?: {...} }`

Réponses serveur utiles :
- `welcome`, `registered`, `room_joined`, `state`, `your_hand`, `game_over`, `error`.

Pour le développement, regardez les scripts de simulation dans `frontend/scripts/` qui montrent des exemples d'échanges WS.

---

## Jetons (résumé)
- Monnaie virtuelle interne (solde affiché via `tokenBalance`).
- Usage : buy-ins, objets/cosmétiques, tests/dev.
- Opérations critiques gérées côté serveur ; messages WS liés : `buy_in`, `grant_tokens`, `token_balance`, `token_change`.
- Consulter la documentation interne (README détaillé) pour les règles complètes et les flags `--dev-tokens` pour tests.

---

## Commandes utiles (racine)
- `npm run frontend:dev` — démarre Vite (frontend)
- `npm run frontend:build` — build frontend
- `npm run frontend:ws:belote` — simulateur Belote (bots)
- `npm run frontend:ws:holdem` — simulateur Hold'em (bots)
- `npm run belote:e2e` / `npm run holdem:e2e` — scripts e2e qui démarrent le backend et lancent les sims
- `npm run backend:serve` — alias pour lancer `php backend/bin/server.php`

---

## Contribuer rapidement
- Lire le code dans `backend/src/` pour comprendre les rooms (`Room`, `HoldemRoom`, `BeloteRoom`, etc.).
- Les simulations dans `frontend/scripts/` sont utiles pour reproduire des scénarios sans UI.
- Ajoutez des tests (PHPUnit) pour toute logique monétaire ou règles de jeu sensibles.

---

## Dépannage rapide
- WebSocket fermé → vérifier que `php backend/bin/server.php` est lancé.
- Frontend n'arrive pas à proxifier `/ws` → vérifier `vite.config.js` et que Vite écoute sur `0.0.0.0:5173`.
- Autorisations/CORS/localhost : lancer les serveurs depuis la machine hôte ou ajuster `server.allowedHosts`.

---

Besoin d'une version anglaise, d'exemples WS JSON prêts à copier-coller, ou d'un README encore plus détaillé pour les développeurs ? Dites-moi ce que vous préférez et j'adapte.
