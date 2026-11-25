# Synced state

Use a synced state when every user with the view or widget open must see the same data and
change it together: a shared list, a board, a counter. For data only one user changes, plain
[server functions](../SKILL.md#server-functions) are enough.

See `.moi/base.d.ts` (`moi/sync`) for the full types.

## How it works

- You describe the state once: its first value and the actions that change it.
- The browser and the server both hold a copy and run the same actions on it.
- A call like `todo.addItem(id, text)` changes the browser's copy at once and is sent to the
  server as an event (`addItem` plus its arguments).
- The server runs events one at a time, in the order they arrive, saves, and sends each one to
  every window. The last write wins.
- A call that does not fit the server's state is dropped, and disappears from the screen.

## Three places

```ts
// lib/todo.ts — shared by browser and server
import { defineState } from 'moi/sync'

export type Todo = { items: { id: string; text: string; done: boolean }[] }

// Name the state type and pass the first value; `state` is then typed in every action.
export const todoState = defineState<Todo>({ items: [] }).actions({
  addItem(state, id: string, text: string) {
    if (typeof text !== 'string' || !text.trim() || text.length > 200) return
    if (state.items.some(item => item.id === id)) return
    state.items.push({ id, text: text.trim(), done: false })
  },
  checkItem(state, id: string, done: boolean) {
    const item = state.items.find(item => item.id === id)
    if (item) item.done = done === true
  }
})
```

```ts
// views/todo.server.ts — where the state is stored
import { syncedState } from 'moi/sync'
import { todoState, type Todo } from '../lib/todo'

const FILE = '.moi/data/todo.json'

export const todoRemote = syncedState(todoState, {
  load: async () =>
    (await Bun.file(FILE).exists()) ? ((await Bun.file(FILE).json()) as Todo) : undefined,
  save: async state => void (await Bun.write(FILE, JSON.stringify(state, null, 2)))
})
```

```tsx
// views/todo.tsx — the browser's copy
import { createStore } from 'moi/sync'
import { todoState } from '../lib/todo'
import { todoRemote } from './todo.server'

const todo = createStore(todoState, todoRemote) // once, at module level

export default function TodoView() {
  const items = todo.use(state => state.items)
  const { loaded, status, pending, error } = todo.useStatus()
  // todo.addItem(crypto.randomUUID(), text)  — shows at once
  // await todo.server.checkItem(id, true)    — shows when the server confirms it
}
```

Keep `lib/` for code both sides use. A lib file must not import a `.server.ts` or call
`createStore`: the store belongs to the view, the storage to the `.server.ts`. If several views
share one store, put it in a browser-only file next to them (`views/_todo-store.ts`).

## Rules for actions

- **Change `state` in place.** Moi gives each call a fresh copy. The state must be a JSON value.
- **Same result on both sides.** No clock and no random values inside an action. Make ids and
  dates in the caller and pass them as arguments.
- **Do not trust arguments.** The server gets them from a browser. Check types and limits.
- **Change nothing when the call does not fit** (the item is gone, the list is full). The call is
  then dropped.
- **Pass what the user saw.** "Clear completed" is `removeItems(ids)`, not `clearDone()`, or the
  server may remove an item someone ticked a moment later.
- Action names `use`, `useStatus`, `get`, `server`, and `reconnect` are taken.

## In the view

- Until `loaded` is true, `use()` gives the first value: show a skeleton.
- Select a stored value (`state => state.items`), not a new object.
- Use `todo.server.<action>()` when a wrong guess on screen would confuse the user.
- While offline, calls wait (`pending`) and are sent after the connection comes back.
- `load` runs for every action, so a change you make to the file is kept. Open windows show it
  after the next action or reconnect.
