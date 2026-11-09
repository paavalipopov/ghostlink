import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type JSX } from 'react'
import { version } from '../../../package.json'
import type { UpdateState } from '../../shared/bridge'
import type { Bounds } from '../../shared/coords'
import { codeIsStrong, makeCode, makePingId } from '../../shared/protocol'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { useGhostLink, type LinkPhase, type LinkSettings } from './link'
import { StatusDot } from './StatusDot'
import {
  GhostMark,
  IconDice,
  IconBug,
  IconDrag,
  IconFullScreen,
  IconWindow,
  IconUpdate
} from './icons'

function stored(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}

function remember(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Private mode can reject storage. The session still works.
  }
}

const NAMES = [
  'Ada',
  'Nico',
  'Remy',
  'Jules',
  'Sasha',
  'Quinn',
  'Milo',
  'Noor',
  'Alex',
  'Sam',
  'Rin',
  'Kai'
]

function makeName(): string {
  return NAMES[Math.floor(Math.random() * NAMES.length)]
}

const LISTEN_MS = 60_000

function releaseMark(value: string): string {
  const [major, minor] = value.split('.')
  return major && minor != null && minor !== '' ? `${major}.${minor}` : value
}

function remainLabel(until: number, now: number): string {
  const seconds = Math.min(60, Math.max(1, Math.ceil((until - now) / 1000)))
  const minute = Math.floor(seconds / 60)
  const rest = seconds % 60
  return `${minute}:${rest.toString().padStart(2, '0')}`
}

function monitorState(active: boolean, phase: LinkPhase): 'idle' | 'wait' | 'live' | 'error' {
  if (!active) return 'idle'
  if (phase === 'linked') return 'live'
  if (phase === 'error') return 'error'
  return 'wait'
}

function monitorTitle(state: 'idle' | 'wait' | 'live' | 'error', detail: string): string {
  if (state === 'live') return 'Connected'
  if (state === 'wait') return 'Connecting'
  if (state === 'error') return detail || 'Could not connect'
  return 'Disconnected'
}

function updatePresentation(state: UpdateState): {
  status: string
  action: string
  busy: boolean
} {
  switch (state.phase) {
    case 'checking':
      return { status: 'Checking for updates', action: 'Checking for updates', busy: true }
    case 'available':
      return { status: `Version ${state.version} found`, action: 'Downloading update', busy: true }
    case 'downloading':
      return {
        status: `Downloading version ${state.version}`,
        action: `Downloading update: ${state.percent}%`,
        busy: true
      }
    case 'ready':
      return {
        status: `Version ${state.version} is ready`,
        action: 'Restart and update',
        busy: false
      }
    case 'up-to-date':
      return {
        status: `Version ${state.version} is current`,
        action: 'Check for updates',
        busy: false
      }
    case 'error':
      return { status: state.message, action: 'Retry update check', busy: false }
    default:
      return { status: 'Application updates', action: 'Check for updates', busy: false }
  }
}

function App(): JSX.Element {
  const [name, setName] = useState(() => stored('ghostlink.name', ''))
  const [code, setCode] = useState(() => stored('ghostlink.code', ''))
  const [monitoring, setMonitoring] = useState(false)
  const [ghostMarks, setGhostMarks] = useState(false)
  useEffect(() => {
    let gone = false
    void window.api.ghostMarks().then((value) => {
      if (!gone) setGhostMarks(value)
    })
    return () => {
      gone = true
    }
  }, [])
  const [listenUntil, setListenUntil] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [marking, setMarking] = useState(false)
  const [panelReady, setPanelReady] = useState(false)
  const [sessionCode, setSessionCode] = useState('')
  const [testCode, setTestCode] = useState('')
  const [updateState, setUpdateState] = useState<UpdateState>({ phase: 'unsupported' })

  useEffect(() => {
    let gone = false
    const stop = window.api.onUpdateState((next) => {
      if (!gone) setUpdateState(next)
    })
    void window.api.getUpdateState().then((next) => {
      if (!gone) setUpdateState(next)
    })
    return () => {
      gone = true
      stop()
    }
  }, [])

  const settings: LinkSettings = { code: sessionCode }
  const link = useGhostLink(monitoring, settings)
  const testLink = useGhostLink(Boolean(testCode), { code: testCode })
  const { publishMove, publishPing } = link
  const enabled = useRef(false)
  const nameRef = useRef('Friend')
  const panelRef = useRef<HTMLElement>(null)
  const fitted = useRef(false)

  useEffect(() => {
    enabled.current = monitoring
  }, [monitoring])

  useEffect(() => window.api.onPadClosed(() => setTestCode('')), [])

  useEffect(() => {
    const raw = stored('ghostlink.areaPx', '')
    if (raw) {
      try {
        void window.api.restorePlayArea(JSON.parse(raw) as Bounds)
      } catch {
        // Ignore a damaged saved rectangle.
      }
    }
    setPanelReady(true)
    void window.api.setShowFrame(true)
    const offArea = window.api.onPlayArea((next) => {
      remember('ghostlink.areaPx', JSON.stringify(next))
    })
    const offMarking = window.api.onMarking(setMarking)
    const offSample = window.api.onSample((sample) => {
      if (!enabled.current) return
      publishMove({
        name: nameRef.current,
        x: sample.inside ? sample.x : null,
        y: sample.inside ? sample.y : null
      })
    })
    const offClick = window.api.onClick((sample) => {
      if (!enabled.current || !sample.inside) return
      publishPing({
        name: nameRef.current,
        x: sample.x,
        y: sample.y,
        id: makePingId()
      })
    })
    return () => {
      offArea()
      offMarking()
      offSample()
      offClick()
    }
  }, [publishMove, publishPing])

  useEffect(() => {
    if (!monitoring) return
    publishMove({ name: nameRef.current, x: null, y: null })
  }, [monitoring, publishMove])

  useEffect(() => {
    const ghosts = { ...(monitoring ? link.ghosts : {}), ...(testCode ? testLink.ghosts : {}) }
    const payload = Object.entries(ghosts).map(([id, ghost]) => ({
      id,
      name: ghost.name,
      color: ghost.color,
      x: ghost.x,
      y: ghost.y,
      pings: ghost.pings.map((ping) => ({ id: ping.id, x: ping.x, y: ping.y }))
    }))
    window.api.setGhosts(payload)
  }, [monitoring, link.ghosts, testCode, testLink.ghosts])

  const codeOk = codeIsStrong(code)
  const formOk = codeOk && name.trim().length > 0
  const linked = monitoring && link.phase === 'linked'
  const dot = monitorState(monitoring, link.phase)
  const dotTitle = monitorTitle(dot, link.detail)
  const update = updatePresentation(updateState)
  const updateAvailable =
    updateState.phase === 'available' ||
    updateState.phase === 'downloading' ||
    updateState.phase === 'ready'

  useEffect(() => {
    window.api.setLinked(linked)
  }, [linked])

  useEffect(() => {
    if (!monitoring || linked) setListenUntil(null)
  }, [monitoring, linked])

  useEffect(() => {
    if (listenUntil == null) return
    const tick = (): void => {
      const remaining = listenUntil - Date.now()
      if (remaining <= 0) {
        setListenUntil(null)
        setMonitoring(false)
        return
      }
      setNow(Date.now())
    }
    tick()
    const timer = setInterval(tick, 200)
    return () => clearInterval(timer)
  }, [listenUntil])

  const layoutWidth = 300
  const [layoutReady, setLayoutReady] = useState(false)
  const [zoom, setZoom] = useState(1)
  useLayoutEffect(() => {
    if (!panelReady) return
    let cancel = false
    void document.fonts.ready.then(() => {
      if (cancel) return
      setLayoutReady(true)
    })
    return () => {
      cancel = true
    }
  }, [panelReady])

  useLayoutEffect(() => {
    if (!layoutReady || fitted.current) return
    const node = panelRef.current
    if (!node) return
    const rect = node.getBoundingClientRect()
    const width = Math.ceil(rect.width)
    const height = Math.ceil(rect.height)
    if (width < 240 || height < 200) return
    fitted.current = true
    window.api.fitWindow({ width, height })
    const started = window.setInterval(() => {
      const gapW = window.innerWidth / width
      const gapH = window.innerHeight / height
      if (Math.abs(gapW - gapH) > 0.04 || Math.min(gapW, gapH) < 0.98) return
      window.clearInterval(started)
      const gap = Math.min(gapW, gapH)
      if (gap > 1.04) setZoom(Math.round(gap * 100) / 100)
    }, 30)
    window.setTimeout(() => window.clearInterval(started), 1000)
  }, [layoutReady, layoutWidth])

  const beginListen = (): void => {
    nameRef.current = name.trim() || 'Friend'
    setSessionCode(code.trim())
    const started = Date.now()
    setNow(started)
    setListenUntil(started + LISTEN_MS)
    setMonitoring(true)
  }

  return (
    <main
      ref={panelRef}
      className="box-border flex flex-col gap-2.5 px-3 py-3"
      style={{ width: layoutWidth, zoom } as CSSProperties}
    >
      <header className="flex items-center justify-center">
        <h1 data-testid="app-title" className="relative text-2xl font-semibold tracking-tight">
          <button
            type="button"
            data-testid="ghost-toggle"
            aria-pressed={ghostMarks}
            aria-label="Ghost pointers"
            className="absolute right-full top-1/2 m-0 mr-2 -translate-y-1/2 cursor-default border-0 bg-transparent p-0 leading-none"
            onClick={() => {
              const next = !ghostMarks
              setGhostMarks(next)
              window.api.setGhostMarks(next)
            }}
          >
            <GhostMark />
          </button>
          Ghostlink
          <sup
            data-testid="app-version"
            className="pointer-events-none absolute left-full top-[0.15em] ml-0.5 text-[0.5em] font-semibold leading-none tracking-normal"
          >
            {releaseMark(version)}
          </sup>
        </h1>
      </header>

      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Input
            id="name"
            className="pr-8"
            data-testid="name-input"
            value={name}
            placeholder="username"
            aria-label="username"
            onChange={(event) => {
              setName(event.target.value)
              remember('ghostlink.name', event.target.value)
            }}
          />
          <button
            type="button"
            data-testid="random-name"
            title="Pick a name"
            aria-label="Pick a name"
            className="absolute inset-y-0 right-0 flex w-8 items-center justify-center border-0 bg-transparent p-0 text-muted-foreground hover:text-foreground focus-visible:outline-none"
            onClick={() => {
              const next = makeName()
              setName(next)
              remember('ghostlink.name', next)
            }}
          >
            <IconDice />
          </button>
        </div>
        <StatusDot state={dot} title={dotTitle} />
      </div>

      <div className="relative">
        <Input
          id="code"
          className="pr-8"
          data-testid="code-input"
          value={code}
          placeholder="secret"
          aria-label="secret"
          onChange={(event) => {
            setCode(event.target.value)
            remember('ghostlink.code', event.target.value)
          }}
        />
        <button
          type="button"
          data-testid="new-code"
          title="Make a code"
          aria-label="Make a code"
          className="absolute inset-y-0 right-0 flex w-8 items-center justify-center border-0 bg-transparent p-0 text-muted-foreground hover:text-foreground focus-visible:outline-none"
          onClick={() => {
            const next = makeCode()
            setCode(next)
            remember('ghostlink.code', next)
          }}
        >
          <IconDice />
        </button>
      </div>

      <Button
        type="button"
        className="group w-full bg-[#3dbe6a] text-[#1a140c] hover:bg-[#349e59]"
        data-testid="connect"
        data-mode={linked ? 'live' : monitoring ? 'listen' : 'idle'}
        title={
          linked
            ? 'Disconnect'
            : monitoring
              ? 'Stop waiting'
              : 'Connect with this code for one minute'
        }
        aria-label={linked || monitoring ? 'Disconnect' : 'Connect'}
        disabled={!monitoring && !formOk}
        onClick={() => {
          if (monitoring) {
            setMonitoring(false)
            return
          }
          beginListen()
        }}
      >
        {linked ? (
          <>
            <span className="group-hover:hidden">Connected</span>
            <span className="hidden group-hover:inline">Disconnect</span>
          </>
        ) : monitoring ? (
          <>
            <span>Disconnect</span>
            {listenUntil != null && (
              <span data-testid="countdown" className="tabular-nums">
                {remainLabel(listenUntil, now)}
              </span>
            )}
          </>
        ) : (
          'Connect'
        )}
      </Button>

      <div data-testid="section-rule" className="h-px bg-[#8a8378]" />

      <section className="space-y-2.5">
        <h2 className="text-center text-sm font-medium">Shared display</h2>
        <div className="grid grid-cols-2 gap-1.5">
          <Button
            type="button"
            variant="secondary"
            className="px-2"
            title="Point at a window and wait through the countdown. The frame matches that window."
            disabled={marking}
            data-testid="mark-window"
            onClick={() => void window.api.mark('window')}
          >
            <IconWindow />
            Pick window
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="px-2"
            data-testid="drag-frame"
            title="Click and drag across to select a custom rectangular frame."
            disabled={marking}
            onClick={() => void window.api.pickFrame()}
          >
            <IconDrag />
            Drag frame
          </Button>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="ghost"
            className={`size-9 shrink-0 rounded-full border border-border px-0 disabled:opacity-100 ${
              updateState.phase === 'unsupported' ? 'invisible' : ''
            } ${
              updateAvailable
                ? 'border-[#3dbe6a] bg-[#3dbe6a] text-[#1a140c] hover:bg-[#349e59]'
                : 'bg-background text-foreground'
            } ${updateState.phase === 'up-to-date' ? 'opacity-50 hover:opacity-100' : ''}`}
            data-testid="update-action"
            data-state={updateState.phase}
            title={`${update.status}. ${update.action}`}
            aria-label={update.action}
            aria-busy={update.busy}
            aria-hidden={updateState.phase === 'unsupported'}
            disabled={update.busy || updateState.phase === 'unsupported'}
            onClick={() => {
              if (updateState.phase === 'ready') {
                void window.api.restartAndUpdate()
                return
              }
              void window.api.checkForUpdates()
            }}
          >
            <IconUpdate />
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="min-w-0 flex-1 px-2"
            title="Frame this whole display"
            disabled={marking}
            data-testid="full-screen"
            onClick={() => void window.api.useDisplay()}
          >
            <IconFullScreen />
            Full Screen
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="size-9 shrink-0 rounded-full border border-border px-0"
            style={{ background: 'var(--background)', color: 'var(--foreground)' }}
            data-testid="open-pad"
            title="Test run"
            aria-label="Test run"
            onClick={() => {
              const next = testCode || makeCode()
              setTestCode(next)
              void window.api.openPad({ code: next }).catch(() => setTestCode(''))
            }}
          >
            <IconBug />
          </Button>
        </div>
        <span className="sr-only" role="status">
          {update.status}
        </span>
      </section>
    </main>
  )
}

export default App
