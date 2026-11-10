import { listen } from '@tauri-apps/api/event'
import { useEffect, useState, type JSX } from 'react'
import { createRoot } from 'react-dom/client'
import { CursorMark } from '../renderer/src/CursorMark'
import type { Sample } from '../shared/protocol'
import './overlay.css'

type Preview = { sample: Sample; test: boolean; clickKey: number | null }
type PeerPointer = {
  id: string
  name: string
  color: string
  x: number
  y: number
  clickKey: string | null
}

// This file mounts the overlay as a Vite entry point.
// eslint-disable-next-line react-refresh/only-export-components
function Overlay(): JSX.Element {
  const [preview, setPreview] = useState<Preview | null>(null)
  const [peers, setPeers] = useState<PeerPointer[]>([])

  useEffect(() => {
    const subscription = listen<Preview | null>('pointer-preview', ({ payload }) =>
      setPreview(payload)
    )
    const peerSubscription = listen<PeerPointer[]>('peer-pointers', ({ payload }) =>
      setPeers(payload)
    )
    return () => {
      void subscription.then((unlisten) => unlisten())
      void peerSubscription.then((unlisten) => unlisten())
    }
  }, [])

  return (
    <div className="overlay">
      <div className="frame" />
      {peers.map((peer) => (
        <div
          className="point"
          key={peer.id}
          data-testid="peer-pointer"
          data-name={peer.name}
          data-x={peer.x}
          data-y={peer.y}
          style={{ transform: `translate3d(${peer.x * 100}vw, ${peer.y * 100}vh, 0)` }}
        >
          <CursorMark name={peer.name} color={peer.color} clickKey={peer.clickKey} />
        </div>
      ))}
      {preview && (
        <div
          className="point"
          key={preview.test ? 'test' : 'local'}
          style={{
            transform: `translate3d(${preview.sample.x * 100}vw, ${preview.sample.y * 100}vh, 0)`
          }}
        >
          <CursorMark
            name={preview.test ? 'Test user' : 'Local pointer'}
            color={preview.test ? '#6cb6d9' : '#e2a14a'}
            clickKey={preview.clickKey === null ? null : String(preview.clickKey)}
          />
        </div>
      )}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Overlay />)
