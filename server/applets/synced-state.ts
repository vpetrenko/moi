// Worker side of `syncedState` from `moi/sync`. A synced state is a plain
// server function, so it rides the existing applet RPC: called with no
// argument it returns the state, called with an event it runs that action on
// the stored state. `publish` hands an applied event to the Moi server, which
// sends it to every window (see functions.ts).
import type { StateDefinition, SyncActions, SyncedState, SyncedStorage } from 'moi/sync'

import {
  isSyncEvent,
  type SyncAnswer,
  type SyncEvent,
  type SyncMessage,
  type SyncSnapshot
} from '../../lib/sync'

// The worker stores `<module>/<export>` here before a call, so events name their state.
export const SYNC_KEY = Symbol.for('moi.sync.key')

type Call = { action: string; args: unknown[] }

export function createSyncedState(publish: (message: SyncMessage) => void) {
  return function syncedState<S, A extends SyncActions<S>>(
    definition: StateDefinition<S, A>,
    storage: SyncedStorage<S, A>
  ): SyncedState<S, A> {
    // The hooks see untyped calls here; the public type narrows them per action.
    const hooks = storage as {
      before?: (call: Call, state: S) => unknown
      after?: (call: Call, state: S) => unknown
    }
    // Starts at the clock, so a restarted worker never repeats an old number.
    let rev = Date.now()
    // The stored state the windows are in step with, as JSON text.
    let known: string | undefined
    // One call at a time, in arrival order: the last write wins.
    let queue: Promise<unknown> = Promise.resolve()

    async function handle(event: unknown, read: boolean): Promise<SyncSnapshot<S> | SyncAnswer> {
      const state: S = (await storage.load()) ?? definition.initial()
      const text = JSON.stringify(state)
      // Storage was changed outside: skip a number, so every window reads the state again.
      if (known !== undefined && text !== known) rev = Math.max(rev + 2, Date.now())
      known = text
      if (read) return { rev, state }

      // The event comes from a browser: only a known action of this state may run.
      if (!isSyncEvent(event) || !Object.hasOwn(definition.actions, event.action)) {
        return { rev, applied: false }
      }
      const draft = JSON.parse(text) as S
      const applied: SyncEvent = { id: event.id, action: event.action, args: event.args }
      try {
        // The hook may drop the call (false) or replace its arguments (an array).
        const verdict = await hooks.before?.({ action: applied.action, args: applied.args }, state)
        if (verdict === false) return { rev, applied: false }
        if (Array.isArray(verdict)) applied.args = verdict
        const action = definition.actions[applied.action] as (state: S, ...args: unknown[]) => void
        action(draft, ...applied.args)
      } catch (error) {
        console.error(`[moi] synced state action "${event.action}" was dropped:`, error)
        return { rev, applied: false }
      }
      const next = JSON.stringify(draft)
      // Nothing changed: the action did not fit the current state.
      if (next === text) return { rev, applied: false }
      await storage.save(draft)
      known = next
      rev += 1
      const key = (call as { [SYNC_KEY]?: string })[SYNC_KEY]
      if (key) publish({ key, rev, event: applied })
      // Side effects do not hold back the next call, and their failure changes nothing.
      void Promise.resolve()
        .then(() => hooks.after?.({ action: applied.action, args: applied.args }, draft))
        .catch(error => {
          console.error(`[moi] synced state "after" hook failed for "${applied.action}":`, error)
        })
      return { rev, applied: true, event: applied }
    }

    const call = (...args: unknown[]) => {
      const result = queue.then(() => handle(args[0], args.length === 0))
      queue = result.catch(() => {})
      return result
    }
    Object.assign(call, { [SYNC_KEY]: undefined })
    // The browser sees this export as an RPC function; the type only carries S and A.
    return call as unknown as SyncedState<S, A>
  }
}
