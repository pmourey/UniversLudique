import React from 'react';

function DnDCombatView({ roomState, connId, send }) {
  const { players = [], monsters = [], initiative = [], turn, log = [] } = roomState;
  const myPlayer = players.find(p => p.id === connId);
  const isMyTurn = turn === connId && myPlayer && myPlayer.status === 'OK';
  const canAttack = isMyTurn;
  const canDrinkPotion = myPlayer && isMyTurn && myPlayer.potions > 0 && myPlayer.hp < myPlayer.max_hp && myPlayer.hp <= 0.5 * myPlayer.max_hp;
  const handleAttack = (targetId) => {
    send('action', { action: 'attack', params: { attacker: connId, target: targetId } });
  };
  const handleDrinkPotion = () => {
    send('action', { action: 'drink_potion' });
  };
  return (
    <div>
      {myPlayer && (
        <div style={{ marginBottom: 8 }}>
          <b>{myPlayer.name}</b> — Niveau: {myPlayer.level ?? 1} — Or : {myPlayer.gold ?? 0} — Potions : {myPlayer.potions ?? 0}
          {canDrinkPotion && (
            <button style={{ marginLeft: 12 }} onClick={handleDrinkPotion}>Boire Potion (+10 PV)</button>
          )}
        </div>
      )}
      <div style={{ display: 'flex', gap: 32 }}>
        <div>
          <b>Aventuriers</b>
          <ul>
            {players.map(p => (
              <li key={p.id} style={{ color: p.status === 'Dead' ? 'red' : undefined }}>
                {p.name} (HP: {p.hp}/{p.max_hp}, Dégâts: {p.dmg}, AC: {p.ac}, Dex: {p.dex}) {p.status === 'Dead' && '💀'}
                {turn === p.id && <b> ← Tour</b>}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <b>Monstres</b>
          <ul>
            {monsters.map(m => (
              <li key={m.id} style={{ color: m.status === 'Dead' ? 'red' : undefined }}>
                {m.name} (HP: {m.hp}/{m.max_hp}, Dégâts: {m.dmg}, AC: {m.ac}, Dex: {m.dex}, CR: {m.cr}) {m.status === 'Dead' && '💀'}
                {canAttack && m.status === 'OK' && (
                  <button onClick={() => handleAttack(m.id)} style={{ marginLeft: 8 }}>Attaquer</button>
                )}
                {turn === m.id && <b> ← Tour</b>}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <b>Initiative</b>
          <ol>
            {initiative.map((e, i) => (
              <li key={i} style={{ fontWeight: turn === e.id ? 'bold' : undefined }}>
                {e.type === 'player'
                  ? (players.find(p => p.id === e.id)?.name || e.id)
                  : (monsters.find(m => m.id === e.id)?.name || e.id)
                }
                {turn === e.id && ' ← Tour'}
              </li>
            ))}
          </ol>
        </div>
      </div>
      <div style={{ marginTop: 12 }}>
        <b>Log du combat :</b>
        <ul style={{ maxHeight: 120, overflow: 'auto', background: '#f9f9f9', padding: 8, borderRadius: 4, color: '#222' }}>
          {log.map((l, i) => (
            <li key={i}><b>{l[0]}</b>: {l[1]}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default DnDCombatView;

