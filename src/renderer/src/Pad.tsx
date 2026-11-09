import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type PointerEvent
} from 'react'
import { quantize } from '../../shared/coords'
import type { Bounds } from '../../shared/coords'
import { codeIsStrong, makePingId } from '../../shared/protocol'
import { useGhostLink } from './link'
import { StatusDot } from './StatusDot'
import { useRelayStatus } from './relay-status'

function pointIn(event: PointerEvent<HTMLDivElement>): { x: number; y: number } | null {
  const rect = event.currentTarget.getBoundingClientRect()
  if (rect.width < 1 || rect.height < 1) return null
  return {
    x: quantize((event.clientX - rect.left) / rect.width),
    y: quantize((event.clientY - rect.top) / rect.height)
  }
}

export function Pad(): JSX.Element {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('code') ?? ''
  const settings = { code }
  const ready = codeIsStrong(code)
  const link = useGhostLink(ready, settings)
  const relays = useRelayStatus(ready)
  const { publishMove, publishPing } = link
  const [area, setArea] = useState<Bounds | null>(null)
  const [timedOut, setTimedOut] = useState(false)
  const panelRef = useRef<HTMLElement>(null)
  const fitted = useRef(false)
  const [zoom, setZoom] = useState(1)

  useLayoutEffect(() => {
    if (!ready || !area || fitted.current) return
    let gone = false
    let timer: number | undefined
    let timeout: number | undefined
    void document.fonts.ready.then(() => {
      if (gone || !panelRef.current) return
      fitted.current = true
      const rect = panelRef.current.getBoundingClientRect()
      const width = Math.ceil(rect.width)
      const height = Math.ceil(rect.height)
      window.api.fitWindow({ width, height })
      timer = window.setInterval(() => {
        const gapW = window.innerWidth / width
        const gapH = window.innerHeight / height
        if (Math.abs(gapW - gapH) > 0.04 || Math.min(gapW, gapH) < 0.98) return
        window.clearInterval(timer)
        const gap = Math.min(gapW, gapH)
        if (gap > 1.04) setZoom(Math.round(gap * 100) / 100)
      }, 30)
      timeout = window.setTimeout(() => window.clearInterval(timer), 1000)
    })
    return () => {
      gone = true
      window.clearInterval(timer)
      window.clearTimeout(timeout)
    }
  }, [ready, area])

  useEffect(() => {
    let gone = false
    let receivedArea = false
    const stop = window.api.onPlayArea((next) => {
      receivedArea = true
      setArea(next)
    })
    void window.api.getPlayArea().then((next) => {
      if (!gone && !receivedArea) setArea(next)
    })
    const timer = setTimeout(() => setTimedOut(true), 20_000)
    return () => {
      gone = true
      stop()
      clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    if (!ready) return
    publishMove({ name: 'Test user', x: null, y: null })
  }, [ready, publishMove])

  if (!ready) {
    return (
      <main className="p-6 text-sm text-muted-foreground">
        Open this window from the Ghostlink panel.
      </main>
    )
  }

  return (
    <main
      ref={panelRef}
      className="flex flex-col gap-3 p-4"
      style={{ width: 316, minHeight: 314, zoom } as CSSProperties}
    >
      <header>
        <h1 className="text-lg font-semibold">Test your pointer</h1>
      </header>
      <p className="text-sm text-muted-foreground">
        Move here to show <span className="text-foreground">Test user</span> pointer in your green
        area:{' '}
        <span className="whitespace-nowrap" data-testid="pad-area">
          {area ? `${area.width} × ${area.height} pixels.` : 'Reading selected area…'}
        </span>
      </p>
      <div className="flex items-center gap-4 text-xs text-muted-foreground" role="status">
        <span className="flex items-center gap-1.5">
          Relays
          <StatusDot
            compact
            testId="pad-relays"
            state={relays.state}
            title={
              relays.open > 0
                ? `${relays.open} of ${relays.total} signaling servers reachable. Peer connection is checked separately.`
                : relays.state === 'error'
                  ? 'No signaling servers reachable. Check your internet connection.'
                  : 'Checking signaling servers'
            }
          />
        </span>
        <span
          className="flex items-center gap-1.5"
          data-testid="pad-status"
          data-phase={link.phase}
        >
          Test peer
          <StatusDot
            compact
            testId="pad-peer"
            state={
              link.phase === 'linked'
                ? 'live'
                : link.phase === 'error' || timedOut
                  ? 'error'
                  : 'wait'
            }
            title={
              link.phase === 'linked'
                ? 'Connected to your main panel through WebRTC'
                : link.phase === 'error'
                  ? link.detail
                  : timedOut
                    ? 'The test peer has not connected. Reachable relays alone do not guarantee a peer connection.'
                    : 'Connecting to your main panel'
            }
          />
        </span>
      </div>
      <div
        data-testid="pad-surface"
        title="This surface maps to your selected green area. Move or click to test the remote pointer."
        className="relative min-h-32 flex-1 overflow-hidden rounded-lg border border-border bg-[#100e0c] select-none"
        onPointerMove={(event) => {
          const point = pointIn(event)
          if (!point) return
          publishMove({ name: 'Test user', ...point })
        }}
        onPointerLeave={() => {
          publishMove({ name: 'Test user', x: null, y: null })
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          const point = pointIn(event)
          if (!point) return
          publishMove({ name: 'Test user', ...point })
          publishPing({
            name: 'Test user',
            ...point,
            id: makePingId()
          })
        }}
      />
    </main>
  )
}
