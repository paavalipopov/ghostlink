import { useEffect, useRef, useState, type JSX, type PointerEvent } from 'react'
import { quantize } from '../../shared/coords'
import { CLICK_MS } from '../../shared/protocol'
import { CursorMark } from './CursorMark'
import { GhostField } from './GhostField'
import { useGhostLink } from './link'

const SEAT_COLOR = '#6cb6d9'

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
  const ready = code.trim().length >= 4
  const link = useGhostLink(ready, settings)
  const { publishMove, publishPing } = link
  const [local, setLocal] = useState<{ x: number; y: number } | null>(null)
  const [clickKey, setClickKey] = useState<string | null>(null)
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const armClick = (): string => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`
    setClickKey(id)
    if (clickTimer.current) clearTimeout(clickTimer.current)
    clickTimer.current = setTimeout(() => {
      setClickKey((current) => (current === id ? null : current))
    }, CLICK_MS)
    return id
  }

  useEffect(() => {
    if (!ready) return
    publishMove({ name: 'Test seat', x: null, y: null })
  }, [ready, publishMove])

  if (!ready) {
    return (
      <main className="p-6 text-sm text-muted-foreground">
        Open this window from the Ghostlink panel.
      </main>
    )
  }

  return (
    <main className="flex h-full flex-col gap-3 p-4">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">Test seat</h1>
        <span
          data-testid="pad-status"
          data-phase={link.phase}
          title={link.phase === 'linked' ? 'Connected' : link.detail}
          aria-label={link.phase === 'linked' ? 'Connected' : link.detail}
          className="inline-block size-2.5 rounded-full"
          style={{
            background:
              link.phase === 'linked' ? '#3dbe6a' : link.phase === 'error' ? '#d4654a' : '#e2a14a'
          }}
        />
      </header>
      <div
        data-testid="pad-surface"
        title="Move here. A click blinks their pointer."
        className="relative min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-[#100e0c] select-none"
        onPointerMove={(event) => {
          const point = pointIn(event)
          if (!point) return
          setLocal(point)
          publishMove({ name: 'Test seat', ...point })
        }}
        onPointerLeave={() => {
          setLocal(null)
          publishMove({ name: 'Test seat', x: null, y: null })
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          const point = pointIn(event)
          if (!point) return
          setLocal(point)
          publishPing({
            name: 'Test seat',
            ...point,
            id: armClick()
          })
        }}
      >
        <GhostField ghosts={link.ghosts} />
        {local && (
          <div
            className="ghost-move"
            data-testid="pad-cursor"
            data-x={local.x}
            data-y={local.y}
            data-flash={clickKey ? '1' : '0'}
            style={{ left: `${local.x * 100}%`, top: `${local.y * 100}%` }}
          >
            <CursorMark name="Test seat" color={SEAT_COLOR} clickKey={clickKey} />
          </div>
        )}
      </div>
    </main>
  )
}
