import { expect, test } from 'bun:test'

import type { SocketListener } from '@/client/runtime/reconnecting-socket'

import { createChannelHub, type ChannelTransport } from './applet-channels'

// A socket the test opens and drops by hand, recording what the hub sends.
function fakeSocket() {
  const listeners = new Set<SocketListener>()
  const sent: object[] = []
  const state = { isOpen: false, holders: 0, reconnects: 0 }
  const transport: ChannelTransport = {
    get isOpen() {
      return state.isOpen
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    start() {
      state.holders++
      return () => {
        state.holders--
      }
    },
    send(message) {
      if (state.isOpen) sent.push(message)
    },
    reconnect() {
      state.reconnects++
    }
  }
  return {
    transport,
    sent,
    state,
    open() {
      state.isOpen = true
      for (const listener of listeners) listener.open?.()
    },
    drop() {
      state.isOpen = false
      for (const listener of listeners) listener.close?.()
    },
    receive(message: object) {
      for (const listener of listeners) listener.message?.(message)
    }
  }
}

function recorder() {
  const events: unknown[] = []
  return {
    events,
    listener: {
      open: () => events.push('open'),
      message: (data: unknown) => events.push(data),
      close: (message?: string) => events.push(message ? `close: ${message}` : 'close')
    }
  }
}

const ref = { module: 'views/todo', name: 'todo' }

test('opens a channel on every connection and holds the socket only while one is open', () => {
  const socket = fakeSocket()
  const hub = createChannelHub(socket.transport)
  expect(socket.state.holders).toBe(0)

  const { events, listener } = recorder()
  const channel = hub.open(ref, listener)
  expect(socket.state.holders).toBe(1)
  // Not connected yet: nothing can be sent.
  expect(channel.send('early')).toBe(false)

  socket.open()
  expect(socket.sent).toEqual([{ type: 'channel:open', id: '1', ...ref }])
  expect(channel.send('unconfirmed')).toBe(false)
  socket.receive({ type: 'channel:opened', id: '1' })
  socket.receive({ type: 'channel:message', id: '1', data: { hello: true } })
  expect(channel.send('hi')).toBe(true)

  socket.drop()
  expect(channel.send('offline')).toBe(false)
  socket.open()

  expect(events).toEqual(['open', { hello: true }, 'close'])
  expect(socket.sent).toEqual([
    { type: 'channel:open', id: '1', ...ref },
    { type: 'channel:message', id: '1', data: 'hi' },
    { type: 'channel:open', id: '1', ...ref }
  ])

  channel.close()
  expect(socket.sent.at(-1)).toEqual({ type: 'channel:close', id: '1' })
  expect(socket.state.holders).toBe(0)
  socket.receive({ type: 'channel:message', id: '1', data: 'after close' })
  expect(events).toHaveLength(3)
})

test('asks again for a channel the server dropped, without touching the others', async () => {
  const socket = fakeSocket()
  const hub = createChannelHub(socket.transport)
  const dropped = recorder()
  const healthy = recorder()
  hub.open(ref, dropped.listener)
  hub.open({ module: 'views/todo', name: 'other' }, healthy.listener)
  socket.open()
  socket.receive({ type: 'channel:opened', id: '1' })
  socket.receive({ type: 'channel:opened', id: '2' })
  const before = socket.sent.length

  socket.receive({
    type: 'channel:closed',
    id: '1',
    message: 'Server code changed'
  })
  expect(dropped.events).toEqual(['open', 'close: Server code changed'])
  expect(healthy.events).toEqual(['open'])
  expect(socket.sent).toHaveLength(before)

  await Bun.sleep(600)
  expect(socket.sent.slice(before)).toEqual([{ type: 'channel:open', id: '1', ...ref }])
})

test('a failing listener does not stop delivery to other applets', () => {
  const socket = fakeSocket()
  const hub = createChannelHub(socket.transport)
  const working = recorder()
  const original = console.error
  console.error = () => {}
  try {
    hub.open(ref, {
      open: () => {
        throw new Error('applet bug')
      }
    })
    hub.open(ref, working.listener)
    socket.open()
    socket.receive({ type: 'channel:opened', id: '1' })
    socket.receive({ type: 'channel:opened', id: '2' })
  } finally {
    console.error = original
  }
  expect(working.events).toEqual(['open'])
})
