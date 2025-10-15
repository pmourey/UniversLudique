# UniversLudique — Documentation détaillée

Ce document complète le README principal avec des explications approfondies sur l’architecture, les règles d’utilisation des jetons, le protocole WebSocket, la structure du code, et les cas d’usage avancés.

---

## Table des matières
1. Présentation générale
2. Architecture technique
3. Règles d’utilisation des jetons
4. Protocole WebSocket détaillé
5. Structure du dépôt et conventions
6. Simulations et tests automatisés
7. FAQ et dépannage avancé

---

## 1. Présentation générale
UniversLudique est une plateforme de jeux en ligne multi-jeux (Tarot, Belote, Texas Hold'em, DnD 5e) avec gestion de salons, chat, monnaie virtuelle (jetons), et support de bots pour la simulation.

## 2. Architecture technique
- **Backend** : PHP 8.1+, serveur WebSocket basé sur Ratchet, logique des rooms et gestion des jetons.
- **Frontend** : React (Vite), connexion WS, scripts de simulation pour automatiser des parties.
- **Tests** : PHPUnit pour le backend, scripts Node.js pour simuler des clients.

## 3. Règles d’utilisation des jetons
- Les jetons sont la monnaie virtuelle interne.
- **Acquisition** :
  - Par défaut, chaque nouvel utilisateur reçoit un solde initial (configurable).
  - Des jetons peuvent être accordés par l’admin (`grant_tokens`) ou via des bonus (événements, tests).
- **Utilisation** :
  - **Buy-in** : Pour rejoindre certaines parties (ex : Hold'em), un buy-in en jetons est requis (`buy_in`).
  - **Objets/cosmétiques** : Certains éléments cosmétiques ou objets spéciaux peuvent être achetés avec des jetons (fonctionnalité à étendre).
  - **Tests/dev** : En mode développement, des flags (`--dev-tokens`) permettent de générer ou manipuler des jetons pour les tests.
- **Gestion serveur** :
  - Toutes les opérations critiques (achat, gain, perte) sont validées côté serveur.
  - Les messages WS liés : `buy_in`, `grant_tokens`, `token_balance`, `token_change`.
  - Le solde est renvoyé régulièrement ou sur demande (`token_balance`).
- **Sécurité** :
  - Les tentatives de triche (ex : manipulation du solde côté client) sont ignorées ou sanctionnées.
  - Les logs serveur tracent toutes les modifications de solde.

## 4. Protocole WebSocket détaillé
- **Format** : tous les messages sont des objets JSON `{ type: string, payload?: object }`.
- **Principaux types de messages** :
  - `register { name }` : inscription d’un joueur
  - `create_room`, `join_room { roomId }`, `leave_room` : gestion des salons
  - `chat { text }` : messages de chat
  - `action { action: ..., params?: ... }` : actions de jeu (jouer une carte, miser, etc.)
  - `buy_in { amount }` : buy-in en jetons
  - `grant_tokens { amount }` : ajout de jetons (admin/dev)
  - `token_balance` : demande ou notification du solde
  - `token_change { delta }` : notification de changement de solde
  - `state`, `your_hand`, `game_over`, `error` : états de jeu et notifications
- **Exemples** :
  - Un client qui veut rejoindre une table de Hold'em avec buy-in :
    ```json
    { "type": "buy_in", "payload": { "amount": 1000 } }
    ```
  - Le serveur répond :
    ```json
    { "type": "token_balance", "payload": { "balance": 9000 } }
    ```

## 5. Structure du dépôt et conventions
- `backend/src/` :
  - `Room.php` : classe de base pour les salons
  - `HoldemRoom.php`, `BeloteRoom.php`, etc. : logique spécifique à chaque jeu
  - `PlayerWallet.php` : gestion des jetons
- `frontend/scripts/` :
  - Scripts de simulation (ex : `ws-simulate-holdem.js`) pour automatiser des parties
- `tests/` :
  - Tests unitaires et d’intégration (PHPUnit)

## 6. Simulations et tests automatisés
- Les scripts de simulation permettent de tester les flows de jeu sans UI manuelle.
- Utiliser les commandes npm dédiées (`npm run frontend:ws:holdem`, etc.) pour lancer des bots.
- Les tests critiques (buy-in, gestion des jetons) sont couverts par PHPUnit.

## 7. FAQ et dépannage avancé
- **WebSocket ne répond pas** : vérifier que le backend est lancé (`php backend/bin/server.php`).
- **Problèmes de jetons** : consulter les logs serveur, vérifier les messages `token_change`.
- **Tests automatiques** : lancer `phpunit` dans `backend/` pour vérifier la logique monétaire.
- **Développement de nouvelles règles** : étendre les classes Room et PlayerWallet, ajouter des tests.

---

Pour toute question ou besoin d’exemples supplémentaires (messages WS, scénarios de test, etc.), se référer à ce document ou contacter le mainteneur.

