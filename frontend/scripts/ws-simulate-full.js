// Simulate 3 WS clients playing a full deal end-to-end
// Usage: npm run ws:simfull
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
    await new Promise((resolve) => {
      const ws = new WebSocket(WS_URL)
      this.ws = ws
      ws.on('open', () => resolve())
      ws.on('message', (data) => this.onMessage(JSON.parse(data.toString())))
      ws.on('close', () => {})
      ws.on('error', () => {})
    })
  }
  onMessage(msg) {
    if (msg.type === 'welcome') { this.id = msg.payload?.connectionId }
    if (msg.type === 'your_hand') {
      this.hand = msg.payload?.hand || []
      this.isYourTurn = !!msg.payload?.isYourTurn
      this.taker = !!msg.payload?.youAreTaker
    }
  }
  send(type, payload={}) { this.ws.send(JSON.stringify({ type, payload })) }
  action(action, params={}) { this.send('action', { action, params }) }
}

async function run() {
  const A = new Bot('Alpha')
  const B = new Bot('Bravo')
  const C = new Bot('Charlie')

  await Promise.all([A.connect(), B.connect(), C.connect()])
  A.send('register', { name: 'Alpha' })
  B.send('register', { name: 'Bravo' })
  C.send('register', { name: 'Charlie' })
  await delay(200)

  let roomId = null
  const captureRoom = (msg) => {
    if (msg.type === 'room_joined' || msg.type === 'state') {
      if (!roomId && msg.payload?.roomId) { roomId = msg.payload.roomId }
    }
  }
  A.ws.on('message', d => captureRoom(JSON.parse(d.toString())))
  A.send('create_room')
  await delay(300)
  if (!roomId) throw new Error('No roomId captured')

  B.send('join_room', { roomId })
  C.send('join_room', { roomId })
  await delay(300)

  A.send('start_game')
  await delay(400)

  // Bidding loop (A bids garde, others pass)
  let biddingDone = false
  const onState = (msg) => {
    if (msg.type === 'state' && ['discarding','playing','scoring','finished'].includes(msg.payload?.status)) biddingDone = true
  }
  for (const bot of [A,B,C]) bot.ws.on('message', d=>onState(JSON.parse(d.toString())))
  const endBidding = Date.now() + 6000
  while (!biddingDone && Date.now() < endBidding) {
    if (A.isYourTurn) A.action('bid', { bid: 'garde' })
    if (B.isYourTurn) B.action('bid', { bid: 'pass' })
    if (C.isYourTurn) C.action('bid', { bid: 'pass' })
    await delay(80)
  }

  await delay(300)
  // Discard by taker
  const doDiscard = (bot) => {
    const n = 6
    const toDiscard = bot.hand.slice(0, n)
    bot.action('discard', { cards: toDiscard })
  }
  if (A.taker && A.hand.length >= 6) doDiscard(A)
  if (B.taker && B.hand.length >= 6) doDiscard(B)
  if (C.taker && C.hand.length >= 6) doDiscard(C)

  // Play all cards
  let finished = false
  const onGameOver = (msg) => { if (msg.type === 'game_over') finished = true }
  for (const bot of [A,B,C]) bot.ws.on('message', d=>onGameOver(JSON.parse(d.toString())))

  const endPlay = Date.now() + 60000
  while (!finished && Date.now() < endPlay) {
    if (A.isYourTurn && A.hand[0]) A.action('play_card', { card: A.hand[0] })
    if (B.isYourTurn && B.hand[0]) B.action('play_card', { card: B.hand[0] })
    if (C.isYourTurn && C.hand[0]) C.action('play_card', { card: C.hand[0] })
    await delay(20)
  }

  // Close
  A.ws.close(); B.ws.close(); C.ws.close()
  if (!finished) throw new Error('Did not reach game_over within timeout')
}

run().catch(e => { console.error('Simulation error:', e); process.exit(1) })

