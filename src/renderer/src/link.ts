import { useCallback, useEffect, useRef, useState } from 'react'
import { joinRoom as joinNostr } from 'trystero'
import {
  APP_ID,
  CLICK_MS,
  colorForPeer,
  explainLinkError,
  roomIdFromCode
} from '../../shared/protocol'
import type { MoveMessage, PingMessage } from '../../shared/protocol'

export type LinkSettings = {
  code: string
}

export type ShownPing = {
  id: string
  x: number
  y: number
  at: number
}

export type ShownGhost = {
  name: string
  color: string
  x: number | null
  y: number | null
  pings: ShownPing[]
}

export type LinkPhase = 'idle' | 'searching' | 'linked' | 'error'

type Sender = {
  move: (message: MoveMessage) => void
  ping: (message: PingMessage) => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

const IDLE_DETAIL = 'Type the same code as your friend, then press Connect.'
const SEARCHING_DETAIL = 'Looking for your friend. They need this same code, and Connect pressed.'

export type GhostLink = {
  phase: LinkPhase
  detail: string
  ghosts: Record<string, ShownGhost>
  publishMove: (message: MoveMessage) => void
  publishPing: (message: PingMessage) => void
}

export function useGhostLink(active: boolean, settings: LinkSettings): GhostLink {
  const sessionKey = active ? settings.code.trim() : ''
  const [phase, setPhase] = useState<LinkPhase>('idle')
  const [detail, setDetail] = useState(IDLE_DETAIL)
  const [ghosts, setGhosts] = useState<Record<string, ShownGhost>>({})
  const [seenKey, setSeenKey] = useState(sessionKey)
  if (seenKey !== sessionKey) {
    setSeenKey(sessionKey)
    setPhase(sessionKey ? 'searching' : 'idle')
    setDetail(sessionKey ? SEARCHING_DETAIL : IDLE_DETAIL)
    setGhosts({})
  }
  const sendRef = useRef<Sender | null>(null)
  const lastMove = useRef<MoveMessage | null>(null)

  const publishMove = useCallback((message: MoveMessage) => {
    lastMove.current = message
    sendRef.current?.move(message)
  }, [])

  const publishPing = useCallback((message: PingMessage) => {
    sendRef.current?.ping(message)
  }, [])

  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now()
      setGhosts((current) => {
        let changed = false
        const next: Record<string, ShownGhost> = {}
        for (const [id, ghost] of Object.entries(current)) {
          const pings = ghost.pings.filter((ping) => now - ping.at < CLICK_MS)
          if (pings.length !== ghost.pings.length) changed = true
          next[id] = pings.length === ghost.pings.length ? ghost : { ...ghost, pings }
        }
        return changed ? next : current
      })
    }, 200)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!sessionKey) return

    let disposed = false
    let leave: (() => Promise<void>) | null = null
    const code = settings.code.trim()

    void (async () => {
      try {
        const roomId = await roomIdFromCode(code)
        if (disposed) return
        const onJoinError = ({ error }: { error: string }): void => {
          if (disposed) return
          setPhase('error')
          setDetail(explainLinkError(error))
        }
        const room = joinNostr(
          {
            appId: APP_ID,
            password: code,
            relayConfig: { redundancy: 4 }
          },
          roomId,
          { onJoinError }
        )
        if (disposed) {
          void room.leave()
          return
        }
        leave = () => room.leave()
        const move = room.makeAction<MoveMessage>('move')
        const ping = room.makeAction<PingMessage>('ping')

        const refresh = (): void => {
          if (disposed) return
          const ids = Object.keys(room.getPeers())
          if (ids.length > 0) {
            setPhase('linked')
            setDetail('Connected. Their cursor shows once both play areas cover the game.')
          } else {
            setPhase('searching')
            setDetail(SEARCHING_DETAIL)
          }
        }

        move.onMessage = (message, { peerId }) => {
          if (disposed || !isRecord(message)) return
          const name = typeof message.name === 'string' ? message.name.slice(0, 40) : 'Friend'
          const x = typeof message.x === 'number' ? message.x : null
          const y = typeof message.y === 'number' ? message.y : null
          setGhosts((current) => {
            const prev = current[peerId]
            return {
              ...current,
              [peerId]: {
                name,
                color: prev?.color ?? colorForPeer(peerId),
                x,
                y,
                pings: prev?.pings ?? []
              }
            }
          })
        }

        ping.onMessage = (message, { peerId }) => {
          if (
            disposed ||
            !isRecord(message) ||
            typeof message.x !== 'number' ||
            typeof message.y !== 'number'
          ) {
            return
          }
          const name = typeof message.name === 'string' ? message.name.slice(0, 40) : 'Friend'
          const id = typeof message.id === 'string' ? message.id : `${Date.now()}`
          setGhosts((current) => {
            const prev = current[peerId] ?? {
              name,
              color: colorForPeer(peerId),
              x: null,
              y: null,
              pings: []
            }
            return {
              ...current,
              [peerId]: {
                ...prev,
                name,
                pings: [
                  ...prev.pings,
                  { id, x: message.x as number, y: message.y as number, at: Date.now() }
                ]
              }
            }
          })
        }

        room.onPeerJoin = (peerId) => {
          const hello = lastMove.current
          if (hello) void move.send(hello, { target: peerId })
          refresh()
        }
        room.onPeerLeave = (peerId) => {
          setGhosts((current) => {
            const next = { ...current }
            delete next[peerId]
            return next
          })
          refresh()
        }

        sendRef.current = {
          move: (message) => {
            void move.send(message)
          },
          ping: (message) => {
            void ping.send(message)
          }
        }
        const hello = lastMove.current
        if (hello) void move.send(hello)
        refresh()
      } catch (error) {
        if (!disposed) {
          setPhase('error')
          setDetail(explainLinkError(error))
        }
      }
    })()

    return () => {
      disposed = true
      sendRef.current = null
      void leave?.()
    }
  }, [sessionKey, settings.code])

  return { phase, detail, ghosts, publishMove, publishPing }
}
