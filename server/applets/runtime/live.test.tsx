import { afterEach, beforeEach, expect, test } from 'bun:test'
import { parseHTML } from 'linkedom'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { SyncedStateClient } from 'moi/live'
import type { SyncedState } from 'moi/server'

import type { AppletChannelListener } from '../../../lib/types'

import { useSyncedState } from './live'
import { __attachBridge } from './moi'

type Counter = { count: number }
type Add = { by: number }

const reduce = (state: Counter, action: Add): Counter => ({
  count: state.count + action.by
})
// What a bundle gets when it imports a channel from a `.server.ts`.
const counter = {
  __moiChannel: { module: 'views/count', name: 'counter' }
} as SyncedState<Counter, Add>

// The host end of the channel: the test plays the server.
let listener: AppletChannelListener
let live: boolean
let sent: { opId: string; action: Add }[]
let client: SyncedStateClient<Counter, Add>
let root: Root
let restore: () => void

function report(next: SyncedStateClient<Counter, Add>) {
  client = next
}

function Probe() {
  report(useSyncedState(counter, reduce))
  return null
}

const server = (message: unknown) => act(async () => listener.message?.(message))
const snapshot = (count: number) => server({ type: 'snapshot', state: { count } })

beforeEach(async () => {
  const { window, document } = parseHTML('<html><body><div id="root"></div></body></html>')
  const globals = {
    window,
    document,
    HTMLElement: window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true
  }
  const descriptors = Object.keys(globals).map(
    key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const
  )
  for (const [key, value] of Object.entries(globals))
    Object.defineProperty(globalThis, key, { configurable: true, value })
  restore = () => {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete (globalThis as Record<string, unknown>)[key]
    }
  }

  live = true
  sent = []
  __attachBridge({
    openChannel: (_channel, next) => {
      listener = next
      return {
        send: data => {
          if (live) sent.push(data as { opId: string; action: Add })
          return live
        },
        close: () => {},
        reconnect: () => {}
      }
    }
  })
  root = createRoot(document.getElementById('root')!)
  await act(async () => root.render(<Probe />))
})

afterEach(async () => {
  await act(async () => root.unmount())
  restore()
})

test('shows an action at once and keeps it until the server confirms it', async () => {
  expect(client.state).toBeUndefined()
  expect(client.status).toBe('connecting')

  await snapshot(10)
  expect(client).toMatchObject({
    state: { count: 10 },
    status: 'live',
    pending: 0
  })

  await act(async () => client.send({ by: 5 }))
  expect(client).toMatchObject({ state: { count: 15 }, pending: 1 })
  expect(sent).toHaveLength(1)

  // Another window's action lands first; this window's action stays on top.
  await server({ type: 'applied', opId: 'someone-else', action: { by: 100 } })
  expect(client).toMatchObject({ state: { count: 115 }, pending: 1 })

  await server({
    type: 'applied',
    opId: sent[0]!.opId,
    action: sent[0]!.action
  })
  expect(client).toMatchObject({ state: { count: 115 }, pending: 0 })
})

test('holds actions made offline and sends them once after the next snapshot', async () => {
  await snapshot(1)
  live = false
  await act(async () => listener.close?.())
  expect(client.status).toBe('reconnecting')

  await act(async () => client.send({ by: 2 }))
  expect(sent).toEqual([])
  expect(client).toMatchObject({ state: { count: 3 }, pending: 1 })

  live = true
  await act(async () => listener.open?.())
  // Not in step yet: the server may have changed while this window was away.
  expect(sent).toEqual([])
  await snapshot(50)
  expect(sent).toEqual([{ type: 'action', opId: expect.any(String), action: { by: 2 } }] as never)
  expect(client).toMatchObject({
    state: { count: 52 },
    status: 'live',
    pending: 1
  })

  // A later snapshot on the same connection must not send the action again.
  await snapshot(50)
  expect(sent).toHaveLength(1)

  // The server had already applied it before the drop: an ack clears it.
  await server({ type: 'ack', opId: sent[0]!.opId })
  expect(client).toMatchObject({ state: { count: 50 }, pending: 0 })
})

test('drops a refused action and says why', async () => {
  await snapshot(0)
  await act(async () => client.send({ by: -1 }))
  expect(client.state).toEqual({ count: -1 })

  await server({
    type: 'rejected',
    opId: sent[0]!.opId,
    message: 'The count cannot go below zero'
  })
  expect(client).toMatchObject({
    state: { count: 0 },
    pending: 0,
    rejected: 'The count cannot go below zero'
  })

  await act(async () => client.clearRejected())
  expect(client.rejected).toBeUndefined()
})

test('reports why the channel cannot open', async () => {
  await act(async () => listener.close?.('This export is not a channel'))
  expect(client).toMatchObject({
    status: 'connecting',
    error: 'This export is not a channel'
  })

  await snapshot(0)
  expect(client.error).toBeUndefined()
})
