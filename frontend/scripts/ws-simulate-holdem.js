/* eslint-env node */
// Simulate 4 WS clients for a Texas Hold'em with betting rounds
// Usage: npm run ws:holdem
import WebSocket from 'ws'

const WS_URL = process.env.WS_URL || 'ws://127.0.0.1:8090'
const N = 4 // number of bots
function delay(ms) { return new Promise(r => setTimeout(r, ms)) }

class Bot {
  constructor(name) {
    this.name = name
    this.ws = null
    this.id = null
    this.registered = false
    this.hand = []
    this.isYourTurn = false
    this.allowed = null
  }
  async connect() {
    await new Promise((resolve) => {
      const ws = new WebSocket(WS_URL)
      this.ws = ws
      ws.on('open', () => { console.log(`[${this.name}] connected`); resolve() })
      ws.on('message', (data) => this.onMessage(JSON.parse(data.toString())))
      ws.on('error', (err) => { console.error(`[${this.name}] error`, err?.message || err) })
    })
  }
  onMessage(msg) {
    if (msg.type === 'welcome') this.id = msg.payload?.connectionId
    if (msg.type === 'registered') this.registered = true
    if (msg.type === 'your_hand') {
      this.hand = msg.payload?.hand || []
      this.isYourTurn = !!msg.payload?.isYourTurn
      this.allowed = msg.payload?.allowed || null
    }
  }
  send(type, payload={}) { this.ws.send(JSON.stringify({ type, payload })) }
  act() {
    if (!this.isYourTurn || !this.allowed) return false
    const a = this.allowed
    // Politique simple: check si possible, sinon call si abordable, sinon bet/raise min, sinon fold
    if (a.check) { this.send('action', { action: 'check' }); return true }
    if ((a.call || 0) > 0) { this.send('action', { action: 'call' }); return true }
    if ((a.minBet || 0) > 0) { this.send('action', { action: 'bet', params: { amount: a.minBet } }); return true }
    if ((a.minRaiseTo || 0) > 0) { this.send('action', { action: 'raise_to', params: { to: a.minRaiseTo } }); return true }
    this.send('action', { action: 'fold' }); return true
  }
}

async function run() {
  console.log(`WS_URL=${WS_URL}`)
  const bots = Array.from({length: N}, (_,i) => new Bot(`H${i+1}`))

  await Promise.all(bots.map(b => b.connect()))
  bots.forEach((b,i)=> b.send('register', { name: `H${i+1}` }))

  // Wait for all registered
  const startReg = Date.now()
  while (bots.some(b => !b.registered) && Date.now() - startReg < 2000) await delay(50)
  if (bots.some(b => !b.registered)) throw new Error('Registration timeout')

  // Capture roomId
  let roomId = null
  const capture = (m) => {
    if ((m.type === 'room_joined' || m.type === 'state' || m.type === 'room_update') && m.payload?.roomId) roomId = m.payload.roomId
    if (m.type === 'state') console.log(`[STATE] status=${m.payload?.status} round=${m.payload?.round||'-'} bet=${m.payload?.currentBet||0} pot=${m.payload?.potTotal||0}`)
    if (m.type === 'game_over') console.log(`[GAME_OVER] winners=${(m.payload?.winnersNames||[]).join(', ')}`)
  }
  const listeners = []
  for (const b of bots) { const fn = d => capture(JSON.parse(d.toString())); listeners.push({b,fn}); b.ws.on('message', fn) }

  // Create holdem room via first bot
  bots[0].send('create_room', { game: 'holdem' })
  const startWait = Date.now()
  while (!roomId && Date.now() - startWait < 3000) await delay(50)
  if (!roomId) throw new Error('No roomId captured')
  for (const {b, fn} of listeners) { if (typeof b.ws.off === 'function') b.ws.off('message', fn); else if (typeof b.ws.removeListener === 'function') b.ws.removeListener('message', fn) }

  console.log('Created room', roomId)
  // Join others
  for (let i=1;i<N;i++) bots[i].send('join_room', { roomId })

  // Wait for N players (listen on creator)
  let count = 0
  const handler = (d) => { try { const m=JSON.parse(d.toString()); if ((m.type==='state'||m.type==='room_update') && Array.isArray(m.payload?.players)) count = m.payload.players.length } catch (e) { void e } }
  bots[0].ws.on('message', handler)
  const startJoin = Date.now()
  while (count < N && Date.now() - startJoin < 3000) await delay(50)
  if (typeof bots[0].ws.off === 'function') bots[0].ws.off('message', handler); else if (typeof bots[0].ws.removeListener === 'function') bots[0].ws.removeListener('message', handler)
  if (count < N) throw new Error(`Players join timeout: got ${count}/${N}`)

  // Start game
  bots[0].send('start_game')

  // Boucle d’auto-play: agir quand c’est le tour du bot
  let finished = false
  const onMsg = (b, m) => {
    try {
      const msg = JSON.parse(m.toString())
      if (msg.type === 'game_over') finished = true
      if (msg.type === 'your_hand') {
        b.hand = msg.payload?.hand || []
        b.isYourTurn = !!msg.payload?.isYourTurn
        b.allowed = msg.payload?.allowed || null
        if (b.isYourTurn) b.act()
      }
    } catch (e) { void e }
  }
  for (const b of bots) b.ws.on('message', (m) => onMsg(b, m))

  const end = Date.now() + 20000
  while (!finished && Date.now() < end) await delay(50)

  console.log('Simulation done')
  bots.forEach(b => { try { b.ws.close() } catch (e) { void e } })
}

run().catch(e => { console.error('Holdem sim error:', e) })
