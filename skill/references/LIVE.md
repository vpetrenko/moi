# Synced state

Use a synced state when every user with the view or widget open must see the same data and
change it together: a shared list, a board, a counter. For data only one user changes, plain
[server functions](../SKILL.md#server-functions) are enough.

See `.moi/base.d.ts` for the full types (`moi/server` and `moi/live`).

## How it works

- The server keeps the state. It is the only writer.
- A window shows an **action** at once (optimistic) and sends a **command** to the server.
- The server applies commands one at a time, in the order they arrive. The last write wins.
- A command that no longer fits the state is dropped. The window then shows the server's state,
  so the dropped change disappears.
- After each save, every open window reads the state again.

## Files

Split the code in three:

- `lib/<name>.ts` — the state type and the command type. Shared by browser and server.
- `lib/<name>-client.ts` — actions, `reduce`, and `toCommand`. Browser only.
- `<view>.server.ts` — `load`, `save`, and `apply`. Server only.

## Commands

Make a command say what the result must be, not what to change: `{ type: 'setDone', id, done }`,
not `{ type: 'toggle', id }`. Then a resend is safe and two users changing the same item do not
undo each other. Create ids in the browser (`crypto.randomUUID()`), so adding twice adds one item.

## Server

```ts
// board.server.ts
import { syncedState } from 'moi/server'
import type { Board, BoardCommand } from '../lib/board'

const FILE = '.moi/data/board.json'

export const board = syncedState<Board, BoardCommand>({
  load: async () => ((await Bun.file(FILE).exists()) ? await Bun.file(FILE).json() : { cards: [] }),
  save: async state => void (await Bun.write(FILE, JSON.stringify(state, null, 2))),
  // `command` comes from a browser: check its shape first.
  // Return the same `state` to drop a command that does not fit.
  apply: (state, command) => (isBoardCommand(command) ? applyCommand(state, command) : state)
})
```

`load` runs for every command, so a change you make to the file is not overwritten. Open windows
show it after the next command or reconnect.

## Browser

```tsx
import { useSyncedState } from 'moi/live'
import { board } from './board.server'
import { boardActions } from '../lib/board-client' // { reduce, toCommand }

const { state, status, pending, error, dispatch, reconnect } = useSyncedState(board, boardActions)
```

- `state` is `undefined` until loaded: show a skeleton.
- `reduce(state, action)` must be pure. Moi runs it again on each new server state.
- `toCommand(state, action)` gets the state on screen before the action. Return `undefined` to
  send nothing.
- `status` is `'connecting'`, `'live'`, or `'reconnecting'`. While offline, actions wait
  (`pending`) and are sent after the connection comes back.
- Define `boardActions` outside the component.
