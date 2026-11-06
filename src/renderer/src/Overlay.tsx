import { useEffect, useState, type JSX } from 'react'
import { CLICK_COLOR, type MarkKind, type OverlayModel } from '../../shared/protocol'
import { CursorMark } from './CursorMark'
import './assets/marks.css'

const MARK_TEXT: Record<MarkKind, string> = {
  'top-left': 'Put the pointer on the top-left of the game picture',
  'bottom-right': 'Put the pointer on the bottom-right of the game picture',
  window: 'Put the pointer over the game window'
}

export function Overlay(): JSX.Element {
  const [model, setModel] = useState<OverlayModel | null>(null)

  useEffect(() => window.api.onOverlay(setModel), [])

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
        background: 'transparent'
      }}
    >
      {model?.showFrame && model.frame && (
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
      {model?.mark && (
        <div className="mark-banner">
          <div className="mark-count">{model.mark.count}</div>
          <div>{MARK_TEXT[model.mark.kind]}</div>
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
            <CursorMark name={ghost.name} color={ghost.flash ? CLICK_COLOR : ghost.color} />
          </div>
        ) : null
      )}
    </div>
  )
}
