import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { jsonRequest, requestJson } from '@/client/api/http'
import { useClientEvent } from '@/client/runtime/use-client-events'
import type { AppSettings } from '@/lib/types'

export const appSettingsKey = ['app-settings'] as const

export function useAppSettings() {
  const queryClient = useQueryClient()
  // Another client can change settings; the server broadcasts the new value
  // over the live-events socket so every open client stays in sync.
  useClientEvent(event => {
    if (event.type === 'app-settings:changed') {
      queryClient.setQueryData<AppSettings>(appSettingsKey, event.settings)
    }
  })
  return useQuery<AppSettings>({
    queryKey: appSettingsKey,
    queryFn: () => requestJson('/api/settings'),
    staleTime: 30_000
  })
}

export function useSaveAppSettings() {
  const queryClient = useQueryClient()
  return useMutation<AppSettings, Error, Partial<AppSettings>>({
    mutationFn: patch =>
      requestJson('/api/settings', jsonRequest('PATCH', patch), 'Failed to save settings'),
    onSuccess: next => {
      queryClient.setQueryData<AppSettings>(appSettingsKey, next)
    }
  })
}
