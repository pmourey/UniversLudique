import React from 'react';

function TarotGamePanel({ roomState, isYourTurn, hand, placeBid, playCard, discardSel, toggleDiscard, submitDiscard }) {
  if (!roomState) return null;

  // Affichage des enchères
  if (roomState.status === 'bidding') {
    return (
      <div style={{ borderTop: '1px dashed #ccc', paddingTop: 8 }}>
        <h3>Enchères</h3>
        <p>{isYourTurn ? 'À vous de parler.' : 'En attente...'}</p>
        {/* Ajoutez ici les boutons d'enchères selon la logique de votre application */}
      </div>
    );
  }

  // Affichage de l'écart (discard)
  if (roomState.status === 'discarding') {
    return (
      <div style={{ borderTop: '1px dashed #ccc', paddingTop: 8 }}>
        <h3>Écart</h3>
        {/* Affichage de la main et sélection des cartes à écarter */}
        <div>
          {hand.map(card => (
            <button key={card} onClick={() => toggleDiscard(card)} style={{ margin: 2, background: discardSel.includes(card) ? '#ffd' : '#fff' }}>
              {card}
            </button>
          ))}
        </div>
        <button onClick={submitDiscard} disabled={discardSel.length !== (roomState.players?.length === 5 ? 3 : 6)}>
          Valider l'écart
        </button>
      </div>
    );
  }

  // Affichage du jeu (playing)
  if (roomState.status === 'playing') {
    return (
      <div style={{ borderTop: '1px dashed #ccc', paddingTop: 8 }}>
        <h3>Jeu</h3>
        {/* Affichage de la main et des cartes jouables */}
        <div>
          {hand.map(card => (
            <button key={card} onClick={() => playCard(card)} style={{ margin: 2 }}>
              {card}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return null;
}

export default TarotGamePanel;

