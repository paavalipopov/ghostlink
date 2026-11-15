import { describe, expect, it } from 'vitest'
import { fullscreenToggleModel, selectionRejected } from '../src/prototype/fullscreen-toggle'

const idle = {
  state: 'idle',
  error: null,
  windowTracked: false,
  busy: false,
  marking: false
}

describe('fullscreen toggle', () => {
  it('stays off and disabled until a window is picked', () => {
    const model = fullscreenToggleModel(idle)
    expect(model).toMatchObject({ pressed: false, enabled: false, status: 'off' })
    expect(model.title).toMatch(/Pick a window/)
  })

  it('uses one control to enter and leave', () => {
    const ready = fullscreenToggleModel({ ...idle, windowTracked: true })
    expect(ready).toMatchObject({ pressed: false, enabled: true, status: 'off' })
    expect(ready.title).toContain('Alt+Shift+A')
    const live = fullscreenToggleModel({ ...idle, state: 'scaling' })
    expect(live.title).toContain('Alt+Shift+A')
    expect(live.title).toContain('Ctrl+Alt+F11')
    for (const state of ['starting', 'scaling', 'waiting', 'stopping']) {
      const live = fullscreenToggleModel({ ...idle, state, windowTracked: false })
      expect(live).toMatchObject({ pressed: true, enabled: true, status: 'on' })
    }
  })

  it('blocks a second request while one is in flight and while a drag is active', () => {
    expect(fullscreenToggleModel({ ...idle, windowTracked: true, busy: true }).enabled).toBe(false)
    expect(fullscreenToggleModel({ ...idle, windowTracked: true, marking: true }).enabled).toBe(
      false
    )
    expect(fullscreenToggleModel({ ...idle, state: 'scaling', busy: true }).enabled).toBe(false)
  })

  it('keeps a failed exit available and surfaces the error without an idle label', () => {
    const failed = fullscreenToggleModel({
      ...idle,
      state: 'failed',
      error: 'Fullscreen helper exited: exit code: 1',
      windowTracked: true
    })
    expect(failed.status).toBe('off')
    expect(failed.title).toContain('Fullscreen helper exited')
    expect(failed.title).not.toMatch(/\bidle\b/i)
  })

  it('treats an unsupported selection as a reason to drop window tracking', () => {
    expect(selectionRejected('Pick a window before entering fullscreen.')).toBe(true)
    expect(selectionRejected('The selected window changed. Try again.')).toBe(true)
    expect(selectionRejected('Finish or cancel the current drag first.')).toBe(true)
    expect(selectionRejected('Windows did not activate the selected window.')).toBe(false)
  })
})
