import { defineState } from 'moi/sync'

export type Counter = { value: number }

export const counterState = defineState<Counter>({ value: 0 }).actions({
  set(state, value: number) {
    if (typeof value === 'number') state.value = value
  }
})
