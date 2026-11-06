import { useEffect, type JSX, type PointerEvent } from 'react'
import { quantize } from '../../shared/coords'
import { GhostField } from './GhostField'
import { useGhostLink } from './link'

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
  const settings = {
    code,
    relayUrl: params.get('relay') ?? '',
    turnUrl: params.get('turn') ?? '',
    turnUsername: params.get('turnUser') ?? '',
    turnCredential: params.get('turnPass') ?? ''
  }
  const ready = code.trim().length >= 4
  const link = useGhostLink(ready, settings)
  const { publishMove, publishPing } = link

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
      <header className="space-y-1">
        <h1 className="text-lg font-semibold">Test seat</h1>
        <p
          data-testid="pad-status"
          data-phase={link.phase}
          className="text-sm text-muted-foreground"
        >
          {link.detail} Move in the box. A click draws a ping. This does not click the game.
        </p>
      </header>
      <div
        data-testid="pad-surface"
        className="relative min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-[#100e0c] select-none"
        onPointerMove={(event) => {
          const point = pointIn(event)
          if (!point) return
          publishMove({ name: 'Test seat', ...point })
        }}
        onPointerLeave={() => publishMove({ name: 'Test seat', x: null, y: null })}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          const point = pointIn(event)
          if (!point) return
          publishPing({
            name: 'Test seat',
            ...point,
            id: `${Date.now()}-${Math.random().toString(16).slice(2)}`
          })
        }}
      >
        <GhostField ghosts={link.ghosts} />
      </div>
    </main>
  )
}
