import React from 'react';
import CardImage from './components/CardImage'

function TarotGamePanel({ roomState, isYourTurn, hand, playCard, discardSel, toggleDiscard, submitDiscard }) {
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
            <CardImage
              key={card}
              card={card}
              onClick={() => toggleDiscard(card)}
              className="card"
              style={{ margin: 4, border: discardSel.includes(card) ? '2px solid #f90' : '2px solid transparent', borderRadius: 6 }}
            />
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
            <CardImage key={card} card={card} onClick={() => playCard(card)} className="card" style={{ margin: 4 }} />
          ))}
        </div>
      </div>
    );
  }

  return null;
}

export default TarotGamePanel;
