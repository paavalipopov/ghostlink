import { defaultRelayUrls, joinRoom, type ActionReceiveContext, type Room } from 'trystero'
import {
  APP_ID,
  CLICK_MS,
  MAX_PEERS,
  MAX_PINGS,
  MAX_PING_ID,
  colorForPeer,
  roomIdFromCode,
  unitPoint,
  type MoveMessage,
  type PingMessage
} from '../../shared/protocol'
import {
  connectionPool,
  guardDiscovery,
  POINTER_BYTES,
  ROOM_RECEIVE_BYTES,
  tokenBucket
} from './peer-budget'

export type LinkSettings = { code: string; scope?: 'share' | 'test' }
export type ShownPing = { id: string; x: number; y: number; at: number }
export type ShownGhost = MoveMessage & { color: string; pings: ShownPing[] }
type Ghosts = Record<string, ShownGhost>
type Callbacks = {
  peers: (count: number) => void
  ghosts: (ghosts: Ghosts) => void
  error: (reason: unknown) => void
}

type Member = {
  move: () => boolean
  ping: () => boolean
  ghost: ShownGhost | null
  queuedMove: MoveMessage | null
  sendingMove: boolean
  sendingPings: number
}
export type PointerRoom = {
  move(msg: MoveMessage): void
  ping(msg: PingMessage): void
  close(): void
}

function validMove(value: unknown): value is MoveMessage {
  if (!value || typeof value !== 'object') return false
  const msg = value as Partial<MoveMessage>
  return (
    typeof msg.name === 'string' &&
    msg.name.length <= 40 &&
    ((msg.x === null && msg.y === null) || unitPoint(msg.x, msg.y) !== null)
  )
}

export function openPointerRoom(
  { code, scope = 'share' }: LinkSettings,
  callbacks: Callbacks,
  join: typeof joinRoom = joinRoom
): PointerRoom {
  const limit = scope === 'test' ? 1 : MAX_PEERS
  const members = new Map<string, Member>()
  const listeners = new AbortController()
  const { signal } = listeners
  let pool: ReturnType<typeof connectionPool> | undefined
  let room: Room | undefined
  let lastMove: MoveMessage | null = null
  let sendMove: ((id: string, message: MoveMessage) => void) | undefined
  let sendPing: ((id: string, message: PingMessage) => void) | undefined
  let dirty = false

  const timer = setInterval(() => {
    const now = Date.now()
    for (const member of members.values()) {
      const ghost = member.ghost
      if (ghost?.pings.length && now - ghost.pings[0].at >= CLICK_MS) {
        ghost.pings = ghost.pings.filter((p) => now - p.at < CLICK_MS)
        dirty = true
      }
    }
    if (!dirty) return
    dirty = false
    const snapshot: Ghosts = Object.create(null)
    for (const [id, { ghost }] of members) {
      if (ghost) snapshot[id] = { ...ghost, pings: [...ghost.pings] }
    }
    callbacks.ghosts(snapshot)
  }, 33)

  function close(): void {
    if (signal.aborted) return
    listeners.abort()
    clearInterval(timer)
    members.clear()
    lastMove = null
    try {
      void room?.leave().catch(() => {})
    } finally {
      pool?.close()
    }
  }

  function admitAction(kind: 'move' | 'ping', ctx: ActionReceiveContext): boolean {
    const member = members.get(ctx.peerId)
    return (
      !!member &&
      ctx.kind === 'message' &&
      ctx.metadata === undefined &&
      ctx.byteLength > 0 &&
      ctx.byteLength <= POINTER_BYTES &&
      member[kind]()
    )
  }

  void (async () => {
    const secret = code.trim()
    if (!secret) throw new Error('A shared code is required.')
    const roomId = await roomIdFromCode(secret)
    if (signal.aborted) return
    guardDiscovery(defaultRelayUrls)
    pool = connectionPool(limit)
    room = join(
      {
        appId: scope === 'test' ? APP_ID + '.test' : APP_ID,
        password: secret,
        identity: 'none',
        maxUsers: limit + 1,
        maxReceiveBytes: ROOM_RECEIVE_BYTES,
        rtcPolyfill: pool.Connection,
        relayConfig: { redundancy: 4 }
      },
      roomId
    )
    const move = room.makeAction<MoveMessage>('move')
    const ping = room.makeAction<PingMessage>('ping')
    move.onReceive((ctx) => admitAction('move', ctx), { signal })
    ping.onReceive((ctx) => admitAction('ping', ctx), { signal })
    move.onMessage(
      (msg, { peerId }) => {
        const member = members.get(peerId)
        if (!member || !validMove(msg)) return
        member.ghost = {
          name: msg.name,
          x: msg.x,
          y: msg.y,
          color: member.ghost?.color ?? colorForPeer(peerId),
          pings: member.ghost?.pings ?? []
        }
        dirty = true
      },
      { signal }
    )
    ping.onMessage(
      (msg, { peerId }) => {
        const member = members.get(peerId)
        if (
          !member ||
          !validMove(msg) ||
          msg.x === null ||
          msg.y === null ||
          typeof msg.id !== 'string' ||
          !msg.id ||
          msg.id.length > MAX_PING_ID
        )
          return
        const ghost = member.ghost ?? {
          name: msg.name,
          color: colorForPeer(peerId),
          x: null,
          y: null,
          pings: []
        }
        ghost.name = msg.name
        ghost.pings = [...ghost.pings, { id: msg.id, x: msg.x, y: msg.y, at: Date.now() }].slice(
          -MAX_PINGS
        )
        member.ghost = ghost
        dirty = true
      },
      { signal }
    )

    // At most one pending send and one newer position per recipient.
    sendMove = (id, msg) => {
      const member = members.get(id)
      if (!member) return
      member.queuedMove = msg
      if (member.sendingMove) return
      member.sendingMove = true
      void (async () => {
        try {
          while (members.get(id) === member && member.queuedMove) {
            const next = member.queuedMove
            member.queuedMove = null
            await move.send(next, { target: id, signal })
          }
        } catch {
          // A departing peer can close its channel while a send is in flight.
        } finally {
          member.sendingMove = false
        }
      })()
    }
    sendPing = (id, msg) => {
      const member = members.get(id)
      if (!member || member.sendingPings >= MAX_PINGS) return
      member.sendingPings++
      void ping
        .send(msg, { target: id, signal })
        .catch(() => {})
        .finally(() => {
          member.sendingPings--
        })
    }
    // The direct room verifies both encrypted signaling directions and its
    // room-bound identity handshake before emitting onPeerJoin.
    room.onPeerJoin(
      ({ peerId }) => {
        if (signal.aborted || members.has(peerId) || members.size >= limit) return
        members.set(peerId, {
          move: tokenBucket(90, 18),
          ping: tokenBucket(12, 8),
          ghost: null,
          queuedMove: null,
          sendingMove: false,
          sendingPings: 0
        })
        if (lastMove) sendMove?.(peerId, lastMove)
        callbacks.peers(members.size)
      },
      { signal, replay: true }
    )
    room.onPeerLeave(
      ({ peerId }) => {
        if (!members.delete(peerId)) return
        dirty = true
        callbacks.peers(members.size)
      },
      { signal }
    )
    room.onError(
      (err) => {
        if (
          !members.size &&
          (err.code === 'relay-failed' ||
            err.code === 'identity-failed' ||
            err.code === 'peer-connect-failed')
        )
          callbacks.error(err.message)
      },
      { signal }
    )
    await room.ready
  })().catch((reason: unknown) => {
    if (signal.aborted) return
    close()
    callbacks.ghosts({})
    callbacks.error(reason)
  })

  return {
    move(msg: MoveMessage) {
      if (signal.aborted) return
      lastMove = { ...msg, name: msg.name.slice(0, 40) }
      for (const id of members.keys()) sendMove?.(id, lastMove)
    },
    ping(msg: PingMessage) {
      if (signal.aborted) return
      const ping = { ...msg, name: msg.name.slice(0, 40), id: msg.id.slice(0, MAX_PING_ID) }
      for (const id of members.keys()) sendPing?.(id, ping)
    },
    close
  }
}
