// Public moi contract, reused internally and installed as `.moi/base.d.ts`.
// Editor/`tsc` only — the moi bundler needs no declarations.

declare module 'moi' {
  export type JsonValue =
    | null
    | boolean
    | number
    | string
    | JsonValue[]
    | { [key: string]: JsonValue }

  // Resolve moi:/views/..., moi:/files/... or an HTTP(S) address for the browser.
  // moi addresses become root-relative URLs using the current page's origin.
  // Workspace files use the server's media/asset stream.
  export function resolveUrl(url: string): string
  // Navigate to a workspace page, file, or HTTP(S) address in the current tab.
  // Workspace pages add browser history; their query strings become view params.
  export function navigate(url: string): void
  export type AttachmentInput =
    | { type: 'text'; label: string; text: string }
    | { type: 'file'; file: File; path?: never }
    | { type: 'file'; path: string; file?: never }
  // Stage an attachment in the current chat draft; does not send a message.
  export function addChatAttachment(input: AttachmentInput): void
  // Prepare optional attachments and send to the active chat without changing
  // its draft. Call from event handlers; each call starts an agent run and is
  // rate-limited. Preparation failure or navigation cancels the whole send.
  export type ChatMessageInput = { message: string; attachments?: AttachmentInput[] }
  export function sendChatMessage(input: ChatMessageInput): void
  export type WidgetConfig = {
    rowSpan: 1 | 2 | 3 | 4
    colSpan: 1 | 2 | 3 | 4
    // Advisory env hints for server functions; never blocks loading.
    requiredEnv?: string[]
  }
  export type ViewConfig = {
    // Nav tab label; defaults to the file name.
    title?: string
    // App icon registry id used by workspace tabs.
    icon?: string
    // Advisory env hints for server functions; never blocks loading.
    requiredEnv?: string[]
  }
}

// Bundled asset imports (`import logo from './logo.png'`) resolve to a URL string.
declare module '*.png' {
  const s: string
  export default s
}
declare module '*.jpg' {
  const s: string
  export default s
}
declare module '*.jpeg' {
  const s: string
  export default s
}
declare module '*.gif' {
  const s: string
  export default s
}
declare module '*.webp' {
  const s: string
  export default s
}
declare module '*.avif' {
  const s: string
  export default s
}
declare module '*.svg' {
  const s: string
  export default s
}

// State shared by every window of a view or widget. Define it once in a file
// both sides import, wrap it with `syncedState` in a `.server.ts`, and with
// `createStore` in the browser.
declare module 'moi/sync' {
  // An action changes `state` in place; Moi hands it a fresh copy. It runs in
  // the window and again on the server, so it must give the same result on
  // both: no clock, no random ids (pass them as arguments). Arguments are JSON
  // values and come from a browser: check what matters. Change nothing (or
  // throw) when the call does not fit the state; it is then dropped.
  export type SyncActions<S> = Record<string, (state: S, ...args: never[]) => void>
  export type StateDefinition<S, A extends SyncActions<S>> = {
    // A fresh copy of the first value.
    initial(): S
    actions: A
  }
  // Name the state type, pass the first value, then the actions:
  // `defineState<Todo>({ items: [] }).actions({ addItem(state, id: string) { … } })`.
  // `state` is typed as `Todo` in every action.
  export function defineState<S>(initial: S): {
    actions<A extends SyncActions<S>>(actions: A): StateDefinition<S, A>
  }

  // One action call, typed per action: `{ action: 'addItem'; args: [id: string, text: string] }`.
  export type SyncCall<A> = {
    [K in keyof A]: A[K] extends (state: never, ...args: infer P) => void
      ? { action: K; args: P }
      : never
  }[keyof A]

  // ---- Server: only in `.server.ts` files ----

  export type SyncedStorage<S, A = never> = {
    // Read the stored state; undefined when nothing is stored yet. Called for
    // every action, so changes made outside (an agent editing the file) are kept.
    load(): S | undefined | Promise<S | undefined>
    save(state: S): void | Promise<void>
    // Runs before an action, with the stored state. For what only the server
    // can do: check a permission, use a secret or the server's clock. Return
    // false (or throw) to drop the call, or an array to replace its arguments;
    // every window, the sender too, then runs the call with the new arguments.
    // The arguments come from a browser and are not checked yet.
    before?(
      call: SyncCall<A>,
      state: S
    ): boolean | void | unknown[] | Promise<boolean | void | unknown[]>
    // Runs after an applied call is saved, with the new state. For side
    // effects: notify, log, call an API. Never put side effects in an action:
    // actions run on both sides, more than once. A failure here is only logged.
    after?(call: SyncCall<A>, state: S): void | Promise<void>
  }
  // Type carriers only; never set.
  export type SyncedState<S, A> = { readonly __state?: S; readonly __actions?: A }
  // Export as `export const name = syncedState(definition, storage)`. The
  // server runs the windows' action calls one at a time, in the order they
  // arrive (the last write wins), saves, and sends each applied call to every
  // window.
  export function syncedState<S, A extends SyncActions<S>>(
    definition: StateDefinition<S, A>,
    storage: SyncedStorage<S, A>
  ): SyncedState<S, A>

  // ---- Browser ----

  export type SyncStatus = {
    status: 'connecting' | 'live' | 'reconnecting'
    // False until the stored state arrived; `use` gives the first value until then.
    loaded: boolean
    // Calls of this window the server has not confirmed yet.
    pending: number
    // Why the last request failed.
    error: string | undefined
  }
  export type SyncResult = {
    // False when the server dropped the call; its change is then gone from the screen.
    applied: boolean
    // Set when the server failed (not when the call just did not fit).
    error?: string
  }
  type SyncCalls<A> = {
    [K in keyof A]: A[K] extends (state: never, ...args: infer P) => void
      ? (...args: P) => Promise<SyncResult>
      : never
  }
  // The actions as methods, plus the hooks. `store.addItem(...)` shows the
  // change at once and sends the call to the server; the promise resolves when
  // the server answered and tells whether the call was applied.
  export type SyncedStore<S, A> = SyncCalls<A> & {
    // The same actions, but the change shows only when the server confirms it.
    server: SyncCalls<A>
    // Hooks. Select a stored value (`store.use(s => s.items)`), not a new object.
    use<U>(selector: (state: S) => U): U
    useStatus(): SyncStatus
    // Listen to every call the server applied, in server order. `own` is true
    // for this window's calls. For reactions that are not state: a highlight,
    // a sound. Keeps the store connected; returns the unsubscribe. Reading the
    // whole state again (first load, a missed event) gives no events.
    onEvent(listener: (call: SyncCall<A>, info: { own: boolean }) => void): () => void
    // Try again now: send waiting calls and read the state.
    reconnect(): void
  }
  // Create once, at module level. `remote` is the value imported from the `.server.ts`.
  export function createStore<S, A extends SyncActions<S>>(
    definition: StateDefinition<S, A>,
    remote: SyncedState<S, A>
  ): SyncedStore<S, A>
}
