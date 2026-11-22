import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultRelayUrls, type ActionReceiveContext, type joinRoom } from 'trystero'
import config from '../src-tauri/tauri.conf.json'
import { MAX_PEERS, MAX_PINGS, type MoveMessage } from '../src/shared/protocol'
import {
  connectionPool,
  POINTER_BYTES,
  ROOM_RECEIVE_BYTES,
  tokenBucket
} from '../src/renderer/src/peer-budget'
import { openPointerRoom } from '../src/renderer/src/pointer-room'

class Native extends EventTarget {
  closed = false
  close(): void {
    this.closed = true
  }
  createDataChannel(label: string): EventTarget & { label: string; close(): void } {
    return Object.assign(new EventTarget(), { label, close: vi.fn() })
  }
}
const NativeRTC = Native as unknown as typeof RTCPeerConnection
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('room limits', () => {
  it('reserves a physical slot before negotiation and releases every slot on disposal', () => {
    const share = connectionPool(MAX_PEERS, NativeRTC)
    const pad = connectionPool(1, NativeRTC)
    const peers = Array.from({ length: MAX_PEERS }, () => new share.Connection())
    const test = new pad.Connection()
    expect(() => new share.Connection()).toThrow()
    expect(() => new pad.Connection()).toThrow()
    peers[0].close()
    const replacement = new share.Connection()
    share.close()
    expect([...peers, replacement].every((pc) => (pc as unknown as Native).closed)).toBe(true)
    expect(() => new share.Connection()).toThrow()
    expect((test as unknown as Native).closed).toBe(false)
    pad.close()
  })
  it('limits churn even when a negotiating socket immediately closes', () => {
    vi.useFakeTimers()
    const pool = connectionPool(1, NativeRTC)
    for (let i = 0; i < 4; i++) new pool.Connection().close()
    expect(() => new pool.Connection()).toThrow()
    vi.advanceTimersByTime(500)
    new pool.Connection().close()
    pool.close()
  })
  it('refills by elapsed time and never accumulates more than the allowed burst', () => {
    let time = 0
    const take = tokenBucket(10, 2, () => time)
    expect([take(), take(), take()]).toEqual([true, true, false])
    time = 100
    expect([take(), take()]).toEqual([true, false])
    time = 5000
    expect([take(3), take(2), take()]).toEqual([false, true, false])
  })
  it('checks raw frames before the transport receives them', () => {
    const pool = connectionPool(1, NativeRTC)
    const connection = new pool.Connection()
    const channel = connection.createDataChannel('data')
    const parser = vi.fn()
    channel.addEventListener('message', parser)
    channel.dispatchEvent(new MessageEvent('message', { data: new ArrayBuffer(100) }))
    channel.dispatchEvent(new MessageEvent('message', { data: new ArrayBuffer(8193) }))
    expect(parser).toHaveBeenCalledTimes(1)
    expect((connection as unknown as Native).closed).toBe(true)
    pool.close()
  })
  it('permits precisely the pinned discovery relays in the shipped webview', () => {
    const csp = config.app.security.csp.split(' ').filter((entry) => entry.startsWith('wss://'))
    expect(csp.sort()).toEqual([...defaultRelayUrls].sort())
  })
})

it('cancels a room before asynchronous discovery can start', async () => {
  const join = vi.fn()
  const callbacks = { peers: vi.fn(), ghosts: vi.fn(), error: vi.fn() }
  const session = openPointerRoom(
    { code: 'cancel before join' },
    callbacks,
    join as unknown as typeof joinRoom
  )
  session.close()
  await new Promise((resolve) => setTimeout(resolve, 40))
  expect(join).not.toHaveBeenCalled()
  expect(callbacks.ghosts).not.toHaveBeenCalled()
})

it('admits only current members, budgets messages before decode and batches overlay updates', async () => {
  vi.stubGlobal('RTCPeerConnection', NativeRTC)
  class Action {
    send = vi.fn(async () => {})
    onReceive = vi.fn<(f: (ctx: ActionReceiveContext) => boolean) => void>()
    onMessage =
      vi.fn<(f: (data: MoveMessage & { id?: string }, ctx: { peerId: string }) => void) => void>()
  }
  const move = new Action()
  const ping = new Action()
  const room = {
    makeAction: (name: string) => (name === 'move' ? move : ping),
    ready: Promise.resolve(),
    leave: vi.fn(async () => {}),
    onPeerJoin: vi.fn<(f: (ctx: { peerId: string }) => void) => void>(),
    onPeerLeave: vi.fn<(f: (ctx: { peerId: string }) => void) => void>(),
    onError: vi.fn()
  }
  const join = vi.fn(() => room)
  const callbacks = { peers: vi.fn(), ghosts: vi.fn(), error: vi.fn() }
  const session = openPointerRoom(
    { code: 'unit test secret' },
    callbacks,
    join as unknown as typeof joinRoom
  )
  try {
    session.move({ name: 'hello', x: 0, y: 0 })
    await vi.waitFor(() => expect(room.onPeerJoin).toHaveBeenCalledOnce())
    vi.useFakeTimers()
    expect(join).toHaveBeenCalledWith(
      expect.objectContaining({
        maxUsers: MAX_PEERS + 1,
        maxReceiveBytes: ROOM_RECEIVE_BYTES,
        password: 'unit test secret'
      }),
      expect.any(String)
    )
    const peer = { peerId: 'peer-one' }
    const ctx = { ...peer, byteLength: 40, kind: 'message' } as ActionReceiveContext
    const mayMove = move.onReceive.mock.calls[0][0],
      mayPing = ping.onReceive.mock.calls[0][0]
    expect(mayMove(ctx)).toBe(false)
    expect(move.send).not.toHaveBeenCalled()
    room.onPeerJoin.mock.calls[0][0](peer)
    expect(move.send).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'hello' }),
      expect.objectContaining({ target: peer.peerId })
    )
    expect(mayMove({ ...ctx, byteLength: POINTER_BYTES + 1 })).toBe(false)
    expect(mayMove({ ...ctx, metadata: 'unused' })).toBe(false)
    expect(mayMove({ ...ctx, kind: 'request' })).toBe(false)
    const position = { x: 0.25, y: 0.75, name: 'friend' }
    for (let i = 0; i < 18; i++) {
      expect(mayMove(ctx)).toBe(true)
      move.onMessage.mock.calls[0][0]({ ...position, x: i / 18 }, peer)
    }
    expect(mayMove(ctx)).toBe(false)
    for (let i = 0; i < 8; i++) {
      expect(mayPing(ctx)).toBe(true)
      ping.onMessage.mock.calls[0][0]({ ...position, id: 'p' + i }, peer)
    }
    expect(mayPing(ctx)).toBe(false)
    expect(callbacks.ghosts).not.toHaveBeenCalled()
    // The renderer's interval was created before the transport finished joining.
    vi.useRealTimers()
    await vi.waitFor(() => expect(callbacks.ghosts).toHaveBeenCalledOnce())
    const displayed = callbacks.ghosts.mock.calls[0][0][peer.peerId]
    expect(displayed.x).toBe(17 / 18)
    expect(displayed.pings.map((p: { id: string }) => p.id)).toEqual(['p4', 'p5', 'p6', 'p7'])
    expect(displayed.pings).toHaveLength(MAX_PINGS)
    room.onPeerLeave.mock.calls[0][0](peer)
    expect(mayMove(ctx)).toBe(false)
    session.close()
    room.onPeerJoin.mock.calls[0][0](peer)
    expect(mayPing(ctx)).toBe(false)
    expect(room.leave).toHaveBeenCalledOnce()
  } finally {
    session.close()
  }
})
