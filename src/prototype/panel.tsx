import { invoke } from '@tauri-apps/api/core'
import { useEffect, useState, type JSX } from 'react'
import { createRoot } from 'react-dom/client'
import type { Bounds } from '../shared/coords'
import './panel.css'

type Display = { name: string; bounds: Bounds; scaleFactor: number }

function describe({ x, y, width, height }: Bounds): string {
  return `(${x}, ${y}) · ${width} × ${height} px`
}

// This file mounts the panel as a Vite entry point.
// eslint-disable-next-line react-refresh/only-export-components
function Panel(): JSX.Element {
  const [displays, setDisplays] = useState<Display[]>([])
  const [index, setIndex] = useState(0)
  const [area, setArea] = useState<Bounds | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void invoke<Display[]>('displays').then(setDisplays, (error) => setError(String(error)))
  }, [])

  async function selectArea(index: number | null): Promise<void> {
    setBusy(true)
    setError('')
    try {
      setArea(await invoke<Bounds | null>('select_area', { index }))
    } catch (error) {
      setArea(null)
      setError(String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main>
      <h1>Ghostlink Tauri prototype</h1>
      <p>Select a display to trace your pointer inside its center rectangle.</p>
      <label htmlFor="display">Display</label>
      <select
        id="display"
        disabled={busy || displays.length === 0}
        value={index}
        onChange={(event) => setIndex(Number(event.target.value))}
      >
        {displays.map((display, index) => (
          <option key={index} value={index}>
            {display.name} · {Math.round(display.scaleFactor * 100)}% · {describe(display.bounds)}
          </option>
        ))}
      </select>
      <div className="actions">
        <button disabled={busy || displays.length === 0} onClick={() => void selectArea(index)}>
          Show center rectangle
        </button>
        <button disabled={busy || !area} onClick={() => void selectArea(null)}>
          Hide overlay
        </button>
      </div>
      <p role="status">{area ? `Capture area: ${describe(area)}` : 'Overlay off'}</p>
      {error && <p role="alert">{error}</p>}
      <p>Move another app under the orange frame. Click where the marker appears.</p>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<Panel />)
