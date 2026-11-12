import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useEffect, useState, type JSX } from 'react'
import { createRoot } from 'react-dom/client'
import { CursorMark } from '../renderer/src/CursorMark'
import type { Sample } from '../shared/protocol'
import './overlay.css'

type Preview = { sample: Sample; clickKey: number | null }
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
  const [ghostMarks, setGhostMarks] = useState(false)
  const [pickCount, setPickCount] = useState<number | null>(null)
  const [showFrame, setShowFrame] = useState(false)
  const shape = ghostMarks ? 'ghost' : 'arrow'

  useEffect(() => {
    const subscription = listen<Preview | null>('pointer-preview', ({ payload }) =>
      setPreview(payload)
    )
    const peerSubscription = listen<PeerPointer[]>('peer-pointers', ({ payload }) =>
      setPeers(payload)
    )
    const marksSubscription = listen<boolean>('ghost-marks', ({ payload }) =>
      setGhostMarks(payload)
    )
    const pickSubscription = listen<number | null>('pick-count', ({ payload }) =>
      setPickCount(payload)
    )
    let disposed = false
    let frameChanged = false
    const frameSubscription = listen<boolean>('show-frame', ({ payload }) => {
      frameChanged = true
      if (!disposed) setShowFrame(payload)
    })
    void frameSubscription
      .then(() => invoke<boolean>('overlay_frame_visible'))
      .then((visible) => {
        if (!disposed && !frameChanged) setShowFrame(visible)
      })
      .catch(console.error)
    return () => {
      disposed = true
      void subscription.then((unlisten) => unlisten())
      void peerSubscription.then((unlisten) => unlisten())
      void marksSubscription.then((unlisten) => unlisten())
      void pickSubscription.then((unlisten) => unlisten())
      void frameSubscription.then((unlisten) => unlisten())
    }
  }, [])

  return (
    <div className="overlay">
      {showFrame && <div className="frame" />}
      {pickCount !== null && (
        <div className="mark-banner" data-testid="pick-count">
          <div className="mark-count">{pickCount}</div>
          <div>Put the pointer over the game window</div>
        </div>
      )}
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
          <CursorMark name={peer.name} color={peer.color} shape={shape} clickKey={peer.clickKey} />
        </div>
      ))}
      {preview && (
        <div
          className="point"
          style={{
            transform: `translate3d(${preview.sample.x * 100}vw, ${preview.sample.y * 100}vh, 0)`
          }}
        >
          <CursorMark
            name="Test user"
            color="#6cb6d9"
            shape={shape}
            clickKey={preview.clickKey === null ? null : String(preview.clickKey)}
          />
        </div>
      )}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Overlay />)
