import { channel, syncedState } from 'moi/server'

export const echo = channel<unknown, unknown>({
  open(connection) {
    connection.send({ hello: true })
  },
  message(connection, message) {
    if (message === 'boom') throw new Error('intentional channel error')
    if (message === 'all') echo.publish({ all: echo.connections })
    else connection.send({ echo: message })
  }
})

export const failing = channel({
  open() {
    throw new Error('intentional open error')
  }
})

type Counter = { count: number }
type Add = { type: 'add'; by: number }

let stored: Counter = { count: 0 }
let saves = 0

export const counter = syncedState<Counter, Add>({
  load: () => stored,
  save: state => {
    stored = state
    saves++
  },
  reduce: (state, action) => (action.by === 0 ? state : { count: state.count + action.by }),
  isAction: (value): value is Add =>
    typeof value === 'object' &&
    value !== null &&
    (value as Add).type === 'add' &&
    typeof (value as Add).by === 'number',
  check: (state, action) => (state.count + action.by < 0 ? 'The count cannot go below zero' : null)
})

// Stands for an agent editing the stored file while windows are open.
export async function overwrite(count: number) {
  stored = { count }
}

export async function saveCount() {
  return saves
}

export async function notAChannel() {
  return 1
}
