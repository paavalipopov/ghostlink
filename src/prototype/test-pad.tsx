import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useCallback, useEffect, useRef, useState, type JSX, type PointerEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { isInside, normalize, type Bounds, type Point } from '../shared/coords'
import './panel.css'

type Input = Point & { click: boolean }

function pointIn(event: PointerEvent<HTMLDivElement>): Point | null {
  const { left, top, width, height } = event.currentTarget.getBoundingClientRect()
  if (width < 1 || height < 1) return null
  const point = normalize(
    { x: event.clientX, y: event.clientY },
    { x: left, y: top, width, height }
  )
  return isInside(point) ? point : null
}

// This file mounts the trackpad as a Vite entry point.
// eslint-disable-next-line react-refresh/only-export-components
function TestPad(): JSX.Element {
  const [area, setArea] = useState<Bounds | null>(null)
  const [error, setError] = useState<string | null>(null)
  const frame = useRef<number | null>(null)
  const pendingPoint = useRef<Point | null>(null)

  const send = useCallback((input: Input | null): void => {
    if (frame.current !== null) window.cancelAnimationFrame(frame.current)
    frame.current = null
    void invoke('test_pad_input', { input }).catch((error) => setError(String(error)))
  }, [])

  useEffect(() => {
    let disposed = false
    let receivedArea = false
    const subscription = listen<Bounds | null>('test-area', ({ payload }) => {
      receivedArea = true
      if (!disposed) setArea(payload)
    })
    void subscription
      .then(() => invoke<Bounds | null>('test_pad_area'))
      .then((area) => {
        if (!disposed && !receivedArea) setArea(area)
      })
      .catch((error) => {
        if (!disposed) setError(String(error))
      })

    const leave = (): void => send(null)
    const escape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      leave()
      void invoke('close_test_pad').catch((error) => setError(String(error)))
    }
    window.addEventListener('blur', leave)
    window.addEventListener('keydown', escape)
    return () => {
      disposed = true
      if (frame.current !== null) window.cancelAnimationFrame(frame.current)
      window.removeEventListener('blur', leave)
      window.removeEventListener('keydown', escape)
      void subscription.then(
        (unlisten) => unlisten(),
        () => undefined
      )
    }
  }, [send])

  return (
    <main className="flex h-full flex-col gap-3 p-4">
      <header>
        <h1 className="text-lg font-semibold">Test your pointer</h1>
      </header>
      <p className="text-sm text-muted-foreground">
        Move here to show <span className="text-foreground">Test user</span> in your shared area.{' '}
        <span className="whitespace-nowrap" data-testid="pad-area">
          {area ? `${area.width} × ${area.height} pixels.` : 'Choose a shared area in Ghostlink.'}
        </span>
      </p>
      <p className="text-xs text-muted-foreground" role="status">
        Private preview
      </p>
      <div
        role="group"
        aria-label="Test trackpad"
        data-testid="pad-surface"
        title="Move or click to test the pointer in your shared area."
        className="relative min-h-32 flex-1 touch-none overflow-hidden rounded-lg border border-border bg-[#100e0c] select-none"
        onPointerMove={(event) => {
          if (!area) return
          pendingPoint.current = pointIn(event)
          if (frame.current !== null) return
          frame.current = window.requestAnimationFrame(() => {
            frame.current = null
            const point = pendingPoint.current
            send(point ? { ...point, click: false } : null)
          })
        }}
        onPointerDown={(event) => {
          if (!area || event.button !== 0) return
          const point = pointIn(event)
          if (point) send({ ...point, click: true })
        }}
        onPointerLeave={() => send(null)}
        onPointerCancel={() => send(null)}
      />
      {error && (
        <p role="alert" className="text-xs text-[#ffad98]">
          {error}
        </p>
      )}
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<TestPad />)
