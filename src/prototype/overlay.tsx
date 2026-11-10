import { listen } from '@tauri-apps/api/event'
import { useEffect, useState, type JSX } from 'react'
import { createRoot } from 'react-dom/client'
import { CursorMark } from '../renderer/src/CursorMark'
import type { Sample } from '../shared/protocol'
import './overlay.css'

type Preview = { sample: Sample; test: boolean; clickKey: number | null }

// This file mounts the overlay as a Vite entry point.
// eslint-disable-next-line react-refresh/only-export-components
function Overlay(): JSX.Element {
  const [preview, setPreview] = useState<Preview | null>(null)

  useEffect(() => {
    const subscription = listen<Preview | null>('pointer-preview', ({ payload }) =>
      setPreview(payload)
    )
    return () => {
      void subscription.then((unlisten) => unlisten())
    }
  }, [])

  return (
    <div className="overlay">
      <div className="frame" />
      {preview && (
        <div
          className="point"
          style={{ left: `${preview.sample.x * 100}%`, top: `${preview.sample.y * 100}%` }}
        >
          <div className="crosshair" />
          <div className="mark">
            <CursorMark
              name={preview.test ? 'Test user' : 'Local pointer'}
              color={preview.test ? '#6cb6d9' : '#e2a14a'}
              clickKey={preview.clickKey === null ? null : String(preview.clickKey)}
            />
          </div>
        </div>
      )}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Overlay />)
