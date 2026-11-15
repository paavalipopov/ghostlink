import { invoke } from '@tauri-apps/api/core'
import { useEffect, useState, type JSX } from 'react'
import { createRoot } from 'react-dom/client'
import App from '@renderer/App'
import { createPanelApi, type Controls } from './panel-api'
import './panel.css'
import { FullscreenToggle } from './fullscreen-controls'

type ReadyPanel = { controls: Controls; bridge: ReturnType<typeof createPanelApi> }

function ConnectedPanel({
  controls,
  bridge,
  note,
  setNote
}: ReadyPanel & {
  note: string | null
  setNote: (note: string | null) => void
}): JSX.Element {
  const [windowTracked, setWindowTracked] = useState(false)
  const [marking, setMarking] = useState(false)
  useEffect(() => bridge.onWindowTracked(setWindowTracked), [bridge])
  useEffect(() => bridge.api.onMarking(setMarking), [bridge])
  return (
    <App
      api={bridge.api}
      appVersion={controls.appVersion}
      canSelectArea={controls.desktopAreas && controls.displays.length > 0}
      canPickWindow={controls.pickWindow}
      areaNote={
        note ?? (controls.desktopAreas ? null : 'Desktop areas require an X11 session on Linux.')
      }
      fullscreenToggle={
        controls.pickWindow ? (
          <FullscreenToggle
            report={setNote}
            windowTracked={windowTracked}
            marking={marking}
            onSelectionRejected={bridge.rejectWindow}
          />
        ) : null
      }
    />
  )
}

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
  return <ConnectedPanel {...ready} note={note} setNote={setNote} />
}

createRoot(document.getElementById('root')!).render(<Panel />)
