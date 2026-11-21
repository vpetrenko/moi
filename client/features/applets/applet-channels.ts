// Host side of applet live channels (`moi/live`). One socket per workspace
// carries every channel its applets open; it exists only while a channel is
// open. The socket goes to the workspace's owner, so channels work the same in
// local and shared workspaces.
import { createWorkspaceSocket } from '@/client/features/workspace/remote'
import type { ReconnectingSocket } from '@/client/runtime/reconnecting-socket'
import type { ChannelClientFrame, ChannelRef, ChannelServerFrame } from '@/lib/channels'
import type { AppletChannel, AppletChannelListener } from '@/lib/types'

export type ChannelTransport = Pick<
  ReconnectingSocket,
  'isOpen' | 'subscribe' | 'start' | 'send' | 'reconnect'
>

type Entry = {
  id: string
  ref: ChannelRef
  listener: AppletChannelListener
  // The server confirmed this channel on the current connection.
  open: boolean
  closed: boolean
  attempts: number
  retry?: ReturnType<typeof setTimeout>
}

const BASE_RETRY_MS = 500
const MAX_RETRY_MS = 10_000

// Applet code must not break the host or the other applets on the socket.
function notify(call: () => void) {
  try {
    call()
  } catch (error) {
    console.error('[moi/live] Channel listener failed', error)
  }
}

function isServerFrame(message: { type?: unknown }): message is ChannelServerFrame {
  return (
    typeof message.type === 'string' &&
    message.type.startsWith('channel:') &&
    typeof (message as { id?: unknown }).id === 'string'
  )
}

export function createChannelHub(socket: ChannelTransport) {
  const entries = new Map<string, Entry>()
  let nextId = 1
  let stop: (() => void) | undefined

  const send = (frame: ChannelClientFrame) => socket.send(frame)
  const request = (entry: Entry) => send({ type: 'channel:open', id: entry.id, ...entry.ref })

  function lost(entry: Entry, message?: string) {
    clearTimeout(entry.retry)
    entry.retry = undefined
    entry.open = false
    notify(() => entry.listener.close?.(message))
  }

  function start() {
    const unsubscribe = socket.subscribe({
      open: () => {
        for (const entry of entries.values()) request(entry)
      },
      message: message => {
        if (!isServerFrame(message)) return
        const entry = entries.get(message.id)
        if (!entry) return
        if (message.type === 'channel:opened') {
          entry.open = true
          entry.attempts = 0
          notify(() => entry.listener.open?.())
        } else if (message.type === 'channel:message') {
          const { data } = message
          notify(() => entry.listener.message?.(data))
        } else {
          // The server dropped this channel only: ask again, more slowly each time.
          lost(entry, message.message)
          const delay = Math.min(BASE_RETRY_MS * 2 ** entry.attempts++, MAX_RETRY_MS)
          entry.retry = setTimeout(() => {
            entry.retry = undefined
            if (!entry.closed && socket.isOpen) request(entry)
          }, delay)
        }
      },
      close: () => {
        for (const entry of entries.values()) lost(entry)
      }
    })
    const release = socket.start()
    return () => {
      unsubscribe()
      release()
    }
  }

  return {
    open(ref: ChannelRef, listener: AppletChannelListener): AppletChannel {
      const entry: Entry = {
        id: String(nextId++),
        ref,
        listener,
        open: false,
        closed: false,
        attempts: 0
      }
      entries.set(entry.id, entry)
      stop ??= start()
      if (socket.isOpen) request(entry)
      return {
        send(data) {
          if (!entry.open || !socket.isOpen) return false
          send({ type: 'channel:message', id: entry.id, data })
          return true
        },
        close() {
          if (entry.closed) return
          entry.closed = true
          entry.open = false
          clearTimeout(entry.retry)
          entries.delete(entry.id)
          send({ type: 'channel:close', id: entry.id })
          if (entries.size === 0) {
            stop?.()
            stop = undefined
          }
        },
        reconnect() {
          if (!entry.closed) socket.reconnect()
        }
      }
    }
  }
}

type ChannelHub = ReturnType<typeof createChannelHub>

const hubs = new Map<string, ChannelHub>()

export function appletChannels(workspaceId: string): ChannelHub {
  let hub = hubs.get(workspaceId)
  if (!hub) {
    hub = createChannelHub(createWorkspaceSocket(workspaceId))
    hubs.set(workspaceId, hub)
  }
  return hub
}
