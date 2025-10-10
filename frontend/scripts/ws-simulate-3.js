// Simulate 3 WS clients playing bidding -> discard -> one trick
// Usage: npm run ws:sim3
import WebSocket from 'ws'

const WS_URL = process.env.WS_URL || 'ws://127.0.0.1:8090'

function delay(ms) { return new Promise(r => setTimeout(r, ms)) }

class Bot {
  constructor(name) {
    this.name = name
    this.ws = null
    this.id = null
    this.hand = []
    this.isYourTurn = false
    this.taker = false
  }
  async connect() {
    console.log(`[${this.name}] connecting...`)
    await new Promise((resolve) => {
      const ws = new WebSocket(WS_URL)
      this.ws = ws
      ws.on('open', () => { console.log(`[${this.name}] connected`); resolve() })
      ws.on('message', (data) => this.onMessage(JSON.parse(data.toString())))
      ws.on('close', () => console.log(`[${this.name}] closed`))
      ws.on('error', (e) => console.log(`[${this.name}] error`, e?.message || e))
    })
  }
  onMessage(msg) {
    if (msg.type === 'welcome') { this.id = msg.payload?.connectionId; console.log(`[${this.name}] welcome id=${this.id}`) }
    if (msg.type === 'your_hand') {
      this.hand = msg.payload?.hand || []
      this.isYourTurn = !!msg.payload?.isYourTurn
      this.taker = !!msg.payload?.youAreTaker
    }
  }
  send(type, payload={}) { console.log(`[${this.name}] >>`, type, payload); this.ws.send(JSON.stringify({ type, payload })) }
  action(action, params={}) { this.send('action', { action, params }) }
}

async function run() {
  const A = new Bot('Alice')
  const B = new Bot('Bob')
  const C = new Bot('Charly')

  await Promise.all([A.connect(), B.connect(), C.connect()])

  A.send('register', { name: A.name })
  B.send('register', { name: B.name })
  C.send('register', { name: C.name })
  await delay(200)

  let roomId = null
  const captureRoom = (msg) => {
    if (msg.type === 'room_joined' || msg.type === 'state') {
      if (!roomId && msg.payload?.roomId) { roomId = msg.payload.roomId; console.log(`[sim] captured roomId=${roomId}`) }
    }
  }
  A.ws.on('message', d => captureRoom(JSON.parse(d.toString())))

  A.send('create_room')
  await delay(300)
  if (!roomId) throw new Error('No roomId captured from Alice')

  B.send('join_room', { roomId })
  C.send('join_room', { roomId })
  await delay(300)

  A.send('start_game')
  await delay(400)

  console.log('[sim] Start bidding loop')
  const endBidding = Date.now() + 6000
  let biddingDone = false
  const onState = (msg) => {
    if (msg.type === 'state' && ['discarding','playing','scoring','finished'].includes(msg.payload?.status)) biddingDone = true
  }
  A.ws.on('message', d=>onState(JSON.parse(d.toString())))
  B.ws.on('message', d=>onState(JSON.parse(d.toString())))
  C.ws.on('message', d=>onState(JSON.parse(d.toString())))

  while (!biddingDone && Date.now() < endBidding) {
    if (A.isYourTurn) A.action('bid', { bid: 'garde' })
    if (B.isYourTurn) B.action('bid', { bid: 'pass' })
    if (C.isYourTurn) C.action('bid', { bid: 'pass' })
    await delay(120)
  }
  console.log('[sim] Bidding done?', biddingDone)

  await delay(400)
  // discard (taker only)
  const discard6 = (bot) => {
    const target = 6
    const toDiscard = bot.hand.slice(0, target)
    console.log(`[${bot.name}] discarding`, toDiscard)
    bot.action('discard', { cards: toDiscard })
  }
  if (A.taker && A.hand.length >= 6) discard6(A)
  if (B.taker && B.hand.length >= 6) discard6(B)
  if (C.taker && C.hand.length >= 6) discard6(C)

  await delay(600)
  console.log('[sim] Play one trick')
  const endPlay = Date.now() + 8000
  let played = 0
  while (Date.now() < endPlay && played < 3) {
    if (A.isYourTurn && A.hand[0]) { A.action('play_card', { card: A.hand[0] }); played++ }
    if (B.isYourTurn && B.hand[0]) { B.action('play_card', { card: B.hand[0] }); played++ }
    if (C.isYourTurn && C.hand[0]) { C.action('play_card', { card: C.hand[0] }); played++ }
    await delay(150)
  }

  console.log('[sim] Done. Closing sockets.')
  A.ws.close(); B.ws.close(); C.ws.close()
}

run().catch(e => { console.error('Simulation error:', e); process.exit(1) })
