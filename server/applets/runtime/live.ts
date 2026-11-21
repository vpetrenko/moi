// Browser-only runtime for `moi/live`. The host owns the connection and hands
// channels out through the applet bridge; these hooks add React state on top.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ChannelClient, LiveStatus, SyncedStateClient } from 'moi/live'
import type { Channel, SyncedState } from 'moi/server'

import type { SyncClientMessage, SyncServerMessage } from '../../../lib/channels'
import type { AppletChannel, AppletChannelListener } from '../../../lib/types'

import { __getBridge } from './moi'

const UNREACHABLE = 'Could not connect. Trying again'
// Failed attempts before a window that was never live shows an error.
const QUIET_ATTEMPTS = 3

let warned = false
function openChannel(channel: unknown, listener: AppletChannelListener): AppletChannel | undefined {
  const open = __getBridge()?.openChannel
  if (open) return open(channel, listener)
  if (!warned) {
    warned = true
    console.warn('[moi/live] Live channels are unavailable. Update Moi to use them.')
  }
  return undefined
}

// A channel imported from a `.server.ts` is a new object in every bundle, so
// effects depend on where it points instead.
function channelKey(channel: unknown): string {
  const ref = (channel as { __moiChannel?: { module?: unknown; name?: unknown } } | null)
    ?.__moiChannel
  return `${String(ref?.module)}/${String(ref?.name)}`
}

// Lets a long-lived effect read the value of the latest render.
function useLatestRef<T>(value: T) {
  const ref = useRef(value)
  useLayoutEffect(() => {
    ref.current = value
  }, [value])
  return ref
}

function newOpId() {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function useChannel<In, Out>(
  channel: Channel<In, Out>,
  onMessage: (message: Out) => void
): ChannelClient<In> {
  const [status, setStatus] = useState<LiveStatus>('connecting')
  const [error, setError] = useState<string | undefined>(undefined)
  const handle = useRef<AppletChannel | undefined>(undefined)
  const latest = useLatestRef(onMessage)
  const target = useLatestRef<unknown>(channel)
  const key = channelKey(channel)

  useEffect(() => {
    let everLive = false
    let attempts = 0
    const opened = openChannel(target.current, {
      open: () => {
        everLive = true
        attempts = 0
        setStatus('live')
        setError(undefined)
      },
      message: data => latest.current(data as Out),
      close: message => {
        attempts += 1
        setStatus(everLive ? 'reconnecting' : 'connecting')
        if (message) setError(message)
        else if (!everLive && attempts >= QUIET_ATTEMPTS) setError(UNREACHABLE)
      }
    })
    handle.current = opened
    return () => {
      handle.current = undefined
      opened?.close()
    }
  }, [key, target, latest])

  const send = useCallback((message: In) => handle.current?.send(message) ?? false, [])
  const reconnect = useCallback(() => handle.current?.reconnect(), [])
  return { status, error, send, reconnect }
}

type Pending<A> = { opId: string; action: A }

export function useSyncedState<S, A>(
  state: SyncedState<S, A>,
  reduce: (state: S, action: A) => S
): SyncedStateClient<S, A> {
  // `confirmed` is the state the server has. `pending` are this window's
  // actions it has not confirmed yet.
  const [confirmed, setConfirmed] = useState<{ state: S } | undefined>(undefined)
  const [pending, setPending] = useState<Pending<A>[]>([])
  const [status, setStatus] = useState<LiveStatus>('connecting')
  const [rejected, setRejected] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)

  const pendingRef = useRef<Pending<A>[]>([])
  const handle = useRef<AppletChannel | undefined>(undefined)
  // True once this connection delivered its snapshot, so actions can be sent on it.
  const inStep = useRef(false)
  const reduceRef = useLatestRef(reduce)
  const target = useLatestRef<unknown>(state)
  const key = channelKey(state)

  const changePending = useCallback((change: (list: Pending<A>[]) => Pending<A>[]) => {
    pendingRef.current = change(pendingRef.current)
    setPending(pendingRef.current)
  }, [])

  useEffect(() => {
    let everLive = false
    let attempts = 0
    const drop = (opId: string) => changePending(list => list.filter(op => op.opId !== opId))
    const transmit = (target: AppletChannel, op: Pending<A>) => {
      const message: SyncClientMessage<A> = {
        type: 'action',
        opId: op.opId,
        action: op.action
      }
      target.send(message)
    }

    const opened = openChannel(target.current, {
      message: data => {
        const message = data as SyncServerMessage<S, A>
        switch (message.type) {
          case 'snapshot':
            setConfirmed({ state: message.state })
            setError(undefined)
            setStatus('live')
            everLive = true
            attempts = 0
            if (!inStep.current && handle.current) {
              // First snapshot on this connection: send what the server has not confirmed yet.
              inStep.current = true
              for (const op of pendingRef.current) transmit(handle.current, op)
            }
            break
          case 'applied': {
            const { action, opId } = message
            setConfirmed(current =>
              current ? { state: reduceRef.current(current.state, action) } : current
            )
            drop(opId)
            break
          }
          case 'ack':
            drop(message.opId)
            break
          case 'rejected':
            drop(message.opId)
            setRejected(message.message)
            break
          case 'error':
            setError(message.message)
            break
        }
      },
      close: message => {
        inStep.current = false
        attempts += 1
        setStatus(everLive ? 'reconnecting' : 'connecting')
        if (message) setError(message)
        else if (!everLive && attempts >= QUIET_ATTEMPTS) setError(UNREACHABLE)
      }
    })
    handle.current = opened
    return () => {
      handle.current = undefined
      inStep.current = false
      opened?.close()
    }
  }, [key, target, reduceRef, changePending])

  const send = useCallback(
    (action: A) => {
      const op: Pending<A> = { opId: newOpId(), action }
      changePending(list => [...list, op])
      setRejected(undefined)
      if (inStep.current && handle.current) {
        const message: SyncClientMessage<A> = {
          type: 'action',
          opId: op.opId,
          action
        }
        handle.current.send(message)
      }
    },
    [changePending]
  )
  const reconnect = useCallback(() => handle.current?.reconnect(), [])
  const clearRejected = useCallback(() => setRejected(undefined), [])

  // What the user sees: the server's state with this window's unconfirmed actions on top.
  const shown = useMemo(
    () =>
      confirmed && {
        state: pending.reduce((current, op) => reduce(current, op.action), confirmed.state)
      },
    [confirmed, pending, reduce]
  )

  return {
    state: shown?.state,
    status,
    pending: pending.length,
    rejected,
    clearRejected,
    error,
    send,
    reconnect
  }
}
