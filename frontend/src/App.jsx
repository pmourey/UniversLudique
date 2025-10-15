import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import './App.css'
import TarotGamePanel from './TarotGamePanel'
import BeloteGamePanel from './BeloteGamePanel'
import HoldemGamePanel from './HoldemGamePanel'
import DnDGamePanel from './DnDGamePanel'
import { suitToSymbol } from './utils/suitSymbols'

const DEFAULT_WS = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`
const WS_URL = DEFAULT_WS
// console.log('WebSocket URL utilisée :', WS_URL)

// Helpers persistance localStorage
const LS_NAME = 'player_name'
const LS_REGISTERED = 'player_registeredName'
const LS_ROOMID = 'player_roomId'
const LS_JETONS_PREFIX = 'player_jetons_'

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
  const [discardSel, setDiscardSel] = useState([])
  const [playable, setPlayable] = useState([]) // nouvelles cartes jouables (Belote)

  // Nouveau: type de jeu à créer
  const [newGame, setNewGame] = useState('dnd5e') // 'tarot' | 'belote' | 'holdem' | 'dnd5e'
  const [holdemEval, setHoldemEval] = useState(null)

  // État pour le filtre de jeu dans la liste des salons
  const [gameFilter, setGameFilter] = useState('all')

  // Nouvel état pour le solde de jetons
  const [jetons, setJetons] = useState(0);

  // Nouvel état pour l'or et l'erreur de conversion
  const [gold, setGold] = useState(0);
  const [conversionMsg, setConversionMsg] = useState('');

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
        setServerRegistered(false)
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

  // Si le message 'state' arrive avant 'welcome', connId peut être null;
  // garder `gold` synchronisé quand connId ou roomState changent.
  useEffect(() => {
    if (!roomState) return;
    if (roomState.game === 'dnd5e' && Array.isArray(roomState.players)) {
      const me = roomState.players.find(p => p.id === connId);
      if (me && typeof me.gold === 'number') {
        setGold(Number(me.gold));
      }
    }
  }, [connId, roomState]);

  // Helpers localStorage pour les jetons par pseudo
  const loadJetonsFor = (name) => {
    if (!name) return 0;
    // Ne charger que si le pseudo ressemble à un pseudo valide (évite les clés partielles)
    const safe = /^[A-Za-z0-9_-]{3,40}$/.test(name);
    if (!safe) return 0;
    const v = localStorage.getItem(LS_JETONS_PREFIX + name);
    return v ? Number(v) : 0;
  };
  const saveJetonsFor = useCallback((name, val) => {
    if (!name) return;
    // N'écrire en localStorage que pour un pseudo confirmé :
    // - soit il correspond à registeredName (nom effectivement enregistré durant la session)
    // - soit il correspond à la valeur déjà persistée sous LS_REGISTERED
    const confirmed = registeredName || localStorage.getItem(LS_REGISTERED) || null;
    if (!confirmed || name !== confirmed) return;
    // Valider le format du pseudo avant d'écrire (empêche les clés partielles)
    const safe = /^[A-Za-z0-9_-]{3,40}$/.test(name);
    if (!safe) return;
    try {
      localStorage.setItem(LS_JETONS_PREFIX + name, String(val));
    } catch (e) {
      // Si le stockage échoue (quota ou autre), ne pas interrompre l'app
      console.warn('Failed to save jetons to localStorage', e);
    }
  }, [registeredName]);

  // Restaurer les jetons au démarrage : prefère registeredName, puis name (champ de saisie), puis 0
  useEffect(() => {
    const rn = localStorage.getItem(LS_REGISTERED) || registeredName || null;
    let restored = 0;
    if (rn) {
      restored = loadJetonsFor(rn);
      if (restored > 0) {
        setJetons(restored);
      }
    }
    // fallback sur le nom en cours (non forcément enregistré)
    const n = localStorage.getItem(LS_NAME) || name || null;
    if (n) {
      restored = loadJetonsFor(n);
      if (restored > 0) {
        setJetons(restored);
      }
    }
    // garder la valeur actuelle sinon
  }, [registeredName, name]);

  // Sauvegarder automatiquement les jetons dans localStorage quand ils changent
  useEffect(() => {
    // N'écrire dans localStorage que pour un pseudo confirmé (registeredName).
    // Evite de créer des clés temporaires pendant la frappe du pseudo.
    if (registeredName) saveJetonsFor(registeredName, jetons);
  }, [jetons, registeredName, name, saveJetonsFor]);

  // Persister juste avant refresh/fermeture (sauvegarde finale)
  useEffect(() => {
    const onUnload = () => {
      // Sauvegarde finale uniquement pour le pseudo confirmé
      if (registeredName) saveJetonsFor(registeredName, jetons);
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [jetons, registeredName, name, saveJetonsFor]);

  // Restaurer les jetons stockés localement quand on a déjà un pseudo enregistré
  useEffect(() => {
    if (registeredName) {
      const saved = loadJetonsFor(registeredName);
      if (saved > 0) setJetons(saved);
    }
  }, [registeredName]);

  const send = (type, payload = {}) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ type, payload }))
  }

  // Ajout d'un état pour l'erreur d'inscription
  const [registerError, setRegisterError] = useState('')
  // Indique si le serveur a confirmé l'inscription (accusé 'registered')
  const [serverRegistered, setServerRegistered] = useState(false)

  const handleMessage = (msg) => {
    switch (msg.type) {
      case 'welcome':
        setConnId(msg.payload?.connectionId || null)
        break
      case 'registered': {
        setRegisteredName(msg.payload?.name || null)
        setServerRegistered(true)
        setRegisterError('')
        // Restaurer le solde de jetons local s'il existe, sinon utiliser la valeur fournie
        const registered = msg.payload?.name || null;
        if (registered) {
          const saved = loadJetonsFor(registered);
          if (saved > 0) {
            setJetons(saved);
          } else if (typeof msg.payload?.jetons === 'number') {
            setJetons(msg.payload.jetons);
            saveJetonsFor(registered, msg.payload.jetons);
          } else {
            setJetons(0);
          }
        }
        break
      }
      case 'unregistered':
        setRegisteredName(null)
        setServerRegistered(false)
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
        // MAJ gold si DnD et joueur trouvé
        if (msg.payload?.game === 'dnd5e' && msg.payload?.players) {
          const me = msg.payload.players.find(p => p.id === connId);
          if (me && typeof me.gold === 'number') setGold(Number(me.gold));
        }
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
        setPlayable(msg.payload?.playable || msg.payload?.allowed || [])
        break
      case 'conversion_gold':
        setJetons(msg.jetons);
        setGold(Number(msg.gold));
        setConversionMsg(`Conversion réussie : +${msg.converted} jeton(s)`);
        // Sauvegarder le solde converti localement
        // N'écrire dans localStorage que si le pseudo est confirmé (registeredName)
        if (registeredName) saveJetonsFor(registeredName, msg.jetons);
        break;
      case 'error':
        setConversionMsg(msg.message || 'Erreur');
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
      case 'jetons_update':
        setJetons(msg.jetons);
        // Sauvegarder le nouveau solde de jetons dans localStorage (registeredName ou champ name)
        // N'écrire que si le pseudo est confirmé pour éviter la création de clés partielles
        if (registeredName) {
          saveJetonsFor(registeredName, msg.jetons);
        }
        break;
      default:
        break
    }
  }

  // Actions jeu
  const doRegister = (pseudo) => {
    // Envoyer le solde local des jetons au serveur pour initialiser le wallet côté serveur
    send('register', { name: pseudo, jetons: Number(jetons) })
  }
  const createRoom = () => send('create_room', { game: newGame })
  const listRooms = () => send('list_rooms')
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

  // Rafraîchir automatiquement la liste des salons uniquement à la connexion
  useEffect(() => {
    if (status === 'connected') {
      listRooms();
      // Si on a déjà un pseudo enregistré localement, (re)transmettre au serveur
      // le nom et le solde de jetons pour synchroniser le wallet côté serveur.
      if (registeredName) {
        const saved = loadJetonsFor(registeredName);
        // envoyer même si saved === 0 afin que le serveur connaisse le pseudo
        send('register', { name: registeredName, jetons: Number(saved) });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, registeredName]);

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

  // Informations sur l'atout (pour affichage coloré dans l'entête)
  // Calculer une fois via useMemo pour éviter plusieurs appels et permettre un style cohérent
  const trumpInfo = useMemo(() => suitToSymbol(roomState?.trumpSuit), [roomState?.trumpSuit])

  // Persistance localStorage : nom, nom enregistré, salon courant
  useEffect(() => { localStorage.setItem(LS_NAME, name) }, [name])
  useEffect(() => { if (registeredName) localStorage.setItem(LS_REGISTERED, registeredName); else localStorage.removeItem(LS_REGISTERED) }, [registeredName])
  useEffect(() => { localStorage.setItem(LS_ROOMID, roomId) }, [roomId])

  // Re-inscription et rejoin automatique après reload
  useEffect(() => {
    if (
      status === 'connected' &&
      serverRegistered &&
      registeredName &&
      roomId &&
      !roomState &&
      !isLeavingRef.current &&
      newGame !== 'dnd5e' // Empêche la connexion auto pour DnD
    ) {
      send('join_room', { roomId })
    }
  }, [status, serverRegistered, registeredName, roomId, roomState, newGame])

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

  // Fonction pour convertir l'or en jetons
  const convertGoldToJeton = (nbJetons) => {
    setConversionMsg('');
    send('action', { action: 'convert_gold', params: { jetons: nbJetons } });
  };

  // Rendu du formulaire d'inscription si pas de pseudo enregistré
  if (!registeredName) {
    return (
      <div className="register-form">
        <h1>Univers Multijeux (prototype)</h1>
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
    <div className="App">
      {/* Affichage du solde de jetons en haut à droite */}
      <div style={{position: 'fixed', top: 10, right: 20, background: '#222', color: '#fff', padding: '6px 16px', borderRadius: 8, zIndex: 1000, fontWeight: 'bold', fontSize: 18}}>
        Jetons : {jetons}
      </div>

      <div style={{ maxWidth: 1000, margin: '0 auto', padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
{/*        <div>
          <span>Connecté en tant que <b>{registeredName}</b></span>
          <button onClick={handleUnregister} style={{marginLeft:8}}>Se désinscrire</button>
        </div>*/}
        </div>
        <p>Status: {status} {connId ? `(id: ${connId})` : ''}</p>
        {status !== 'connected' && (<button onClick={connect}>Se connecter</button>)}

        {/* Panneau de gestion des salons : affiché uniquement si connecté et pas dans un salon */}
        {status === 'connected' && !roomState && (
          <>
            {/* Formulaire de création de salon */}
            <section style={{ border: '1px solid #ddd', padding: 12, borderRadius: 8, marginTop: 12, marginBottom: 12 }}>
              <h2>Créer un salon</h2>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <label>Jeu&nbsp;:
                  <select value={newGame} onChange={e => setNewGame(e.target.value)}>
                    <option value="tarot">Tarot</option>
                    <option value="belote">Belote</option>
                    <option value="holdem">Texas Hold'em</option>
                    <option value="dnd5e">DnD 5e</option>
                  </select>
                </label>
                <button onClick={createRoom} disabled={status !== 'connected'}>Créer un salon</button>
              </div>
            </section>

            {/* Liste des salons disponibles (indépendante du formulaire de création) */}
            <section style={{ border: '1px solid #ddd', padding: 12, borderRadius: 8 }}>
              <h2>Salons disponibles</h2>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
                <input value={roomId} onChange={e => setRoomId(e.target.value)} placeholder="ID du salon" />
                <button onClick={joinRoom} disabled={status !== 'connected' || !roomId || rooms.filter(r => gameFilter === 'all' || r.game === gameFilter).length === 0}>Rejoindre</button>
                <label style={{marginLeft:16}}>Filtrer par jeu&nbsp;:
                  <select value={gameFilter} onChange={e => setGameFilter(e.target.value)}>
                    <option value="all">Tous</option>
                    <option value="tarot">Tarot</option>
                    <option value="belote">Belote</option>
                    <option value="holdem">Texas Hold'em</option>
                    <option value="dnd5e">DnD 5e</option>
                  </select>
                </label>
              </div>
              {rooms?.filter(r => gameFilter === 'all' || r.game === gameFilter).length > 0 ? (
                <ul>
                  {rooms.filter(r => gameFilter === 'all' || r.game === gameFilter).map(r => (
                    <li key={r.roomId}>
                      <button onClick={() => setRoomId(r.roomId)}>Choisir</button>
                      &nbsp;Salon {r.roomId} — jeu: {r.game || 'tarot'} — joueurs: {r.players} (min: {r.minPlayers}, max: {r.maxPlayers}) — statut: {r.status}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>Aucun salon disponible.</p>
              )}
            </section>
          </>
        )}

        {/* Panneau du salon courant : affiché uniquement si dans un salon */}
        {roomState && (
          <section style={{ border: '1px solid #ddd', padding: 12, borderRadius: 8, marginTop: 12 }}>
            <h2>Salon courant</h2>
            <button onClick={leaveRoom} style={{marginBottom: 12}}>Quitter le salon</button>
            {/* Le bouton Quitter est affiché pour tous les jeux */}
            <div>
              <p>Salon: <b>{roomState.roomId}</b> — Jeu: <b>{roomState.game || 'tarot'}</b> — Statut: <b>{roomState.status}</b> — Donneur: {roomState.dealerId ?? '—'} {roomState.game === 'belote' && roomState.trumpSuit ? <span>— Atout: <span className="trump-badge" role="img" title={`Atout : ${trumpInfo.label}`} aria-label={`Atout : ${trumpInfo.label}`} style={{color: trumpInfo.color}}>{trumpInfo.symbol}</span></span> : ''}</p>
              <p>Joueurs (ordre):</p>
              <ul>
                {(roomState.players || []).map(p => (
                  <li key={p.id}>
                    {p.name}
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
              {/* Diagnostic localStorage pour les jetons */}
              <div style={{ marginBottom: 8, fontSize: 13, color: '#333' }}>
                <span>Jetons locaux sauvegardés: </span>
                <b>{(registeredName || name) ? loadJetonsFor(registeredName || name) : '—'}</b>
                <button style={{ marginLeft: 8 }} onClick={() => { const key = registeredName || name; if (key) { const v = loadJetonsFor(key); setJetons(v); setConversionMsg('Jetons restaurés depuis localStorage'); } }}>Restaurer depuis localStorage</button>
              </div>
              {/* Tarot */}
              {roomState.game === 'tarot' && (
                <TarotGamePanel
                  roomState={roomState}
                  isYourTurn={isYourTurn}
                  hand={hand}
                  placeBid={placeBid}
                  playCard={playCard}
                  discardSel={discardSel}
                  toggleDiscard={toggleDiscard}
                  submitDiscard={submitDiscard}
                />
              )}
              {/* Belote */}
              {roomState.game === 'belote' && (
                <BeloteGamePanel
                  roomState={roomState}
                  isYourTurn={isYourTurn}
                  hand={hand}
                  playable={playable}
                  playCard={playCard}
                  chooseTrump={chooseTrump}
                />
              )}
              {/* Hold'em */}
              {roomState.game === 'holdem' && (
                <HoldemGamePanel
                  roomState={roomState}
                  isYourTurn={isYourTurn}
                  hand={hand}
                  playable={playable}
                  holdemEval={holdemEval}
                  connId={connId}
                  playersArr={playersArr}
                  holdemCheck={holdemCheck}
                  holdemCall={holdemCall}
                  holdemBet={holdemBet}
                  holdemRaiseTo={holdemRaiseTo}
                  holdemFold={holdemFold}
                />
              )}
              {/* DnD 5e */}
              {roomState.game === 'dnd5e' && (
                <DnDGamePanel
                  roomState={roomState}
                  connId={connId}
                  gold={gold}
                  jetons={jetons}
                  conversionMsg={conversionMsg}
                  convertGoldToJeton={convertGoldToJeton}
                  send={send}
                />
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
    </div>
  )
}

export default App

// Les composants HoldemActions, DnDMonsterSetup et DnDCombatView ont été déplacés vers frontend/src/gameplay/
