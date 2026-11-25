import { syncedState } from 'moi/sync'

import { counterState, type Counter } from './synced-state'

let stored: Counter | undefined

export const counter = syncedState(counterState, {
  load: () => stored,
  save: state => {
    stored = state
  }
})
