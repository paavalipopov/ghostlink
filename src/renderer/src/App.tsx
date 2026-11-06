import { useEffect, useRef, useState, type JSX } from 'react'
import type { Bounds } from '../../shared/coords'
import type { DisplayInfo } from '../../shared/protocol'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { Switch } from '@renderer/components/ui/switch'
import { GhostField } from './GhostField'
import { useGhostLink, type LinkSettings } from './link'

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

function relayError(url: string): string | null {
  const value = url.trim()
  if (!value) return null
  return /^wss?:\/\//i.test(value) ? null : 'Relay address should start with ws:// or wss://'
}

function turnError(url: string): string | null {
  const value = url.trim()
  if (!value) return null
  return /^turns?:/i.test(value) ? null : 'TURN address should start with turn: or turns:'
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

function makeCode(): string {
  const pick = (): string => CODE_WORDS[Math.floor(Math.random() * CODE_WORDS.length)]
  const number = Math.floor(10 + Math.random() * 90)
  return `${pick()}-${pick()}-${number}`
}

function App(): JSX.Element {
  const [name, setName] = useState(() => stored('ghostlink.name', ''))
  const [code, setCode] = useState(() => stored('ghostlink.code', ''))
  const [relayUrl, setRelayUrl] = useState(() => stored('ghostlink.relay', ''))
  const [turnUrl, setTurnUrl] = useState(() => stored('ghostlink.turnUrl', ''))
  const [turnUsername, setTurnUsername] = useState(() => stored('ghostlink.turnUser', ''))
  const [turnCredential, setTurnCredential] = useState(() => stored('ghostlink.turnPass', ''))
  const [pingOn, setPingOn] = useState(() => stored('ghostlink.ping', '1') !== '0')
  const [showFrame, setShowFrame] = useState(() => stored('ghostlink.frame', '1') !== '0')
  const [onTop, setOnTop] = useState(() => stored('ghostlink.ontop', '1') !== '0')
  const [connected, setConnected] = useState(false)
  const [displays, setDisplays] = useState<DisplayInfo[]>([])
  const [displayId, setDisplayId] = useState<number | null>(null)
  const [area, setArea] = useState<Bounds | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [marking, setMarking] = useState(false)
  const [hookDetail, setHookDetail] = useState('')
  const [copied, setCopied] = useState(false)

  const settings: LinkSettings = { code, relayUrl, turnUrl, turnUsername, turnCredential }
  const link = useGhostLink(connected, settings)
  const { publishMove, publishPing } = link
  const enabled = useRef(false)
  const nameRef = useRef(name)
  const pingRef = useRef(pingOn)

  useEffect(() => {
    enabled.current = connected
    nameRef.current = name.trim() || 'Friend'
    pingRef.current = pingOn
  }, [connected, name, pingOn])

  useEffect(() => {
    const raw = stored('ghostlink.area', '')
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
      remember('ghostlink.area', JSON.stringify(next))
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
    if (!connected) return
    publishMove({ name: name.trim() || 'Friend', x: null, y: null })
  }, [connected, name, publishMove])

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

  useEffect(() => {
    window.api.setPanelOnTop(onTop)
    remember('ghostlink.ontop', onTop ? '1' : '0')
  }, [onTop])

  const codeOk = code.trim().length >= 4
  const relayProblem = relayError(relayUrl)
  const turnProblem = turnError(turnUrl)
  const formOk = codeOk && name.trim().length > 0 && !relayProblem && !turnProblem
  const friends = Object.values(link.ghosts)
    .map((ghost) => ghost.name)
    .filter(Boolean)
  const status =
    link.phase === 'linked' && friends.length > 0
      ? `Direct link is open with ${friends.join(', ')}.`
      : link.detail

  return (
    <main className="mx-auto flex h-full max-w-md flex-col gap-5 overflow-y-auto px-4 py-5">
      <header className="space-y-1">
        <p className="text-xs font-medium tracking-wide text-primary">Ghostlink</p>
        <h1 className="text-xl font-semibold">See your friend’s cursor</h1>
        <p className="text-sm text-muted-foreground">
          Both of you open this app and your own copy of the game. Their cursor appears on your
          screen, and a ring when they click. The ring does not click your game.
        </p>
      </header>

      <section className="space-y-3 rounded-lg border border-border bg-card p-3">
        <h2 className="text-sm font-medium">1. Join your friend</h2>
        <div className="space-y-1.5">
          <Label htmlFor="name">Your name</Label>
          <Input
            id="name"
            data-testid="name-input"
            value={name}
            placeholder="Pavel"
            onChange={(event) => {
              setName(event.target.value)
              remember('ghostlink.name', event.target.value)
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="code">Shared code</Label>
          <div className="flex flex-wrap gap-2">
            <Input
              id="code"
              className="min-w-40 flex-1"
              data-testid="code-input"
              value={code}
              placeholder="amber-harbor-42"
              onChange={(event) => {
                setCode(event.target.value)
                remember('ghostlink.code', event.target.value)
              }}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const next = makeCode()
                setCode(next)
                remember('ghostlink.code', next)
              }}
            >
              New code
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!codeOk}
              onClick={() => {
                void window.api.copyText(code.trim()).then(() => {
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1200)
                })
              }}
            >
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            One of you clicks New code, then Copy, and pastes it into any chat. The other types that
            exact code. Then both press Connect.
          </p>
        </div>
        <Button
          type="button"
          data-testid="connect"
          disabled={!connected && !formOk}
          onClick={() => setConnected((value) => !value)}
        >
          {connected ? 'Disconnect' : 'Connect'}
        </Button>
        <p data-testid="status" data-phase={link.phase} className="text-sm">
          <span
            className={
              link.phase === 'linked'
                ? 'text-primary'
                : link.phase === 'error'
                  ? 'text-[#d4654a]'
                  : 'text-muted-foreground'
            }
          >
            {status}
          </span>
        </p>
        {connected && (
          <div
            data-testid="stage"
            className="relative aspect-video overflow-hidden rounded-md border border-border bg-[#100e0c]"
          >
            <GhostField ghosts={link.ghosts} />
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium">2. Line it up with the game</h2>
          <p className="text-xs text-muted-foreground">
            Start the game in a window. Exclusive fullscreen hides the cursor. Both of you cover the
            same game picture, not the whole desktop, unless the game fills the screen.
          </p>
        </div>
        <Label htmlFor="display">Display</Label>
        <select
          id="display"
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
            disabled={marking}
            onClick={() => void window.api.mark('window')}
          >
            The window under my mouse
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Put the mouse over the game, then click “The window under my mouse”. If the outline
          includes the title bar, mark the picture corners instead. A countdown lets you place the
          pointer. Ctrl+Alt+1 is the top-left corner, Ctrl+Alt+2 is the bottom-right.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={marking}
            onClick={() => void window.api.mark('top-left')}
          >
            Mark top-left
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
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
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="frame">Show the outline</Label>
          <Switch id="frame" checked={showFrame} onCheckedChange={setShowFrame} />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">3. Clicks</h2>
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="ping">Show a ring when I click</Label>
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
        <p className="text-xs text-muted-foreground">{hookDetail}</p>
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="ontop">Keep this panel above the game</Label>
          <Switch id="ontop" checked={onTop} onCheckedChange={setOnTop} />
        </div>
      </section>

      <details className="rounded-lg border border-border px-3 py-2 text-sm">
        <summary className="cursor-pointer text-muted-foreground">If you cannot connect</summary>
        <div className="mt-3 space-y-3">
          <p className="text-xs text-muted-foreground">
            Leave this closed. It is only for a backup address if Connect never finds your friend.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="relay">My signaling relay</Label>
            <Input
              id="relay"
              data-testid="relay-url"
              value={relayUrl}
              placeholder="wss://your-vps.example"
              onChange={(event) => {
                setRelayUrl(event.target.value)
                remember('ghostlink.relay', event.target.value)
              }}
            />
            {relayProblem && <p className="text-xs text-[#d4654a]">{relayProblem}</p>}
            <p className="text-xs text-muted-foreground">
              Use this if the status stays on “looking”. Both of you set the same address.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="turn">TURN server</Label>
            <Input
              id="turn"
              data-testid="turn-url"
              value={turnUrl}
              placeholder="turn:your-vps.example:3478"
              onChange={(event) => {
                setTurnUrl(event.target.value)
                remember('ghostlink.turnUrl', event.target.value)
              }}
            />
            <Input
              aria-label="TURN username"
              value={turnUsername}
              placeholder="username"
              onChange={(event) => {
                setTurnUsername(event.target.value)
                remember('ghostlink.turnUser', event.target.value)
              }}
            />
            <Input
              aria-label="TURN password"
              type="password"
              value={turnCredential}
              placeholder="password"
              onChange={(event) => {
                setTurnCredential(event.target.value)
                remember('ghostlink.turnPass', event.target.value)
              }}
            />
            {turnProblem && <p className="text-xs text-[#d4654a]">{turnProblem}</p>}
            <p className="text-xs text-muted-foreground">
              Use this if it says a direct path did not open. The pointer is still encrypted.
            </p>
          </div>
        </div>
      </details>

      <details className="rounded-lg border border-border px-3 py-2 text-sm">
        <summary className="cursor-pointer text-muted-foreground">Try it on this PC first</summary>
        <div className="mt-3 space-y-3">
          <p className="text-xs text-muted-foreground">
            Opens a second window in the same room. Move the pointer inside that window. The cursor
            should show on the dark rectangle above, after you press Connect.
          </p>
          <Button
            type="button"
            variant="outline"
            data-testid="open-pad"
            disabled={!codeOk}
            onClick={() =>
              void window.api.openPad({
                code: code.trim(),
                relayUrl: relayUrl.trim(),
                turnUrl: turnUrl.trim(),
                turnUsername,
                turnCredential
              })
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
