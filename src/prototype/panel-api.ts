import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { PanelApi } from '@renderer/App'
import type { UpdateState } from '../shared/bridge'
import { quantize, type Bounds } from '../shared/coords'
import type { Sample } from '../shared/protocol'

type Display = { name: string; bounds: Bounds; scaleFactor: number; primary: boolean }
export type Controls = {
  appVersion: string
  displays: Display[]
  desktopAreas: boolean
  pickWindow: boolean
}
type AreaChange = { area: Bounds | null; error: string | null }
type PeerInput = { kind: 'move' | 'click'; session: number; sample: Sample | null }

function subscribe<T>(event: string, callback: (payload: T) => void): () => void {
  let active = true
  const subscription = listen<T>(event, ({ payload }) => {
    if (active) callback(payload)
  })
  void subscription.catch(console.error)
  return () => {
    active = false
    void subscription.then(
      (stop) => stop(),
      () => undefined
    )
  }
}

type PanelBridge = { api: PanelApi; selectDisplay: (display: Display | undefined) => void }

export function createPanelApi(
  controls: Controls,
  report: (note: string | null) => void
): PanelBridge {
  let preferred: Display | undefined
  let currentArea: Bounds | null = null
  let marks = false
  let marking = false
  let sequence = 0
  let session: number | null = null
  const areaListeners = new Set<(area: Bounds) => void>()
  const markingListeners = new Set<(active: boolean) => void>()

  function displayForArea(): Display | undefined {
    const area = currentArea
    return (
      preferred ??
      (area &&
        controls.displays.find(
          ({ bounds }) =>
            area.x >= bounds.x &&
            area.y >= bounds.y &&
            area.x + area.width <= bounds.x + bounds.width &&
            area.y + area.height <= bounds.y + bounds.height
        )) ??
      controls.displays.find((display) => display.primary) ??
      controls.displays[0]
    )
  }

  function setMarking(active: boolean): void {
    marking = active
    markingListeners.forEach((listener) => listener(active))
  }

  function apply({ area, error }: AreaChange): Bounds | null {
    report(error)
    currentArea = area
    if (area) areaListeners.forEach((listener) => listener(area))
    return area
  }

  function onInput(kind: PeerInput['kind'], callback: (sample: Sample) => void): () => void {
    return subscribe<PeerInput>('peer-input', (input) => {
      if (session !== input.session || input.kind !== kind) return
      const sample = input.sample
      callback(
        sample
          ? { x: quantize(sample.x), y: quantize(sample.y), inside: true }
          : { x: 0, y: 0, inside: false }
      )
    })
  }

  async function selectDisplayArea(): Promise<Bounds | null> {
    const selected = displayForArea()
    if (!selected || !controls.desktopAreas) return null
    try {
      return apply(await invoke<AreaChange>('select_display', { bounds: selected.bounds }))
    } catch (error) {
      report(String(error))
      return null
    }
  }

  const api: PanelApi = {
    ghostMarks: async () => marks,
    setGhostMarks(enabled) {
      marks = enabled
      void invoke('set_ghost_marks', { enabled }).catch(console.error)
    },
    async restorePlayArea(bounds) {
      if (!controls.desktopAreas) return false
      try {
        return apply(await invoke<AreaChange>('restore_area', { bounds })) !== null
      } catch {
        return false
      }
    },
    setShowFrame(show) {
      if (show && !currentArea) void selectDisplayArea()
    },
    onPlayArea(callback) {
      areaListeners.add(callback)
      const stop = subscribe<AreaChange>('area-change', (change) => {
        apply(change)
        setMarking(false)
      })
      return () => {
        stop()
        areaListeners.delete(callback)
      }
    },
    onMarking(callback) {
      markingListeners.add(callback)
      return () => {
        markingListeners.delete(callback)
      }
    },
    onSample: (callback) => onInput('move', callback),
    onClick: (callback) => onInput('click', callback),
    setSharing(active) {
      const next = active ? ++sequence : null
      if (session === next) return
      session = next
      report(null)
      void invoke<string | null>('set_peer_sharing', { session: next }).then(
        (warning) => {
          if (session === next && warning) report(warning)
        },
        (error) => {
          if (session === next) report(String(error))
        }
      )
    },
    setGhosts(ghosts) {
      if (session === null) return
      const pointers = ghosts.flatMap(({ id, name, color, x, y, pings }) =>
        x === null || y === null
          ? []
          : [{ id, name, color, x, y, clickKey: pings.at(-1)?.id ?? null }]
      )
      void invoke('show_peer_pointers', { session, pointers }).catch(console.error)
    },
    fitWindow(size) {
      void invoke('fit_panel', size).catch(console.error)
    },
    async mark(kind) {
      if (kind !== 'window' || !controls.pickWindow || marking) return
      setMarking(true)
      report(null)
      try {
        await invoke('prepare_pick_marker')
        for (const count of [3, 2, 1]) {
          await invoke('set_pick_count', { count })
          await new Promise((done) => window.setTimeout(done, 700))
        }
        apply(await invoke<AreaChange>('select_window'))
      } catch (error) {
        report(String(error))
      } finally {
        void invoke('set_pick_count', { count: null }).catch(console.error)
        setMarking(false)
      }
    },
    async pickFrame() {
      const selected = displayForArea()
      if (!selected || !controls.desktopAreas || marking) return
      setMarking(true)
      report(null)
      try {
        await invoke('begin_drag', { bounds: selected.bounds })
      } catch (error) {
        report(String(error))
        setMarking(false)
      }
    },
    useDisplay: selectDisplayArea,
    async openPad({ code }) {
      try {
        await invoke('open_test_pad', { code })
      } catch (error) {
        report(String(error))
        throw error
      }
    },
    onPadClosed: (callback) => subscribe('test-pad-closed', callback),
    getUpdateState: () => invoke<UpdateState>('get_update_state'),
    onUpdateState: (callback) => subscribe<UpdateState>('update-state', callback),
    checkForUpdates: () => invoke('check_for_updates'),
    restartAndUpdate: () => invoke('restart_and_update')
  }

  return {
    api,
    selectDisplay(display) {
      preferred = display
    }
  }
}
