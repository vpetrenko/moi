import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { parse, stringify } from 'devalue'
import { join } from 'path'

// The worker half of live channels, driven with the same IPC messages the Moi
// server sends: channels exported by a `.server.ts`, and the synced-state rules
// built on them.

const FIXTURES = join(import.meta.dir, '__fixtures__')
const WORKER_PATH = join(import.meta.dir, '..', 'applets', 'functions-worker.ts')

type WorkerMessage = {
  type: string
  id?: string
  connectionId?: string
  connectionIds?: string[]
  data?: unknown
  message?: string
}

function spawnTestWorker() {
  const ready = Promise.withResolvers<void>()
  const received: WorkerMessage[] = []
  const calls = new Map<string, (message: WorkerMessage) => void>()

  const proc = Bun.spawn([process.execPath, WORKER_PATH], {
    env: { ...process.env, MEI_FUNCTIONS_DIR: FIXTURES },
    stderr: 'inherit',
    ipc(raw) {
      const message = raw as WorkerMessage
      if (message.type === 'ready') return ready.resolve()
      if (message.id && calls.has(message.id)) {
        calls.get(message.id)!(message)
        calls.delete(message.id)
        return
      }
      received.push(message)
    }
  })

  let nextConnection = 1
  const worker = {
    ready: ready.promise,
    received,
    kill: () => proc.kill(),
    open(name: string) {
      const connectionId = `c${nextConnection++}`
      proc.send({ type: 'channel:open', connectionId, module: 'live', name })
      return connectionId
    },
    send(connectionId: string, data: unknown) {
      proc.send({ type: 'channel:message', connectionId, data })
    },
    close(connectionId: string) {
      proc.send({ type: 'channel:close', connectionId })
    },
    async call(name: string, args: unknown[] = []): Promise<unknown> {
      const id = crypto.randomUUID()
      const reply = await new Promise<WorkerMessage>(resolve => {
        calls.set(id, resolve)
        proc.send({
          id,
          type: 'call',
          module: 'live',
          name,
          args: stringify(args)
        })
      })
      if (reply.type !== 'result') throw new Error(reply.message)
      return parse(reply.data as string)
    },
    // What one connection was sent, in order.
    sentTo(connectionId: string): unknown[] {
      return received
        .filter(m => m.type === 'channel:send' && m.connectionIds?.includes(connectionId))
        .map(m => m.data)
    },
    async until(check: () => boolean) {
      const deadline = Date.now() + 5000
      while (!check()) {
        if (Date.now() > deadline) {
          throw new Error(`Timed out. Worker sent: ${JSON.stringify(received)}`)
        }
        await Bun.sleep(5)
      }
    }
  }
  return worker
}

let worker: ReturnType<typeof spawnTestWorker>

beforeAll(async () => {
  worker = spawnTestWorker()
  await worker.ready
})

afterAll(() => {
  worker.kill()
})

describe('channel', () => {
  test('confirms the connection before what the open handler sends', async () => {
    const id = worker.open('echo')
    await worker.until(() => worker.sentTo(id).length === 1)

    const mine = worker.received.filter(m => m.connectionId === id || m.connectionIds?.includes(id))
    expect(mine.map(m => m.type)).toEqual(['channel:opened', 'channel:send'])
    expect(worker.sentTo(id)).toEqual([{ hello: true }])
  })

  test('answers one connection and publishes to all, until a connection closes', async () => {
    const first = worker.open('echo')
    const second = worker.open('echo')
    await worker.until(() => worker.sentTo(second).length === 1)

    worker.send(first, 'ping')
    await worker.until(() => worker.sentTo(first).length === 2)
    expect(worker.sentTo(first)[1]).toEqual({ echo: 'ping' })
    expect(worker.sentTo(second)).toHaveLength(1)

    worker.close(second)
    worker.send(first, 'all')
    await worker.until(() => worker.sentTo(first).length === 3)
    expect(worker.sentTo(second)).toHaveLength(1)
  })

  test('reports a throwing message handler and keeps the connection', async () => {
    const id = worker.open('echo')
    worker.send(id, 'boom')
    worker.send(id, 'still here')
    await worker.until(() => worker.sentTo(id).length === 2)

    const error = worker.received.find(m => m.type === 'channel:error' && m.connectionId === id)
    expect(error?.message).toBe('intentional channel error')
    expect(worker.sentTo(id)[1]).toEqual({ echo: 'still here' })
  })

  test.each([
    ['failing', 'intentional open error'],
    ['notAChannel', 'not a channel'],
    ['missing', 'not a channel']
  ])('closes a connection to %s with the reason', async (name, reason) => {
    const id = worker.open(name)
    const closed = () =>
      worker.received.find(m => m.type === 'channel:closed' && m.connectionId === id)
    await worker.until(() => closed() !== undefined)

    expect(closed()?.message).toContain(reason)
  })
})

describe('syncedState', () => {
  const action = (opId: string, by: unknown) => ({
    type: 'action',
    opId,
    action: { type: 'add', by }
  })

  test('applies actions in order for every window and never twice', async () => {
    const first = worker.open('counter')
    const second = worker.open('counter')
    await worker.until(() => worker.sentTo(second).length === 1)
    expect(worker.sentTo(first)).toEqual([{ type: 'snapshot', state: { count: 0 } }])

    worker.send(first, action('op-1', 2))
    worker.send(second, action('op-2', 3))
    await worker.until(() => worker.sentTo(first).length === 3)
    const applied = [
      { type: 'applied', opId: 'op-1', action: { type: 'add', by: 2 } },
      { type: 'applied', opId: 'op-2', action: { type: 'add', by: 3 } }
    ]
    expect(worker.sentTo(first).slice(1)).toEqual(applied)
    expect(worker.sentTo(second).slice(1)).toEqual(applied)

    // A resend after a reconnect is confirmed to the sender only.
    worker.send(first, action('op-1', 2))
    await worker.until(() => worker.sentTo(first).length === 4)
    expect(worker.sentTo(first)[3]).toEqual({ type: 'ack', opId: 'op-1' })
    expect(worker.sentTo(second)).toHaveLength(3)

    const late = worker.open('counter')
    await worker.until(() => worker.sentTo(late).length === 1)
    expect(worker.sentTo(late)).toEqual([{ type: 'snapshot', state: { count: 5 } }])

    for (const id of [first, second, late]) worker.close(id)
  })

  test('refuses an action without changing the state or telling other windows', async () => {
    const first = worker.open('counter')
    const second = worker.open('counter')
    await worker.until(() => worker.sentTo(second).length === 1)
    const savesBefore = await worker.call('saveCount')

    worker.send(first, action('op-refused', -100))
    worker.send(first, action('op-invalid', 'many'))
    await worker.until(() => worker.sentTo(first).length === 3)

    expect(worker.sentTo(first).slice(1)).toEqual([
      {
        type: 'rejected',
        opId: 'op-refused',
        message: 'The count cannot go below zero'
      },
      {
        type: 'rejected',
        opId: 'op-invalid',
        message: 'This action is not valid'
      }
    ])
    expect(worker.sentTo(second)).toHaveLength(1)
    expect(await worker.call('saveCount')).toBe(savesBefore)

    for (const id of [first, second]) worker.close(id)
  })

  test('brings every window in step when storage changed outside', async () => {
    const first = worker.open('counter')
    const second = worker.open('counter')
    await worker.until(() => worker.sentTo(second).length === 1)

    await worker.call('overwrite', [40])
    worker.send(first, action('op-after-edit', 2))
    await worker.until(() => worker.sentTo(second).length === 3)

    expect(worker.sentTo(second).slice(1)).toEqual([
      { type: 'snapshot', state: { count: 40 } },
      {
        type: 'applied',
        opId: 'op-after-edit',
        action: { type: 'add', by: 2 }
      }
    ])

    for (const id of [first, second]) worker.close(id)
  })
})
