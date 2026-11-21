import { afterAll, beforeAll, expect, test } from 'bun:test'
import { join } from 'node:path'

import type { ChannelClientFrame, ChannelServerFrame } from '@/lib/channels'

import { closeChannelSocket, handleChannelFrame, isChannelFrame } from './channels'
import { reloadModules, restartWorker } from './functions'
import { getAppletLog } from './log'

// Browser frames in, browser frames out, with the real functions worker in
// between running the `live.server.ts` fixture.

const FIXTURES = join(import.meta.dir, '..', 'test', '__fixtures__')

let previousFunctionsDir: string | undefined
beforeAll(() => {
  previousFunctionsDir = process.env.MEI_FUNCTIONS_DIR
  process.env.MEI_FUNCTIONS_DIR = FIXTURES
})

afterAll(() => {
  restartWorker(FIXTURES)
  if (previousFunctionsDir === undefined) delete process.env.MEI_FUNCTIONS_DIR
  else process.env.MEI_FUNCTIONS_DIR = previousFunctionsDir
})

function browser() {
  const frames: ChannelServerFrame[] = []
  const socket = {
    send: (data: string) => frames.push(JSON.parse(data) as ChannelServerFrame)
  }
  return {
    socket,
    frames,
    send(frame: ChannelClientFrame) {
      const raw = JSON.stringify(frame)
      expect(isChannelFrame(raw)).toBe(true)
      handleChannelFrame(socket, FIXTURES, raw)
    },
    async until(check: () => boolean) {
      const deadline = Date.now() + 5000
      while (!check()) {
        if (Date.now() > deadline) throw new Error(`Timed out. Got: ${JSON.stringify(frames)}`)
        await Bun.sleep(5)
      }
    }
  }
}

test('carries a channel between a browser socket and workspace server code', async () => {
  const tab = browser()
  tab.send({ type: 'channel:open', id: 'a', module: 'live', name: 'echo' })
  // Sent before the worker confirmed the channel: must still arrive, in order.
  tab.send({ type: 'channel:message', id: 'a', data: 'one' })
  tab.send({ type: 'channel:message', id: 'a', data: 'two' })
  await tab.until(() => tab.frames.length === 4)

  expect(tab.frames).toEqual([
    { type: 'channel:opened', id: 'a' },
    { type: 'channel:message', id: 'a', data: { hello: true } },
    { type: 'channel:message', id: 'a', data: { echo: 'one' } },
    { type: 'channel:message', id: 'a', data: { echo: 'two' } }
  ])

  tab.send({ type: 'channel:close', id: 'a' })
  tab.send({ type: 'channel:message', id: 'a', data: 'late' })
  const other = browser()
  other.send({ type: 'channel:open', id: 'a', module: 'live', name: 'echo' })
  other.send({ type: 'channel:message', id: 'a', data: 'all' })
  await other.until(() => other.frames.length === 3)

  // The closed channel is not counted and hears nothing more.
  expect(other.frames[2]).toEqual({
    type: 'channel:message',
    id: 'a',
    data: { all: 1 }
  })
  expect(tab.frames).toHaveLength(4)
  closeChannelSocket(other.socket)
})

test('tells the browser why a channel did not open and records it for the agent', async () => {
  const tab = browser()
  tab.send({
    type: 'channel:open',
    id: 'x',
    module: 'live',
    name: 'notAChannel'
  })
  await tab.until(() => tab.frames.length === 1)

  expect(tab.frames[0]).toMatchObject({ type: 'channel:closed', id: 'x' })
  const reason = (tab.frames[0] as { message?: string }).message
  expect(reason).toContain('not a channel')
  expect(getAppletLog(FIXTURES)).toContainEqual(
    expect.objectContaining({
      source: 'rpc',
      module: 'live',
      fn: 'notAChannel',
      message: reason
    })
  )
})

test('closes open channels when server code restarts, and a reopen reaches the new worker', async () => {
  const tab = browser()
  tab.send({ type: 'channel:open', id: 'c', module: 'live', name: 'counter' })
  tab.send({
    type: 'channel:message',
    id: 'c',
    data: {
      type: 'action',
      opId: 'before-restart',
      action: { type: 'add', by: 7 }
    }
  })
  await tab.until(() => tab.frames.length === 3)

  reloadModules(['live'], FIXTURES)
  await tab.until(() => tab.frames.length === 4)
  // No reason: an ordinary restart, not a failure to show or record.
  expect(tab.frames[3]).toEqual({ type: 'channel:closed', id: 'c' })

  tab.send({ type: 'channel:open', id: 'c', module: 'live', name: 'counter' })
  await tab.until(() => tab.frames.length === 6)
  // The fixture keeps its state in memory, so a fresh worker starts from zero.
  expect(tab.frames.slice(4)).toEqual([
    { type: 'channel:opened', id: 'c' },
    {
      type: 'channel:message',
      id: 'c',
      data: { type: 'snapshot', state: { count: 0 } }
    }
  ])
  closeChannelSocket(tab.socket)
})

test('ignores frames that are not channel frames', () => {
  const tab = browser()
  expect(isChannelFrame('{"type":"ping"}')).toBe(false)
  expect(isChannelFrame('{"type":"presence:set"}')).toBe(false)
  handleChannelFrame(
    tab.socket,
    FIXTURES,
    '{"type":"channel:open","id":"a","module":"../x","name":"y"}'
  )
  handleChannelFrame(tab.socket, FIXTURES, '{"type":"channel:nope","id":"a"}')
  expect(tab.frames).toEqual([])
})
