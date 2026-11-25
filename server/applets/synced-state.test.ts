import { expect, test } from 'bun:test'

import { createSyncedState } from './synced-state'

type Counter = { value: number }
type Call = (command?: unknown) => Promise<Counter>

function setup(apply: (state: Counter, command: unknown) => Counter) {
  let stored: Counter = { value: 0 }
  const saved: Counter[] = []
  let changes = 0
  const syncedState = createSyncedState(() => changes++)
  const call = syncedState<Counter, number>({
    load: () => stored,
    save: state => {
      stored = state
      saved.push(state)
    },
    apply
  }) as unknown as Call
  return { call, saved, changes: () => changes, write: (state: Counter) => (stored = state) }
}

const set = (state: Counter, command: unknown): Counter =>
  typeof command === 'number' ? { value: command } : state

test('a call without a command reads the state and saves nothing', async () => {
  const { call, saved, changes } = setup(set)
  expect(await call()).toEqual({ value: 0 })
  expect(saved).toEqual([])
  expect(changes()).toBe(0)
})

test('commands apply in arrival order, so the last write wins', async () => {
  const { call, saved, changes } = setup(set)
  const answers = await Promise.all([call(1), call(2), call(3)])
  expect(answers).toEqual([{ value: 1 }, { value: 2 }, { value: 3 }])
  expect(saved.at(-1)).toEqual({ value: 3 })
  expect(changes()).toBe(3)
})

test('a command that does not fit is dropped: no save, no notice, current state back', async () => {
  const { call, saved, changes } = setup((state, command) => {
    if (command === 'boom') throw new Error('boom')
    return set(state, command)
  })
  await call(5)
  expect(await call('not a number')).toEqual({ value: 5 })
  expect(await call('boom')).toEqual({ value: 5 })
  expect(saved).toEqual([{ value: 5 }])
  expect(changes()).toBe(1)
})

test('each command starts from storage, so outside edits are kept', async () => {
  const { call, write } = setup((state, command) =>
    typeof command === 'number' ? { value: state.value + command } : state
  )
  await call(1)
  write({ value: 100 })
  expect(await call(1)).toEqual({ value: 101 })
})

test('a failed save does not block later calls', async () => {
  let fail = true
  const call = createSyncedState(() => {})<Counter, number>({
    load: () => ({ value: 0 }),
    save: () => {
      if (fail) throw new Error('disk full')
    },
    apply: set
  }) as unknown as Call
  await expect(call(1)).rejects.toThrow('disk full')
  fail = false
  expect(await call(2)).toEqual({ value: 2 })
})
