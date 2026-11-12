import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPanelApi, type Controls } from '../src/prototype/panel-api'

const native = vi.hoisted(() => ({
  invoke: vi.fn(),
  listeners: new Map<string, Set<(event: { payload: unknown }) => void>>()
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }))
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (event: string, callback: (event: { payload: unknown }) => void) => {
    const listeners = native.listeners.get(event) ?? new Set()
    native.listeners.set(event, listeners)
    listeners.add(callback)
    return () => listeners.delete(callback)
  })
}))

const display = { x: 0, y: 0, width: 1920, height: 1200 }
const selected = { x: 200, y: 100, width: 800, height: 600 }
const controls: Controls = {
  appVersion: '0.8.0',
  desktopAreas: true,
  pickWindow: true,
  displays: [{ name: 'Primary', bounds: display, scaleFactor: 1.25, primary: true }]
}

function emit(event: string, payload: unknown): void {
  native.listeners.get(event)?.forEach((callback) => callback({ payload }))
}

beforeEach(() => {
  native.listeners.clear()
  native.invoke.mockReset().mockImplementation(async (command, args) => {
    if (command === 'restore_area' || command === 'select_display')
      return { area: args.bounds, error: null }
    if (command === 'select_window') return { area: selected, error: null }
    return null
  })
  vi.stubGlobal('window', globalThis)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('Tauri panel bridge (mocked IPC)', () => {
  it('hides the border without replacing the selected area or changing the peer session', async () => {
    const { api } = createPanelApi(controls, vi.fn())
    await api.restorePlayArea(selected)
    api.setSharing?.(true)
    native.invoke.mockClear()
    api.setShowFrame(false)
    api.setShowFrame(true)
    expect(native.invoke.mock.calls).toEqual([
      ['set_show_frame', { show: false }],
      ['set_show_frame', { show: true }]
    ])
  })

  it('chooses a default area once even when starting with the frame hidden', () => {
    const { api } = createPanelApi(controls, vi.fn())
    api.setShowFrame(false)
    api.setShowFrame(true)
    expect(native.invoke.mock.calls.filter(([command]) => command === 'select_display')).toEqual([
      ['select_display', { bounds: display }]
    ])
  })

  it('keeps the countdown active during automatic tracking updates and prevents a second pick', async () => {
    vi.useFakeTimers()
    const { api } = createPanelApi(controls, vi.fn())
    const marking = vi.fn()
    const area = vi.fn()
    api.onMarking(marking)
    api.onPlayArea(area)
    const pick = api.mark('window')
    await vi.advanceTimersByTimeAsync(700)
    emit('area-change', { area: selected, error: null, tracking: true })
    expect(area).toHaveBeenLastCalledWith(selected)
    expect(marking).toHaveBeenLastCalledWith(true)
    await api.mark('window')
    expect(
      native.invoke.mock.calls.filter(([command]) => command === 'prepare_pick_marker')
    ).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1400)
    await pick
    expect(marking.mock.calls).toEqual([[true], [false]])
    expect(
      native.invoke.mock.calls
        .filter(([command]) => command === 'set_pick_count')
        .map(([, args]) => args.count)
    ).toEqual([3, 2, 1, null])
    expect(
      native.invoke.mock.calls.filter(([command]) => command === 'select_window')
    ).toHaveLength(1)
  })

  it('finishes a drag only on the selection result, not on a tracking update', async () => {
    const { api } = createPanelApi(controls, vi.fn())
    const marking = vi.fn()
    api.onMarking(marking)
    const stop = api.onPlayArea(vi.fn())
    await api.pickFrame()
    emit('area-change', { area: selected, error: null, tracking: true })
    expect(marking).toHaveBeenLastCalledWith(true)
    emit('area-change', { area: selected, error: null })
    expect(marking).toHaveBeenLastCalledWith(false)
    stop()
    emit('area-change', { area: display, error: null })
    expect(marking.mock.calls).toEqual([[true], [false]])
  })

  it('drops old-session input after disconnect/reconnect and quantizes live movement', () => {
    const { api } = createPanelApi(controls, vi.fn())
    const move = vi.fn(),
      click = vi.fn()
    const stopMove = api.onSample(move)
    api.onClick(click)
    api.setSharing?.(true)
    api.setSharing?.(false)
    api.setSharing?.(true)
    emit('peer-input', { session: 1, kind: 'move', sample: { x: 0.9, y: 0.9 } })
    emit('peer-input', { session: 1, kind: 'click', sample: { x: 0.9, y: 0.9 } })
    expect(move).not.toHaveBeenCalled()
    expect(click).not.toHaveBeenCalled()
    emit('peer-input', { session: 2, kind: 'move', sample: { x: 0.12349, y: 0.9876 } })
    expect(move).toHaveBeenLastCalledWith({ x: 0.123, y: 0.988, inside: true })
    emit('peer-input', { session: 2, kind: 'move', sample: null })
    expect(move).toHaveBeenLastCalledWith({ x: 0, y: 0, inside: false })
    stopMove()
    emit('peer-input', { session: 2, kind: 'move', sample: { x: 0.5, y: 0.5 } })
    expect(move).toHaveBeenCalledTimes(2)
  })
})
