import { expect, test } from 'bun:test'

import type { SyncAnswer, SyncEvent, SyncMessage, SyncSnapshot } from '../../lib/sync'

import { createSyncedState, SYNC_KEY } from './synced-state'

type List = { items: string[] }
type Call = {
  (): Promise<SyncSnapshot<List>>
  (event: unknown): Promise<SyncAnswer>
}

const definition = {
  initial: (): List => ({ items: [] }),
  actions: {
    add(state: List, item: string) {
      if (!state.items.includes(item)) state.items.push(item)
    },
    remove(state: List, item: string) {
      state.items = state.items.filter(other => other !== item)
    },
    fail() {
      throw new Error('boom')
    }
  }
}

let nextId = 0
const event = (action: string, ...args: unknown[]): SyncEvent => ({
  id: `e${nextId++}`,
  action,
  args
})

type Hook = (call: { action: string; args: unknown[] }, state: List) => unknown

function setup(options: { failSave?: () => boolean; before?: Hook; after?: Hook } = {}) {
  let stored: List | undefined
  const published: SyncMessage[] = []
  const call = createSyncedState(message => published.push(message))(definition, {
    load: () => stored,
    save: state => {
      if (options.failSave?.()) throw new Error('disk full')
      stored = state
    },
    ...(options.before ? { before: options.before as never } : {}),
    ...(options.after ? { after: options.after as never } : {})
  }) as unknown as Call
  Object.assign(call, { [SYNC_KEY]: 'views/list/list' })
  return { call, published, stored: () => stored, write: (state: List) => (stored = state) }
}

test('a read gives the initial state when nothing is stored, and saves nothing', async () => {
  const { call, published, stored } = setup()
  expect((await call()).state).toEqual({ items: [] })
  expect(stored()).toBeUndefined()
  expect(published).toEqual([])
})

test('an applied action is saved and sent on with the next rev', async () => {
  const { call, published, stored } = setup()
  const { rev } = await call()
  const add = event('add', 'milk')
  expect(await call(add)).toEqual({ rev: rev + 1, applied: true, event: add })
  expect(stored()).toEqual({ items: ['milk'] })
  expect(published).toEqual([{ key: 'views/list/list', rev: rev + 1, event: add }])
})

test('actions run in arrival order, so the last write wins', async () => {
  const { call, published, stored } = setup()
  await Promise.all([call(event('add', 'a')), call(event('remove', 'a')), call(event('add', 'b'))])
  expect(stored()).toEqual({ items: ['b'] })
  const revs = published.map(message => message.rev)
  expect(revs).toEqual([revs[0], revs[0] + 1, revs[0] + 2])
})

test('a call that does not fit is dropped: no save, no event, same rev', async () => {
  const { call, published, stored } = setup()
  await call(event('add', 'milk'))
  const { rev } = await call()
  for (const dropped of [
    event('add', 'milk'), // changes nothing
    event('fail'), // throws
    event('toString'), // not an action of this state
    { action: 'add', args: ['x'] }, // not an event
    'add'
  ]) {
    expect(await call(dropped)).toEqual({ rev, applied: false })
  }
  expect(stored()).toEqual({ items: ['milk'] })
  expect(published).toHaveLength(1)
})

test('an outside edit is kept and leaves a gap in rev, so windows read the state again', async () => {
  const { call, published, write } = setup()
  await call(event('add', 'a'))
  write({ items: ['a', 'edited outside'] })
  await call(event('add', 'b'))
  expect((await call()).state).toEqual({ items: ['a', 'edited outside', 'b'] })
  expect(published[1].rev).toBeGreaterThan(published[0].rev + 1)
})

test('a failed save does not block later calls', async () => {
  let fail = true
  const { call } = setup({ failSave: () => fail })
  await expect(call(event('add', 'a'))).rejects.toThrow('disk full')
  fail = false
  expect((await call(event('add', 'b'))).applied).toBe(true)
})

test('before can drop a call, by returning false or by throwing', async () => {
  const { call, published, stored } = setup({
    before: ({ args }) => {
      if (args[0] === 'forbidden') return false
      if (args[0] === 'broken') throw new Error('no')
    }
  })
  expect((await call(event('add', 'forbidden'))).applied).toBe(false)
  expect((await call(event('add', 'broken'))).applied).toBe(false)
  expect((await call(event('add', 'fine'))).applied).toBe(true)
  expect(stored()).toEqual({ items: ['fine'] })
  expect(published).toHaveLength(1)
})

test('before can replace the arguments; the answer and the event carry the new ones', async () => {
  const { call, published, stored } = setup({
    // Sees the state as stored before the action.
    before: ({ args }, state) => [`${String(args[0]).toUpperCase()}#${state.items.length}`]
  })
  const add = event('add', 'milk')
  const answer = await call(add)
  const changed = { id: add.id, action: 'add', args: ['MILK#0'] }
  expect(answer.event).toEqual(changed)
  expect(published[0].event).toEqual(changed)
  expect(stored()).toEqual({ items: ['MILK#0'] })
})

test('after runs once per applied call with the new state, and its failure changes nothing', async () => {
  const seen: unknown[] = []
  const { call, stored } = setup({
    after: (applied, state) => {
      seen.push([applied, structuredClone(state)])
      throw new Error('mail server down')
    }
  })
  expect((await call(event('add', 'milk'))).applied).toBe(true)
  expect((await call(event('add', 'milk'))).applied).toBe(false)
  expect((await call(event('add', 'eggs'))).applied).toBe(true)
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(seen).toEqual([
    [{ action: 'add', args: ['milk'] }, { items: ['milk'] }],
    [{ action: 'add', args: ['eggs'] }, { items: ['milk', 'eggs'] }]
  ])
  expect(stored()).toEqual({ items: ['milk', 'eggs'] })
})
