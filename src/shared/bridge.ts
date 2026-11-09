import type { Bounds } from './coords'
import type {
  DisplayInfo,
  FramePick,
  GhostUpdate,
  HookStatus,
  MarkKind,
  OverlayModel,
  Sample
} from './protocol'

export type PadLaunch = {
  code: string
}

export type UpdateState =
  | { phase: 'unsupported' }
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'available'; version: string }
  | { phase: 'downloading'; version: string; percent: number }
  | { phase: 'ready'; version: string }
  | { phase: 'up-to-date'; version: string }
  | { phase: 'error'; message: string }

export const CH = {
  displays: 'displays:get',
  playGet: 'play:get',
  playUseDisplay: 'play:display',
  playMark: 'play:mark',
  playPick: 'play:pick',
  playPickShot: 'play:pick-shot',
  playPickFinish: 'play:pick-finish',
  playArea: 'play:area',
  playNote: 'play:note',
  playMarking: 'play:marking',
  playRestore: 'play:restore',
  sample: 'input:sample',
  click: 'input:click',
  hook: 'input:hook',
  ghosts: 'overlay:ghosts',
  frame: 'overlay:frame',
  linked: 'link:live',
  overlay: 'overlay:state',
  pad: 'pad:open',
  padClosed: 'pad:closed',
  fit: 'window:fit',
  marksGet: 'marks:get',
  marksSet: 'marks:set',
  marksState: 'marks:state',
  updateGet: 'update:get',
  updateCheck: 'update:check',
  updateInstall: 'update:install',
  updateState: 'update:state'
} as const

export type GhostlinkApi = {
  getDisplays: () => Promise<DisplayInfo[]>
  getPlayArea: () => Promise<Bounds>
  useDisplay: () => Promise<Bounds | null>
  restorePlayArea: (area: Bounds) => Promise<boolean>
  mark: (kind: MarkKind) => Promise<void>
  pickFrame: () => Promise<void>
  pickShot: () => Promise<{ displayId: number; image: string } | null>
  finishPick: (pick: FramePick | null) => Promise<void>
  onPlayArea: (cb: (area: Bounds) => void) => () => void
  onNote: (cb: (note: string | null) => void) => () => void
  onMarking: (cb: (active: boolean) => void) => () => void
  onSample: (cb: (sample: Sample) => void) => () => void
  onClick: (cb: (sample: Sample) => void) => () => void
  onOverlay: (cb: (model: OverlayModel) => void) => () => void
  setGhosts: (ghosts: GhostUpdate[]) => void
  setShowFrame: (show: boolean) => void
  setLinked: (linked: boolean) => void
  fitWindow: (size: { width: number; height: number }) => void
  setGhostMarks: (on: boolean) => void
  ghostMarks: () => Promise<boolean>
  onGhostMarks: (cb: (on: boolean) => void) => () => void
  hookStatus: () => Promise<HookStatus>
  openPad: (launch: PadLaunch) => Promise<void>
  onPadClosed: (cb: () => void) => () => void
  getUpdateState: () => Promise<UpdateState>
  checkForUpdates: () => Promise<void>
  restartAndUpdate: () => Promise<boolean>
  onUpdateState: (cb: (state: UpdateState) => void) => () => void
}
