import { invoke } from '@tauri-apps/api/core'
import { useEffect, useState, type JSX } from 'react'

type Status = { state: string; error: string | null; hotkey: string }

export function FullscreenControls({
  report
}: {
  report: (note: string | null) => void
}): JSX.Element {
  const [status, setStatus] = useState<Status>({
    state: 'idle',
    error: null,
    hotkey: 'Ctrl+Alt+F11'
  })
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    const refresh = (): void => {
      void invoke<Status>('fullscreen_status').then(
        (next) => {
          if (active) setStatus(next)
        },
        (error) => {
          if (active) setStatus({ state: 'failed', error: String(error), hotkey: 'Ctrl+Alt+F11' })
        }
      )
    }
    refresh()
    const timer = window.setInterval(refresh, 750)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [])
  async function control(command: 'fullscreen_start' | 'fullscreen_stop'): Promise<void> {
    setBusy(true)
    report(null)
    try {
      setStatus(await invoke<Status>(command))
    } catch (error) {
      report(String(error))
    } finally {
      setBusy(false)
    }
  }
  const running = ['starting', 'scaling', 'waiting'].includes(status.state)
  return (
    <div className="text-xs">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="rounded border px-2 py-1"
          disabled={busy || running}
          onClick={() => {
            void control('fullscreen_start')
          }}
        >
          Dev fullscreen
        </button>
        <button
          type="button"
          className="rounded border px-2 py-1"
          disabled={busy}
          onClick={() => {
            void control('fullscreen_stop')
          }}
        >
          Stop
        </button>
        <span role="status" title={status.error ?? undefined}>
          {status.state}
        </span>
      </div>
      <p className="mt-1 text-muted-foreground" title={status.error ?? undefined}>
        Pick window first · {status.hotkey} exits{status.error ? ' · Hover status for error' : ''}
      </p>
    </div>
  )
}
