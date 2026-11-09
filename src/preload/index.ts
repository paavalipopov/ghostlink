import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { CH, type GhostlinkApi, type PadLaunch } from '../shared/bridge'
import type { Bounds } from '../shared/coords'
import type { FramePick, GhostUpdate } from '../shared/protocol'

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T): void => {
    cb(payload)
  }
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api: GhostlinkApi = {
  getDisplays: () => ipcRenderer.invoke(CH.displays),
  getPlayArea: () => ipcRenderer.invoke(CH.playGet),
  useDisplay: () => ipcRenderer.invoke(CH.playUseDisplay),
  restorePlayArea: (area: Bounds) => ipcRenderer.invoke(CH.playRestore, area),
  mark: (kind) => ipcRenderer.invoke(CH.playMark, kind),
  pickFrame: () => ipcRenderer.invoke(CH.playPick),
  pickShot: () => ipcRenderer.invoke(CH.playPickShot),
  finishPick: (pick: FramePick | null) => ipcRenderer.invoke(CH.playPickFinish, pick),
  onPlayArea: (cb) => subscribe(CH.playArea, cb),
  onNote: (cb) => subscribe(CH.playNote, cb),
  onMarking: (cb) => subscribe(CH.playMarking, cb),
  onSample: (cb) => subscribe(CH.sample, cb),
  onClick: (cb) => subscribe(CH.click, cb),
  onOverlay: (cb) => subscribe(CH.overlay, cb),
  setGhosts: (ghosts: GhostUpdate[]) => {
    ipcRenderer.send(CH.ghosts, ghosts)
  },
  setShowFrame: (show) => {
    ipcRenderer.send(CH.frame, show)
  },
  setLinked: (linked) => {
    ipcRenderer.send(CH.linked, linked)
  },
  fitWindow: (size) => {
    ipcRenderer.send(CH.fit, size)
  },
  setGhostMarks: (on) => {
    ipcRenderer.send(CH.marksSet, on)
  },
  ghostMarks: () => ipcRenderer.invoke(CH.marksGet),
  onGhostMarks: (cb) => subscribe(CH.marksState, cb),
  hookStatus: () => ipcRenderer.invoke(CH.hook),
  openPad: (launch: PadLaunch) => ipcRenderer.invoke(CH.pad, launch),
  onPadClosed: (cb) => subscribe(CH.padClosed, cb),
  getUpdateState: () => ipcRenderer.invoke(CH.updateGet),
  checkForUpdates: () => ipcRenderer.invoke(CH.updateCheck),
  restartAndUpdate: () => ipcRenderer.invoke(CH.updateInstall),
  onUpdateState: (cb) => subscribe(CH.updateState, cb)
}

contextBridge.exposeInMainWorld('api', api)
