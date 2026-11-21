// MEI Functions Worker — child process that loads and executes .server.ts modules.
// Spawned by the main process with IPC. Receives call/reload messages.
import { parse, stringify } from 'devalue'
import { join, resolve, sep } from 'path'

import {
  channel,
  closeConnection,
  openConnection,
  receiveMessage,
  setChannelTransport,
  syncedState
} from './channel-runtime'

// `import { channel, syncedState } from 'moi/server'` in workspace server code
// resolves to this process's channel runtime, whatever the workspace installs.
Bun.plugin({
  name: 'moi-server',
  setup(build) {
    build.module('moi/server', () => ({
      exports: { channel, syncedState },
      loader: 'object'
    }))
  }
})

const MEI_DIR =
  process.env.MEI_FUNCTIONS_DIR ?? join(import.meta.dir, '..', '..', 'test-workspace', '.moi')

// The parent spawns us from a neutral cwd so Bun never auto-loads the
// workspace's `.env` into this process — moi injects the resolved, scope-filtered
// env at spawn instead (see functions.ts). Restore the documented
// `cwd = workspace root` so server functions can use plain relative paths.
if (process.env.MEI_WORKSPACE_ROOT) {
  try {
    process.chdir(process.env.MEI_WORKSPACE_ROOT)
  } catch {}
}

const moduleCache = new Map<string, Record<string, unknown>>()

function send(msg: unknown) {
  try {
    process.send!(msg)
  } catch {
    // IPC channel closed — parent died
  }
}

async function loadModule(name: string): Promise<Record<string, unknown>> {
  const cached = moduleCache.get(name)
  if (cached) return cached

  // Module keys are paths relative to MEI_DIR (the workspace's `.moi/`),
  // e.g. "widgets/hello". Defense-in-depth: the route already rejects `..`
  // segments, but never load a file that resolves outside MEI_DIR.
  const filePath = join(MEI_DIR, `${name}.server.ts`)
  if (!resolve(filePath).startsWith(resolve(MEI_DIR) + sep)) {
    throw new Error(`Server module "${name}" not found`)
  }
  const file = Bun.file(filePath)

  if (!(await file.exists())) {
    throw new Error(`Server module "${name}" not found`)
  }

  const mod = (await import(filePath + `?t=${file.lastModified}`)) as Record<string, unknown>
  moduleCache.set(name, mod)
  // Tell the parent what's cached here — introspection only, shown in /status.
  send({ type: 'loaded', module: name })
  return mod
}

async function evictModule(name: string) {
  const mod = moduleCache.get(name)
  if (!mod) return

  if (typeof mod.dispose === 'function') {
    try {
      await (mod.dispose as () => Promise<void>)()
    } catch (err) {
      console.error(`[mei] dispose error in ${name}.server.ts:`, err)
    }
  }

  moduleCache.delete(name)
}

type CallMessage = { id: string; type: 'call'; module: string; name: string; args: string }
type ReloadMessage = { type: 'reload'; modules: string[] }
type ShutdownMessage = { type: 'shutdown' }
type ChannelMessage =
  | { type: 'channel:open'; connectionId: string; module: string; name: string }
  | { type: 'channel:message'; connectionId: string; data: unknown }
  | { type: 'channel:close'; connectionId: string }
type IncomingMessage = CallMessage | ReloadMessage | ShutdownMessage | ChannelMessage

setChannelTransport({
  opened: connectionId => send({ type: 'channel:opened', connectionId }),
  send: (connectionIds, data) => send({ type: 'channel:send', connectionIds, data }),
  closed: (connectionId, message) => send({ type: 'channel:closed', connectionId, message }),
  error: (connectionId, message) => send({ type: 'channel:error', connectionId, message })
})

process.on('message', async (raw: IncomingMessage) => {
  // Channel events are handed over at once; the runtime keeps each
  // connection's open, messages and close in order.
  if (raw.type === 'channel:open') {
    const { module: moduleName, name } = raw
    openConnection(raw.connectionId, async () => (await loadModule(moduleName))[name])
    return
  }
  if (raw.type === 'channel:message') return receiveMessage(raw.connectionId, raw.data)
  if (raw.type === 'channel:close') return closeConnection(raw.connectionId)

  if (raw.type === 'reload') {
    for (const name of raw.modules) {
      await evictModule(name)
    }
    return
  }

  // Graceful exit. The parent kills this process to pick up edited server code
  // — evicting from moduleCache isn't enough, because a module's own imports
  // are pinned in Bun's ESM registry with no way to invalidate them (the
  // `?t=` buster below only busts the .server.ts itself, one level deep). Run
  // every cached module's `dispose()` first so a hard kill doesn't strand a db
  // handle or timer; the parent hard-kills us if we take too long.
  if (raw.type === 'shutdown') {
    for (const name of [...moduleCache.keys()]) {
      await evictModule(name)
    }
    process.exit(0)
  }

  if (raw.type === 'call') {
    const { id, module: moduleName, name, args } = raw

    if (!id || !moduleName || !name) {
      send({ id, type: 'error', message: 'Malformed call message' })
      return
    }

    try {
      const mod = await loadModule(moduleName)
      const fn = mod[name]

      if (typeof fn !== 'function') {
        throw new Error(`"${name}" in ${moduleName}.server.ts is not a function`)
      }

      const parsedArgs = parse(args) as unknown[]
      const result = await fn(...parsedArgs)

      send({ id, type: 'result', data: stringify(result) })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      send({ id, type: 'error', message })
    }
  }
})

send({ type: 'ready' })
