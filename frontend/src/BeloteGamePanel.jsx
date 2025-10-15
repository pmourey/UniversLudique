import React from 'react';

function BeloteGamePanel({ roomState, isYourTurn, hand, playable, playCard, chooseTrump }) {
  if (!roomState) return null;

  // Choix de l'atout
  if (roomState.status === 'choosing_trump') {
    return (
      <div style={{ borderTop: '1px dashed #ccc', paddingTop: 8 }}>
        <h3>Choix de l'atout (Belote)</h3>
        <p>{isYourTurn ? 'À vous de choisir l\'atout' : 'En attente...'}</p>
        <div style={{ display: 'flex', gap: 8 }}>
          {['S','H','D','C'].map(s => (
            <button key={s} disabled={!isYourTurn} onClick={() => chooseTrump(s)}>{s}</button>
          ))}
        </div>
      </div>
    );
  }

  // Jeu des cartes
  if (roomState.status === 'playing') {
    return (
      <div style={{ borderTop: '1px dashed #ccc', paddingTop: 8 }}>
        <h3>Jeu des cartes (Belote) — Atout: {roomState.trumpSuit || '—'}</h3>
        <p>{isYourTurn ? 'À vous de jouer' : 'En attente...'}</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {hand.map((c) => {
            const canPlay = !isYourTurn ? false : (playable.length === 0 || playable.includes(c));
            return (
              <button key={c} onClick={() => isYourTurn && canPlay && playCard(c)} disabled={!canPlay}>{c}</button>
            );
          })}
        </div>
        <div style={{ marginTop: 8 }}>
          <b>Pli en cours:</b> {(roomState.trick || []).map((t, i) => (
            <span key={i} style={{ marginRight: 8 }}>{t.playerId}:{t.card}</span>
          ))}
        </div>
      </div>
    );
  }

  return null;
}

export default BeloteGamePanel;

