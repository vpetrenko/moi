# Live channels

Use a live channel when open windows must see each other's changes at once: a shared list, a
board, a counter, a log that grows. Moi owns the WebSocket, reconnects it, and routes messages
to your server code. Never open your own port or WebSocket server.

For data that one window loads and saves on its own, plain [server functions](../SKILL.md#server-functions)
are enough.

See `.moi/base.d.ts` (`moi/server` and `moi/live`) for the full types.

## How it fits together

- Create the channel in a `.server.ts` file with `channel()` or `syncedState()` from
  `moi/server`, and export it as a `const`. This is the only non-function export a `.server.ts`
  may have.
- Import that export in the applet and pass it to `useChannel` or `useSyncedState` from
  `moi/live`. The browser gets only a reference; the server code stays on the server.
- `moi/server` works only in `.server.ts` files and the files they import. Importing it from
  browser code fails the build.
- Channel code runs in the same process as server functions, with `cwd = <workspace root>`.
  After `moi bundle` rebuilds server code the process restarts: module variables are lost and
  every window reconnects on its own. Keep state that matters in a file or database.
- Messages, state and actions are JSON values. Everything that comes from a browser is
  untrusted: check its shape.

## Synced state

Pick this first. It gives every window the same state, changed only by actions:

- The server is the single writer. It applies actions one at a time, saves, and sends each
  accepted action to all windows.
- A window shows its own action at once and keeps it until the server confirms it.
- Actions made offline wait and are sent after reconnect. A resend is never applied twice.
- `load` runs before every action, so a change made outside (you editing the file) reaches all
  windows with the next action or connection.

Put the types, the `reduce` function and the action check in a shared file, because both sides
use them:

```ts
// .moi/lib/votes.ts — shared by browser and server
export type Votes = { [option: string]: number }
export type VoteAction = { type: 'vote'; option: string } | { type: 'reset' }

// Pure: return a new object, or the same object when nothing changes.
export function reduceVotes(votes: Votes, action: VoteAction): Votes {
  if (action.type === 'reset') return {}
  return { ...votes, [action.option]: (votes[action.option] ?? 0) + 1 }
}

export function isVoteAction(value: unknown): value is VoteAction {
  if (typeof value !== 'object' || value === null) return false
  const action = value as Record<string, unknown>
  return action.type === 'reset' || (action.type === 'vote' && typeof action.option === 'string')
}
```

```ts
// .moi/views/poll.server.ts
import { syncedState } from 'moi/server'
import { isVoteAction, reduceVotes, type VoteAction, type Votes } from '../lib/votes'

const FILE = '.moi/data/votes.json'

export const votes = syncedState<Votes, VoteAction>({
  load: async () => ((await Bun.file(FILE).exists()) ? await Bun.file(FILE).json() : {}),
  save: async state => void (await Bun.write(FILE, JSON.stringify(state, null, 2))),
  reduce: reduceVotes,
  isAction: isVoteAction,
  // Optional. Return the reason when an action cannot be applied to this state.
  check: (state, action) =>
    action.type === 'vote' && action.option.length > 40 ? 'This option is too long' : null
})
```

```tsx
// .moi/views/poll.tsx
import { useSyncedState } from 'moi/live'
import { reduceVotes } from '../lib/votes'
import { votes } from './poll.server'

export default function Poll() {
  const { state, status, pending, rejected, error, send, reconnect } = useSyncedState(
    votes,
    reduceVotes
  )
  if (error) return <button onClick={reconnect}>{error}. Try again</button>
  if (!state) return <p>Loading</p>
  return (
    <div>
      {status === 'reconnecting' && <p>Reconnecting, {pending} changes waiting</p>}
      {rejected && <p>The change was not saved: {rejected}</p>}
      <button onClick={() => send({ type: 'vote', option: 'tea' })}>Tea: {state.tea ?? 0}</button>
    </div>
  )
}
```

`state` is `undefined` until the first snapshot arrives. `status` is `connecting`, `live` or
`reconnecting`.

Keep the whole state small: every window receives it on connect. For undo and redo, store a
list of commands and a cursor as the state, and make undo and redo actions that move the cursor.

## Plain channel

Use `channel()` when synced state does not fit, for example a stream of events with no stored
state.

```ts
// .moi/widgets/ticker.server.ts
import { channel } from 'moi/server'

export const ticker = channel<{ type: 'say'; text: string }, { text: string; at: number }>({
  open(connection) {
    connection.send({ text: 'Connected', at: Date.now() }) // to this window only
  },
  message(connection, message) {
    if (message?.type !== 'say' || typeof message.text !== 'string') return
    ticker.publish({ text: message.text, at: Date.now() }) // to every open window
  },
  close(connection) {}
})
```

```tsx
// .moi/widgets/ticker.tsx
import { useState } from 'react'
import { useChannel } from 'moi/live'
import { ticker } from './ticker.server'

export default function Ticker() {
  const [lines, setLines] = useState<string[]>([])
  const { status, send } = useChannel(ticker, message =>
    setLines(current => [...current.slice(-20), message.text])
  )
  return (
    <button disabled={status !== 'live'} onClick={() => send({ type: 'say', text: 'Hi' })}>
      {lines.at(-1) ?? 'Say hi'}
    </button>
  )
}
```

- One connection is one mounted hook in one window. `connection.id` is stable while it is open.
- Messages of one connection run one at a time, in the order they arrive.
- `send` in the browser returns `false` and drops the message while the channel is not live.
  After a reconnect `open` runs again, so send what a new window needs from there.
- A handler that throws is recorded in `moi debug logs`; the connection stays open.

## Checking your work

- `moi check` typechecks both sides; the hook infers its types from the server export.
- `moi debug logs` shows a channel that failed to open or a handler that threw.
- Server functions in the same file still work and can be tested with `moi call-server-fn`.
  That command runs in a separate process, so it does not see or notify open windows.
