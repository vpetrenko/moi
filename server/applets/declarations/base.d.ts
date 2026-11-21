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

// Server side of live channels. Import only in `.server.ts` files and the
// files they import. Export each channel from a `.server.ts` as
// `export const name = channel(...)` or `export const name = syncedState(...)`.
declare module 'moi/server' {
  // One open browser window (a view or widget instance) on this channel.
  export type ChannelConnection<Out = unknown> = {
    readonly id: string
    send(message: Out): void
  }
  export type ChannelHandlers<In = unknown, Out = unknown> = {
    open?(connection: ChannelConnection<Out>): void | Promise<void>
    // `message` comes from a browser: check its shape before using it.
    // Messages of one connection run one at a time, in the order they arrive.
    message?(connection: ChannelConnection<Out>, message: In): void | Promise<void>
    close?(connection: ChannelConnection<Out>): void | Promise<void>
  }
  export type Channel<In = unknown, Out = unknown> = {
    // Send to every open connection of this channel.
    publish(message: Out): void
    readonly connections: number
    // Type carrier only; never set.
    readonly __in?: In
  }
  // A plain two-way channel. Messages are JSON values.
  export function channel<In = unknown, Out = unknown>(
    handlers: ChannelHandlers<In, Out>
  ): Channel<In, Out>

  export type SyncedStateOptions<S, A> = {
    // Read the current state from storage. Called before every action, so
    // changes made outside (an agent editing the file) are picked up.
    load(): S | Promise<S>
    save(state: S): void | Promise<void>
    // Pure: return a new state, or the same object when nothing changes.
    // The browser runs the same function, so keep it in a shared file.
    reduce(state: S, action: A): S
    // Check the shape of an action that came from a browser.
    isAction(value: unknown): value is A
    // Return the reason when the action cannot be applied to this state.
    check?(state: S, action: A): string | undefined | null
  }
  export type SyncedState<S, A> = {
    // Type carriers only; never set.
    readonly __state?: S
    readonly __action?: A
  }
  // One shared state for every window, changed only by actions. The server is
  // the single writer: it applies actions one at a time, saves, and sends each
  // accepted action to all windows. State and actions are JSON values.
  export function syncedState<S, A>(options: SyncedStateOptions<S, A>): SyncedState<S, A>
}

// Browser side of live channels. Pass the channel imported from a `.server.ts`.
declare module 'moi/live' {
  import type { Channel, SyncedState } from 'moi/server'

  export type LiveStatus = 'connecting' | 'live' | 'reconnecting'
  export type ChannelClient<In> = {
    status: LiveStatus
    // Why the last connection attempt failed, while not live.
    error: string | undefined
    // False when the channel is not live; the message is dropped.
    send(message: In): boolean
    reconnect(): void
  }
  export function useChannel<In, Out>(
    channel: Channel<In, Out>,
    onMessage: (message: Out) => void
  ): ChannelClient<In>

  export type SyncedStateClient<S, A> = {
    // Server state with this window's unconfirmed actions on top.
    // Undefined until the first snapshot arrives.
    state: S | undefined
    status: LiveStatus
    // Actions of this window the server has not confirmed yet.
    pending: number
    // Why the server refused the last action.
    rejected: string | undefined
    clearRejected(): void
    // Why the state could not be loaded or the connection failed.
    error: string | undefined
    // Shows the action at once and sends it. While offline it waits and is
    // sent after reconnect.
    send(action: A): void
    reconnect(): void
  }
  export function useSyncedState<S, A>(
    state: SyncedState<S, A>,
    reduce: (state: S, action: A) => S
  ): SyncedStateClient<S, A>
}
