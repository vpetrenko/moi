// Browser-only runtime for `moi/sync`. A synced state imported from a
// `.server.ts` is an RPC function here: no argument reads the state, an event
// runs one action on the server. The server sends every applied event to all
// windows through the host (see `onSync`), and each window runs it on its copy.
import { useSyncExternalStore } from 'react'
import type {
  StateDefinition,
  SyncActions,
  SyncedState,
  SyncedStore,
  SyncResult,
  SyncStatus
} from 'moi/sync'

import {
  isSyncMessage,
  type SyncAnswer,
  type SyncEvent,
  type SyncSnapshot
} from '../../../lib/sync'

import { __getBridge } from './moi'

export { defineState } from '../../../lib/sync'

type Remote<S> = {
  (): Promise<SyncSnapshot<S>>
  (event: SyncEvent): Promise<SyncAnswer>
  // `<module>/<export>`, set by the RPC stub.
  key?: string
}
type Pending = {
  event: SyncEvent
  // Shown at once. Otherwise the change shows when the server's event arrives.
  optimistic: boolean
  done: (result: SyncResult) => void
}
type EventListener = (call: { action: string; args: unknown[] }, info: { own: boolean }) => void

const RESERVED = ['use', 'useStatus', 'server', 'reconnect', 'onEvent']

function messageOf(error: unknown) {
  return error instanceof Error && error.message ? error.message : 'Could not connect'
}

export function createStore<S, A extends SyncActions<S>>(
  definition: StateDefinition<S, A>,
  remote: SyncedState<S, A>
): SyncedStore<S, A> {
  const call = remote as unknown as Remote<S>
  // The server's state, as far as this window has applied its events.
  let confirmed = { rev: -1, state: definition.initial() }
  let loaded = false
  // Events that arrived ahead of `confirmed`, by rev.
  const future = new Map<number, SyncEvent>()
  // This window's calls the server has not confirmed yet, oldest first.
  let pending: Pending[] = []
  // Of those, the calls not sent yet.
  const unsent: Pending[] = []
  // What the user sees: `confirmed` with the optimistic calls on top.
  let shown = confirmed.state
  let status: SyncStatus = { status: 'connecting', loaded: false, pending: 0, error: undefined }
  const listeners = new Set<() => void>()
  const eventListeners = new Set<EventListener>()
  // Ids of this window's calls, to tell its own events from other windows'.
  const ownIds = new Set<string>()
  // Components and event listeners that keep the store connected.
  let users = 0
  let stopListening: (() => void) | undefined
  // Requests go out one at a time, so the server gets this window's calls in order.
  let chain: Promise<void> = Promise.resolve()
  let refreshQueued = false

  // Every call works on a fresh copy, so an action can simply change `state`.
  function run(state: S, event: SyncEvent): S {
    const draft = structuredClone(state)
    const action = definition.actions[event.action] as (state: S, ...args: unknown[]) => void
    action(draft, ...event.args)
    return draft
  }

  function publish(change: Partial<Pick<SyncStatus, 'status' | 'error'>> = {}) {
    let next = confirmed.state
    for (const op of pending) {
      if (!op.optimistic) continue
      try {
        next = run(next, op.event)
      } catch {
        // The call no longer fits the newer state; the server will drop it too.
      }
    }
    shown = next
    const updated = { ...status, ...change, loaded, pending: pending.length }
    if (
      updated.status !== status.status ||
      updated.error !== status.error ||
      updated.loaded !== status.loaded ||
      updated.pending !== status.pending
    ) {
      status = updated
    }
    for (const listener of [...listeners]) listener()
  }

  // Apply buffered events in server order. A gap means one was missed: read the state again.
  function drain() {
    for (;;) {
      const rev = confirmed.rev + 1
      const event = future.get(rev)
      if (!event) break
      future.delete(rev)
      try {
        confirmed = { rev, state: run(confirmed.state, event) }
      } catch {
        refresh()
        break
      }
      pending = pending.filter(op => op.event.id !== event.id)
      const info = { own: ownIds.delete(event.id) }
      for (const listener of [...eventListeners]) {
        try {
          listener({ action: event.action, args: event.args }, info)
        } catch (error) {
          console.error('[moi/sync] Event listener failed', error)
        }
      }
    }
    for (const rev of [...future.keys()]) if (rev <= confirmed.rev) future.delete(rev)
    if (future.size > 0) refresh()
  }

  function receive(rev: number, event: SyncEvent) {
    if (rev > confirmed.rev) future.set(rev, event)
    if (loaded) drain()
  }

  function refresh() {
    if (refreshQueued) return
    refreshQueued = true
    chain = chain.then(async () => {
      refreshQueued = false
      try {
        const snapshot = await call()
        if (!loaded || snapshot.rev >= confirmed.rev) confirmed = snapshot
        loaded = true
        drain()
        publish({ status: 'live', error: undefined })
      } catch (error) {
        publish({ status: loaded ? 'reconnecting' : 'connecting', error: messageOf(error) })
      }
    })
  }

  // Send the waiting calls, oldest first.
  function pump() {
    chain = chain.then(async () => {
      for (let op = unsent[0]; op; op = unsent[0]) {
        let answer: SyncAnswer | undefined
        let error: string | undefined
        try {
          answer = await call(op.event)
        } catch (failure) {
          error = messageOf(failure)
          // Not reached (a network failure): keep the calls for the next try.
          if (failure instanceof TypeError) {
            publish({ status: loaded ? 'reconnecting' : 'connecting', error })
            return
          }
          // Refused by the server: the call is dropped and its change disappears.
        }
        unsent.shift()
        pending = pending.filter(other => other !== op)
        if (answer?.applied) receive(answer.rev, answer.event ?? op.event)
        else ownIds.delete(op.event.id)
        publish(error ? { error } : { status: loaded ? 'live' : status.status, error: undefined })
        op.done({ applied: answer?.applied === true, ...(error ? { error } : {}) })
      }
    })
  }

  function send(action: string, args: unknown[], optimistic: boolean) {
    return new Promise<SyncResult>(done => {
      const op: Pending = { event: { id: crypto.randomUUID(), action, args }, optimistic, done }
      ownIds.add(op.event.id)
      pending = [...pending, op]
      unsent.push(op)
      publish()
      pump()
    })
  }

  function reconnect() {
    pump()
    refresh()
  }

  // Connected while a component or an event listener uses the store.
  function connect() {
    if (++users === 1) {
      stopListening = __getBridge()?.onSync?.(message => {
        // No message: the connection came back, events may have been missed.
        if (message === undefined) return reconnect()
        if (!isSyncMessage(message) || message.key !== call.key) return
        receive(message.rev, message.event)
        publish()
      })
      reconnect()
    }
    let connected = true
    return () => {
      if (!connected) return
      connected = false
      if (--users > 0) return
      stopListening?.()
      stopListening = undefined
    }
  }

  function subscribe(listener: () => void) {
    listeners.add(listener)
    const disconnect = connect()
    return () => {
      listeners.delete(listener)
      disconnect()
    }
  }

  function onEvent(listener: EventListener) {
    eventListeners.add(listener)
    const disconnect = connect()
    return () => {
      eventListeners.delete(listener)
      disconnect()
    }
  }

  function use<U>(selector: (state: S) => U) {
    const select = () => selector(shown)
    return useSyncExternalStore(subscribe, select, select)
  }
  function useStatus() {
    return useSyncExternalStore(
      subscribe,
      () => status,
      () => status
    )
  }

  const server: Record<string, (...args: unknown[]) => Promise<SyncResult>> = {}
  const store: Record<string, unknown> = { use, useStatus, reconnect, onEvent, server }
  for (const name of Object.keys(definition.actions)) {
    if (RESERVED.includes(name)) throw new Error(`"${name}" cannot be an action name`)
    store[name] = (...args: unknown[]) => send(name, args, true)
    server[name] = (...args: unknown[]) => send(name, args, false)
  }
  return store as SyncedStore<S, A>
}
