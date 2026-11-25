// Worker side of `syncedState` from `moi/server`. A synced state is a plain
// server function, so it rides the existing applet RPC: called with no
// argument it returns the state, called with a command it applies the command
// and returns the new state. `changed` tells the Moi server to notify every
// open window (see functions.ts).
import type { SyncedState, SyncedStateOptions } from 'moi/server'

export function createSyncedState(changed: () => void) {
  return function syncedState<S, C>(options: SyncedStateOptions<S>): SyncedState<S, C> {
    // One call at a time, in arrival order: the last write wins.
    let queue: Promise<unknown> = Promise.resolve()

    async function handle(commands: unknown[]): Promise<S> {
      const state: S = await options.load()
      if (commands.length === 0) return state
      let next = state
      try {
        next = options.apply(state, commands[0])
      } catch (error) {
        // A command that does not fit the current state is dropped.
        console.error('[moi] synced state command was dropped:', error)
      }
      if (next === state) return state
      await options.save(next)
      changed()
      return next
    }

    const call = (...commands: unknown[]): Promise<S> => {
      const result = queue.then(() => handle(commands))
      queue = result.catch(() => {})
      return result
    }
    // The browser sees this export as an RPC function; the type only carries S and C.
    return call as unknown as SyncedState<S, C>
  }
}
