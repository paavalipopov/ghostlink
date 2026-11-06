import { useEffect, useRef, useState, type JSX, type PointerEvent } from 'react'
import type { MarkKind, OverlayModel } from '../../shared/protocol'
import { CursorMark } from './CursorMark'
import './assets/marks.css'

const MARK_TEXT: Record<MarkKind, string> = {
  'top-left': 'Put the pointer on the top-left of the game picture',
  'bottom-right': 'Put the pointer on the bottom-right of the game picture',
  window: 'Put the pointer over the game window'
}

type Draft = { x: number; y: number; width: number; height: number }

function draftBetween(a: { x: number; y: number }, b: { x: number; y: number }): Draft {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y)
  }
}

export function Overlay(): JSX.Element {
  const [model, setModel] = useState<OverlayModel | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const origin = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => window.api.onOverlay(setModel), [])

  useEffect(() => {
    if (!model?.picking) {
      origin.current = null
      setDraft(null)
    }
  }, [model?.picking])

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (!model?.picking || event.button !== 0) return
    const start = { x: event.clientX, y: event.clientY }
    origin.current = start
    event.currentTarget.setPointerCapture(event.pointerId)
    setDraft(draftBetween(start, start))
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (!origin.current) return
    setDraft(draftBetween(origin.current, { x: event.clientX, y: event.clientY }))
  }

  const onPointerUp = (event: PointerEvent<HTMLDivElement>): void => {
    const start = origin.current
    origin.current = null
    setDraft(null)
    if (!start || !model?.picking) return
    void window.api.finishPick({
      space: 'overlay',
      x1: start.x,
      y1: start.y,
      x2: event.clientX,
      y2: event.clientY
    })
  }

  return (
    <div
      data-testid="overlay-root"
      data-picking={model?.picking ? '1' : '0'}
      style={{
        position: 'fixed',
        inset: 0,
        overflow: 'hidden',
        pointerEvents: model?.picking ? 'auto' : 'none',
        background: 'transparent',
        cursor: model?.picking ? 'crosshair' : 'none'
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {model?.showFrame && model.frame && !model.picking && (
        <div
          className="frame"
          style={{
            left: model.frame.x,
            top: model.frame.y,
            width: model.frame.width,
            height: model.frame.height
          }}
        />
      )}
      {draft && draft.width > 0 && draft.height > 0 && (
        <div
          className="frame"
          data-testid="drag-rect"
          style={{ left: draft.x, top: draft.y, width: draft.width, height: draft.height }}
        />
      )}
      {model?.mark && (
        <div className="mark-banner">
          <div className="mark-count">{model.mark.count}</div>
          <div>{MARK_TEXT[model.mark.kind]}</div>
        </div>
      )}
      {model?.picking && (
        <div className="mark-banner" data-testid="pick-banner">
          <div>Drag across the picture, then release.</div>
        </div>
      )}
      {model?.mark && model.cursor && (
        <div className="crosshair" style={{ left: model.cursor.x, top: model.cursor.y }} />
      )}
      {model?.ghosts.map((ghost) =>
        ghost.visible ? (
          <div
            key={ghost.id}
            className="ghost-move"
            data-testid="overlay-ghost"
            data-name={ghost.name}
            data-x={ghost.nx ?? ''}
            data-y={ghost.ny ?? ''}
            data-flash={ghost.flash ? '1' : '0'}
            style={{ left: ghost.x, top: ghost.y }}
          >
            <CursorMark
              name={ghost.name}
              color={ghost.color}
              clickKey={ghost.flash ? ghost.flashId : null}
            />
          </div>
        ) : null
      )}
    </div>
  )
}
