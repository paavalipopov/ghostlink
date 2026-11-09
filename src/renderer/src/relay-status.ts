import { useEffect, useState } from 'react'
import { getRelaySockets } from 'trystero'
import type { IndicatorState } from './StatusDot'

type RelayStatus = { state: IndicatorState; open: number; total: number }

// Observe Trystero's real signaling sockets, without sending extra probes or secrets.
export function useRelayStatus(active: boolean): RelayStatus {
  const [status, setStatus] = useState<RelayStatus>({ state: 'wait', open: 0, total: 0 })
  useEffect(() => {
    if (!active) return
    const started = Date.now()
    const read = (): void => {
      const sockets = Object.values(getRelaySockets() as Record<string, WebSocket>)
      const open = sockets.filter((socket) => socket.readyState === WebSocket.OPEN).length
      const state = open > 0 ? 'live' : Date.now() - started < 15_000 ? 'wait' : 'error'
      setStatus((current) =>
        current.state === state && current.open === open && current.total === sockets.length
          ? current
          : { state, open, total: sockets.length }
      )
    }
    const timer = setInterval(read, 500)
    return () => clearInterval(timer)
  }, [active])
  return active ? status : { state: 'idle', open: 0, total: 0 }
}
