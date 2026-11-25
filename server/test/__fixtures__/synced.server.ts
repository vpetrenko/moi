import { syncedState } from 'moi/server'

type Counter = { value: number }

let stored: Counter = { value: 0 }

export const counter = syncedState<Counter, number>({
  load: () => stored,
  save: state => {
    stored = state
  },
  apply: (state, command) => (typeof command === 'number' ? { value: command } : state)
})
