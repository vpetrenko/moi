import { afterEach, beforeEach, expect, test } from 'bun:test'
import { parseHTML } from 'linkedom'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { SyncedState, SyncedStore } from 'moi/sync'

import type { SyncMessage } from '../../../lib/sync'
import { createSyncedState, SYNC_KEY } from '../synced-state'

import { __attachBridge } from './moi'
import { createStore, defineState } from './sync'

type List = { items: string[] }

const MAX = 3
const listState = defineState<List>({ items: [] }).actions({
  add(state, item: string) {
    if (state.items.length < MAX && !state.items.includes(item)) state.items.push(item)
  },
  remove(state, item: string) {
    state.items = state.items.filter(other => other !== item)
  }
})
type Store = SyncedStore<List, typeof listState.actions>
type Window = { store: Store; shown: () => string[]; listener: (message?: unknown) => void }

// The real server code behind a fake RPC stub and a fake workspace socket.
let stored: List | undefined
let online: boolean
let reads: number
let deliver: (message: SyncMessage) => boolean
let windows: Window[]
let roots: Root[]
let restore: () => void

const tick = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms))
const settle = () => act(async () => void (await tick(30)))

async function openWindow(server: (...args: unknown[]) => Promise<unknown>): Promise<Window> {
  const remote = Object.assign(
    async (...args: unknown[]) => {
      // Answer on a later task, like a real request.
      await tick()
      if (!online) throw new TypeError('Failed to fetch')
      if (args.length === 0) reads++
      return server(...args)
    },
    { key: 'views/list/list' }
  ) as unknown as SyncedState<List, typeof listState.actions>

  let listener: Window['listener'] = () => {}
  __attachBridge({
    onSync: next => {
      listener = next
      return () => {}
    }
  })
  const store = createStore(listState, remote)
  let shown: string[] = []
  const report = (items: string[]) => {
    shown = items
  }
  function Probe() {
    report(store.use(state => state.items))
    return null
  }
  const root = createRoot(document.createElement('div') as unknown as Element)
  roots.push(root)
  await act(async () => root.render(<Probe />))
  return { store, shown: () => shown, listener: message => listener(message) }
}

beforeEach(async () => {
  const { window, document } = parseHTML('<html><body></body></html>')
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

  stored = { items: ['a'] }
  online = true
  reads = 0
  deliver = () => true
  windows = []
  roots = []
  const server = createSyncedState(message => {
    // The Moi server sends an applied event to every window, the sender too.
    if (deliver(message))
      for (const window of windows) void tick().then(() => window.listener(message))
  })(listState, {
    load: () => stored,
    save: state => {
      stored = state
    }
  }) as unknown as (...args: unknown[]) => Promise<unknown>
  Object.assign(server, { [SYNC_KEY]: 'views/list/list' })

  windows.push(await openWindow(server), await openWindow(server))
  await settle()
})

afterEach(async () => {
  for (const root of roots) await act(async () => root.unmount())
  restore()
})

test('each window reads the stored state once', () => {
  const [one, two] = windows
  expect(one.shown()).toEqual(['a'])
  expect(two.shown()).toEqual(['a'])
  expect(reads).toBe(2)
})

test('an action shows at once, and the other window gets it as an event, not a new read', async () => {
  const [one, two] = windows
  await act(async () => void one.store.add('b'))
  expect(one.shown()).toEqual(['a', 'b'])
  expect(two.shown()).toEqual(['a'])
  await settle()
  expect(one.shown()).toEqual(['a', 'b'])
  expect(two.shown()).toEqual(['a', 'b'])
  expect(stored).toEqual({ items: ['a', 'b'] })
  expect(reads).toBe(2)
})

test('a server action shows only when the server confirms it', async () => {
  const [one, two] = windows
  let answered = false
  await act(async () => void one.store.server.remove('a').then(() => (answered = true)))
  expect(one.shown()).toEqual(['a'])
  expect(answered).toBe(false)
  await settle()
  expect(answered).toBe(true)
  expect(one.shown()).toEqual([])
  expect(two.shown()).toEqual([])
})

test('actions from two windows end in the same state, last write wins', async () => {
  const [one, two] = windows
  await act(async () => {
    void one.store.add('b')
    void two.store.remove('a')
    void two.store.add('c')
    void one.store.remove('c')
  })
  await settle()
  expect(one.shown()).toEqual(stored!.items)
  expect(two.shown()).toEqual(stored!.items)
})

test('a call the server drops disappears from the screen', async () => {
  const [one, two] = windows
  await act(async () => {
    void one.store.add('b')
    void one.store.add('c')
  })
  await settle()
  // The list is full on the server; this window's optimistic add cannot hold.
  await act(async () => {
    void two.store.remove('c')
    void one.store.add('d')
    void two.store.add('e')
  })
  await settle()
  expect(stored!.items).toHaveLength(MAX)
  expect(one.shown()).toEqual(stored!.items)
  expect(two.shown()).toEqual(stored!.items)
})

test('offline calls show, wait, and are sent when the connection is back', async () => {
  const [one, two] = windows
  online = false
  await act(async () => void one.store.add('b'))
  await settle()
  expect(one.shown()).toEqual(['a', 'b'])
  expect(two.shown()).toEqual(['a'])

  online = true
  await act(async () => one.listener())
  await settle()
  expect(stored).toEqual({ items: ['a', 'b'] })
  expect(two.shown()).toEqual(['a', 'b'])
})

test('a window that missed an event reads the state again', async () => {
  const [one, two] = windows
  let dropNext = true
  // The first event never reaches the windows; the second shows the gap.
  deliver = () => {
    const pass = !dropNext
    dropNext = false
    return pass
  }
  await act(async () => void one.store.add('b'))
  await settle()
  expect(two.shown()).toEqual(['a'])
  await act(async () => void one.store.add('c'))
  await settle()
  expect(two.shown()).toEqual(['a', 'b', 'c'])
  expect(reads).toBe(3)
})
