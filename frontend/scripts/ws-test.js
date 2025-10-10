// Simple test WS client for the Tarot backend
// Usage: npm run ws:test
import WebSocket from 'ws'

const WS_URL = process.env.WS_URL || 'ws://127.0.0.1:8090'

const ws = new WebSocket(WS_URL)

const log = (...args) => console.log('[client]', ...args)

let stage = 0

ws.on('open', () => {
  log('Connected to', WS_URL)
})

ws.on('message', (data) => {
  try {
    const msg = JSON.parse(data.toString())
    log('<<', msg)
    handle(msg)
  } catch (e) {
    log('Invalid JSON', e)
  }
})

ws.on('close', () => log('Closed'))
ws.on('error', (err) => log('Error', err))

function send(type, payload = {}) {
  ws.send(JSON.stringify({ type, payload }))
  log('>>', { type, payload })
}

function handle(msg) {
  if (msg.type === 'welcome' && stage === 0) {
    stage = 1
    send('register', { name: 'Bot' + Math.floor(Math.random() * 1000) })
    return
  }
  if (msg.type === 'registered' && stage === 1) {
    stage = 2
    send('create_room')
    return
  }
  if ((msg.type === 'room_joined' || msg.type === 'state') && stage === 2) {
    stage = 3
    send('chat', { text: 'Bonjour depuis ws-test' })
    setTimeout(() => {
      send('list_rooms')
    }, 200)
    return
  }
  if (msg.type === 'rooms' && stage === 3) {
    stage = 4
    log('Rooms count:', Array.isArray(msg.payload) ? msg.payload.length : 'n/a')
    setTimeout(() => ws.close(), 300)
  }
}
