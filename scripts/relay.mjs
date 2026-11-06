import { createWsRelayServer } from '@trystero-p2p/ws-relay/server'

const port = Number(process.env.PORT || 9077)
const server = createWsRelayServer({ port })
await server.ready
console.log(`Ghostlink signaling relay listening on ${port}`)
console.log('Both players put this address in “If you cannot connect”:')
console.log(`  ws://<this-machine>:${port}`)
console.log('Put TLS in front of it before using it across the internet.')
