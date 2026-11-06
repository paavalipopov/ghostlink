import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { CH, type GhostlinkApi, type PadLaunch } from '../shared/bridge'
import type { Bounds } from '../shared/coords'
import type { GhostUpdate } from '../shared/protocol'

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
  useDisplay: (id) => ipcRenderer.invoke(CH.playUseDisplay, id),
  restorePlayArea: (area: Bounds) => ipcRenderer.invoke(CH.playRestore, area),
  mark: (kind) => ipcRenderer.invoke(CH.playMark, kind),
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
  setPanelOnTop: (on) => {
    ipcRenderer.send(CH.ontop, on)
  },
  hookStatus: () => ipcRenderer.invoke(CH.hook),
  openPad: (launch: PadLaunch) => ipcRenderer.invoke(CH.pad, launch),
  copyText: (text) => ipcRenderer.invoke(CH.copy, text)
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-expect-error window is augmented in the renderer
  window.electron = electronAPI
  // @ts-expect-error window is augmented in the renderer
  window.api = api
}
