import { useEffect, useRef, useState, type JSX } from 'react'
import type { Bounds } from '../../shared/coords'
import type { DisplayInfo } from '../../shared/protocol'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { Switch } from '@renderer/components/ui/switch'
import { useGhostLink, type LinkPhase, type LinkSettings } from './link'

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

const CODE_WORDS = [
  'amber',
  'harbor',
  'lantern',
  'willow',
  'copper',
  'meadow',
  'pebble',
  'sparrow',
  'cinder',
  'maple',
  'river',
  'thimble',
  'orchid',
  'cedar',
  'quilt',
  'marigold'
]

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

function makeCode(): string {
  const pick = (): string => CODE_WORDS[Math.floor(Math.random() * CODE_WORDS.length)]
  const number = Math.floor(10 + Math.random() * 90)
  return `${pick()}-${pick()}-${number}`
}

function makeName(): string {
  return NAMES[Math.floor(Math.random() * NAMES.length)]
}

function monitorState(active: boolean, phase: LinkPhase): 'idle' | 'wait' | 'live' | 'error' {
  if (!active) return 'idle'
  if (phase === 'linked') return 'live'
  if (phase === 'error') return 'error'
  return 'wait'
}

function monitorColor(state: 'idle' | 'wait' | 'live' | 'error'): string {
  if (state === 'live') return '#3dbe6a'
  if (state === 'wait') return '#e2a14a'
  if (state === 'error') return '#d4654a'
  return '#5c564c'
}

function monitorTitle(state: 'idle' | 'wait' | 'live' | 'error', detail: string): string {
  if (state === 'live') return 'Connected'
  if (state === 'wait') return 'Waiting for the other computer'
  if (state === 'error') return detail || 'Could not connect'
  return 'Not connected'
}

function App(): JSX.Element {
  const [name, setName] = useState(() => stored('ghostlink.name', ''))
  const [code, setCode] = useState(() => stored('ghostlink.code', ''))
  const [pingOn, setPingOn] = useState(() => stored('ghostlink.ping', '1') !== '0')
  const [showFrame, setShowFrame] = useState(() => stored('ghostlink.frame', '1') !== '0')
  const [monitoring, setMonitoring] = useState(false)
  const [displays, setDisplays] = useState<DisplayInfo[]>([])
  const [displayId, setDisplayId] = useState<number | null>(null)
  const [area, setArea] = useState<Bounds | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [marking, setMarking] = useState(false)
  const [hookDetail, setHookDetail] = useState('')

  const settings: LinkSettings = { code }
  const link = useGhostLink(monitoring, settings)
  const { publishMove, publishPing } = link
  const enabled = useRef(false)
  const nameRef = useRef(name)
  const pingRef = useRef(pingOn)

  useEffect(() => {
    enabled.current = monitoring
    nameRef.current = name.trim() || 'Friend'
    pingRef.current = pingOn
  }, [monitoring, name, pingOn])

  useEffect(() => {
    const raw = stored('ghostlink.areaPx', '')
    if (raw) {
      try {
        void window.api.restorePlayArea(JSON.parse(raw) as Bounds)
      } catch {
        // Ignore a damaged saved rectangle.
      }
    }
    void window.api.getDisplays().then((items) => {
      setDisplays(items)
      setDisplayId(
        (current) => current ?? items.find((item) => item.primary)?.id ?? items[0]?.id ?? null
      )
    })
    void window.api.getPlayArea().then(setArea)
    void window.api.hookStatus().then((status) => setHookDetail(status.detail))
    const offArea = window.api.onPlayArea((next) => {
      setArea(next)
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
      if (!enabled.current || !pingRef.current || !sample.inside) return
      publishPing({
        name: nameRef.current,
        x: sample.x,
        y: sample.y,
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`
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
    publishMove({ name: name.trim() || 'Friend', x: null, y: null })
  }, [monitoring, name, publishMove])

  useEffect(() => {
    const payload = Object.entries(link.ghosts).map(([id, ghost]) => ({
      id,
      name: ghost.name,
      color: ghost.color,
      x: ghost.x,
      y: ghost.y,
      pings: ghost.pings.map((ping) => ({ id: ping.id, x: ping.x, y: ping.y }))
    }))
    window.api.setGhosts(payload)
  }, [link.ghosts])

  useEffect(() => {
    window.api.setShowFrame(showFrame)
    remember('ghostlink.frame', showFrame ? '1' : '0')
  }, [showFrame])

  const codeOk = code.trim().length >= 4
  const formOk = codeOk && name.trim().length > 0
  const linked = monitoring && link.phase === 'linked'
  const dot = monitorState(monitoring, link.phase)
  const dotTitle = monitorTitle(dot, link.detail)

  return (
    <main className="mx-auto flex h-full max-w-md flex-col gap-5 overflow-y-auto px-4 py-5">
      <h1 className="text-center text-3xl font-semibold tracking-tight">Ghostlink</h1>

      <section className="space-y-3 rounded-lg border border-border bg-card p-3">
        <h2 className="text-center text-base font-medium">Sync</h2>
        <div className="space-y-1.5">
          <Label htmlFor="name">Name</Label>
          <div className="flex gap-2">
            <Input
              id="name"
              className="min-w-0 flex-1"
              data-testid="name-input"
              value={name}
              placeholder="Name"
              onChange={(event) => {
                setName(event.target.value)
                remember('ghostlink.name', event.target.value)
              }}
            />
            <Button
              type="button"
              variant="outline"
              data-testid="random-name"
              title="Pick a name"
              onClick={() => {
                const next = makeName()
                setName(next)
                remember('ghostlink.name', next)
              }}
            >
              Random
            </Button>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="code">Code</Label>
          <div className="flex gap-2">
            <Input
              id="code"
              className="min-w-0 flex-1"
              data-testid="code-input"
              value={code}
              placeholder="amber-harbor-42"
              onChange={(event) => {
                setCode(event.target.value)
                remember('ghostlink.code', event.target.value)
                setMonitoring(false)
              }}
            />
            <Button
              type="button"
              variant="outline"
              data-testid="new-code"
              title="Make a code and wait for the other computer"
              onClick={() => {
                const next = makeCode()
                setCode(next)
                remember('ghostlink.code', next)
                setMonitoring(true)
              }}
            >
              New code
            </Button>
          </div>
        </div>
        <Button
          type="button"
          className="group w-full"
          data-testid="connect"
          title={linked ? 'Disconnect' : 'Paste their code, then connect'}
          aria-label={linked ? 'Disconnect' : 'Connect'}
          disabled={!linked && (!formOk || (monitoring && link.phase !== 'error'))}
          onClick={() => {
            if (linked) {
              setMonitoring(false)
              return
            }
            if (monitoring && link.phase === 'error') {
              setMonitoring(false)
              queueMicrotask(() => setMonitoring(true))
              return
            }
            setMonitoring(true)
          }}
        >
          {linked ? (
            <>
              <span className="group-hover:hidden">Connected</span>
              <span className="hidden group-hover:inline">Disconnect</span>
            </>
          ) : (
            'Connect'
          )}
        </Button>
        <div className="flex justify-center">
          <span
            data-testid="monitor"
            data-state={dot}
            data-phase={link.phase}
            title={dotTitle}
            aria-label={dotTitle}
            className="inline-block size-2.5 rounded-full"
            style={{ background: monitorColor(dot) }}
          />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Frame</h2>
        <Label htmlFor="display">Display</Label>
        <select
          id="display"
          title="Screen the game is on"
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
          value={displayId ?? ''}
          onChange={(event) => setDisplayId(Number(event.target.value))}
        >
          {displays.map((display) => (
            <option key={display.id} value={display.id}>
              {display.label}
              {display.primary ? ' (main)' : ''} · {display.bounds.width}×{display.bounds.height}
            </option>
          ))}
        </select>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            title="Frame this whole display"
            disabled={displayId == null || marking}
            onClick={() => {
              if (displayId == null) return
              void window.api.useDisplay(displayId)
            }}
          >
            The game fills this screen
          </Button>
          <Button
            type="button"
            variant="secondary"
            title="Point at the game, then click. The frame matches that window."
            disabled={marking}
            data-testid="mark-window"
            onClick={() => void window.api.mark('window')}
          >
            The window under my mouse
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            title="Countdown, then the top-left corner follows the pointer. Ctrl+Alt+1."
            disabled={marking}
            onClick={() => void window.api.mark('top-left')}
          >
            Mark top-left
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            title="Countdown, then the bottom-right corner follows the pointer. Ctrl+Alt+2."
            disabled={marking}
            onClick={() => void window.api.mark('bottom-right')}
          >
            Mark bottom-right
          </Button>
        </div>
        <p data-testid="play-area" className="text-xs text-muted-foreground">
          {marking
            ? 'Move the pointer, then hold still.'
            : area
              ? `${Math.round(area.width)} × ${Math.round(area.height)} at ${Math.round(area.x)}, ${Math.round(area.y)}`
              : 'Waiting for a display.'}
          {note ? ` · ${note}` : ''}
        </p>
        <div className="flex items-center justify-between gap-3" title="Show or hide the frame">
          <Label htmlFor="frame">Show the outline</Label>
          <Switch id="frame" checked={showFrame} onCheckedChange={setShowFrame} />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Click</h2>
        <div className="flex items-center justify-between gap-3" title={hookDetail}>
          <Label htmlFor="ping">Color on click</Label>
          <Switch
            id="ping"
            data-testid="ping-toggle"
            checked={pingOn}
            onCheckedChange={(value) => {
              setPingOn(value)
              remember('ghostlink.ping', value ? '1' : '0')
            }}
          />
        </div>
      </section>

      <details className="rounded-lg border border-border px-3 py-2 text-sm">
        <summary
          className="cursor-pointer text-muted-foreground"
          title="Second window in this room"
        >
          Try it on this PC
        </summary>
        <div className="mt-3">
          <Button
            type="button"
            variant="outline"
            data-testid="open-pad"
            title="Open a second window that joins this code"
            disabled={!codeOk}
            onClick={() =>
              void window.api.openPad({ code: code.trim() })
            }
          >
            Open a test window
          </Button>
        </div>
      </details>
    </main>
  )
}

export default App
