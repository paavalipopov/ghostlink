import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type JSX } from 'react'
import { version } from '../../../package.json'
import type { Bounds } from '../../shared/coords'
import {
  ERROR_COLOR,
  IDLE_RING,
  LIVE_COLOR,
  codeIsStrong,
  makeCode,
  makePingId,
  type DisplayInfo
} from '../../shared/protocol'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { useGhostLink, type LinkPhase, type LinkSettings } from './link'
import {
  GhostMark,
  IconDice,
  IconBug,
  IconDrag,
  IconFullScreen,
  IconWindow
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

function displayLabel(display: DisplayInfo): string {
  return `${display.bounds.width}×${display.bounds.height}${display.primary ? ' · main' : ''} · ${display.label}`
}

function panelWidth(items: DisplayInfo[]): number {
  const canvas = document.createElement('canvas')
  const pen = canvas.getContext('2d')
  if (!pen) return 300
  pen.font = '14px Segoe UI'
  const text = items.reduce(
    (max, display) => Math.max(max, pen.measureText(displayLabel(display)).width),
    0
  )
  return Math.min(420, Math.max(300, Math.ceil(text) + 84))
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

function LinkDot({
  state,
  title
}: {
  state: 'idle' | 'wait' | 'live' | 'error'
  title: string
}): JSX.Element {
  if (state === 'wait') {
    return (
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center">
        <span
          data-testid="monitor"
          data-state={state}
          title={title}
          aria-label={title}
          className="link-wait inline-block size-7 rounded-full border-2"
        />
      </span>
    )
  }
  const color = state === 'live' ? LIVE_COLOR : state === 'error' ? ERROR_COLOR : 'transparent'
  const border = state === 'idle' ? IDLE_RING : color
  return (
    <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center">
      <span
        data-testid="monitor"
        data-state={state}
        title={title}
        aria-label={title}
        className="inline-block size-7 rounded-full border-2"
        style={{ background: color, borderColor: border }}
      />
    </span>
  )
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
  const [displays, setDisplays] = useState<DisplayInfo[]>([])
  const [displayId, setDisplayId] = useState<number | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [marking, setMarking] = useState(false)
  const [panelReady, setPanelReady] = useState(false)
  const [sessionCode, setSessionCode] = useState('')

  const settings: LinkSettings = { code: sessionCode }
  const link = useGhostLink(monitoring, settings)
  const { publishMove, publishPing } = link
  const enabled = useRef(false)
  const nameRef = useRef('Friend')
  const panelRef = useRef<HTMLElement>(null)
  const fitted = useRef(false)

  useEffect(() => {
    enabled.current = monitoring
  }, [monitoring])

  useEffect(() => {
    const raw = stored('ghostlink.areaPx', '')
    if (raw) {
      try {
        void window.api.restorePlayArea(JSON.parse(raw) as Bounds)
      } catch {
        // Ignore a damaged saved rectangle.
      }
    }
    void window.api
      .getDisplays()
      .then((items) => {
        setDisplays(items)
        setDisplayId(
          (current) => current ?? items.find((item) => item.primary)?.id ?? items[0]?.id ?? null
        )
      })
      .finally(() => setPanelReady(true))
    void window.api.setShowFrame(true)
    const offArea = window.api.onPlayArea((next) => {
      remember('ghostlink.areaPx', JSON.stringify(next))
    })
    const offNote = window.api.onNote(setNote)
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
      offNote()
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
    if (!monitoring) {
      window.api.setGhosts([])
      return
    }
    const payload = Object.entries(link.ghosts).map(([id, ghost]) => ({
      id,
      name: ghost.name,
      color: ghost.color,
      x: ghost.x,
      y: ghost.y,
      pings: ghost.pings.map((ping) => ({ id: ping.id, x: ping.x, y: ping.y }))
    }))
    window.api.setGhosts(payload)
  }, [monitoring, link.ghosts])

  const codeOk = codeIsStrong(code)
  const formOk = codeOk && name.trim().length > 0
  const linked = monitoring && link.phase === 'linked'
  const dot = monitorState(monitoring, link.phase)
  const dotTitle = monitorTitle(dot, link.detail)

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

  const [layoutWidth, setLayoutWidth] = useState(300)
  const [layoutReady, setLayoutReady] = useState(false)
  const [zoom, setZoom] = useState(1)
  useLayoutEffect(() => {
    if (!panelReady) return
    let cancel = false
    void document.fonts.ready.then(() => {
      if (cancel) return
      setLayoutWidth(panelWidth(displays))
      setLayoutReady(true)
    })
    return () => {
      cancel = true
    }
  }, [panelReady, displays])

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

  const chosen = displays.find((item) => item.id === displayId)
  const displayTitle = chosen ? displayLabel(chosen) : 'Screen the game is on'

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
        <LinkDot state={dot} title={dotTitle} />
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
        <select
          id="display"
          aria-label="Shared display"
          title={displayTitle}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
          value={displayId ?? ''}
          onChange={(event) => setDisplayId(Number(event.target.value))}
        >
          {displays.map((display) => (
            <option key={display.id} value={display.id}>
              {displayLabel(display)}
            </option>
          ))}
        </select>
        <div className="grid grid-cols-2 gap-1.5">
          <Button
            type="button"
            variant="secondary"
            className="px-2"
            title="Frame this whole display"
            disabled={displayId == null || marking}
            data-testid="full-screen"
            onClick={() => {
              if (displayId == null) return
              void window.api.useDisplay(displayId)
            }}
          >
            <IconFullScreen />
            Full Screen
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="px-2"
            data-testid="drag-frame"
            title="Click and drag across to select a custom rectangular frame."
            disabled={displayId == null || marking}
            onClick={() => {
              if (displayId == null) return
              void window.api.pickFrame(displayId)
            }}
          >
            <IconDrag />
            Drag frame
          </Button>
        </div>
        <div className="flex gap-1.5">
          <Button
            type="button"
            variant="secondary"
            className="min-w-0 flex-1 px-2"
            title="Point at the game, then click. The frame matches that window."
            disabled={marking}
            data-testid="mark-window"
            onClick={() => void window.api.mark('window')}
          >
            <IconWindow />
            Target window
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="size-9 shrink-0 rounded-full border border-border px-0"
            style={{ background: 'var(--background)', color: 'var(--foreground)' }}
            data-testid="open-pad"
            title="Test run"
            aria-label="Test run"
            disabled={!codeOk}
            onClick={() => void window.api.openPad({ code: code.trim() })}
          >
            <IconBug />
          </Button>
        </div>
        <p data-testid="play-area" className="min-h-4 text-xs text-muted-foreground">
          {marking ? note || 'Move the pointer, then hold still.' : note}
        </p>
      </section>
    </main>
  )
}

export default App
