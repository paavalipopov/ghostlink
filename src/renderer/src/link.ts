import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { explainLinkError, type MoveMessage, type PingMessage } from '../../shared/protocol'
import { openPointerRoom, type LinkSettings, type ShownGhost } from './pointer-room'

export type { LinkSettings, ShownGhost, ShownPing } from './pointer-room'
export type LinkPhase = 'idle' | 'searching' | 'linked' | 'error'
const IDLE_DETAIL = 'Type the same code as your friend, then press Connect.'
const SEARCHING_DETAIL = 'Looking for your friend. They need this same code, and Connect pressed.'
const LINKED_DETAIL = 'Connected. Their cursor shows once both play areas cover the game.'

export type GhostLink = {
  phase: LinkPhase
  detail: string
  ghosts: Record<string, ShownGhost>
  publishMove: (message: MoveMessage) => void
  publishPing: (message: PingMessage) => void
}

export function useGhostLink(active: boolean, { code, scope = 'share' }: LinkSettings): GhostLink {
  const secret = active ? code.trim() : ''
  const [phase, setPhase] = useState<LinkPhase>(secret ? 'searching' : 'idle')
  const [detail, setDetail] = useState(secret ? SEARCHING_DETAIL : IDLE_DETAIL)
  const [ghosts, setGhosts] = useState<Record<string, ShownGhost>>({})
  const session = useRef<ReturnType<typeof openPointerRoom> | null>(null)
  const sessionKey = JSON.stringify([scope, secret])
  const [seenKey, setSeenKey] = useState(sessionKey)
  if (seenKey !== sessionKey) {
    setSeenKey(sessionKey)
    setPhase(secret ? 'searching' : 'idle')
    setDetail(secret ? SEARCHING_DETAIL : IDLE_DETAIL)
    setGhosts({})
  }

  useLayoutEffect(() => {
    if (!secret) return
    const current = openPointerRoom(
      { code: secret, scope },
      {
        peers(count) {
          setPhase(count ? 'linked' : 'searching')
          setDetail(count ? LINKED_DETAIL : SEARCHING_DETAIL)
        },
        ghosts: setGhosts,
        error(reason) {
          setPhase('error')
          setDetail(explainLinkError(reason))
        }
      }
    )
    session.current = current
    return () => {
      session.current = null
      current.close()
    }
  }, [secret, scope])

  const publishMove = useCallback((msg: MoveMessage) => session.current?.move(msg), [])
  const publishPing = useCallback((msg: PingMessage) => session.current?.ping(msg), [])
  return { phase, detail, ghosts, publishMove, publishPing }
}
