// Relay between browsers and applet live channels. Channel frames arrive on the
// workspace events socket (see web.ts); each open channel becomes one
// connection in the workspace's functions worker, where the `.server.ts` code
// that owns the channel runs.
import { CHANNEL_FRAME_PREFIX, isChannelClientFrame, type ChannelServerFrame } from '@/lib/channels'

import { openChannel, type ChannelHandle } from './functions'
import { appletForModule, recordAppletError } from './log'

export type ChannelSocket = { send(data: string): unknown }

// One browser message; state and actions are meant to be small.
const MAX_FRAME_CHARS = 256 * 1024
const MAX_CHANNELS_PER_SOCKET = 64

type Entry = {
  closed: boolean
  // Resolves once the worker knows the connection; undefined when it never opened.
  handle: Promise<ChannelHandle | undefined>
}

const sockets = new WeakMap<ChannelSocket, Map<string, Entry>>()

export function isChannelFrame(raw: string | Uint8Array): raw is string {
  return typeof raw === 'string' && raw.startsWith(CHANNEL_FRAME_PREFIX)
}

function emit(socket: ChannelSocket, frame: ChannelServerFrame) {
  try {
    socket.send(JSON.stringify(frame))
  } catch {
    // The browser is gone; its close event cleans up.
  }
}

function open(
  socket: ChannelSocket,
  entries: Map<string, Entry>,
  workspacePath: string,
  id: string,
  module: string,
  name: string
) {
  const journal = (message: string) =>
    recordAppletError(workspacePath, {
      source: 'rpc',
      ...(appletForModule(module) ?? {}),
      module,
      fn: name,
      message
    })
  const entry: Entry = { closed: false, handle: Promise.resolve(undefined) }
  // Tell the browser once, and only while this entry still owns the id.
  const closed = (message?: string) => {
    if (entry.closed) return
    entry.closed = true
    if (entries.get(id) === entry) entries.delete(id)
    emit(socket, {
      type: 'channel:closed',
      id,
      ...(message ? { message } : {})
    })
  }
  entries.set(id, entry)
  entry.handle = openChannel(module, name, workspacePath, {
    opened: () => {
      if (!entry.closed) emit(socket, { type: 'channel:opened', id })
    },
    message: data => {
      if (!entry.closed) emit(socket, { type: 'channel:message', id, data })
    },
    closed: reason => {
      if (reason.error && !entry.closed) journal(reason.message)
      closed(reason.error ? reason.message : undefined)
    },
    error: journal
  }).then(
    handle => {
      // The browser left while the worker was starting.
      if (entry.closed) handle.close()
      return handle
    },
    error => {
      closed(error instanceof Error ? error.message : 'The channel could not be opened')
      return undefined
    }
  )
}

function close(entries: Map<string, Entry>, id: string) {
  const entry = entries.get(id)
  if (!entry) return
  entries.delete(id)
  if (entry.closed) return
  entry.closed = true
  void entry.handle.then(handle => handle?.close())
}

export function handleChannelFrame(socket: ChannelSocket, workspacePath: string, raw: string) {
  if (raw.length > MAX_FRAME_CHARS) return
  let frame: unknown
  try {
    frame = JSON.parse(raw)
  } catch {
    return
  }
  if (!isChannelClientFrame(frame)) return

  let entries = sockets.get(socket)
  if (!entries) {
    entries = new Map()
    sockets.set(socket, entries)
  }
  if (frame.type === 'channel:open') {
    // Reopening an id replaces the connection behind it.
    close(entries, frame.id)
    if (entries.size >= MAX_CHANNELS_PER_SOCKET) {
      emit(socket, {
        type: 'channel:closed',
        id: frame.id,
        message: 'Too many open channels'
      })
      return
    }
    open(socket, entries, workspacePath, frame.id, frame.module, frame.name)
  } else if (frame.type === 'channel:message') {
    const { data } = frame
    void entries.get(frame.id)?.handle.then(handle => handle?.send(data))
  } else {
    close(entries, frame.id)
  }
}

export function closeChannelSocket(socket: ChannelSocket) {
  const entries = sockets.get(socket)
  if (!entries) return
  sockets.delete(socket)
  for (const id of [...entries.keys()]) close(entries, id)
}
