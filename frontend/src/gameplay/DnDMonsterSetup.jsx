import React, { useState } from 'react'

function DnDMonsterSetup({ send }) {
  const [monsters, setMonsters] = useState([
    { name: 'Gobelin', hp: 8, max_hp: 8, dmg: 3, ac: 13, cr: 1, dex: 14 },
    { name: 'Orc', hp: 15, max_hp: 15, dmg: 5, ac: 13, cr: 2, dex: 12 },
  ]);
  const handleChange = (i, field, value) => {
    setMonsters(m => m.map((mon, idx) => idx === i ? { ...mon, [field]: value } : mon));
  };
  const addMonster = () => setMonsters(m => [...m, { name: '', hp: 10, max_hp: 10, dmg: 2, ac: 10, cr: 1, dex: 10 }]);
  const removeMonster = (i) => setMonsters(m => m.filter((_, idx) => idx !== i));
  const submit = () => {
    send('action', { action: 'set_monsters', params: { monsters } });
    send('action', { action: 'start_combat' });
  };
  return (
    <div>
      <h4>Configuration des monstres</h4>
      <table style={{ borderCollapse: 'collapse', marginBottom: 8 }}>
        <thead>
          <tr>
            <th style={{ width: 80, textAlign: 'left', padding: 2 }}>Nom</th>
            <th style={{ width: 50, textAlign: 'left', padding: 2 }}>HP</th>
            <th style={{ width: 60, textAlign: 'left', padding: 2 }}>Max HP</th>
            <th style={{ width: 60, textAlign: 'left', padding: 2 }}>Dégâts</th>
            <th style={{ width: 40, textAlign: 'left', padding: 2 }}>AC</th>
            <th style={{ width: 40, textAlign: 'left', padding: 2 }}>CR</th>
            <th style={{ width: 40, textAlign: 'left', padding: 2 }}>Dex</th>
            <th style={{ width: 60, textAlign: 'left', padding: 2 }}>Action</th>
          </tr>
        </thead>
        <tbody>
          {monsters.map((m, i) => (
            <tr key={i}>
              <td style={{ padding: 2 }}><input value={m.name} onChange={e => handleChange(i, 'name', e.target.value)} placeholder="Nom" style={{ width: 70 }} /></td>
              <td style={{ padding: 2 }}><input type="number" value={m.hp} onChange={e => handleChange(i, 'hp', +e.target.value)} placeholder="HP" style={{ width: 40 }} /></td>
              <td style={{ padding: 2 }}><input type="number" value={m.max_hp} onChange={e => handleChange(i, 'max_hp', +e.target.value)} placeholder="Max HP" style={{ width: 50 }} /></td>
              <td style={{ padding: 2 }}><input type="number" value={m.dmg} onChange={e => handleChange(i, 'dmg', +e.target.value)} placeholder="Dégâts" style={{ width: 50 }} /></td>
              <td style={{ padding: 2 }}><input type="number" value={m.ac} onChange={e => handleChange(i, 'ac', +e.target.value)} placeholder="AC" style={{ width: 30 }} /></td>
              <td style={{ padding: 2 }}><input type="number" value={m.cr} onChange={e => handleChange(i, 'cr', +e.target.value)} placeholder="CR" style={{ width: 30 }} /></td>
              <td style={{ padding: 2 }}><input type="number" value={m.dex} onChange={e => handleChange(i, 'dex', +e.target.value)} placeholder="Dex" style={{ width: 30 }} /></td>
              <td style={{ padding: 2 }}><button onClick={() => removeMonster(i)} disabled={monsters.length <= 1}>Suppr</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button onClick={addMonster}>Ajouter un monstre</button>
      <button onClick={submit} style={{ marginLeft: 8 }}>Lancer le combat</button>
    </div>
  );
}

export default DnDMonsterSetup

