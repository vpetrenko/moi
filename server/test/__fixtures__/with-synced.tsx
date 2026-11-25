import { createSyncedStore } from 'moi/live'

import { counter } from './synced.server'

const useCounter = createSyncedStore(counter, send => ({
  set: (value: number) => send(value, () => ({ value }))
}))

export default function WithSynced() {
  const value = useCounter(current => current.state?.value)
  return <button onClick={() => useCounter.actions.set(1)}>{value}</button>
}
