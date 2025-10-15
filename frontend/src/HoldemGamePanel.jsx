import React from 'react';
import HoldemActions from './gameplay/HoldemActions'
import CardImage from './components/CardImage'

function HoldemGamePanel({ roomState, isYourTurn, hand, playable, holdemEval, connId, playersArr, holdemCheck, holdemCall, holdemBet, holdemRaiseTo, holdemFold }) {
  if (!roomState) return null;

  return (
    <div style={{ borderTop: '1px dashed #ccc', paddingTop: 8 }}>
      <h3>Texas Hold'em</h3>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <b>Cartes communes:</b> {(roomState.community || []).length > 0 ? (
            <span style={{ display: 'inline-flex', alignItems: 'center' }}>{(roomState.community || []).map((c, i) => (
              <CardImage key={i} card={c} width={48} style={{ marginRight: 6 }} />
            ))}</span>
          ) : (
            <span> —</span>
          )}
        </div>
        <div>
          <b>Pot:</b> {roomState.potTotal ?? 0}
        </div>
        <div>
          <b>Blinds:</b> {roomState.smallBlind ?? 0}/{roomState.bigBlind ?? 0}
        </div>
      </div>
      <div style={{ marginTop: 8 }}>
        <b>Probabilité de gagner (calcul backend) :</b>
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          {(roomState.players || []).map((p) => (
            <li key={p.id} style={{ color: p.id === connId ? '#1976d2' : undefined }}>
              {p.name} :&nbsp;
              {holdemEval && holdemEval.allWinProbs && typeof holdemEval.allWinProbs[p.id] !== 'undefined'
                ? `${holdemEval.allWinProbs[p.id]} %`
                : '—'}
            </li>
          ))}
        </ul>
      </div>
      <div style={{ marginTop: 8 }}>
        <b>Votre main:</b> {hand.length > 0 ? (
          <span style={{ display: 'inline-flex', alignItems: 'center' }}>{hand.map((c, i) => (
            <CardImage key={i} card={c} width={64} style={{ marginRight: 6 }} onClick={() => playCard(c)} />
          ))}</span>
        ) : '—'}
        <> — <b>Votre tapis:</b> {(playersArr.find(p => p.id === connId)?.stack) ?? 0}</>
      </div>
      {roomState.status === 'waiting' && <p>La donne n'a pas démarré.</p>}
      {roomState.status === 'dealing' && (
        <HoldemActions isYourTurn={isYourTurn} playableInfo={playable} onCheck={holdemCheck} onCall={holdemCall} onBet={holdemBet} onRaiseTo={holdemRaiseTo} onFold={holdemFold} roomState={roomState} />
      )}
      {roomState.status === 'showdown' && <p>Showdown… calcul des mains.</p>}
      {roomState.status === 'finished' && <p>Donne terminée.</p>}
    </div>
  );
}

export default HoldemGamePanel;
