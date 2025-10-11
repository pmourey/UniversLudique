/* eslint-env node */
/* global process */
// Simulate 4 WS clients playing a Belote deal end-to-end
// Usage: npm run ws:belote
import WebSocket from 'ws'
import process from 'node:process'

const WS_URL = process.env.WS_URL || 'ws://127.0.0.1:8090'
function delay(ms) { return new Promise(r => setTimeout(r, ms)) }

class Bot {
  constructor(name) {
    this.name = name
    this.ws = null
    this.id = null
    this.hand = []
    this.isYourTurn = false
    this.playable = []
    this.registered = false
  }
  async connect() {
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(WS_URL)
      this.ws = ws
      ws.on('open', () => { console.log(`[${this.name}] connected`); resolve() })
      ws.on('message', (data) => this.onMessage(JSON.parse(data.toString())))
      ws.on('close', () => { /* console.log(`[${this.name}] closed`) */ })
      ws.on('error', (err) => { console.error(`[${this.name}] error`, err?.message || err); reject(err) })
    })
  }
  onMessage(msg) {
    if (msg.type === 'welcome') this.id = msg.payload?.connectionId
    if (msg.type === 'registered') this.registered = true
    if (msg.type === 'your_hand') {
      this.hand = msg.payload?.hand || []
      this.isYourTurn = !!msg.payload?.isYourTurn
      this.playable = msg.payload?.playable || []
    }
  }
  send(type, payload={}) { this.ws.send(JSON.stringify({ type, payload })) }
  action(action, params={}) { this.send('action', { action, params }) }
}

async function run() {
  console.log(`WS_URL=${WS_URL}`)
  const A = new Bot('B1')
  const B = new Bot('B2')
  const C = new Bot('B3')
  const D = new Bot('B4')

  await Promise.all([A.connect(), B.connect(), C.connect(), D.connect()])
  A.send('register', { name: 'B1' })
  B.send('register', { name: 'B2' })
  C.send('register', { name: 'B3' })
  D.send('register', { name: 'B4' })

  // Wait for all to be registered (up to 2s)
  const waitRegistered = async (bots, timeoutMs = 2000) => {
    const start = Date.now()
    while (bots.some(b => !b.registered) && (Date.now() - start) < timeoutMs) {
      await delay(50)
    }
    if (bots.some(b => !b.registered)) throw new Error('Registration timeout')
  }
  await waitRegistered([A,B,C,D])

  // Create belote room
  let roomId = null
  const capture = (msg) => {
    if ((msg.type === 'room_joined' || msg.type === 'state' || msg.type === 'room_update') && msg.payload?.roomId) roomId = msg.payload.roomId
    if (msg.type === 'state') console.log(`[STATE] status=${msg.payload?.status} game=${msg.payload?.game} trump=${msg.payload?.trumpSuit||'-'} current=${msg.payload?.currentPlayerId}`)
    if (msg.type === 'game_over') console.log(`[GAME_OVER] winners=${(msg.payload?.winnersNames||[]).join(', ')}`)
  }

  // Attach capture listeners before creating the room
  const bots = [A,B,C,D]
  const listeners = []
  for (const bot of bots) {
    const fn = (d)=>capture(JSON.parse(d.toString()))
    listeners.push({ bot, fn })
    bot.ws.on('message', fn)
  }

  A.send('create_room', { game: 'belote' })

  // Wait up to 3s for roomId to be captured
  const waitRoomId = async (timeoutMs = 3000) => {
    const start = Date.now()
    while (!roomId && (Date.now() - start) < timeoutMs) {
      await delay(50)
    }
    if (!roomId) throw new Error('No roomId captured')
  }
  await waitRoomId(3000)

  // Detach listeners once roomId obtained (to avoid duplicate parsing later)
  for (const {bot, fn} of listeners) {
    if (typeof bot.ws.off === 'function') bot.ws.off('message', fn)
    else if (typeof bot.ws.removeListener === 'function') bot.ws.removeListener('message', fn)
  }

  console.log('Created room', roomId)
  B.send('join_room', { roomId })
  C.send('join_room', { roomId })
  D.send('join_room', { roomId })

  // Wait for 4 players in room (listen on creator A)
  const waitPlayers = async (expected = 4, timeoutMs = 3000) => {
    let count = 0
    const handler = (d) => {
      try {
        const m = JSON.parse(d.toString())
        if ((m.type === 'state' || m.type === 'room_update') && Array.isArray(m.payload?.players)) {
          count = m.payload.players.length
        }
      } catch {}
    }
    A.ws.on('message', handler)
    const start = Date.now()
    while (count < expected && (Date.now() - start) < timeoutMs) {
      await delay(50)
    }
    if (typeof A.ws.off === 'function') A.ws.off('message', handler)
    else if (typeof A.ws.removeListener === 'function') A.ws.removeListener('message', handler)
    if (count < expected) throw new Error(`Players join timeout: got ${count}/${expected}`)
  }
  await waitPlayers(4, 3000)

  A.send('start_game')
  await delay(300)

  // Choose trump: whichever bot has the turn chooses 'H'
  let trumpChosen = false
  const onState = (m) => { if (m.type === 'state' && m.payload?.status === 'playing') trumpChosen = true }
  for (const bot of [A,B,C,D]) bot.ws.on('message', d=>onState(JSON.parse(d.toString())))

  const endChoose = Date.now() + 5000
  while (!trumpChosen && Date.now() < endChoose) {
    if (A.isYourTurn) A.action('choose_trump', { suit: 'H' })
    if (B.isYourTurn) B.action('choose_trump', { suit: 'H' })
    if (C.isYourTurn) C.action('choose_trump', { suit: 'H' })
    if (D.isYourTurn) D.action('choose_trump', { suit: 'H' })
    await delay(80)
  }
  console.log('Trump chosen:', trumpChosen)

  // Play all cards legally
  let finished = false
  const onGameOver = (m) => { if (m.type === 'game_over') finished = true }
  for (const bot of [A,B,C,D]) bot.ws.on('message', d=>onGameOver(JSON.parse(d.toString())))

  const endPlay = Date.now() + 60000
  while (!finished && Date.now() < endPlay) {
    for (const bot of [A,B,C,D]) {
      if (bot.isYourTurn) {
        const c = bot.playable?.[0] || bot.hand?.[0]
        if (c) bot.action('play_card', { card: c })
      }
    }
    await delay(20)
  }

  // Force finish if needed
  if (!finished) { console.log('Forcing finish'); A.action('finish') }
  await delay(200)

  console.log('Simulation done')
  A.ws.close(); B.ws.close(); C.ws.close(); D.ws.close()
}

run().catch(e => { console.error('Belote sim error:', e); process.exit(1) })
