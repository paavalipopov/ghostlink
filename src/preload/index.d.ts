import type { GhostlinkApi } from '../shared/bridge'

declare global {
  interface Window {
    api: GhostlinkApi
  }
}

export {}
