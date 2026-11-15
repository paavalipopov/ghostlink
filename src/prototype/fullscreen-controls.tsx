import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useEffect, useRef, useState, type JSX } from 'react'
import { Button } from '@renderer/components/ui/button'
import { fullscreenToggleModel, selectionRejected } from './fullscreen-toggle'

type Status = { state: string; error: string | null; hotkey: string }

export function FullscreenToggle({
  report,
  windowTracked,
  marking,
  onSelectionRejected
}: {
  report: (note: string | null) => void
  windowTracked: boolean
  marking: boolean
  onSelectionRejected: () => void
}): JSX.Element {
  const [status, setStatus] = useState<Status>({
    state: 'idle',
    error: null,
    hotkey: 'Ctrl+Alt+F11'
  })
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const reported = useRef<string | null>(null)

  useEffect(() => {
    let active = true
    const refresh = (): void => {
      if (pending.current) return
      void invoke<Status>('fullscreen_status').then(
        (next) => {
          if (active && !pending.current) setStatus(next)
        },
        (error) => {
          if (active && !pending.current) {
            setStatus({ state: 'failed', error: String(error), hotkey: 'Ctrl+Alt+F11' })
          }
        }
      )
    }
    refresh()
    const timer = window.setInterval(refresh, 750)
    const subscription = listen<Status>('fullscreen-status', ({ payload }) => {
      if (active && !pending.current) setStatus(payload)
    })
    return () => {
      active = false
      window.clearInterval(timer)
      void subscription.then((stop) => stop())
    }
  }, [])

  useEffect(() => {
    if (status.error) {
      if (reported.current !== status.error) {
        reported.current = status.error
        if (selectionRejected(status.error)) onSelectionRejected()
        report(status.error)
      }
      return
    }
    if (reported.current) {
      reported.current = null
      report(null)
    }
  }, [onSelectionRejected, report, status.error])

  const model = fullscreenToggleModel({
    state: status.state,
    error: status.error,
    windowTracked,
    busy,
    marking
  })

  async function toggle(): Promise<void> {
    if (pending.current || !model.enabled) return
    pending.current = true
    setBusy(true)
    try {
      setStatus(await invoke<Status>('fullscreen_toggle'))
    } catch (error) {
      const message = String(error)
      if (selectionRejected(message)) onSelectionRejected()
      setStatus((current) => ({ ...current, state: 'failed', error: message }))
    } finally {
      pending.current = false
      setBusy(false)
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      className={`col-start-1 grid h-6 w-[84px] grid-cols-[1fr_16px] gap-0.5 justify-self-start rounded-full px-1.5 py-0 text-[11px] ${
        model.enabled || busy ? '' : 'opacity-50'
      }`}
      data-testid="toggle-fullscreen"
      aria-pressed={model.pressed}
      aria-disabled={!model.enabled}
      title={model.title}
      onClick={() => {
        void toggle()
      }}
    >
      <span data-testid="fullscreen-label">Fullscreen</span>
      <span className="text-left" data-testid="fullscreen-status">
        {model.status}
      </span>
    </Button>
  )
}
