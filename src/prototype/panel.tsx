import { invoke } from '@tauri-apps/api/core'
import { useEffect, useState, type JSX } from 'react'
import { createRoot } from 'react-dom/client'
import App from '@renderer/App'
import { version } from '../../src-tauri/tauri.conf.json'
import { createPanelApi, type Controls } from './panel-api'
import './panel.css'

type ReadyPanel = { controls: Controls; bridge: ReturnType<typeof createPanelApi> }

// This file mounts the panel as a Vite entry point.
// eslint-disable-next-line react-refresh/only-export-components
function Panel(): JSX.Element {
  const [ready, setReady] = useState<ReadyPanel | null>(null)
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    let disposed = false
    void invoke<Controls>('controls').then(
      (controls) => {
        if (!disposed) setReady({ controls, bridge: createPanelApi(controls, setNote) })
      },
      (error) => {
        if (!disposed) setNote(String(error))
      }
    )
    return () => {
      disposed = true
    }
  }, [])

  if (!ready)
    return (
      <p className="p-3 text-sm" role="status">
        {note ?? 'Opening Ghostlink…'}
      </p>
    )
  const { controls, bridge } = ready
  return (
    <App
      api={bridge.api}
      appVersion={version}
      canSelectArea={controls.desktopAreas && controls.displays.length > 0}
      canPickWindow={controls.pickWindow}
      areaNote={
        note ?? (controls.desktopAreas ? null : 'Desktop areas require an X11 session on Linux.')
      }
      areaControls={
        controls.displays.length > 1 && (
          <select
            aria-label="Display"
            className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs [color-scheme:dark]"
            disabled={!controls.desktopAreas}
            onChange={(event) => {
              const value = event.target.value
              bridge.selectDisplay(value === '' ? undefined : controls.displays[Number(value)])
            }}
          >
            <option value="">Current display</option>
            {controls.displays.map((display, index) => (
              <option key={index} value={index}>
                {display.name} · {Math.round(display.scaleFactor * 100)}% · {display.bounds.width} ×{' '}
                {display.bounds.height}
              </option>
            ))}
          </select>
        )
      }
    />
  )
}

createRoot(document.getElementById('root')!).render(<Panel />)
