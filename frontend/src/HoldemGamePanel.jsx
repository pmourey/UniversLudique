import React from 'react';

function HoldemGamePanel({ roomState, isYourTurn, hand, playable, holdemEval, connId, playersArr, holdemCheck, holdemCall, holdemBet, holdemRaiseTo, holdemFold }) {
  if (!roomState) return null;

  return (
    <div style={{ borderTop: '1px dashed #ccc', paddingTop: 8 }}>
      <h3>Texas Hold'em</h3>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <b>Cartes communes:</b> {(roomState.community || []).length > 0 ? (
            <span> {(roomState.community || []).join(' ')}</span>
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
        <b>Votre main:</b> {hand.length > 0 ? hand.join(' ') : '—'}
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

// Reprise du composant HoldemActions depuis App.jsx
function HoldemActions({ isYourTurn, playableInfo, onCheck, onCall, onBet, onRaiseTo, onFold, roomState }) {
  const [betAmt, setBetAmt] = React.useState('');
  const [raiseTo, setRaiseTo] = React.useState('');
  const allowed = (isYourTurn && playableInfo && typeof playableInfo === 'object' && (playableInfo.fold !== undefined || playableInfo.check !== undefined)) ? playableInfo : null;
  const currentBet = roomState?.currentBet || 0;

  return (
    <div style={{ borderTop: '1px dashed #ddd', paddingTop: 8 }}>
      <p>{isYourTurn ? 'À vous de parler' : 'En attente...'}</p>
      {isYourTurn && allowed && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {allowed.fold && <button onClick={onFold}>Fold</button>}
          {allowed.check && <button onClick={onCheck}>Check</button>}
          {allowed.call > 0 && <button onClick={onCall}>Call {allowed.call}</button>}
          {currentBet === 0 ? (
            <>
              <input type="number" min={allowed.minBet || 0} placeholder={`Bet ≥ ${allowed.minBet || 0}`} value={betAmt} onChange={e => setBetAmt(e.target.value)} style={{ width: 120 }} />
              <button onClick={() => onBet(Math.max(parseInt(betAmt||'0',10), allowed.minBet || 0))} disabled={!betAmt}>Bet</button>
            </>
          ) : (
            <>
              <input type="number" min={allowed.minRaiseTo || 0} placeholder={`Raise to ≥ ${allowed.minRaiseTo || 0}`} value={raiseTo} onChange={e => setRaiseTo(e.target.value)} style={{ width: 160 }} />
              <button onClick={() => onRaiseTo(Math.max(parseInt(raiseTo||'0',10), allowed.minRaiseTo || 0))} disabled={!raiseTo}>Raise To</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default HoldemGamePanel;

