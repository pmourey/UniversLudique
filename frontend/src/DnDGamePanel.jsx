import React from 'react';
import DnDMonsterSetup from './gameplay/DnDMonsterSetup';
import DnDCombatView from './gameplay/DnDCombatView';

function DnDGamePanel({ roomState, connId, gold, jetons, conversionMsg, convertGoldToJeton, send }) {
  if (!roomState) return null;

  return (
    <div style={{ borderTop: '1px dashed #ccc', paddingTop: 8 }}>
      <h3>DnD 5e — Arène</h3>
      <pre style={{background:'#eee',fontSize:12,padding:4, color:'#111'}}>
        connId: {JSON.stringify(connId)}<br />
        gold (state): {gold}
      </pre>
      <div style={{marginBottom:8}}>
        <b>Or :</b> {gold} &nbsp;|&nbsp; <b>Jetons :</b> {jetons}
        <button style={{marginLeft:12}} onClick={() => convertGoldToJeton(1)} disabled={gold < 10}>Convertir 10 or → 1 jeton</button>
      </div>
      {conversionMsg && <div style={{color: conversionMsg.startsWith('Conversion') ? 'green' : 'red', marginBottom:8}}>{conversionMsg}</div>}
      {roomState.status === 'waiting' && <DnDMonsterSetup send={send} />}
      {roomState.status === 'fighting' && <DnDCombatView roomState={roomState} connId={connId} send={send} />}
      {roomState.status === 'finished' && <div>Combat terminé.</div>}
    </div>
  );
}

export default DnDGamePanel;
