import type { JSX } from 'react'
import { ERROR_COLOR, IDLE_RING, LIVE_COLOR } from '../../shared/protocol'

export type IndicatorState = 'idle' | 'wait' | 'live' | 'error'

export function StatusDot({
  state,
  title,
  testId = 'monitor',
  compact = false
}: {
  state: IndicatorState
  title: string
  testId?: string
  compact?: boolean
}): JSX.Element {
  const color = state === 'live' ? LIVE_COLOR : state === 'error' ? ERROR_COLOR : 'transparent'
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center ${compact ? 'size-5' : 'size-9'}`}
    >
      <span
        data-testid={testId}
        data-state={state}
        title={title}
        aria-label={title}
        className={`inline-block rounded-full border-2 ${compact ? 'size-4' : 'size-7'} ${state === 'wait' ? 'link-wait' : ''}`}
        style={
          state === 'wait'
            ? undefined
            : { background: color, borderColor: state === 'idle' ? IDLE_RING : color }
        }
      />
    </span>
  )
}
