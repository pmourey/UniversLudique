import { useEffect, useRef, useState } from 'react'
import './App.css'

const DEFAULT_WS = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`
const WS_URL = import.meta.env.VITE_WS_URL || DEFAULT_WS

function App() {
  const [status, setStatus] = useState('disconnected') // disconnected | connecting | connected
  const [connId, setConnId] = useState(null)
  const [name, setName] = useState('')
  const [registeredName, setRegisteredName] = useState(null)

  const [rooms, setRooms] = useState([])
  const [roomId, setRoomId] = useState('')
  const [roomState, setRoomState] = useState(null)

  const [messages, setMessages] = useState([])
  const [chatInput, setChatInput] = useState('')

  // Jeu
  const [hand, setHand] = useState([])
  const [isYourTurn, setIsYourTurn] = useState(false)
  const [youAreTaker, setYouAreTaker] = useState(false)
  const [discardSel, setDiscardSel] = useState([])

  const wsRef = useRef(null)
  const reconnectRef = useRef({ attempts: 0, timer: null })

  const scheduleReconnect = () => {
    const { attempts, timer } = reconnectRef.current
    if (timer) return
    const delay = Math.min(1000 * Math.pow(2, attempts), 10000)
    reconnectRef.current.attempts = attempts + 1
    reconnectRef.current.timer = setTimeout(() => {
      reconnectRef.current.timer = null
      connect()
    }, delay)
  }

  const clearReconnect = () => {
    if (reconnectRef.current.timer) {
      clearTimeout(reconnectRef.current.timer)
      reconnectRef.current.timer = null
    }
    reconnectRef.current.attempts = 0
  }

  const connect = () => {
    const ws = wsRef.current
    if (ws && ws.readyState !== WebSocket.CLOSED) return
    setStatus('connecting')
    try {
      const wsNew = new WebSocket(WS_URL)
      wsRef.current = wsNew

      wsNew.onopen = () => {
        clearReconnect()
        setStatus('connected')
        // Nouveau: on considère la connexion comme neuve → le nom enregistré n’est plus valide côté serveur
        setRegisteredName(null)
      }

      wsNew.onclose = () => {
        setStatus('disconnected')
        if (wsRef.current === wsNew) wsRef.current = null
        setConnId(null)
        scheduleReconnect()
      }

      // Ne pas forcer disconnected sur error; on attend le close.
      wsNew.onerror = () => {
        // Optionnel: console.warn('WebSocket error')
      }

      wsNew.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data)
          handleMessage(msg)
        } catch {}
      }
    } catch (e) {
      setStatus('disconnected')
      scheduleReconnect()
    }
  }

  const send = (type, payload = {}) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ type, payload }))
  }

  const handleMessage = (msg) => {
    switch (msg.type) {
      case 'welcome':
        setConnId(msg.payload?.connectionId || null)
        break
      case 'registered':
        setRegisteredName(msg.payload?.name || null)
        break
      case 'rooms':
        setRooms(msg.payload || [])
        break
      case 'room_joined':
      case 'room_update':
      case 'state':
        setRoomState(msg.payload)
        setRoomId(msg.payload?.roomId || '')
        if (msg.payload?.status !== 'discarding') setDiscardSel([])
        break
      case 'left_room':
        setRoomState(null)
        setHand([])
        setDiscardSel([])
        break
      case 'chat':
        setMessages((prev) => [...prev, msg.payload])
        break
      case 'notice':
        setMessages((prev) => [...prev, { from: 'system', text: msg.payload?.message || '', ts: Date.now() }])
        break
      case 'game_over': {
        const names = (msg.payload?.winnersNames || []).join(', ')
        const text = names ? `Fin de partie — Gagnant(s): ${names}` : 'Fin de partie'
        setMessages((prev) => [...prev, { from: 'system', text, ts: Date.now() }])
        break
      }
      case 'your_hand':
        setHand(msg.payload?.hand || [])
        setIsYourTurn(!!msg.payload?.isYourTurn)
        setYouAreTaker(!!msg.payload?.youAreTaker)
        break
      case 'error':
        alert(msg.payload?.message || 'Erreur')
        break
      default:
        break
    }
  }

  // Actions jeu
  const doRegister = () => name.trim() && send('register', { name: name.trim() })
  const createRoom = () => send('create_room')
  const listRooms = () => send('list_rooms')
  const joinRoom = () => roomId.trim() && send('join_room', { roomId: roomId.trim() })
  const leaveRoom = () => send('leave_room')
  const startGame = () => send('start_game')
  const restartDeal = () => send('action', { action: 'restart' })
  const finishDeal = () => send('action', { action: 'finish' })
  const sendChat = () => { if (!chatInput.trim()) return; send('chat', { text: chatInput }); setChatInput('') }

  const placeBid = (bid) => send('action', { action: 'bid', params: { bid } })
  const playCard = (card) => send('action', { action: 'play_card', params: { card } })
  const toggleDiscard = (card) => {
    setDiscardSel((prev) => prev.includes(card) ? prev.filter(c => c !== card) : [...prev, card])
  }
  const submitDiscard = () => {
    const target = discardTarget()
    if (discardSel.length !== target) return alert(`Sélectionnez ${target} cartes à écarter`)
    send('action', { action: 'discard', params: { cards: discardSel } })
  }

  const discardTarget = () => {
    const n = roomState?.players?.length || 0
    return n === 5 ? 3 : 6
  }

  useEffect(() => {
    connect()
    return () => { if (wsRef.current) wsRef.current.close() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const canStart = roomState?.status === 'waiting' && (roomState?.players?.length || 0) >= 3
  const canRestart = roomState?.status === 'finished'
  const canForceFinish = roomState?.status === 'playing' && (roomState?.players || []).length > 0 && (roomState.players || []).every(p => p.handCount === 0)

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: 16 }}>
      <h1>Tarot en ligne (prototype)</h1>
      <p>Status: {status} {connId ? `(id: ${connId})` : ''}</p>
      {status !== 'connected' && (<button onClick={connect}>Se connecter</button>)}

      <section style={{ border: '1px solid #ddd', padding: 12, borderRadius: 8, marginTop: 12 }}>
        <h2>Inscription</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Votre pseudo" />
          <button onClick={doRegister} disabled={!name || status !== 'connected'}>S'inscrire</button>
          {registeredName && <span>Inscrit comme: <b>{registeredName}</b></span>}
        </div>
      </section>

      <section style={{ border: '1px solid #ddd', padding: 12, borderRadius: 8, marginTop: 12 }}>
        <h2>Salons</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <button onClick={createRoom} disabled={status !== 'connected'}>Créer un salon</button>
          <button onClick={listRooms} disabled={status !== 'connected'}>Lister les salons</button>
          <input value={roomId} onChange={(e) => setRoomId(e.target.value)} placeholder="ID du salon" />
          <button onClick={joinRoom} disabled={status !== 'connected' || !roomId}>Rejoindre</button>
          <button onClick={leaveRoom} disabled={!roomState}>Quitter</button>
        </div>
        {rooms?.length > 0 && (
          <ul>
            {rooms.map(r => (
              <li key={r.roomId}>
                <button onClick={() => setRoomId(r.roomId)}>Choisir</button>
                &nbsp;Salon {r.roomId} — joueurs: {r.players} — statut: {r.status}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section style={{ border: '1px solid #ddd', padding: 12, borderRadius: 8, marginTop: 12 }}>
        <h2>Salon courant</h2>
        {roomState ? (
          <div>
            <p>Salon: <b>{roomState.roomId}</b> — Statut: <b>{roomState.status}</b> — Donneur: {roomState.dealerId ?? '—'}</p>
            <p>Joueurs (ordre):</p>
            <ul>
              {(roomState.players || []).map(p => (
                <li key={p.id}>
                  {p.name} (#{p.id}) — cartes: {p.handCount} — plis: {p.tricksWon} {roomState.currentPlayerId === p.id ? '⬅️ Tour' : ''} {roomState.takerId === p.id ? ' (preneur)' : ''}
                </li>
              ))}
            </ul>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <button onClick={startGame} disabled={!canStart}>Démarrer la donne</button>
              {canRestart && <button onClick={restartDeal}>Relancer la donne</button>}
              {canForceFinish && <button onClick={finishDeal}>Terminer la donne</button>}
            </div>
            {roomState.status === 'bidding' && (
              <div style={{ borderTop: '1px dashed #ccc', paddingTop: 8 }}>
                <h3>Enchères</h3>
                <p>{isYourTurn ? 'À vous de parler.' : 'En attente...'}</p>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button disabled={!isYourTurn} onClick={() => placeBid('pass')}>Passer</button>
                  <button disabled={!isYourTurn} onClick={() => placeBid('prise')}>Prise</button>
                  <button disabled={!isYourTurn} onClick={() => placeBid('garde')}>Garde</button>
                  <button disabled={!isYourTurn} onClick={() => placeBid('garde_sans')}>Garde sans</button>
                  <button disabled={!isYourTurn} onClick={() => placeBid('garde_contre')}>Garde contre</button>
                </div>
                <p>Meilleure enchère: <b>{roomState.highestBid || '—'}</b> — Preneur: {roomState.takerId ?? '—'}</p>
              </div>
            )}
            {roomState.status === 'discarding' && youAreTaker && (
              <div style={{ borderTop: '1px dashed #ccc', paddingTop: 8 }}>
                <h3>Écart</h3>
                <p>Sélectionnez {discardTarget()} cartes à écarter</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {hand.map((c) => (
                    <button key={c} onClick={() => toggleDiscard(c)} style={{ border: discardSel.includes(c) ? '2px solid red' : '1px solid #ccc' }}>{c}</button>
                  ))}
                </div>
                <button onClick={submitDiscard} disabled={discardSel.length !== discardTarget()}>Valider l'écart</button>
              </div>
            )}
            {roomState.status === 'playing' && (
              <div style={{ borderTop: '1px dashed #ccc', paddingTop: 8 }}>
                <h3>Jeu des cartes</h3>
                <p>{isYourTurn ? 'À vous de jouer' : 'En attente...'}</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {hand.map((c) => (
                    <button key={c} onClick={() => isYourTurn && playCard(c)} disabled={!isYourTurn}>{c}</button>
                  ))}
                </div>
                <div style={{ marginTop: 8 }}>
                  <b>Pli en cours:</b> {(roomState.trick || []).map((t, i) => (
                    <span key={i} style={{ marginRight: 8 }}>{t.playerId}:{t.card}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <p>Aucun salon rejoint.</p>
        )}
      </section>

      <section style={{ border: '1px solid #ddd', padding: 12, borderRadius: 8, marginTop: 12 }}>
        <h2>Chat</h2>
        <div style={{ maxHeight: 200, overflow: 'auto', border: '1px solid #eee', padding: 8, borderRadius: 4 }}>
          {messages.map((m, i) => (
            <div key={i}><b>{m.from}:</b> {m.text}</div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <input value={chatInput} onChange={(e) => setChatInput(e.target.value)} placeholder="Message" />
          <button onClick={sendChat} disabled={!roomState}>Envoyer</button>
        </div>
      </section>

      <p style={{ marginTop: 16, fontSize: 12, color: '#666' }}>WS: {WS_URL}</p>
    </div>
  )
}

export default App
