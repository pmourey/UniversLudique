import { useEffect, useRef, useState } from 'react'
import './App.css'

const DEFAULT_WS = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`
const WS_URL = DEFAULT_WS
// console.log('WebSocket URL utilisée :', WS_URL)

// Helpers persistance localStorage
const LS_NAME = 'tarot_name'
const LS_REGISTERED = 'tarot_registeredName'
const LS_ROOMID = 'tarot_roomId'

function App() {
  // Initialisation depuis localStorage
  const [name, setName] = useState(() => localStorage.getItem(LS_NAME) || '')
  const [registeredName, setRegisteredName] = useState(() => localStorage.getItem(LS_REGISTERED) || null)
  const [roomId, setRoomId] = useState(() => localStorage.getItem(LS_ROOMID) || '')
  const [status, setStatus] = useState('disconnected') // disconnected | connecting | connected
  const [connId, setConnId] = useState(null)

  const [rooms, setRooms] = useState([])
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
  const [newGame, setNewGame] = useState('dnd5e') // 'tarot' | 'belote' | 'holdem' | 'dnd5e'
  const [holdemEval, setHoldemEval] = useState(null)

  const wsRef = useRef(null)
  const reconnectRef = useRef({ attempts: 0, timer: null })
  const unregisteringRef = useRef(false)
  const isLeavingRef = useRef(false)

  const scheduleReconnect = () => {
    if (unregisteringRef.current) return;
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
        // SUPPRIMÉ : ne pas remettre setRegisteredName(null) ici
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
        // eslint-disable-next-line no-unused-vars
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

  // Ajout d'un état pour l'erreur d'inscription
  const [registerError, setRegisterError] = useState('')

  const handleMessage = (msg) => {
    switch (msg.type) {
      case 'welcome':
        setConnId(msg.payload?.connectionId || null)
        break
      case 'registered':
        setRegisteredName(msg.payload?.name || null)
        setRegisterError('')
        break
      case 'unregistered':
        setRegisteredName(null)
        setName('')
        setRoomId('')
        setRoomState(null)
        setHand([])
        setDiscardSel([])
        setPlayable([])
        localStorage.removeItem(LS_NAME)
        localStorage.removeItem(LS_REGISTERED)
        localStorage.removeItem(LS_ROOMID)
        setRegisterError('')
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
        setHand(msg.payload?.hand || []) // Correction : rafraîchir la main du joueur après restart
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
        localStorage.removeItem(LS_ROOMID)
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
        if (msg.payload?.message?.includes('déjà utilisé')) {
          setRegisterError(msg.payload.message)
          setRegisteredName(null)
          setName('')
          localStorage.removeItem(LS_NAME)
          localStorage.removeItem(LS_REGISTERED)
        }
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
  const doRegister = (pseudo) => {
    send('register', { name: pseudo })
  }
  const createRoom = () => send('create_room', { game: newGame })
  const listRooms = (game) => send('list_rooms', { game: game || newGame })
  const joinRoom = () => roomId.trim() && send('join_room', { roomId: roomId.trim() })
  const leaveRoom = () => {
    isLeavingRef.current = true;
    send('leave_room')
  }
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

  // Bouton "Terminer la donne" : actif si tous les joueurs n'ont plus de cartes en main (pour Tarot/Belote)
  const canForceFinish = roomState?.status === 'playing' && (roomState?.players || []).length > 0 && (roomState.players || []).every(p => p.handCount === 0)

  // Persistance localStorage : nom, nom enregistré, salon courant
  useEffect(() => { localStorage.setItem(LS_NAME, name) }, [name])
  useEffect(() => { if (registeredName) localStorage.setItem(LS_REGISTERED, registeredName); else localStorage.removeItem(LS_REGISTERED) }, [registeredName])
  useEffect(() => { localStorage.setItem(LS_ROOMID, roomId) }, [roomId])

  // Re-inscription et rejoin automatique après reload
  useEffect(() => {
    if (status === 'connected' && registeredName && roomId && !roomState && !isLeavingRef.current) {
      send('join_room', { roomId })
    }
  }, [status, registeredName, roomId, roomState])

  // Formulaire d'inscription
  const handleRegister = (e) => {
    e.preventDefault()
    if (!name.trim()) return
    setRegisterError('')
    doRegister(name.trim())
  }

  // Désinscription
  const handleUnregister = () => {
    unregisteringRef.current = true;
    send('unregister')
    setRegisteredName(null)
    setName('')
    localStorage.removeItem(LS_NAME)
    localStorage.removeItem(LS_REGISTERED)
    setRegisterError('')
    if (wsRef.current) {
      wsRef.current.close()
    }
    // Relancer la connexion WebSocket après un court délai pour garantir la fermeture
    setTimeout(() => {
      unregisteringRef.current = false;
      connect();
    }, 300);
  }

  // Rendu du formulaire d'inscription si pas de pseudo enregistré
  if (!registeredName) {
    return (
      <div className="register-form">
        <h2>Inscription</h2>
        <form onSubmit={handleRegister}>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Entrez votre pseudo"
            autoFocus
          />
          <button type="submit">S'inscrire</button>
        </form>
        {registerError && <div className="error" style={{color:'red'}}>{registerError}</div>}
      </div>
    )
  }

  // Affichage principal après inscription
  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Univers Multijeux : Cartes, Stratégie & Simulation en Ligne (prototype)</h1>
        <div>
          <span>Connecté en tant que <b>{registeredName}</b></span>
          <button onClick={handleUnregister} style={{marginLeft:8}}>Se désinscrire</button>
        </div>
      </div>
      <p>Status: {status} {connId ? `(id: ${connId})` : ''}</p>
      {status !== 'connected' && (<button onClick={connect}>Se connecter</button>)}

      {/* Panneau de gestion des salons : affiché uniquement si connecté et pas dans un salon */}
      {status === 'connected' && !roomState && (
        <section style={{ border: '1px solid #ddd', padding: 12, borderRadius: 8, marginTop: 12 }}>
          <h2>Salons</h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
            <label>Choisir jeu:&nbsp;
              <select value={newGame} onChange={(e) => {
                setNewGame(e.target.value);
              }}>
                <option value="tarot">Tarot</option>
                <option value="belote">Belote</option>
                <option value="holdem">Texas Hold'em</option>
                <option value="dnd5e">DnD 5e</option>
              </select>
            </label>
            <button onClick={createRoom} disabled={status !== 'connected'}>Créer un salon</button>
            <input value={roomId} onChange={(e) => setRoomId(e.target.value)} placeholder="ID du salon" />
            <button onClick={joinRoom} disabled={status !== 'connected' || !roomId}>Rejoindre</button>
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
      )}

      {/* Panneau du salon courant : affiché uniquement si dans un salon */}
      {roomState && (
        <section style={{ border: '1px solid #ddd', padding: 12, borderRadius: 8, marginTop: 12 }}>
          <h2>Salon courant</h2>
          <button onClick={leaveRoom} style={{marginBottom: 12}}>Quitter le salon</button>
          {/* Le bouton Quitter est affiché pour tous les jeux */}
          <div>
            <p>Salon: <b>{roomState.roomId}</b> — Jeu: <b>{roomState.game || 'tarot'}</b> — Statut: <b>{roomState.status}</b> — Donneur: {roomState.dealerId ?? '—'} {roomState.game === 'belote' && roomState.trumpSuit ? `— Atout: ${roomState.trumpSuit}` : ''}</p>
            <p>Joueurs (ordre):</p>
            <ul>
              {(roomState.players || []).map(p => (
                <li key={p.id}>
                  {p.name} (#{p.id})
                  {roomState.game === 'dnd5e' && (
                    <span style={{fontWeight:'bold'}}> [{p.status === 'OK' ? 'OK' : 'DEAD'}]</span>
                  )}
                  {p.team !== undefined ? ` (équipe ${p.team})` : ''}
                  {roomState.game === 'holdem' ? (
                    <> — stack: {p.stack ?? '—'} — mise: {p.bet ?? 0} {p.folded ? '(couché)' : ''} {p.allin ? '(all-in)' : ''} {roomState.currentPlayerId === p.id ? '⬅️ Tour' : ''}</>
                  ) : roomState.game === 'dnd5e' ? (
                    <> — Niveau: {p.level ?? 1} — Gold: {p.gold ?? 0} — Potions: {p.potions ?? 0}</>
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
            {/* DnD 5e */}
            {roomState.game === 'dnd5e' && (
              <div style={{ borderTop: '1px dashed #ccc', paddingTop: 8 }}>
                <h3>DnD 5e — Arène</h3>
                {roomState.status === 'waiting' && (
                  <DnDMonsterSetup roomId={roomState.roomId} send={send} />
                )}
                {roomState.status === 'fighting' && (
                  <DnDCombatView roomState={roomState} connId={connId} send={send} />
                )}
                {roomState.status === 'finished' && (
                  <div>Combat terminé.</div>
                )}
              </div>
            )}
            {/* Placeholder autres jeux */}
            {roomState.game && !['tarot','belote','holdem','dnd5e'].includes(roomState.game) && (
              <div style={{ borderTop: '1px dashed #ccc', paddingTop: 8 }}>
                {/* Message supprimé pour DnD5e */}
              </div>
            )}
          </div>
          {/* Panneau de chat intégré dans le salon courant */}
          <section style={{ border: '1px solid #eee', padding: 12, borderRadius: 8, marginTop: 16 }}>
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
        </section>
      )}

      {/* Le panneau de chat global n'est plus affiché hors salon */}

      {holdemEval && roomState && (
        <div className="holdem-eval">
          <div>Phase : <b>{holdemEval.round}</b></div>
          <div>Probabilité de gagner : <b>{(holdemEval.winProb !== undefined && holdemEval.winProb !== '—') ? holdemEval.winProb + ' %' : '—'}</b></div>
          <div>Rang de la main : <b>{holdemEval.rank}</b></div>
        </div>
      )}

      <div style={{float:'right'}}>
        <span>Connecté en tant que <b>{registeredName}</b></span>
        <button onClick={handleUnregister} style={{marginLeft:8}}>Se désinscrire</button>
      </div>

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

// Composant de configuration des monstres pour DnD
function DnDMonsterSetup({ roomId, send }) {
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
// Composant d'affichage et d'action du combat DnD
function DnDCombatView({ roomState, connId, send }) {
  const { players = [], monsters = [], initiative = [], turn, log = [] } = roomState;
  const myPlayer = players.find(p => p.id === connId);
  const isMyTurn = turn === connId && myPlayer && myPlayer.status === 'OK';
  const canAttack = isMyTurn;
  // Ajout : conditions pour boire une potion
  // Le bouton ne s'affiche que si c'est le tour du joueur connecté
  const canDrinkPotion = myPlayer && isMyTurn && myPlayer.potions > 0 && myPlayer.hp < myPlayer.max_hp && myPlayer.hp <= 0.5 * myPlayer.max_hp;
  const handleAttack = (targetId) => {
    send('action', { action: 'attack', params: { attacker: connId, target: targetId } });
  };
  // Ajout : handler pour boire une potion
  const handleDrinkPotion = () => {
    send('action', { action: 'drink_potion' });
  };
  return (
    <div>
      {/* Inventaire du joueur connecté */}
      {myPlayer && (
        <div style={{ marginBottom: 8 }}>
          <b>Inventaire :</b> Or : {myPlayer.gold ?? 0} — Potions : {myPlayer.potions ?? 0}
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

export default App
