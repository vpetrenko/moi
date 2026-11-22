import { requestJson } from '@/client/api/http'
import type { AppSettings } from '@/lib/types'

export const appSettingsQuery = {
  queryKey: ['app-settings'] as const,
  queryFn: () => requestJson<AppSettings>('/api/settings'),
  staleTime: 30_000
}
