import { useCallback, useEffect, useRef, useState } from 'react'
import { joinRoom as joinNostr } from 'trystero'
import { joinRoom as joinRelay } from '@trystero-p2p/ws-relay'
import { APP_ID, colorForPeer, explainLinkError, roomIdFromCode } from '../../shared/protocol'
import type { MoveMessage, PingMessage } from '../../shared/protocol'

export type LinkSettings = {
  code: string
  relayUrl: string
  turnUrl: string
  turnUsername: string
  turnCredential: string
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
  move: (message: MoveMessage, peerId?: string) => void
  ping: (message: PingMessage) => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

const IDLE_DETAIL = 'Type the same code as your friend, then press Connect.'

function searchingDetail(relayUrl: string): string {
  return relayUrl
    ? 'Looking for your friend through the backup address…'
    : 'Looking for your friend. They need this same code, and Connect pressed.'
}

export type GhostLink = {
  phase: LinkPhase
  detail: string
  peerIds: string[]
  ghosts: Record<string, ShownGhost>
  publishMove: (message: MoveMessage) => void
  publishPing: (message: PingMessage) => void
}

export function useGhostLink(active: boolean, settings: LinkSettings): GhostLink {
  const sessionKey = active
    ? [
        settings.code.trim(),
        settings.relayUrl.trim(),
        settings.turnUrl.trim(),
        settings.turnUsername,
        settings.turnCredential
      ].join('\n')
    : ''
  const [phase, setPhase] = useState<LinkPhase>('idle')
  const [detail, setDetail] = useState(IDLE_DETAIL)
  const [peerIds, setPeerIds] = useState<string[]>([])
  const [ghosts, setGhosts] = useState<Record<string, ShownGhost>>({})
  const [seenKey, setSeenKey] = useState(sessionKey)
  if (seenKey !== sessionKey) {
    setSeenKey(sessionKey)
    setPhase(sessionKey ? 'searching' : 'idle')
    setDetail(sessionKey ? searchingDetail(settings.relayUrl.trim()) : IDLE_DETAIL)
    setPeerIds([])
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
          const pings = ghost.pings.filter((ping) => now - ping.at < 900)
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
    const relayUrl = settings.relayUrl.trim()
    const turnUrl = settings.turnUrl.trim()

    void (async () => {
      try {
        const roomId = await roomIdFromCode(code)
        if (disposed) return
        const turnConfig = turnUrl
          ? [
              {
                urls: turnUrl,
                username: settings.turnUsername,
                credential: settings.turnCredential
              }
            ]
          : undefined
        const onJoinError = ({ error }: { error: string }): void => {
          if (disposed) return
          setPhase('error')
          setDetail(explainLinkError(error))
        }
        const room = relayUrl
          ? joinRelay(
              {
                appId: APP_ID,
                password: code,
                relayConfig: { urls: [relayUrl] },
                ...(turnConfig ? { turnConfig } : {})
              },
              roomId,
              { onJoinError }
            )
          : joinNostr(
              {
                appId: APP_ID,
                password: code,
                relayConfig: { redundancy: 4 },
                ...(turnConfig ? { turnConfig } : {})
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
          setPeerIds(ids)
          if (ids.length > 0) {
            setPhase('linked')
            setDetail('Connected. Their cursor shows once both play areas cover the game.')
          } else if (!disposed) {
            setPhase('searching')
            setDetail(searchingDetail(relayUrl))
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
          move: (message, peerId) => {
            void move.send(message, peerId ? { target: peerId } : undefined)
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
  }, [
    sessionKey,
    settings.code,
    settings.relayUrl,
    settings.turnUrl,
    settings.turnUsername,
    settings.turnCredential
  ])

  return { phase, detail, peerIds, ghosts, publishMove, publishPing }
}
