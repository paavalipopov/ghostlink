// Each room owns its native connections, including those still negotiating.
// Apply a wire budget before Trystero parses control messages or action metadata.
export const ROOM_RECEIVE_BYTES = 64 * 1024
export const POINTER_BYTES = 1024
const MAX_FRAME_BYTES = 8192

export function tokenBucket(perSecond: number, burst: number, now = () => performance.now()) {
  let balance = burst
  let previous = now()
  return (cost = 1): boolean => {
    const time = now()
    balance = Math.min(burst, balance + (Math.max(0, time - previous) * perSecond) / 1000)
    previous = time
    if (cost > balance) return false
    balance -= cost
    return true
  }
}

let guardedUrls: Set<string> | undefined

// The Nostr adapter constructs browser WebSockets internally. Attach this
// listener at construction so it also runs before JSON parsing on reconnect.
export function guardDiscovery(urls: readonly string[]): void {
  if (!guardedUrls) {
    const relays = new Set<string>()
    guardedUrls = relays
    const Native = globalThis.WebSocket
    globalThis.WebSocket = class extends Native {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols)
        if (!relays.has(this.url)) return
        const message = tokenBucket(64, 96)
        const characters = tokenBucket(128 * 1024, 256 * 1024)
        this.addEventListener(
          'message',
          (event: MessageEvent<unknown>) => {
            const data = event.data
            if (
              this.readyState === Native.OPEN &&
              typeof data === 'string' &&
              data.length <= 64 * 1024 &&
              message() &&
              characters(data.length)
            )
              return
            event.stopImmediatePropagation()
            this.close(1000, 'Relay traffic limit')
          },
          true
        )
      }
    }
  }
  for (const url of urls) guardedUrls.add(new URL(url).href)
}

export function connectionPool(
  limit: number,
  Native = RTCPeerConnection
): { Connection: typeof RTCPeerConnection; close(): void } {
  const live = new Set<RTCPeerConnection>()
  const mayAllocate = tokenBucket(2, Math.max(4, limit * 2))
  let closed = false

  class RoomConnection extends Native {
    private channel?: RTCDataChannel
    private readonly frame = tokenBucket(180, 120)
    private readonly bytes = tokenBucket(ROOM_RECEIVE_BYTES, ROOM_RECEIVE_BYTES)

    constructor(config?: RTCConfiguration) {
      if (closed || live.size >= limit || !mayAllocate()) {
        throw new Error('Room connection limit reached')
      }
      super(config)
      live.add(this)
      this.addEventListener(
        'datachannel',
        (event) => {
          if (!this.guardChannel(event.channel)) event.stopImmediatePropagation()
        },
        true
      )
    }

    private guardChannel(channel: RTCDataChannel): boolean {
      if (this.channel || !live.has(this) || channel.label !== 'data') {
        channel.close()
        this.close()
        return false
      }
      this.channel = channel
      channel.addEventListener(
        'message',
        (event: MessageEvent<unknown>) => {
          const data = event.data
          const size = data instanceof ArrayBuffer ? data.byteLength : Infinity
          if (live.has(this) && size <= MAX_FRAME_BYTES && this.frame() && this.bytes(size)) return
          event.stopImmediatePropagation()
          channel.close()
          this.close()
        },
        true
      )
      return true
    }

    override createDataChannel(label: string, options?: RTCDataChannelInit): RTCDataChannel {
      const channel = super.createDataChannel(label, options)
      this.guardChannel(channel)
      return channel
    }

    override close(): void {
      live.delete(this)
      super.close()
    }
  }

  return {
    Connection: RoomConnection,
    close() {
      closed = true
      for (const peer of live) peer.close()
    }
  }
}
