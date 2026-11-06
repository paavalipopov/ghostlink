import type { JSX } from 'react'
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
              style={{ left: `${ghost.x * 100}%`, top: `${ghost.y * 100}%` }}
            >
              <CursorMark name={ghost.name} color={ghost.color} />
            </div>
          )}
          {ghost.pings.map((ping) => (
            <span
              key={ping.id}
              className="ping"
              data-testid="stage-ping"
              style={{
                left: `${ping.x * 100}%`,
                top: `${ping.y * 100}%`,
                borderColor: ghost.color
              }}
            />
          ))}
        </div>
      ))}
    </>
  )
}
