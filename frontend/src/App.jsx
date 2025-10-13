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
  const [playable, setPlayable] = useState([]) // nouvelles cartes jouables (Belote)

  // Nouveau: type de jeu à créer
  const [newGame, setNewGame] = useState('tarot') // 'tarot' | 'belote' | 'holdem'
  const [holdemEval, setHoldemEval] = useState(null)

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
        } catch { /* empty */ }
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
      case 'room_created':
        // Après création d'un salon, rafraîchir la liste du bon jeu
        listRooms(msg.payload?.game || newGame);
        break
      case 'room_joined':
      case 'room_update':
      case 'state':
        setRoomState(msg.payload)
        setRoomId(msg.payload?.roomId || '')
        if (msg.payload?.status !== 'discarding') setDiscardSel([])
        // Réinitialiser 'playable' (cartes jouables) uniquement pour la Belote hors phase de jeu.
        // Pour Hold'em, 'playable' transporte l'objet 'allowed' et ne doit pas être vidé.
        if ((msg.payload?.game === 'belote') && msg.payload?.status !== 'playing') setPlayable([])
        break
      case 'left_room':
        setRoomState(null)
        setHand([])
        setDiscardSel([])
        setPlayable([])
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
        setPlayable(msg.payload?.playable || msg.payload?.allowed || [])
        break
      case 'error':
        alert(msg.payload?.message || 'Erreur')
        break
      case 'hand_evaluation':
        setHoldemEval(msg.payload);
        break;
      default:
        break
    }
  }

  // Actions jeu
  const doRegister = () => name.trim() && send('register', { name: name.trim() })
  const createRoom = () => send('create_room', { game: newGame })
  const listRooms = (game) => send('list_rooms', { game: game || newGame })
  const joinRoom = () => roomId.trim() && send('join_room', { roomId: roomId.trim() })
  const leaveRoom = () => send('leave_room')
  const startGame = () => send('start_game')
  const restartDeal = () => send('action', { action: 'restart' })
  const finishDeal = () => send('action', { action: 'finish' })
  const chooseTrump = (suit) => send('action', { action: 'choose_trump', params: { suit } })
  // Hold'em actions
  const holdemCheck = () => send('action', { action: 'check' })
  const holdemCall = () => send('action', { action: 'call' })
  const holdemBet = (amount) => send('action', { action: 'bet', params: { amount } })
  const holdemRaiseTo = (to) => send('action', { action: 'raise_to', params: { to } })
  const holdemFold = () => send('action', { action: 'fold' })
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

  // Rafraîchir automatiquement la liste des salons à chaque changement de jeu sélectionné
  useEffect(() => {
    if (status === 'connected') {
      listRooms();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newGame, status]);

  useEffect(() => {
    // Calculer la probabilité de chaque joueur Hold'em via l'API PHP
    // (fonctionnalité désactivée car variables associées supprimées)
  }, [roomState?.game, hand, roomState?.community, roomState?.players, connId]);

  const minPlayersFor = (g) => g === 'belote' ? 4 : g === 'holdem' ? 2 : 3
  const playersArr = roomState?.players || []
  const holdemEligibleCount = (roomState?.game === 'holdem') ? playersArr.filter(p => (p.stack ?? 0) > 0).length : 0
  const canStart = roomState?.status === 'waiting' && (
    roomState?.game === 'holdem'
      ? holdemEligibleCount >= 2
      : (playersArr.length >= minPlayersFor(roomState?.game || 'tarot'))
  )
  // Autoriser le bouton si la partie est terminée (finished ou scoring)
  const canRestart = (roomState?.status === 'finished' || roomState?.status === 'scoring') && (
    roomState?.game === 'holdem' ? (holdemEligibleCount >= 2) : true
  )
  const canForceFinish = roomState?.status === 'playing' && (roomState?.players || []).length > 0 && (roomState.players || []).every(p => p.handCount === 0)

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: 16 }}>
      <h1>Jeux de cartes multi-joueurs (prototype)</h1>
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
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
          <label>Choisir jeu:&nbsp;
            <select value={newGame} onChange={(e) => {
              setNewGame(e.target.value);
              // listRooms(); // SUPPRIMÉ : le rafraîchissement est maintenant dans useEffect
            }}>
              <option value="tarot">Tarot</option>
              <option value="belote">Belote</option>
              <option value="holdem">Texas Hold'em</option>
            </select>
          </label>
          <button onClick={createRoom} disabled={status !== 'connected'}>Créer un salon</button>
          <input value={roomId} onChange={(e) => setRoomId(e.target.value)} placeholder="ID du salon" />
          <button onClick={joinRoom} disabled={status !== 'connected' || !roomId}>Rejoindre</button>
          <button onClick={leaveRoom} disabled={!roomState}>Quitter</button>
        </div>
        {rooms?.length > 0 && (
          <ul>
            {rooms.map(r => (
              <li key={r.roomId}>
                <button onClick={() => setRoomId(r.roomId)}>Choisir</button>
                &nbsp;Salon {r.roomId} — jeu: {r.game || 'tarot'} — joueurs: {r.players} — statut: {r.status}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section style={{ border: '1px solid #ddd', padding: 12, borderRadius: 8, marginTop: 12 }}>
        <h2>Salon courant</h2>
        {roomState ? (
          <div>
            <p>Salon: <b>{roomState.roomId}</b> — Jeu: <b>{roomState.game || 'tarot'}</b> — Statut: <b>{roomState.status}</b> — Donneur: {roomState.dealerId ?? '—'} {roomState.game === 'belote' && roomState.trumpSuit ? `— Atout: ${roomState.trumpSuit}` : ''}</p>
            <p>Joueurs (ordre):</p>
            <ul>
              {(roomState.players || []).map(p => (
                <li key={p.id}>
                  {p.name} (#{p.id}) {p.team !== undefined ? `(équipe ${p.team})` : ''}
                  {roomState.game === 'holdem' ? (
                    <> — stack: {p.stack ?? '—'} — mise: {p.bet ?? 0} {p.folded ? '(couché)' : ''} {p.allin ? '(all-in)' : ''} {roomState.currentPlayerId === p.id ? '⬅️ Tour' : ''}</>
                  ) : (
                    <> — cartes: {p.handCount ?? 0} — plis: {p.tricksWon ?? 0} {roomState.currentPlayerId === p.id ? '⬅️ Tour' : ''} {roomState.takerId === p.id ? ' (preneur)' : ''}</>
                  )}
                </li>
              ))}
            </ul>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <button onClick={startGame} disabled={!canStart}>Démarrer la donne</button>
              {canRestart && <button onClick={restartDeal}>Relancer la donne</button>}
              {canForceFinish && <button onClick={finishDeal}>Terminer la donne</button>}
            </div>
            {/* Tarot */}
            {roomState.game === 'tarot' && roomState.status === 'bidding' && (
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
            {roomState.game === 'tarot' && roomState.status === 'discarding' && youAreTaker && (
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
            {roomState.game === 'tarot' && roomState.status === 'playing' && (
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
            {/* Belote */}
            {roomState.game === 'belote' && roomState.status === 'choosing_trump' && (
              <div style={{ borderTop: '1px dashed #ccc', paddingTop: 8 }}>
                <h3>Choix de l'atout (Belote)</h3>
                <p>{isYourTurn ? 'À vous de choisir l\'atout' : 'En attente...'}</p>
                <div style={{ display: 'flex', gap: 8 }}>
                  {['S','H','D','C'].map(s => (
                    <button key={s} disabled={!isYourTurn} onClick={() => chooseTrump(s)}>{s}</button>
                  ))}
                </div>
              </div>
            )}
            {roomState.game === 'belote' && roomState.status === 'playing' && (
              <div style={{ borderTop: '1px dashed #ccc', paddingTop: 8 }}>
                <h3>Jeu des cartes (Belote) — Atout: {roomState.trumpSuit || '—'}</h3>
                <p>{isYourTurn ? 'À vous de jouer' : 'En attente...'}</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {hand.map((c) => {
                    const canPlay = !isYourTurn ? false : (playable.length === 0 || playable.includes(c))
                    return (
                      <button key={c} onClick={() => isYourTurn && canPlay && playCard(c)} disabled={!canPlay}>{c}</button>
                    )
                  })}
                </div>
                <div style={{ marginTop: 8 }}>
                  <b>Pli en cours:</b> {(roomState.trick || []).map((t, i) => (
                    <span key={i} style={{ marginRight: 8 }}>{t.playerId}:{t.card}</span>
                  ))}
                </div>
              </div>
            )}
            {/* Hold'em */}
            {roomState.game === 'holdem' && (
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
                {/* Affichage des probabilités de victoire pour chaque joueur (backend) */}
                <div style={{ marginTop: 8 }}>
                  <b>Probabilité de gagner (calcul backend) :</b>
                  <ul style={{ margin: 0, paddingLeft: 20 }}>
                    {(roomState.players || []).map((p) => (
                      <li key={p.id} style={{ color: p.id === connId ? '#1976d2' : undefined }}>
                        {p.name} (#{p.id}) :&nbsp;
                        {holdemEval && holdemEval.allWinProbs && typeof holdemEval.allWinProbs[p.id] !== 'undefined'
                          ? `${holdemEval.allWinProbs[p.id]} %`
                          : '—'}
                      </li>
                    ))}
                  </ul>
                </div>
                <div style={{ marginTop: 8 }}>
                  <b>Votre main:</b> {hand.length > 0 ? hand.join(' ') : '—'}
                  {roomState.game === 'holdem' && (
                    <> — <b>Votre tapis:</b> {(playersArr.find(p => p.id === connId)?.stack) ?? 0}</>
                  )}
                </div>
                {roomState.status === 'waiting' && <p>La donne n'a pas démarré.</p>}
                {roomState.status === 'dealing' && (
                  <HoldemActions isYourTurn={isYourTurn} playableInfo={playable} onCheck={holdemCheck} onCall={holdemCall} onBet={holdemBet} onRaiseTo={holdemRaiseTo} onFold={holdemFold} roomState={roomState} />
                )}
                {roomState.status === 'showdown' && <p>Showdown… calcul des mains.</p>}
                {roomState.status === 'finished' && <p>Donne terminée.</p>}
              </div>
            )}
            {/* Placeholder autres jeux */}
            {roomState.game && !['tarot','belote','holdem'].includes(roomState.game) && (
              <div style={{ borderTop: '1px dashed #ccc', paddingTop: 8 }}>
                <i>Ce jeu n'est pas encore implémenté dans ce prototype.</i>
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

      {holdemEval && (
        <div className="holdem-eval">
          <div>Phase : <b>{holdemEval.round}</b></div>
          <div>Probabilité de gagner : <b>{(holdemEval.winProb !== undefined && holdemEval.winProb !== '—') ? holdemEval.winProb + ' %' : '—'}</b></div>
          <div>Rang de la main : <b>{holdemEval.rank}</b></div>
        </div>
      )}

      <p style={{ marginTop: 16, fontSize: 12, color: '#666' }}>WS: {WS_URL}</p>
    </div>
  )
}

// Composant d’actions Hold’em
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

export default App
