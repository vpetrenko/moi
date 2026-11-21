// Worker side of applet live channels: the implementation of `moi/server`.
// Runs inside the functions worker, next to the workspace's `.server.ts`
// modules. The worker feeds it connection events from the Moi server and
// passes outgoing messages back; see functions-worker.ts and channels.ts.
import type {
  Channel,
  ChannelConnection,
  ChannelHandlers,
  SyncedState,
  SyncedStateOptions
} from 'moi/server'

import type { SyncServerMessage } from '@/lib/channels'

export type ChannelTransport = {
  opened(connectionId: string): void
  send(connectionIds: string[], data: unknown): void
  // With a message the channel failed; the Moi server records it for the agent.
  closed(connectionId: string, message: string): void
  // A handler threw, but the connection stays open.
  error(connectionId: string, message: string): void
}

let transport: ChannelTransport | undefined

export function setChannelTransport(next: ChannelTransport) {
  transport = next
}

// A registered symbol, so a channel is recognized even if a workspace ends up
// with two copies of this module.
const INTERNAL = Symbol.for('moi.channel')

type Internal = {
  handlers: ChannelHandlers
  connections: Map<string, ChannelConnection>
}

type InternalChannel = Channel & { [INTERNAL]: Internal }

function internalOf(value: unknown): Internal | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  return (value as Partial<InternalChannel>)[INTERNAL]
}

function sendTo(connectionIds: string[], data: unknown) {
  if (connectionIds.length) transport?.send(connectionIds, data)
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Unknown error'
}

export function channel<In = unknown, Out = unknown>(
  handlers: ChannelHandlers<In, Out>
): Channel<In, Out> {
  const internal: Internal = {
    handlers: handlers as ChannelHandlers,
    connections: new Map()
  }
  const result: InternalChannel = {
    [INTERNAL]: internal,
    publish(message) {
      sendTo([...internal.connections.keys()], message)
    },
    get connections() {
      return internal.connections.size
    }
  }
  return result as Channel<In, Out>
}

// ---- Connections, driven by the worker ----

type Entry = {
  closed: boolean
  internal?: Internal
  connection?: ChannelConnection
  // Open, then each message, then close: one at a time, in arrival order.
  queue: Promise<void>
}

const entries = new Map<string, Entry>()

/** `load` returns the module export the browser asked for. */
export function openConnection(connectionId: string, load: () => Promise<unknown>) {
  const entry: Entry = { closed: false, queue: Promise.resolve() }
  entries.set(connectionId, entry)
  entry.queue = (async () => {
    const internal = internalOf(await load())
    if (!internal) {
      throw new Error('This export is not a channel. Create it with channel() or syncedState()')
    }
    if (entry.closed) return
    const connection: ChannelConnection = {
      id: connectionId,
      send: message => {
        if (!entry.closed) sendTo([connectionId], message)
      }
    }
    entry.internal = internal
    entry.connection = connection
    internal.connections.set(connectionId, connection)
    // Tell the browser first, so what the open handler sends arrives after it.
    transport?.opened(connectionId)
    await internal.handlers.open?.(connection)
  })().catch(async error => {
    if (entry.closed) return
    await release(connectionId, entry)
    transport?.closed(connectionId, messageOf(error))
  })
}

export function receiveMessage(connectionId: string, data: unknown) {
  const entry = entries.get(connectionId)
  if (!entry) return
  entry.queue = entry.queue.then(async () => {
    if (entry.closed || !entry.internal || !entry.connection) return
    try {
      await entry.internal.handlers.message?.(entry.connection, data)
    } catch (error) {
      transport?.error(connectionId, messageOf(error))
    }
  })
}

export function closeConnection(connectionId: string) {
  const entry = entries.get(connectionId)
  if (!entry || entry.closed) return
  entry.queue = entry.queue.then(() => release(connectionId, entry))
}

async function release(connectionId: string, entry: Entry) {
  entry.closed = true
  if (entries.get(connectionId) === entry) entries.delete(connectionId)
  const { internal, connection } = entry
  if (!internal || !connection) return
  internal.connections.delete(connectionId)
  try {
    await internal.handlers.close?.(connection)
  } catch (error) {
    console.error('[moi] channel close handler failed:', error)
  }
}

// ---- Synced state ----

const MAX_REMEMBERED_ACTIONS = 2000

export function syncedState<S, A>(options: SyncedStateOptions<S, A>): SyncedState<S, A> {
  type Message = SyncServerMessage<S, A>

  // Connections that are open, and those that already got their snapshot.
  const open = new Set<string>()
  const ready = new Set<string>()
  // Stored state the ready windows are in step with, as JSON text.
  let known: string | undefined
  // Work runs one piece at a time, so two windows cannot overwrite each other.
  let queue: Promise<void> = Promise.resolve()
  // Actions already applied, to ignore a resend after a reconnect.
  const seen = new Set<string>()

  function inOrder(task: () => Promise<void>): Promise<void> {
    queue = queue.then(task).catch(error => {
      console.error('[moi] synced state task failed:', error)
    })
    return queue
  }

  function publish(message: Message) {
    sendTo([...ready], message)
  }

  async function load(): Promise<S> {
    const state = await options.load()
    const text = JSON.stringify(state)
    // Storage was changed outside: bring every window in step first.
    if (known !== undefined && text !== known) publish({ type: 'snapshot', state })
    known = text
    return state
  }

  function remember(opId: string) {
    seen.add(opId)
    if (seen.size > MAX_REMEMBERED_ACTIONS) seen.delete(seen.values().next().value as string)
  }

  const result = channel<unknown, Message>({
    open(connection) {
      open.add(connection.id)
      return inOrder(async () => {
        try {
          connection.send({ type: 'snapshot', state: await load() })
        } catch (error) {
          connection.send({ type: 'error', message: messageOf(error) })
        }
        // Join after the snapshot, so no action can arrive before it.
        if (open.has(connection.id)) ready.add(connection.id)
      })
    },
    message(connection, raw) {
      const { type, opId, action } = (raw ?? {}) as Record<string, unknown>
      if (type !== 'action' || typeof opId !== 'string' || opId === '') return
      if (!options.isAction(action)) {
        connection.send({
          type: 'rejected',
          opId,
          message: 'This action is not valid'
        })
        return
      }
      return inOrder(async () => {
        if (seen.has(opId)) return connection.send({ type: 'ack', opId })
        try {
          const state = await load()
          const problem = options.check?.(state, action)
          if (problem) throw new Error(problem)
          const next = options.reduce(state, action)
          if (next !== state) {
            await options.save(next)
            known = JSON.stringify(next)
          }
          remember(opId)
          publish({ type: 'applied', opId, action })
        } catch (error) {
          connection.send({
            type: 'rejected',
            opId,
            message: messageOf(error)
          })
        }
      })
    },
    close(connection) {
      open.delete(connection.id)
      ready.delete(connection.id)
    }
  })
  return result as unknown as SyncedState<S, A>
}
