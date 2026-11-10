import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useEffect, useRef, useState, type JSX } from 'react'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { IconDice } from '@renderer/icons'
import { useGhostLink } from '@renderer/link'
import { StatusDot } from '@renderer/StatusDot'
import { quantize } from '../shared/coords'
import { codeIsStrong, makeCode, makePingId, type Sample } from '../shared/protocol'

type Session = { id: number; name: string; code: string }
type PeerInput =
  | { kind: 'move'; session: number; sample: Sample | null }
  | { kind: 'click'; session: number; sample: Sample }

export function PeerControls({ areaReady }: { areaReady: boolean }): JSX.Element {
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [session, setSession] = useState<Session | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [clickWarning, setClickWarning] = useState<string | null>(null)
  const sequence = useRef(0)
  const { phase, detail, ghosts, publishMove, publishPing } = useGhostLink(session !== null, {
    code: session?.code ?? ''
  })

  useEffect(() => {
    if (!session) return
    let disposed = false
    const subscription = listen<PeerInput>('peer-input', ({ payload }) => {
      if (disposed || payload.session !== session.id) return
      const { sample } = payload
      const point = sample && { x: quantize(sample.x), y: quantize(sample.y) }
      publishMove({ name: session.name, x: point?.x ?? null, y: point?.y ?? null })
      if (payload.kind === 'click' && point) {
        publishPing({ name: session.name, ...point, id: makePingId() })
      }
    })
    void subscription
      .then(() =>
        disposed ? null : invoke<string | null>('set_peer_sharing', { session: session.id })
      )
      .then((warning) => {
        if (!disposed) setClickWarning(warning)
      })
      .catch((error) => {
        if (!disposed) {
          setNotice(String(error))
          setSession(null)
        }
      })
    return () => {
      disposed = true
      void subscription.then(
        (unlisten) => unlisten(),
        () => undefined
      )
      void invoke('set_peer_sharing', { session: null }).catch(console.error)
    }
  }, [session, publishMove, publishPing])

  useEffect(() => {
    if (!session) return
    const pointers = Object.entries(ghosts).flatMap(([id, ghost]) =>
      ghost.x === null || ghost.y === null
        ? []
        : [
            {
              id,
              name: ghost.name,
              color: ghost.color,
              x: ghost.x,
              y: ghost.y,
              clickKey: ghost.pings.at(-1)?.id ?? null
            }
          ]
    )
    void invoke('show_peer_pointers', { session: session.id, pointers }).catch(console.error)
  }, [session, ghosts])

  useEffect(() => {
    if (!session || phase === 'linked' || phase === 'error') return
    const timer = window.setTimeout(() => {
      setNotice('No peer found. Check the shared secret and try again.')
      setSession(null)
    }, 60_000)
    return () => window.clearTimeout(timer)
  }, [session, phase])

  const state = !session
    ? 'idle'
    : phase === 'linked'
      ? 'live'
      : phase === 'error'
        ? 'error'
        : 'wait'
  const status =
    notice ??
    (session
      ? detail
      : areaReady
        ? 'Enter the same secret on both devices.'
        : 'Choose a shared area to connect.')

  return (
    <section
      className="space-y-2 rounded-lg border border-border bg-card p-3"
      aria-label="Peer connection"
    >
      <div className="flex items-center gap-2">
        <Input
          aria-label="Username"
          placeholder="Username"
          value={name}
          maxLength={40}
          disabled={session !== null}
          onChange={(event) => setName(event.target.value)}
        />
        <StatusDot state={state} title={status} compact />
      </div>
      <div className="relative">
        <Input
          aria-label="Shared secret"
          placeholder="Shared secret"
          value={code}
          disabled={session !== null}
          className="pr-9"
          onChange={(event) => setCode(event.target.value)}
        />
        <button
          type="button"
          aria-label="Generate shared secret"
          disabled={session !== null}
          className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-50"
          onClick={() => setCode(makeCode())}
        >
          <IconDice />
        </button>
      </div>
      <Button
        type="button"
        data-testid="connect"
        data-state={state}
        className="w-full bg-[#3dbe6a] text-[#1a140c] hover:bg-[#349e59]"
        disabled={!session && (!areaReady || !name.trim() || !codeIsStrong(code))}
        onClick={() => {
          setNotice(null)
          setClickWarning(null)
          if (session) {
            setSession(null)
          } else {
            const username = name.trim()
            publishMove({ name: username, x: null, y: null })
            setSession({ id: ++sequence.current, name: username, code: code.trim() })
          }
        }}
      >
        {session ? 'Disconnect' : 'Connect'}
      </Button>
      <p className="text-xs text-muted-foreground" role="status">
        {status}
      </p>
      {session && clickWarning && <p className="text-xs text-[#ffad98]">{clickWarning}</p>}
    </section>
  )
}
