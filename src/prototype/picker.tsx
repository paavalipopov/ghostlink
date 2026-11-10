import { invoke } from '@tauri-apps/api/core'
import { useEffect, useRef, useState, type JSX, type PointerEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { rectBetween, type Bounds, type Point } from '../shared/coords'
import '../renderer/src/assets/marks.css'
import './picker.css'

type Drag = { start: Point; end: Point }

function fraction(event: PointerEvent): Point {
  const rect = event.currentTarget.getBoundingClientRect()
  return {
    x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
    y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
  }
}

// This file mounts the picker as a Vite entry point.
// eslint-disable-next-line react-refresh/only-export-components
function Picker(): JSX.Element {
  const origin = useRef<{ point: Point; id: number } | null>(null)
  const [draft, setDraft] = useState<Bounds | null>(null)
  const [note, setNote] = useState('')

  function finish(drag: Drag | null): void {
    origin.current = null
    setDraft(null)
    setNote('')
    void invoke('finish_drag', { drag }).catch((error) => setNote(String(error)))
  }

  useEffect(() => {
    const cancel = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') finish(null)
    }
    window.addEventListener('keydown', cancel)
    return () => window.removeEventListener('keydown', cancel)
  }, [])

  return (
    <div
      className="picker"
      onPointerDown={(event) => {
        if (event.button !== 0 || origin.current) return
        origin.current = { point: fraction(event), id: event.pointerId }
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={(event) => {
        if (origin.current?.id === event.pointerId) {
          setDraft(rectBetween(origin.current.point, fraction(event)))
        }
      }}
      onPointerUp={(event) => {
        if (origin.current?.id === event.pointerId) {
          finish({ start: origin.current.point, end: fraction(event) })
        }
      }}
      onLostPointerCapture={() => {
        origin.current = null
        setDraft(null)
      }}
    >
      {draft && (
        <div
          className="frame"
          style={{
            left: `${draft.x * 100}%`,
            top: `${draft.y * 100}%`,
            width: `${draft.width * 100}%`,
            height: `${draft.height * 100}%`
          }}
        />
      )}
      <div className="mark-banner" role="status">
        {note || 'Drag across the game picture. Press Esc to cancel.'}
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Picker />)
