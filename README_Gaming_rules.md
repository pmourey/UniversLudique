# UniversLudique — Règles des jeux

Ce document regroupe les règles résumées des jeux implémentés sur la plateforme UniversLudique : Tarot, Belote, Texas Hold'em, et Arène DnD 5e.

---

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

## Règles de l’Arène DnD 5e (résumé)
- Mode arène JcJ/JcE inspiré de D&D 5e : chaque joueur incarne un aventurier, affronte des monstres générés par l’hôte.
- Système d’initiative : chaque entité (joueur ou monstre) joue à son tour selon un jet d’initiative (d20 + DEX).
- À son tour, un joueur peut attaquer un monstre ou boire une potion (si disponible et PV bas).
- Les monstres attaquent automatiquement un joueur vivant à leur tour.
- Points de vie, dégâts, armure, potions, or, XP et montée de niveau gérés automatiquement.
- Quand tous les monstres sont vaincus, les survivants se partagent l’or et les potions du butin.
- Les joueurs gagnent de l’XP en tuant des monstres et montent de niveau, ce qui améliore leurs stats.
- Statut de chaque joueur : [OK] (vivant) ou [DEAD] (mort).

Exemple de déroulement :
1. Les joueurs rejoignent le salon DnD 5e, l’hôte configure les monstres.
2. Le combat commence : chaque entité joue à son tour selon l’initiative.
3. Les joueurs peuvent attaquer ou boire une potion à leur tour.
4. Les monstres attaquent automatiquement.
5. Quand tous les monstres sont morts, les survivants reçoivent le butin et l’XP.
6. Les joueurs peuvent relancer un combat avec de nouveaux monstres.

