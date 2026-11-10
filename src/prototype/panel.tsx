import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useCallback, useEffect, useState, type JSX } from 'react'
import { createRoot } from 'react-dom/client'
import { Button } from '@renderer/components/ui/button'
import { GhostMark, IconDrag, IconFullScreen, IconWindow } from '@renderer/icons'
import type { Bounds } from '../shared/coords'
import './panel.css'

type Display = { name: string; bounds: Bounds; scaleFactor: number }
type Controls = { displays: Display[]; desktopAreas: boolean; pickWindow: boolean }
type AreaChange = { area: Bounds | null; error: string | null }
type Action = 'display' | 'drag' | 'window'

function describe({ x, y, width, height }: Bounds): string {
  return `(${x}, ${y}) · ${width} × ${height} px`
}

// This file mounts the panel as a Vite entry point.
// eslint-disable-next-line react-refresh/only-export-components
function Panel(): JSX.Element {
  const [controls, setControls] = useState<Controls | null>(null)
  const [index, setIndex] = useState(0)
  const [area, setArea] = useState<Bounds | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [action, setAction] = useState<Action | null>(null)
  const [countdown, setCountdown] = useState<number | null>(null)
  const display = controls?.displays[index]
  const disabled = !display || !controls?.desktopAreas || action !== null

  const complete = useCallback(({ area, error }: AreaChange): void => {
    setArea(area)
    setError(error)
    setAction(null)
  }, [])

  const failed = useCallback((error: unknown): void => {
    setError(String(error))
    setAction(null)
  }, [])

  useEffect(() => {
    const subscription = listen<AreaChange>('area-change', ({ payload }) => complete(payload))
    void subscription.then(() => invoke<Controls>('controls')).then(setControls, failed)
    return () =>
      void subscription.then(
        (unlisten) => unlisten(),
        () => undefined
      )
  }, [complete, failed])

  useEffect(() => {
    if (countdown === null) return
    const timer = window.setTimeout(() => {
      if (countdown > 1) {
        setCountdown(countdown - 1)
        return
      }
      setCountdown(null)
      void invoke<AreaChange>('select_window').then(complete, failed)
    }, 1000)
    return () => window.clearTimeout(timer)
  }, [countdown, complete, failed])

  function selectDisplay(bounds: Bounds | null): void {
    setAction('display')
    setError(null)
    void invoke<AreaChange>('select_display', { bounds }).then(complete, failed)
  }

  return (
    <main className="mx-auto flex max-w-sm flex-col gap-4 px-4 py-4">
      <header className="text-center">
        <h1 className="flex items-center justify-center gap-2 text-2xl font-semibold tracking-tight">
          <GhostMark />
          Ghostlink
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">Local pointer preview</p>
      </header>

      <section className="space-y-3 rounded-lg border border-border bg-card p-3">
        <h2 className="text-sm font-medium">Shared display</h2>
        <select
          id="display"
          aria-label="Display"
          className="w-full rounded-md border border-input bg-background px-2 py-2 text-sm [color-scheme:dark]"
          disabled={disabled}
          value={index}
          onChange={(event) => setIndex(Number(event.target.value))}
        >
          {controls?.displays.map((display, index) => (
            <option key={index} value={index}>
              {display.name} · {Math.round(display.scaleFactor * 100)}% · {display.bounds.width} ×{' '}
              {display.bounds.height}
            </option>
          ))}
        </select>

        <div className="grid grid-cols-2 gap-1.5">
          <Button
            type="button"
            variant="secondary"
            className="px-2"
            disabled={disabled || !controls?.pickWindow}
            title={
              controls?.pickWindow
                ? 'Point at a window during the countdown'
                : 'Available on Windows'
            }
            onClick={() => {
              setAction('window')
              setError(null)
              setCountdown(3)
            }}
          >
            <IconWindow />
            Pick window
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="px-2"
            disabled={disabled}
            onClick={() => {
              setAction('drag')
              setError(null)
              void invoke('begin_drag', { bounds: display?.bounds }).catch(failed)
            }}
          >
            <IconDrag />
            Drag frame
          </Button>
        </div>

        <Button
          type="button"
          variant="secondary"
          className="w-full"
          disabled={disabled}
          onClick={() => selectDisplay(display?.bounds ?? null)}
        >
          <IconFullScreen />
          Full Screen
        </Button>
      </section>

      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <p role="status">
          {countdown !== null
            ? `Point at the window… ${countdown}`
            : action === 'drag'
              ? 'Drag across the display. Esc cancels.'
              : controls?.desktopAreas === false
                ? 'Desktop areas require an X11 session on Linux.'
                : area
                  ? describe(area)
                  : 'Choose how to frame your shared area.'}
        </p>
        {countdown !== null ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setCountdown(null)
              setAction(null)
            }}
          >
            Cancel
          </Button>
        ) : (
          area && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => selectDisplay(null)}
            >
              Hide frame
            </Button>
          )
        )}
      </div>
      {error && (
        <p role="alert" className="text-xs text-[#ffad98]">
          {error}
        </p>
      )}
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<Panel />)
