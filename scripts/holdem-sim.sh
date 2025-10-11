#!/usr/bin/env bash
set -euo pipefail

HOST="127.0.0.1"
PORT="8090"
WS_URL="ws://${HOST}:${PORT}"

# Lancement du serveur backend en arrière-plan
export HOST PORT
php backend/bin/server.php > /tmp/holdem-server.log 2>&1 &
SERVER_PID=$!
echo "Backend lancé (PID=${SERVER_PID}), logs: /tmp/holdem-server.log"

# Attendre que le port soit ouvert (jusqu'à ~10s)
ATTEMPTS=50
until nc -z ${HOST} ${PORT} >/dev/null 2>&1; do
  ATTEMPTS=$((ATTEMPTS-1))
  if [ ${ATTEMPTS} -le 0 ]; then
    echo "Le serveur ne répond pas sur ${HOST}:${PORT}"
    kill ${SERVER_PID} || true
    exit 1
  fi
  sleep 0.2
done

echo "Serveur prêt sur ${HOST}:${PORT}. Lancement de la simulation Hold'em..."

# Exécuter la simulation Hold'em
export WS_URL
npm --prefix frontend run ws:holdem || SIM_EXIT=$?
SIM_EXIT=${SIM_EXIT:-0}

# Arrêter le serveur
kill ${SERVER_PID} >/dev/null 2>&1 || true
wait ${SERVER_PID} >/dev/null 2>&1 || true

echo "Simulation Hold'em terminée avec code ${SIM_EXIT}"
exit ${SIM_EXIT}

