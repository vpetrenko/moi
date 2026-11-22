import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { jsonRequest, requestJson } from '@/client/api/http'
import { useClientEvent } from '@/client/runtime/use-client-events'
import type { AppSettings } from '@/lib/types'

import { appSettingsQuery } from './query'

export function useAppSettings() {
  const queryClient = useQueryClient()
  // Another client can change settings; the server broadcasts the new value
  // over the live-events socket so every open client stays in sync.
  useClientEvent(event => {
    if (event.type === 'app-settings:changed') {
      queryClient.setQueryData<AppSettings>(appSettingsQuery.queryKey, event.settings)
    }
  })
  return useQuery(appSettingsQuery)
}

export function useSaveAppSettings() {
  const queryClient = useQueryClient()
  return useMutation<AppSettings, Error, Partial<AppSettings>>({
    mutationFn: patch =>
      requestJson('/api/settings', jsonRequest('PATCH', patch), 'Failed to save settings'),
    onSuccess: next => {
      queryClient.setQueryData<AppSettings>(appSettingsQuery.queryKey, next)
    }
  })
}
