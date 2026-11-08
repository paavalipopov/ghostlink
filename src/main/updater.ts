import { app } from 'electron'
import { autoUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater'
import type { UpdateState } from '../shared/bridge'

export type UpdateController = {
  getState: () => UpdateState
  check: () => Promise<void>
  restartAndInstall: () => boolean
  start: () => void
  dispose: () => void
}

const AUTO_CHECK_DELAY_MS = 8_000

export function createUpdateController(publish: (state: UpdateState) => void): UpdateController {
  const supported = app.isPackaged && process.platform === 'win32'
  let state: UpdateState = supported ? { phase: 'idle' } : { phase: 'unsupported' }
  let targetVersion = app.getVersion()
  let autoCheck: NodeJS.Timeout | null = null

  const setState = (next: UpdateState): void => {
    state = next
    publish(next)
  }

  const onChecking = (): void => setState({ phase: 'checking' })
  const onAvailable = (info: UpdateInfo): void => {
    targetVersion = info.version
    setState({ phase: 'available', version: info.version })
  }
  const onNotAvailable = (): void => {
    setState({ phase: 'up-to-date', version: app.getVersion() })
  }
  const onProgress = (progress: ProgressInfo): void => {
    const percent = Math.min(100, Math.max(0, Math.round(progress.percent)))
    setState({ phase: 'downloading', version: targetVersion, percent })
  }
  const onDownloaded = (info: UpdateInfo): void => {
    targetVersion = info.version
    setState({ phase: 'ready', version: info.version })
  }
  const onError = (error: Error): void => {
    console.error('Ghostlink update failed:', error)
    setState({ phase: 'error', message: 'Could not check for updates' })
  }

  if (supported) {
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = false
    autoUpdater.allowPrerelease = false
    autoUpdater.on('checking-for-update', onChecking)
    autoUpdater.on('update-available', onAvailable)
    autoUpdater.on('update-not-available', onNotAvailable)
    autoUpdater.on('download-progress', onProgress)
    autoUpdater.on('update-downloaded', onDownloaded)
    autoUpdater.on('error', onError)
  }

  const check = async (): Promise<void> => {
    if (!supported) return
    if (
      state.phase === 'checking' ||
      state.phase === 'available' ||
      state.phase === 'downloading' ||
      state.phase === 'ready'
    ) {
      return
    }
    setState({ phase: 'checking' })
    try {
      await autoUpdater.checkForUpdates()
    } catch (error) {
      if (state.phase !== 'error') {
        onError(error instanceof Error ? error : new Error('Unknown update error'))
      }
    }
  }

  const restartAndInstall = (): boolean => {
    if (!supported || state.phase !== 'ready') return false
    setTimeout(() => autoUpdater.quitAndInstall(false, true), 0)
    return true
  }

  const start = (): void => {
    if (!supported || autoCheck) return
    autoCheck = setTimeout(() => {
      autoCheck = null
      void check()
    }, AUTO_CHECK_DELAY_MS)
  }

  const dispose = (): void => {
    if (autoCheck) clearTimeout(autoCheck)
    autoCheck = null
    if (!supported) return
    autoUpdater.removeListener('checking-for-update', onChecking)
    autoUpdater.removeListener('update-available', onAvailable)
    autoUpdater.removeListener('update-not-available', onNotAvailable)
    autoUpdater.removeListener('download-progress', onProgress)
    autoUpdater.removeListener('update-downloaded', onDownloaded)
    autoUpdater.removeListener('error', onError)
  }

  return {
    getState: () => state,
    check,
    restartAndInstall,
    start,
    dispose
  }
}
