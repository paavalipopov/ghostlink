import { useEffect, useState, type JSX } from 'react'
import type { MarkKind, OverlayModel } from '../../shared/protocol'
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
      {model?.ghosts.map((ghost) => (
        <div key={ghost.id}>
          {ghost.visible && (
            <div className="ghost-move" style={{ left: ghost.x, top: ghost.y }}>
              <CursorMark name={ghost.name} color={ghost.color} />
            </div>
          )}
          {ghost.pings.map((ping) => (
            <span
              key={ping.id}
              className="ping"
              style={{ left: ping.x, top: ping.y, borderColor: ghost.color }}
            />
          ))}
        </div>
      ))}
    </div>
  )
}
