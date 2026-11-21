import { useSyncedState } from 'moi/live'

import { counter, saveCount } from './live.server'

export default function WithLive() {
  const { state, send } = useSyncedState(counter, (current, action) => ({
    count: current.count + action.by
  }))
  return (
    <button onClick={() => (send({ type: 'add', by: 1 }), void saveCount())}>
      {state?.count ?? 0}
    </button>
  )
}
