# Synced state

`moi/sync` keeps one piece of data the same for every user who has a view or widget open. A
change one user makes shows on their screen at once and on everyone else's a moment later.
Moi supplies the connection, the ordering, and the recovery; you write the data and the actions.

See `.moi/base.d.ts` (`moi/sync`) for the full types.

## When to use it

| Need                                                                  | Use                                              |
| --------------------------------------------------------------------- | ------------------------------------------------ |
| Data several users change together: a list, a board, votes, a counter | Synced state                                     |
| Data one user reads or changes                                        | [Server functions](../SKILL.md#server-functions) |
| Who is here, cursors, focus, selection                                | [Collab](COLLAB.md) presence                     |

Do not use it for large data (thousands of records, long documents) or for two users typing in
the same text at once. The whole state is loaded for every action and sent to each window when
it opens, so keep it small. For large data, keep records in a database behind server functions.

## How it works

1. You describe the state once: its first value and the actions that change it.
2. The browser and the server each hold a copy and run the same actions on it.
3. A call like `todo.addItem(id, text)` changes the browser's copy at once and goes to the server.
4. The server runs calls one at a time, in the order they arrive. It saves the state and sends
   each applied call to every window. The last write wins.
5. Each window runs the call on its own copy. A call the server drops disappears from the
   sender's screen.

You never write code for connecting, ordering, retrying, or reloading.

## Build one

Three places, each with one job. Keep them apart:

- `lib/<name>.ts` holds what both sides share: the type and the actions. It must not import a
  `.server.ts` or call `createStore`.
- `<view>.server.ts` holds the storage. Only the server runs it.
- `<view>.tsx` holds the store. Only the browser runs it.

### 1. The state and its actions

```ts
// lib/todo.ts
import { defineState } from 'moi/sync'

export type TodoItem = { id: string; text: string; done: boolean }
export type Todo = { items: TodoItem[] }

export const MAX_TEXT = 200

export const todoState = defineState<Todo>({ items: [] }).actions({
  addItem(state, id: string, text: string) {
    if (typeof id !== 'string' || typeof text !== 'string') return
    const clean = text.trim()
    if (!clean || clean.length > MAX_TEXT || state.items.length >= 500) return
    if (state.items.some(item => item.id === id)) return
    state.items.push({ id, text: clean, done: false })
  },

  checkItem(state, id: string, done: boolean) {
    const item = state.items.find(item => item.id === id)
    if (item) item.done = done === true
  },

  removeItems(state, ids: string[]) {
    if (!Array.isArray(ids)) return
    state.items = state.items.filter(item => !ids.includes(item.id))
  }
})
```

Always name the state type: `defineState<Todo>(firstValue)`. `state` is then typed in every
action, and the store gets a typed method per action.

### 2. The storage

```ts
// views/todo.server.ts
import { syncedState } from 'moi/sync'

import { todoState, type Todo } from '../lib/todo'

const FILE = '.moi/data/todo.json'

export const todoRemote = syncedState(todoState, {
  // Undefined means nothing is stored yet: Moi starts from the first value.
  load: async () => {
    const file = Bun.file(FILE)
    return (await file.exists()) ? ((await file.json()) as Todo) : undefined
  },
  save: async state => void (await Bun.write(FILE, JSON.stringify(state, null, 2)))
})
```

Export it as `export const <name> = syncedState(...)`. This is the only non-function export a
`.server.ts` may have. Storage can be anything that reads and writes the whole state: a JSON
file, one SQLite row, an external API.

### 3. The store and the view

```tsx
// views/todo.tsx
import { createStore } from 'moi/sync'

import { todoState } from '../lib/todo'
import { todoRemote } from './todo.server'

// Once, at module level. Never inside a component.
const todo = createStore(todoState, todoRemote)

export default function TodoView() {
  const items = todo.use(state => state.items)
  const { loaded, status, pending, error } = todo.useStatus()

  if (error && !loaded) return <LoadError message={error} onRetry={todo.reconnect} />
  if (!loaded) return <ListSkeleton />

  return (
    <>
      {status === 'reconnecting' && <p>Reconnecting, {pending} changes are waiting</p>}
      <AddForm onAdd={text => todo.addItem(crypto.randomUUID(), text)} />
      {items.map(item => (
        <Row
          key={item.id}
          item={item}
          onCheck={done => todo.checkItem(item.id, done)}
          onRemove={() => todo.removeItems([item.id])}
        />
      ))}
    </>
  )
}
```

Importing `./todo.server` in the view is correct. The bundler replaces it with a link to the
server; no server code reaches the browser.

If several views or widgets share one state, create the store once in a browser-only file next
to them (`views/_todo-store.ts`) and import it from each.

## Rules for actions

An action runs in the browser, on the server, and in every other window. It can run more than
once for the same call. Follow these rules or the copies drift apart.

- **Change `state` in place.** Moi hands each call a fresh copy. Do not return a new state.
- **Keep the state a JSON value.** No `Date`, `Map`, `Set`, class instances, or `undefined`
  fields. Store dates as strings or numbers.
- **Same input, same result.** No `Date.now()`, `Math.random()`, or `crypto.randomUUID()` inside
  an action, and no reading of anything outside `state` and the arguments. Make ids and
  timestamps in the caller and pass them in.
- **No side effects.** No fetch, no file access, no toast, no logging that matters. Put those in
  the [hooks](#code-around-a-change).
- **Check the arguments.** The server gets them from a browser. Check types, lengths, and limits
  inside the action, as `addItem` does above.
- **Change nothing when the call does not fit:** the item is gone, the list is full, the value is
  already set. The server then drops the call. This is how conflicts are resolved.
- **Say the result, not the step.** `checkItem(id, true)`, not `toggleItem(id)`. Two users
  toggling at once would undo each other; two users setting `true` agree.
- **Pass what the user saw.** "Clear completed" is `removeItems(ids)` with the ids on screen, not
  `clearDone()`. Otherwise the server also removes an item someone ticked a moment later.
- **Make adding safe to repeat.** Take the id as an argument and ignore an id that exists.
- **Taken names:** `use`, `useStatus`, `server`, `reconnect`, and `onEvent` cannot be actions.

## The store

`createStore(definition, remote)` returns one object:

| Member                           | What it does                                                 |
| -------------------------------- | ------------------------------------------------------------ |
| `store.<action>(...args)`        | Shows the change at once and sends the call                  |
| `store.server.<action>(...args)` | Sends the call; the change shows when the server confirms it |
| `store.use(selector)`            | Hook. The selected part of the state on screen               |
| `store.useStatus()`              | Hook. `{ status, loaded, pending, error }`                   |
| `store.onEvent(listener)`        | Listens to every applied call; returns the unsubscribe       |
| `store.reconnect()`              | Tries again now                                              |

### Reading

- `store.use(state => state.items)` rerenders when the selected value changes. Select a stored
  value, not a new object or array: `state => state.items`, then filter or sort in the component.
- Until `loaded` is true, `use` gives the first value. Show a skeleton, not an empty state, and
  disable inputs.
- `status` is `'connecting'`, `'live'`, or `'reconnecting'`. `pending` counts this window's calls
  the server has not confirmed. `error` says why the last request failed.

### Changing

Every action call returns a promise of `{ applied, error? }`. It resolves when the server
answered. You do not have to wait for it.

Choose per call:

- **`store.addItem(...)`** for small, frequent changes where a wrong guess is harmless: tick,
  rename, add, move. This is the default.
- **`store.server.removeItems(...)`** when the result depends on the server or a wrong guess
  would confuse the user: bulk removal, anything the `before` hook may refuse, a step that
  closes a dialog.

While offline, calls wait and are sent in order when the connection is back. Optimistic calls
stay visible while they wait.

## Code around a change

**Around your own call, in the view.** Use the result:

```ts
const { applied } = await todo.addItem(crypto.randomUUID(), text)
if (!applied) setProblem('The list is full')
```

`applied` is false when the server dropped the call. `error` is set only when the server
failed, not when the call just did not fit.

**On any applied call, in the view.** For reactions that are not state: a highlight, a sound,
a scroll. It reports this window's calls and other windows'.

```ts
useEffect(
  () =>
    todo.onEvent((call, { own }) => {
      if (!own && call.action === 'addItem') flash(call.args[0])
    }),
  []
)
```

`call` is typed per action: after checking `call.action`, `call.args` has that action's types.
There are no events for a full reload of the state (first load, or after a missed event), so do
not use `onEvent` to build state. Use `use` for that.

**On the server, next to `load` and `save`.** For what only the server can or may do:

```ts
export const todoRemote = syncedState(todoState, {
  load,
  save,
  // Before the action, with the stored state. Return false (or throw) to drop the call.
  // Return an array to replace the arguments: every window then runs the call with them.
  before: call => {
    if (call.action === 'addItem') return [call.args[0], removeSecrets(String(call.args[1]))]
  },
  // After the save, with the new state. A failure here is only logged.
  after: async call => {
    if (call.action === 'addItem') await notifyTeam(call.args[1])
  }
})
```

- Use `before` for a secret, the server's clock, a lookup, or a rule the browser must not skip.
  Its arguments are not checked yet: they come straight from a browser.
- Use `after` for side effects: notify, log, call an API. It does not delay the next call.
- Neither hook knows who made the call. To record an author, pass the user id from
  [`useMe()`](COLLAB.md#useme-and-useuser) as an argument. Treat it as a label, not as proof.

## Changing the stored data yourself

`load` runs for every action, so an edit you make to the stored file is kept, not overwritten.
Open windows show it after the next action or reconnect. To show it at once, ask the user to
reload, or make the change through an action.

When you change the shape of the state, old stored data still has the old shape. Make `load`
return the new shape (fill in missing fields, drop unknown ones) or return `undefined` to start
fresh. Never let a wrong shape reach the actions.

## Common mistakes

- **Creating the store inside a component.** It reconnects and loses pending calls on every
  render. Create it at module level.
- **Importing the `.server.ts` or calling `createStore` in `lib/`.** The server then loads
  browser code. Keep `lib/` shared-only.
- **An id or a date made inside an action.** Each copy gets a different value. Pass it in.
- **`toggle`, `increment`, or `clearDone` style actions.** They depend on what each copy holds at
  that moment. Pass the wanted result or the ids.
- **An empty state while loading.** "No tasks yet" flashes before the list arrives. Check
  `loaded` first.
- **A selector that builds a new array.** `state => state.items.filter(...)` rerenders on every
  change. Select `state.items` and filter in the component.
- **Side effects in an action.** They run in every window and again on replay. Use `after`.
- **Keeping per-user or per-window state here.** Draft text, an open dialog, a filter: use
  `useState`. Synced state is for what everyone shares.

## Check your work

1. Run `moi check --only views/<id>`, then `moi bundle --only views/<id>`.
2. Open the view in two windows. Change something in one; it must appear in the other without
   a reload.
3. Reload a window: the data must still be there.
4. Try a call the server should drop (a full list, a removed item): the change must disappear
   from the sender's screen and never reach the other window.
