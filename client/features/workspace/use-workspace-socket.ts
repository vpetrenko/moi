import { useEffect, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { workspaceKeys } from '@/client/api/workspace-keys'
import { appletRuntime } from '@/client/features/applets/applet-runtime'
import { useAppContext } from '@/client/runtime/app-context'
import type { ReconnectingSocket } from '@/client/runtime/reconnecting-socket'
import { isSharedWorkspaceEvent } from '@/lib/events'

import { createWorkspaceSocket, getWorkspaceAddress } from './remote'

// The owner's live connection for the shown workspace. Shared updates join the
// app's event stream under this browser's workspace ID, so listeners treat
// local and remote workspaces alike.
export function useWorkspaceSocket(workspaceId: string): ReconnectingSocket {
  const events = useAppContext()?.events
  const queryClient = useQueryClient()
  const socket = useMemo(() => createWorkspaceSocket(workspaceId), [workspaceId])
  useEffect(() => {
    if (!events) return
    // Mark the owner's snapshot stale before the visitor's layout refetch reads it.
    const refreshOwnerInfo = () => {
      const address = getWorkspaceAddress(workspaceId, queryClient)
      if (address !== workspaceId)
        void queryClient.invalidateQueries({ queryKey: workspaceKeys.layout(address) })
    }
    const unsubscribe = socket.subscribe({
      // Catch up on anything missed while disconnected.
      open: () => {
        refreshOwnerInfo()
        for (const queryKey of [
          workspaceKeys.layout(workspaceId),
          workspaceKeys.widgets(workspaceId),
          workspaceKeys.views(workspaceId)
        ])
          void queryClient.invalidateQueries({ queryKey })
        events.emit({ type: 'workspace:connected', workspaceId })
        // Synced states catch up on events missed while disconnected.
        appletRuntime(workspaceId).notifySync()
      },
      message: message => {
        if (!isSharedWorkspaceEvent(message)) return
        if (message.type === 'sync:event') {
          const { type: _type, ...sync } = message
          return appletRuntime(workspaceId).notifySync(sync)
        }
        if (message.type === 'workspace-config:changed') refreshOwnerInfo()
        events.emit({ ...message, workspaceId })
      }
    })
    const stop = socket.start()
    return () => {
      unsubscribe()
      stop()
    }
  }, [events, queryClient, socket, workspaceId])
  return socket
}
