import { app, BrowserWindow, clipboard, globalShortcut, ipcMain, screen, shell } from 'electron'
import { join } from 'path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { CH, type PadLaunch } from '../shared/bridge'
import { applyCorner, isInside, normalize, project, quantize, type Bounds } from '../shared/coords'
import type {
  DisplayInfo,
  GhostUpdate,
  MarkKind,
  MarkState,
  OverlayModel
} from '../shared/protocol'
import { windowAtPoint } from './desktop-windows'
import { startPointerWatch } from './input'

if (process.env.GHOSTLINK_DEBUG === '1') {
  app.commandLine.appendSwitch('remote-debugging-port', '9333')
  app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1')
}

let control: BrowserWindow | null = null
let overlay: BrowserWindow | null = null
let pad: BrowserWindow | null = null
let playArea: Bounds = { x: 0, y: 0, width: 800, height: 600 }
let showFrame = true
let ghosts: GhostUpdate[] = []
let mark: MarkState = null
let markToken = 0
let overlayOrigin = { x: 0, y: 0 }

const watch = {
  current: null as ReturnType<typeof startPointerWatch> | null
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function virtualBounds(): Bounds {
  const displays = screen.getAllDisplays()
  if (displays.length === 0) return { x: 0, y: 0, width: 800, height: 600 }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const display of displays) {
    minX = Math.min(minX, display.bounds.x)
    minY = Math.min(minY, display.bounds.y)
    maxX = Math.max(maxX, display.bounds.x + display.bounds.width)
    maxY = Math.max(maxY, display.bounds.y + display.bounds.height)
  }
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY)
  }
}

function sendControl(channel: string, payload: unknown): void {
  if (!control || control.isDestroyed()) return
  control.webContents.send(channel, payload)
}

function layoutOverlay(): void {
  if (!overlay || overlay.isDestroyed()) return
  const bounds = virtualBounds()
  overlayOrigin = { x: bounds.x, y: bounds.y }
  overlay.setBounds(bounds)
}

function pushOverlay(): void {
  if (!overlay || overlay.isDestroyed()) return
  const cursor = screen.getCursorScreenPoint()
  const model: OverlayModel = {
    showFrame,
    frame: {
      x: playArea.x - overlayOrigin.x,
      y: playArea.y - overlayOrigin.y,
      width: playArea.width,
      height: playArea.height
    },
    mark,
    cursor: mark ? { x: cursor.x - overlayOrigin.x, y: cursor.y - overlayOrigin.y } : null,
    ghosts: ghosts.map((ghost) => {
      const gx = ghost.x
      const gy = ghost.y
      const visible = gx != null && gy != null
      const point = visible ? project({ x: gx, y: gy }, playArea) : { x: 0, y: 0 }
      return {
        id: ghost.id,
        name: ghost.name,
        color: typeof ghost.color === 'string' ? ghost.color : '#e2a14a',
        visible,
        x: point.x - overlayOrigin.x,
        y: point.y - overlayOrigin.y,
        pings: ghost.pings.map((ping) => {
          const at = project(ping, playArea)
          return { id: ping.id, x: at.x - overlayOrigin.x, y: at.y - overlayOrigin.y }
        })
      }
    })
  }
  overlay.webContents.send(CH.overlay, model)
}

function publishArea(note: string | null = null): void {
  watch.current?.resync()
  sendControl(CH.playArea, playArea)
  sendControl(CH.playNote, note)
  pushOverlay()
}

function validArea(value: unknown): Bounds | null {
  if (!value || typeof value !== 'object') return null
  const area = value as Bounds
  const numbers = [area.x, area.y, area.width, area.height]
  if (!numbers.every((item) => typeof item === 'number' && Number.isFinite(item))) return null
  if (area.width < 40 || area.height < 40 || area.width > 20000 || area.height > 20000) return null
  return { x: area.x, y: area.y, width: area.width, height: area.height }
}

function sanitizeGhosts(value: unknown): GhostUpdate[] {
  if (!Array.isArray(value)) return []
  const next: GhostUpdate[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const ghost = item as GhostUpdate
    if (typeof ghost.id !== 'string' || typeof ghost.name !== 'string') continue
    const x = typeof ghost.x === 'number' && Number.isFinite(ghost.x) ? ghost.x : null
    const y = typeof ghost.y === 'number' && Number.isFinite(ghost.y) ? ghost.y : null
    const pings = Array.isArray(ghost.pings)
      ? ghost.pings.flatMap((ping) => {
          if (!ping || typeof ping.id !== 'string') return []
          if (typeof ping.x !== 'number' || typeof ping.y !== 'number') return []
          if (!Number.isFinite(ping.x) || !Number.isFinite(ping.y)) return []
          return [{ id: ping.id, x: ping.x, y: ping.y }]
        })
      : []
    next.push({
      id: ghost.id,
      name: ghost.name.slice(0, 40),
      color: typeof ghost.color === 'string' ? ghost.color : '#e2a14a',
      x,
      y,
      pings
    })
  }
  return next
}

async function captureWindow(): Promise<void> {
  const point = screen.dipToScreenPoint(screen.getCursorScreenPoint())
  const result = await windowAtPoint(point.x, point.y)
  if (!result.window) {
    publishArea(result.note)
    return
  }
  const raw = result.window
  const origin = screen.screenToDipPoint({ x: raw.x, y: raw.y })
  const far = screen.screenToDipPoint({ x: raw.x + raw.width, y: raw.y + raw.height })
  playArea = { x: origin.x, y: origin.y, width: far.x - origin.x, height: far.y - origin.y }
  publishArea(result.window.title)
}

async function beginMark(kind: MarkKind): Promise<void> {
  const token = ++markToken
  sendControl(CH.playMarking, true)
  for (const count of [3, 2, 1]) {
    if (token !== markToken) return
    mark = { kind, count }
    pushOverlay()
    await delay(700)
  }
  if (token !== markToken) return
  if (kind === 'window') await captureWindow()
  else {
    playArea = applyCorner(playArea, kind, screen.getCursorScreenPoint())
    publishArea(null)
  }
  mark = null
  sendControl(CH.playMarking, false)
  pushOverlay()
}

function displays(): DisplayInfo[] {
  const primary = screen.getPrimaryDisplay().id
  return screen.getAllDisplays().map((display) => ({
    id: display.id,
    label: display.label || `Display ${display.id}`,
    primary: display.id === primary,
    bounds: {
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height
    }
  }))
}

function preloadPath(): string {
  return join(__dirname, '../preload/index.js')
}

function loadPage(win: BrowserWindow, page: string): void {
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/${page}`)
  } else {
    void win.loadFile(join(__dirname, '../renderer', page))
  }
}

function createControl(): void {
  control = new BrowserWindow({
    width: 440,
    height: 980,
    minWidth: 380,
    minHeight: 560,
    show: false,
    autoHideMenuBar: true,
    title: 'Ghostlink',
    backgroundColor: '#141210',
    icon,
    webPreferences: {
      preload: preloadPath(),
      sandbox: false
    }
  })

  control.on('ready-to-show', () => {
    control?.show()
    control?.setAlwaysOnTop(true, 'floating')
  })

  control.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  control.on('closed', () => {
    control = null
    app.quit()
  })

  loadPage(control, 'index.html')
}

function createOverlay(): void {
  const bounds = virtualBounds()
  overlayOrigin = { x: bounds.x, y: bounds.y }
  overlay = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    focusable: false,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    hasShadow: false,
    roundedCorners: false,
    title: 'Ghostlink overlay',
    webPreferences: {
      preload: preloadPath(),
      sandbox: false
    }
  })
  overlay.setIgnoreMouseEvents(true)
  overlay.setAlwaysOnTop(true, 'screen-saver')
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  overlay.on('ready-to-show', () => {
    overlay?.showInactive()
    pushOverlay()
  })
  overlay.on('closed', () => {
    overlay = null
  })
  loadPage(overlay, 'overlay.html')
}

function openPad(launch: PadLaunch): void {
  const params = new URLSearchParams({
    code: launch.code,
    relay: launch.relayUrl,
    turn: launch.turnUrl,
    turnUser: launch.turnUsername,
    turnPass: launch.turnCredential
  })
  const page = `pad.html?${params.toString()}`
  if (pad && !pad.isDestroyed()) {
    loadPage(pad, page)
    pad.focus()
    return
  }
  pad = new BrowserWindow({
    width: 720,
    height: 520,
    minWidth: 480,
    minHeight: 360,
    title: 'Ghostlink test seat',
    backgroundColor: '#141210',
    autoHideMenuBar: true,
    icon,
    webPreferences: {
      preload: preloadPath(),
      sandbox: false
    }
  })
  pad.on('closed', () => {
    pad = null
  })
  loadPage(pad, page)
}

function registerIpc(): void {
  ipcMain.handle(CH.displays, () => displays())
  ipcMain.handle(CH.playGet, () => playArea)
  ipcMain.handle(CH.playUseDisplay, (_event, id: number) => {
    const display = screen.getAllDisplays().find((item) => item.id === id)
    if (!display) return null
    playArea = {
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height
    }
    publishArea(null)
    return playArea
  })
  ipcMain.handle(CH.playRestore, (_event, area: unknown) => {
    const next = validArea(area)
    if (!next) return false
    playArea = next
    publishArea(null)
    return true
  })
  ipcMain.handle(CH.playMark, async (_event, kind: MarkKind) => {
    await beginMark(kind)
  })
  ipcMain.handle(CH.hook, () => watch.current?.status ?? { live: false, detail: 'Not ready' })
  ipcMain.handle(CH.pad, (_event, launch: PadLaunch) => {
    if (!launch || typeof launch.code !== 'string') return
    openPad({
      code: launch.code,
      relayUrl: typeof launch.relayUrl === 'string' ? launch.relayUrl : '',
      turnUrl: typeof launch.turnUrl === 'string' ? launch.turnUrl : '',
      turnUsername: typeof launch.turnUsername === 'string' ? launch.turnUsername : '',
      turnCredential: typeof launch.turnCredential === 'string' ? launch.turnCredential : ''
    })
  })
  ipcMain.handle(CH.copy, (_event, text: string) => {
    clipboard.writeText(String(text ?? ''))
  })
  ipcMain.on(CH.ghosts, (event, payload: unknown) => {
    if (event.sender.id !== control?.webContents.id) return
    ghosts = sanitizeGhosts(payload)
    pushOverlay()
  })
  ipcMain.on(CH.frame, (event, show: boolean) => {
    if (event.sender.id !== control?.webContents.id) return
    showFrame = Boolean(show)
    pushOverlay()
  })
  ipcMain.on(CH.ontop, (event, on: boolean) => {
    if (event.sender.id !== control?.webContents.id) return
    control?.setAlwaysOnTop(Boolean(on), 'floating')
  })
}

function registerShortcuts(hookLive: boolean): void {
  globalShortcut.register('Control+Alt+1', () => {
    playArea = applyCorner(playArea, 'top-left', screen.getCursorScreenPoint())
    publishArea(null)
  })
  globalShortcut.register('Control+Alt+2', () => {
    playArea = applyCorner(playArea, 'bottom-right', screen.getCursorScreenPoint())
    publishArea(null)
  })
  if (!hookLive) {
    globalShortcut.register('Control+Alt+P', () => {
      const normalized = normalize(screen.getCursorScreenPoint(), playArea)
      if (!isInside(normalized)) return
      sendControl(CH.click, {
        x: quantize(normalized.x),
        y: quantize(normalized.y),
        inside: true
      })
    })
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('app.ghostlink.desktop')
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  playArea = {
    x: screen.getPrimaryDisplay().bounds.x,
    y: screen.getPrimaryDisplay().bounds.y,
    width: screen.getPrimaryDisplay().bounds.width,
    height: screen.getPrimaryDisplay().bounds.height
  }

  registerIpc()
  createControl()
  createOverlay()

  watch.current = startPointerWatch({
    getArea: () => playArea,
    isMarking: () => mark !== null,
    onSample: (sample) => sendControl(CH.sample, sample),
    onClick: (sample) => sendControl(CH.click, sample),
    onCursor: () => pushOverlay()
  })
  registerShortcuts(watch.current.status.live)

  screen.on('display-metrics-changed', () => {
    layoutOverlay()
    pushOverlay()
  })
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  watch.current?.stop()
})

app.on('window-all-closed', () => {
  app.quit()
})
