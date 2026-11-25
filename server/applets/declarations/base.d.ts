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

// Shared state on the server. Import only in `.server.ts` files and export it
// as `export const name = syncedState<State, Command>({ ... })`.
declare module 'moi/server' {
  export type SyncedStateOptions<S> = {
    // Read the state from storage. Called for every command, so changes made
    // outside (an agent editing the file) are picked up.
    load(): S | Promise<S>
    save(state: S): void | Promise<void>
    // Apply one command to the current state. The command comes from a
    // browser: check its shape first. Return the same state (or throw) to drop
    // a command that does not fit the current state.
    apply(state: S, command: unknown): S
  }
  // Type carriers only; never set.
  export type SyncedState<S, C> = { readonly __state?: S; readonly __command?: C }
  // One state shared by every window. Windows send commands; the server
  // applies them one at a time, in the order they arrive, so the last write
  // wins. State and commands are JSON values.
  export function syncedState<S, C>(options: SyncedStateOptions<S>): SyncedState<S, C>
}

// Browser side of a synced state: a store, used like a Zustand store.
declare module 'moi/live' {
  import type { SyncedState } from 'moi/server'

  export type LiveStatus = 'connecting' | 'live' | 'reconnecting'
  // Send one command to the server. Resolves when the server has answered and
  // the store holds the result (or the command was dropped).
  // - Without `optimistic`, the state changes only when the server answers.
  // - With `optimistic`, the change shows at once. It must be pure: Moi runs it
  //   again on each new server state until the server answers, and then the
  //   server's state replaces it.
  // While offline, commands wait and are sent after the connection comes back.
  export type SyncedSend<S, C> = (command: C, optimistic?: (state: S) => S) => Promise<void>
  export type SyncedStoreSnapshot<S> = {
    // Server state with optimistic changes on top. Undefined until loaded.
    state: S | undefined
    status: LiveStatus
    // Commands the server has not answered yet.
    pending: number
    // Why the last request failed.
    error: string | undefined
  }
  export type SyncedStore<S, T> = {
    // A hook. Rerenders when the selected value changes, so select a stored
    // value (`store(s => s.state?.items)`), not a new object.
    (): SyncedStoreSnapshot<S>
    <U>(selector: (snapshot: SyncedStoreSnapshot<S>) => U): U
    // The actions made by `createSyncedStore`. Stable; call them from handlers.
    actions: T
    getState(): S | undefined
    // Try again now: send waiting commands and read the state.
    reconnect(): void
  }
  // Create once, at module level. Pass the value imported from a `.server.ts`.
  // `get` returns the state on screen.
  export function createSyncedStore<S, C, T>(
    state: SyncedState<S, C>,
    actions: (send: SyncedSend<S, C>, get: () => S | undefined) => T
  ): SyncedStore<S, T>
}
