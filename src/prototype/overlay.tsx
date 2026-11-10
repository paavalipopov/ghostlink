import { listen } from '@tauri-apps/api/event'
import { useEffect, useState, type JSX } from 'react'
import { createRoot } from 'react-dom/client'
import { CursorMark } from '../renderer/src/CursorMark'
import type { Sample } from '../shared/protocol'
import './overlay.css'

// This file mounts the overlay as a Vite entry point.
// eslint-disable-next-line react-refresh/only-export-components
function Overlay(): JSX.Element {
  const [sample, setSample] = useState<Sample | null>(null)

  useEffect(() => {
    const subscription = listen<Sample>('pointer-sample', ({ payload }) => setSample(payload))
    return () => {
      void subscription.then((unlisten) => unlisten())
    }
  }, [])

  return (
    <div className="overlay">
      <div className="frame" />
      {sample?.inside && (
        <div className="point" style={{ left: `${sample.x * 100}%`, top: `${sample.y * 100}%` }}>
          <div className="crosshair" />
          <div className="mark">
            <CursorMark name="Local pointer" color="#e2a14a" />
          </div>
        </div>
      )}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Overlay />)
