import { afterEach, beforeEach, expect, test } from 'bun:test'
import { parseHTML } from 'linkedom'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { SyncedStore } from 'moi/live'
import type { SyncedState } from 'moi/server'

import { createSyncedStore } from './live'
import { __attachBridge } from './moi'

type Counter = { count: number }
type SetCount = { set: number }
type Actions = {
  // Shows at once.
  add(by: number): Promise<void>
  // Shows when the server answers.
  reset(): Promise<void>
}

// The test plays the server behind the RPC stub.
let serverState: Counter
let accept: boolean
let online: boolean
let calls: unknown[][]
let notify: () => void
let store: SyncedStore<Counter, Actions>
let shown: number | undefined
let root: Root
let restore: () => void

const remote = (async (...args: unknown[]) => {
  // Answer on a later task, like a real request, so a test can see the state in between.
  await new Promise(resolve => setTimeout(resolve, 0))
  if (!online) throw new TypeError('Failed to fetch')
  calls.push(args)
  const command = args[0] as SetCount | undefined
  if (command && accept) serverState = { count: command.set }
  return serverState
}) as unknown as SyncedState<Counter, SetCount>

function report(count: number | undefined) {
  shown = count
}

function Probe() {
  report(store(current => current.state?.count))
  return null
}

const settle = () => act(async () => void (await new Promise(resolve => setTimeout(resolve, 20))))

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

  serverState = { count: 10 }
  accept = true
  online = true
  calls = []
  __attachBridge({
    onSyncChanged: listener => {
      notify = listener
      return () => {}
    }
  })
  store = createSyncedStore(remote, (send, get) => ({
    add: by => {
      const set = (get()?.count ?? 0) + by
      return send({ set }, state => ({ count: state.count + by }))
    },
    reset: () => send({ set: 0 })
  }))
  root = createRoot(document.getElementById('root') as unknown as Element)
  await act(async () => root.render(<Probe />))
  await settle()
})

afterEach(async () => {
  await act(async () => root.unmount())
  restore()
})

const commands = () => calls.filter(args => args.length > 0)

test('reads the state when a component starts using the store', () => {
  expect(shown).toBe(10)
  expect(store.getState()).toEqual({ count: 10 })
  expect(calls).toEqual([[]])
})

test('an optimistic action shows at once, then the server state takes over', async () => {
  await act(async () => void store.actions.add(5))
  expect(shown).toBe(15)
  expect(commands()).toEqual([])
  await settle()
  expect(commands()).toEqual([[{ set: 15 }]])
  expect(shown).toBe(15)
  expect(store().pending).toBe(0)
})

test('an action without an optimistic change shows only after the server answers', async () => {
  let answered = false
  await act(async () => void store.actions.reset().then(() => (answered = true)))
  expect(shown).toBe(10)
  expect(answered).toBe(false)
  await settle()
  expect(answered).toBe(true)
  expect(shown).toBe(0)
})

test('two optimistic actions before a render build on each other', async () => {
  await act(async () => {
    void store.actions.add(1)
    void store.actions.add(1)
  })
  expect(shown).toBe(12)
  await settle()
  expect(commands()).toEqual([[{ set: 11 }], [{ set: 12 }]])
  expect(shown).toBe(12)
})

test('an optimistic change the server drops disappears', async () => {
  accept = false
  await act(async () => void store.actions.add(5))
  expect(shown).toBe(15)
  await settle()
  expect(shown).toBe(10)
  expect(store().pending).toBe(0)
})

test('offline commands wait and are sent when the host says to sync', async () => {
  online = false
  await act(async () => void store.actions.add(5))
  await settle()
  expect(shown).toBe(15)
  expect(store().status).toBe('reconnecting')
  expect(store().pending).toBe(1)

  online = true
  await act(async () => notify())
  await settle()
  expect(commands()).toEqual([[{ set: 15 }]])
  expect(store().status).toBe('live')
  expect(store().pending).toBe(0)
})

test("another window's change arrives when the host says to sync", async () => {
  serverState = { count: 42 }
  await act(async () => notify())
  await settle()
  expect(shown).toBe(42)
})
