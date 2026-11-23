import { useSyncExternalStore } from 'react'

import { useAppConfig } from '@/client/api/app-config'
import { isUserProfile } from '@/lib/collab/protocol'
import type { UserProfile } from '@/lib/collab/types'
import { getCurrentUser, getCurrentUserSource, subscribeCurrentUserStore } from './host-state'

const STORAGE_KEY = 'moi:collab-test-profile'

function readStoredProfile(): UserProfile | undefined {
  try {
    const stored: unknown = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? 'null')
    if (isUserProfile(stored)) return stored
  } catch {
    // Browser storage may be unavailable.
  }
}

let profile = readStoredProfile()

export function getLocalTestProfile(): UserProfile | undefined {
  return profile
}

export function setLocalTestProfile(next?: UserProfile): void {
  profile = next
  try {
    if (next) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    else sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // Keep the profile in this tab until the next reload.
  }
}

export function useLocalCollabTesting() {
  const { localCollabTesting } = useAppConfig()
  const source = useSyncExternalStore(
    subscribeCurrentUserStore,
    getCurrentUserSource,
    getCurrentUserSource
  )
  return (
    localCollabTesting === true &&
    source === 'local' &&
    ['127.0.0.1', 'localhost', '[::1]'].includes(window.location.hostname)
  )
}

export function useLocalCollabProfile(): UserProfile | undefined {
  const testing = useLocalCollabTesting()
  const defaultProfile = useSyncExternalStore(
    subscribeCurrentUserStore,
    getCurrentUser,
    getCurrentUser
  )
  return testing ? (getLocalTestProfile() ?? defaultProfile) : undefined
}
