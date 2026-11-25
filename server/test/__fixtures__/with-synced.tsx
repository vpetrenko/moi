import { createStore } from 'moi/sync'

import { counterState } from './synced-state'
import { counter } from './synced.server'

const store = createStore(counterState, counter)

export default function WithSynced() {
  const value = store.use(state => state.value)
  return <button onClick={() => void store.set(value + 1)}>{value}</button>
}
