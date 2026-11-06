import type { JSX } from 'react'
import { CLICK_COLOR } from '../../shared/protocol'
import type { ShownGhost } from './link'
import { CursorMark } from './CursorMark'
import './assets/marks.css'

export function GhostField({ ghosts }: { ghosts: Record<string, ShownGhost> }): JSX.Element {
  return (
    <>
      {Object.entries(ghosts).map(([id, ghost]) => (
        <div key={id}>
          {ghost.x != null && ghost.y != null && (
            <div
              className="ghost-move"
              data-testid="stage-ghost"
              data-name={ghost.name}
              data-x={ghost.x}
              data-y={ghost.y}
              data-flash={ghost.pings.length > 0 ? '1' : '0'}
              style={{ left: `${ghost.x * 100}%`, top: `${ghost.y * 100}%` }}
            >
              <CursorMark
                name={ghost.name}
                color={ghost.pings.length > 0 ? CLICK_COLOR : ghost.color}
              />
            </div>
          )}
        </div>
      ))}
    </>
  )
}
