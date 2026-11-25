import type { ServerEvent } from '@/lib/events'
import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function freePort() {
  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response('') })
  const port = server.port!
  server.stop(true)
  return port
}

async function connect(url: string) {
  const socket = new WebSocket(url)
  const messages: Record<string, unknown>[] = []
  socket.onmessage = event => messages.push(JSON.parse(String(event.data)))
  await new Promise<void>((resolve, reject) => {
    socket.onopen = () => resolve()
    socket.onerror = reject
  })
  return { socket, messages }
}

async function until(check: () => boolean) {
  const deadline = Date.now() + 5000
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for a socket message')
    await Bun.sleep(10)
  }
}

test('real socket routes isolate shared workspaces, personal state, harness events and navigation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'moi-sockets-'))
  const port = freePort()
  const controlPort = freePort()
  for (const id of ['one', 'two', 'visitor']) {
    await Bun.write(
      join(root, id, '.moi/.workspace.json'),
      JSON.stringify({
        version: 2,
        ...(id === 'visitor' ? { remote: { user_id: 'alice', workspace_id: 'one' } } : {})
      })
    )
  }
  await Bun.write(
    join(root, 'workspaces.json'),
    JSON.stringify(
      ['one', 'two', 'visitor'].map(id => ({ id, path: join(root, id), harness: 'codex' }))
    )
  )
  const ready = Promise.withResolvers<void>()
  const navigation = Promise.withResolvers<void>()
  const scratch = Promise.withResolvers<unknown>()
  const child = Bun.spawn(
    [
      process.execPath,
      '-e',
      `
    await import('./server/web.ts');
    const { publishEvent } = await import('./server/events.ts');
    const { navigationRelay } = await import('./server/navigation-relay.ts');
    const { relayScratchOp } = await import('./server/scratchpad/relay.ts');
    process.on('message', async message => {
      if (message.type === 'scratch') {
        const result = await relayScratchOp('one', { kind: 'view' });
        process.send({ type: 'scratch-result', result });
      }
      if (message.type === 'publish') publishEvent(message.event);
      if (message.type === 'navigate') {
        await navigationRelay.navigate('one', 'moi:/overview');
        process.send({ type: 'navigated' });
      }
    });
    process.send({ type: 'ready' });
  `
    ],
    {
      cwd: join(import.meta.dir, '../..'),
      env: {
        ...process.env,
        MOI_DATA_DIR: root,
        MOI_ENVIRONMENT: 'local',
        MOI_SECRET_BACKEND: 'file',
        PORT: String(port),
        MOI_CONTROL_PORT: String(controlPort)
      },
      stdout: 'ignore',
      stderr: 'pipe',
      ipc(message) {
        if (message.type === 'ready') ready.resolve()
        if (message.type === 'navigated') navigation.resolve()
        if (message.type === 'scratch-result') scratch.resolve(message.result)
      }
    }
  )
  const sockets: WebSocket[] = []
  try {
    await Promise.race([
      ready.promise,
      child.exited.then(async code => {
        throw new Error(`Server exited ${code}: ${await new Response(child.stderr).text()}`)
      }),
      Bun.sleep(10_000).then(() => {
        throw new Error('Server startup timed out')
      })
    ])
    const base = `ws://127.0.0.1:${port}`
    const connections: Awaited<ReturnType<typeof connect>>[] = []
    for (const path of [
      '/api/events',
      '/api/harness/events',
      '/api/workspaces/one/events',
      '/api/workspaces/two/events'
    ]) {
      const connection = await connect(base + path)
      sockets.push(connection.socket)
      connections.push(connection)
    }
    const [machine, harness, one, two] = connections
    one!.socket.send(JSON.stringify({ type: 'ping' }))
    await until(() => one!.messages.some(message => message.type === 'pong'))
    expect(harness!.messages).toContainEqual({ type: 'sessions:status-snapshot', sessions: [] })
    for (const connection of connections) connection.messages.length = 0
    const send = (event: ServerEvent) => child.send({ type: 'publish', event })
    send({
      type: 'personal-state:changed',
      workspaceId: 'visitor',
      state: { revision: 4, selected: {}, sessions: {}, pendingViews: {} }
    })
    send({ type: 'harness:changed' })
    send({ type: 'view:changed', workspaceId: 'one', name: 'plan' })
    send({ type: 'view:changed', workspaceId: 'two', name: 'other' })
    await until(() => connections.every(connection => connection.messages.length > 0))
    expect(machine!.messages).toEqual([
      {
        type: 'personal-state:changed',
        workspaceId: 'visitor',
        state: { revision: 4, selected: {}, sessions: {}, pendingViews: {} }
      }
    ])
    expect(harness!.messages).toEqual([{ type: 'harness:changed' }])
    expect(one!.messages).toEqual([{ type: 'view:changed', name: 'plan' }])
    expect(two!.messages).toEqual([{ type: 'view:changed', name: 'other' }])

    for (const connection of connections) connection.messages.length = 0
    const control = await connect(`ws://127.0.0.1:${controlPort}`)
    sockets.push(control.socket)
    for (const [index, [path, only]] of [
      [join(root, 'one', '.moi'), 'views'],
      [join(root, 'visitor'), 'widgets/counter'],
      [root, undefined],
      [undefined, undefined]
    ].entries()) {
      control.socket.send(JSON.stringify({ type: 'applets:refresh', path, only }))
      await until(() => control.messages.length > index)
    }
    expect(control.messages).toEqual([
      { ok: true },
      { ok: true },
      { error: expect.stringContaining('not inside a registered Moi workspace') },
      { error: expect.stringContaining('workspace path') }
    ])
    await until(() => machine!.messages.length >= 2)
    expect(machine!.messages).toEqual([
      { type: 'applets:refresh', workspaceId: 'one', only: 'views' },
      { type: 'applets:refresh', workspaceId: 'visitor', only: 'widgets', name: 'counter' }
    ])
    expect(one!.messages).toEqual([])
    expect(two!.messages).toEqual([])
    expect(harness!.messages).toEqual([])

    for (const connection of connections) connection.messages.length = 0
    const moved = await fetch(`http://127.0.0.1:${port}/api/workspaces/one`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        widgetGrid: [{ i: '_moi_views', x: 2, y: 3 }],
        origin: 'editing-tab'
      })
    })
    expect(moved.status).toBe(204)
    await until(() => one!.messages.length > 0 && machine!.messages.length > 0)
    expect(one!.messages).toEqual([{ type: 'workspace-config:changed', origin: 'editing-tab' }])
    expect(machine!.messages).toEqual([{ type: 'workspaces-list:changed' }])
    expect(two!.messages).toEqual([])
    expect(harness!.messages).toEqual([])

    // A CLI theme edit can arrive while a browser is moving a widget.
    const workspaceUrl = `http://127.0.0.1:${port}/api/workspaces/one`
    const widgetGrid = [{ i: '_moi_views', x: 0, y: 1 }]
    control.socket.send(JSON.stringify({ type: 'theme', path: join(root, 'one'), color: 'rose' }))
    const gridSave = await fetch(workspaceUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ widgetGrid })
    })
    expect(gridSave.status).toBe(204)
    await until(() =>
      control.messages.some(message => message.ok === true && message.color === 'rose')
    )
    expect(await (await fetch(workspaceUrl)).json()).toMatchObject({
      widgetGrid,
      theme: { color: 'rose' }
    })
    await until(() => one!.messages.length === 3 && machine!.messages.length === 3)

    for (const connection of connections) connection.messages.length = 0
    send({ type: 'workspace:open-requested', workspaceId: 'one' })
    child.send({ type: 'scratch' })
    await until(() => machine!.messages.some(message => message.type === 'scratchpad:op'))
    expect(machine!.messages).toContainEqual({
      type: 'workspace:open-requested',
      workspaceId: 'one'
    })
    const op = machine!.messages.find(message => message.type === 'scratchpad:op')!
    // Replies on owner and harness sockets must not settle the machine's request.
    const wrongReply = JSON.stringify({
      type: 'scratchpad:op-result',
      opId: op.opId,
      result: { wrong: true }
    })
    harness!.socket.send(wrongReply)
    one!.socket.send(wrongReply)
    await Bun.sleep(30)
    machine!.socket.send(
      JSON.stringify({ type: 'scratchpad:op-result', opId: op.opId, result: { ok: true } })
    )
    expect(await scratch.promise).toEqual({ ok: true })
    expect(harness!.messages).toEqual([])
    expect(one!.messages).toEqual([])
    expect(two!.messages).toEqual([])

    // Register on both transports. Only the machine channel can become a navigation target.
    const presence = JSON.stringify({
      type: 'navigation:presence',
      workspaceId: 'one',
      focused: true
    })
    machine!.socket.send(presence)
    one!.socket.send(presence)
    // A local HTTP round trip gives the server time to consume the frames.
    await fetch(`http://127.0.0.1:${port}/api/config`)
    child.send({ type: 'navigate' })
    await until(() => machine!.messages.some(message => message.type === 'navigation:request'))
    const request = machine!.messages.find(message => message.type === 'navigation:request')!
    machine!.socket.send(
      JSON.stringify({ type: 'navigation:result', requestId: request.requestId, ok: true })
    )
    await navigation.promise
    expect(one!.messages.some(message => message.type === 'navigation:request')).toBe(false)
    expect(two!.messages.some(message => message.type === 'navigation:request')).toBe(false)
    expect((await fetch(`http://127.0.0.1:${port}/api/workspaces/visitor/events`)).status).toBe(404)
  } finally {
    for (const socket of sockets) socket.close()
    child.kill('SIGTERM')
    await child.exited
    await rm(root, { recursive: true, force: true })
  }
}, 20_000)
