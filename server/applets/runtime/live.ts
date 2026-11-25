// Browser-only runtime for `moi/live`. A synced state imported from a
// `.server.ts` is an RPC function here: no argument reads the state, a command
// changes it. The host tells us when to read again (see `onSyncChanged`).
import { useSyncExternalStore } from 'react'
import type { SyncedSend, SyncedStore, SyncedStoreSnapshot } from 'moi/live'
import type { SyncedState } from 'moi/server'

import { __getBridge } from './moi'

type Remote<S> = (...command: unknown[]) => Promise<S>
type Pending<S, C> = {
  command: C
  // How the command shows before the server answers. Without it, nothing shows until then.
  optimistic?: (state: S) => S
  done: () => void
}

export function createSyncedStore<S, C, T>(
  state: SyncedState<S, C>,
  createActions: (send: SyncedSend<S, C>, get: () => S | undefined) => T
): SyncedStore<S, T> {
  const remote = state as unknown as Remote<S>
  // The state the server answered with last.
  let confirmed: { state: S } | undefined
  // Commands the server has not answered yet, oldest first.
  let pending: Pending<S, C>[] = []
  let snapshot: SyncedStoreSnapshot<S> = {
    state: undefined,
    status: 'connecting',
    pending: 0,
    error: undefined
  }
  const listeners = new Set<() => void>()
  let stopListening: (() => void) | undefined
  // Requests go out one at a time, so answers come back in server order.
  let chain: Promise<void> = Promise.resolve()

  function publish(change: Partial<Pick<SyncedStoreSnapshot<S>, 'status' | 'error'>> = {}) {
    snapshot = {
      ...snapshot,
      ...change,
      // What the user sees: the server's state with the optimistic changes on top.
      state:
        confirmed &&
        pending.reduce(
          (shown, op) => (op.optimistic ? op.optimistic(shown) : shown),
          confirmed.state
        ),
      pending: pending.length
    }
    for (const listener of [...listeners]) listener()
  }

  function settle(op: Pending<S, C> | undefined) {
    if (!op) return
    pending = pending.filter(other => other !== op)
    op.done()
  }

  // Send every waiting command, oldest first; with none waiting, read the state.
  function sync() {
    chain = chain.then(async () => {
      do {
        const op = pending[0]
        try {
          confirmed = { state: await (op ? remote(op.command) : remote()) }
          settle(op)
          publish({ status: 'live', error: undefined })
        } catch (error) {
          // Not reached (a network failure): keep the commands for the next try.
          // Refused by the server: drop the command, its change disappears.
          const offline = error instanceof TypeError
          if (!offline) settle(op)
          publish({
            status: !offline && op ? snapshot.status : confirmed ? 'reconnecting' : 'connecting',
            error: error instanceof Error && error.message ? error.message : 'Could not connect'
          })
          if (offline || !op) return
        }
      } while (pending.length > 0)
    })
  }

  const send: SyncedSend<S, C> = (command, optimistic) =>
    new Promise<void>(done => {
      pending = [...pending, { command, optimistic, done }]
      publish()
      sync()
    })

  // Connected while a component uses the store.
  function subscribe(listener: () => void) {
    listeners.add(listener)
    if (listeners.size === 1) {
      stopListening = __getBridge()?.onSyncChanged?.(sync)
      sync()
    }
    return () => {
      listeners.delete(listener)
      if (listeners.size > 0) return
      stopListening?.()
      stopListening = undefined
    }
  }

  function useStore<U>(selector?: (current: SyncedStoreSnapshot<S>) => U) {
    const select = () => (selector ? selector(snapshot) : snapshot)
    return useSyncExternalStore(subscribe, select, select)
  }

  const getState = () => snapshot.state
  return Object.assign(useStore, {
    actions: createActions(send, getState),
    getState,
    reconnect: sync
  }) as SyncedStore<S, T>
}
