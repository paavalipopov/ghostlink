import type { Bounds } from './coords'
import type {
  DisplayInfo,
  GhostUpdate,
  HookStatus,
  MarkKind,
  OverlayModel,
  Sample
} from './protocol'

export type PadLaunch = {
  code: string
}

export const CH = {
  displays: 'displays:get',
  playGet: 'play:get',
  playUseDisplay: 'play:display',
  playMark: 'play:mark',
  playArea: 'play:area',
  playNote: 'play:note',
  playMarking: 'play:marking',
  playRestore: 'play:restore',
  sample: 'input:sample',
  click: 'input:click',
  hook: 'input:hook',
  ghosts: 'overlay:ghosts',
  frame: 'overlay:frame',
  overlay: 'overlay:state',
  pad: 'pad:open'
} as const

export type GhostlinkApi = {
  getDisplays: () => Promise<DisplayInfo[]>
  getPlayArea: () => Promise<Bounds>
  useDisplay: (id: number) => Promise<Bounds | null>
  restorePlayArea: (area: Bounds) => Promise<boolean>
  mark: (kind: MarkKind) => Promise<void>
  onPlayArea: (cb: (area: Bounds) => void) => () => void
  onNote: (cb: (note: string | null) => void) => () => void
  onMarking: (cb: (active: boolean) => void) => () => void
  onSample: (cb: (sample: Sample) => void) => () => void
  onClick: (cb: (sample: Sample) => void) => () => void
  onOverlay: (cb: (model: OverlayModel) => void) => () => void
  setGhosts: (ghosts: GhostUpdate[]) => void
  setShowFrame: (show: boolean) => void
  hookStatus: () => Promise<HookStatus>
  openPad: (launch: PadLaunch) => Promise<void>
}
