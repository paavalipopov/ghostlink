import { joinRoom } from 'trystero'
import {
  openPointerRoom,
  type PointerRoom,
  type ShownGhost,
  type LinkSettings
} from '../../src/renderer/src/pointer-room'
import { guardDiscovery } from '../../src/renderer/src/peer-budget'

type State = { count: number; ghosts: Record<string, ShownGhost> }
type Client = Window & {
  connect(code: string, scope?: LinkSettings['scope'], password?: string): State & PointerRoom
}
const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
if (window !== parent) {
  guardDiscovery(['ws://' + location.host + '/relay'])
  const client = window as Window as Client
  client.connect = (code, scope = 'share', password = code) => {
    const state: State = { count: 0, ghosts: {} }
    const room = openPointerRoom(
      { code, scope },
      {
        peers(count) {
          state.count = count
        },
        ghosts(ghosts) {
          state.ghosts = ghosts
        },
        error(err) {
          console.error(String(err))
        }
      },
      (config, id) =>
        joinRoom(
          {
            ...config,
            password,
            rtcConfig: { iceServers: [] },
            relayConfig: { urls: ['ws://' + location.host + '/relay'], redundancy: 1 }
          },
          id
        )
    )
    return Object.assign(state, room)
  }
} else {
  async function until(label: string, test: () => unknown): Promise<void> {
    for (let i = 0; i < 200; i++) {
      if (test()) return
      await pause(100)
    }
    throw new Error(label + ' timed out')
  }
  function assert(ok: unknown, label: string): void {
    if (!ok) throw new Error(label)
  }
  const clients = await Promise.all(
    Array.from({ length: 3 }, async () => {
      const frame = document.createElement('iframe')
      frame.src = 'room.html?peer'
      document.body.append(frame)
      await until('client ready', () => (frame.contentWindow as Client | null)?.connect)
      return frame.contentWindow as Client
    })
  )
  const [host, former, friend] = clients
  const ghost = (session: State, name: string): ShownGhost | undefined =>
    Object.values(session.ghosts).find((g) => g.name === name)
  const oldCode = crypto.randomUUID(),
    newCode = crypto.randomUUID()
  async function run(): Promise<void> {
    const a = host.connect(oldCode),
      b = former.connect(oldCode)
    a.move({ name: 'first', x: 0.25, y: 0.75 })
    await until('first authenticated pointer', () => a.count === 1 && ghost(b, 'first')?.x === 0.25)
    b.ping({ name: 'friend', id: 'click-one', x: 0.5, y: 0.5 })
    await until('return click', () => ghost(a, 'friend')?.pings[0]?.id === 'click-one')
    await until('click expiry', () => ghost(a, 'friend')?.pings.length === 0)
    a.close()
    const next = host.connect(newCode),
      current = friend.connect(newCode)
    // A regular client joining with a different password on the same discovery topic.
    const wrong = former.connect(newCode, 'share', oldCode)
    next.move({ name: 'replacement', x: 0.7, y: 0.3 })
    await until(
      'replacement room',
      () => next.count === 1 && ghost(current, 'replacement')?.x === 0.7
    )
    await until('old room disconnected', () => b.count === 0 && !ghost(b, 'first'))
    const privateHost = host.connect(newCode, 'test'),
      pad = former.connect(newCode, 'test')
    privateHost.move({ name: 'private', x: 0.9, y: 0.8 })
    await until(
      'isolated private room',
      () => privateHost.count === 1 && ghost(pad, 'private')?.x === 0.9
    )
    await pause(1200)
    assert(wrong.count === 0 && !Object.keys(wrong.ghosts).length, 'wrong password admitted')
    assert(
      !ghost(b, 'replacement') && !ghost(pad, 'replacement') && !ghost(current, 'private'),
      'room isolation'
    )
    current.close()
    await until('peer departure', () => next.count === 0)
    const again = friend.connect(newCode)
    await until(
      'same-code reconnect',
      () => next.count === 1 && ghost(again, 'replacement')?.x === 0.7
    )
    for (const session of [next, again, b, wrong, pad, privateHost]) session.close()
  }
  try {
    await run()
    await fetch('/result' + location.search, { method: 'POST', body: 'ok' })
  } catch (err) {
    await fetch('/result' + location.search, {
      method: 'POST',
      body: String(err instanceof Error ? err.stack : err)
    })
  }
}
