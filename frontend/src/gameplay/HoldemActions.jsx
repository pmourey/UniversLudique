import React, { useState } from 'react'

function HoldemActions({ isYourTurn, playableInfo, onCheck, onCall, onBet, onRaiseTo, onFold, roomState }) {
  const [betAmt, setBetAmt] = useState('')
  const [raiseTo, setRaiseTo] = useState('')
  const allowed = (isYourTurn && playableInfo && typeof playableInfo === 'object' && (playableInfo.fold !== undefined || playableInfo.check !== undefined)) ? playableInfo : null
  const currentBet = roomState?.currentBet || 0

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
  )
}

export default HoldemActions

