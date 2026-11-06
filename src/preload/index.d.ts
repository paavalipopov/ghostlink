import { ElectronAPI } from '@electron-toolkit/preload'
import type { GhostlinkApi } from '../shared/bridge'

declare global {
  interface Window {
    electron: ElectronAPI
    api: GhostlinkApi
  }
}

export {}
