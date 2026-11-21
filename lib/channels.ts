// Wire formats for applet live channels (`moi/server` and `moi/live`).

// Where a channel is exported: a server module key and an export name, the
// same address an RPC call uses.
export type ChannelRef = { module: string; name: string }

// Applet bundles import a channel from a `.server.ts` as this marker object.
export type ChannelRefMarker = { __moiChannel: ChannelRef }

// Browser to Moi server, on the workspace events socket. `id` is chosen by the
// browser and names one open channel on that socket.
export type ChannelClientFrame =
  | ({ type: 'channel:open'; id: string } & ChannelRef)
  | { type: 'channel:message'; id: string; data: unknown }
  | { type: 'channel:close'; id: string }

// Moi server to browser.
export type ChannelServerFrame =
  | { type: 'channel:opened'; id: string }
  | { type: 'channel:message'; id: string; data: unknown }
  // The channel is gone: failed to open, or its server code restarted. The
  // browser opens it again.
  | { type: 'channel:closed'; id: string; message?: string }

// `type` is the first key of every frame the browser sends, so the server can
// route on the raw text before parsing.
export const CHANNEL_FRAME_PREFIX = '{"type":"channel:'

const MODULE_PATTERN = /^[A-Za-z0-9_$-]+(?:\/[A-Za-z0-9_$-]+)*$/
const NAME_PATTERN = /^[A-Za-z0-9_$]+$/

export function isChannelRef(value: unknown): value is ChannelRef {
  if (typeof value !== 'object' || value === null) return false
  const { module, name } = value as Record<string, unknown>
  return (
    typeof module === 'string' &&
    module.length <= 200 &&
    MODULE_PATTERN.test(module) &&
    typeof name === 'string' &&
    name.length <= 100 &&
    NAME_PATTERN.test(name)
  )
}

export function channelRefOf(value: unknown): ChannelRef | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const ref = (value as Partial<ChannelRefMarker>).__moiChannel
  return isChannelRef(ref) ? { module: ref.module, name: ref.name } : undefined
}

export function isChannelClientFrame(value: unknown): value is ChannelClientFrame {
  if (typeof value !== 'object' || value === null) return false
  const frame = value as Record<string, unknown>
  if (typeof frame.id !== 'string' || frame.id === '' || frame.id.length > 64) return false
  if (frame.type === 'channel:open') return isChannelRef(frame)
  if (frame.type === 'channel:message') return 'data' in frame
  return frame.type === 'channel:close'
}

// ---- Synced state: the messages `syncedState` and `useSyncedState` exchange ----

// Browser to server. `opId` is unique per action, so a resend is never applied twice.
export type SyncClientMessage<A> = { type: 'action'; opId: string; action: A }

export type SyncServerMessage<S, A> =
  // The whole state: sent on connect, and when storage was changed outside.
  | { type: 'snapshot'; state: S }
  // One accepted action, sent to every window in the order the server applied it.
  | { type: 'applied'; opId: string; action: A }
  // Only to the sender: this action was already applied (resend after reconnect).
  | { type: 'ack'; opId: string }
  // Only to the sender: the action was refused and changed nothing.
  | { type: 'rejected'; opId: string; message: string }
  // The state could not be loaded.
  | { type: 'error'; message: string }
