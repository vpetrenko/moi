// Wire format of synced states (`moi/sync`). One event is one action call:
// the client runs it on its copy and sends it; the server runs it on its copy
// and sends it on to every window.
export type SyncEvent = { id: string; action: string; args: unknown[] }

// Server to every window of the workspace. `key` names the synced state
// (`<module>/<export>`). `rev` counts the state's changes: a window applies
// `rev` only on top of `rev - 1`, and reads the whole state again after a gap.
export type SyncMessage = { key: string; rev: number; event: SyncEvent }

// Answers of a synced state's RPC function: with no argument, and with an event.
export type SyncSnapshot<S> = { rev: number; state: S }
export type SyncAnswer = { rev: number; applied: boolean }

export function isSyncEvent(value: unknown): value is SyncEvent {
  if (typeof value !== 'object' || value === null) return false
  const { id, action, args } = value as Record<string, unknown>
  return (
    typeof id === 'string' &&
    id.length > 0 &&
    id.length <= 64 &&
    typeof action === 'string' &&
    action.length <= 100 &&
    Array.isArray(args)
  )
}

export function isSyncMessage(value: unknown): value is SyncMessage {
  if (typeof value !== 'object' || value === null) return false
  const { key, rev, event } = value as Record<string, unknown>
  return typeof key === 'string' && typeof rev === 'number' && isSyncEvent(event)
}

// `defineState` of `moi/sync`, the same on both sides. The state type is given
// explicitly (`defineState<Todo>(first)`), so every action gets a typed `state`.
export function defineState<S>(initial: S) {
  const text = JSON.stringify(initial)
  return {
    actions<A extends Record<string, (state: S, ...args: never[]) => void>>(actions: A) {
      // A fresh copy each time: nobody can change the first value by accident.
      return { initial: () => JSON.parse(text) as S, actions }
    }
  }
}
