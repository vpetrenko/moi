import type { NavigationRequest } from './navigation'
import type { SyncMessage } from './sync'
import type {
  AppSettings,
  CompiledView,
  HarnessType,
  WidgetInfo,
  ScratchpadOpMessage,
  WorkspaceOpenRequestMessage,
  WorkspaceState
} from './types'

// The workspace URL supplies scope on the wire; the browser adds its local ID.
export type SharedWorkspaceEvent =
  | { type: 'widget:changed'; name: string }
  | { type: 'widgets-list:changed'; widgets: WidgetInfo[] }
  | { type: 'view:changed'; name: string }
  | { type: 'views-list:changed'; views: CompiledView[] }
  | { type: 'view:deleted'; name: string }
  | { type: 'workspace-config:changed'; origin?: string }
  | { type: 'scratchpad:changed'; origin?: string }
  // A synced state (`moi/sync`) applied an action; every open applet runs it too.
  | ({ type: 'sync:event' } & SyncMessage)

export type HarnessEvent =
  | { type: 'harness:changed' }
  | { type: 'workspace-harness:switched'; workspaceId: string; harness: HarnessType }

export type AppEvent =
  | WorkspaceOpenRequestMessage
  | ScratchpadOpMessage
  | { type: 'applets:refresh'; workspaceId: string; only?: 'widgets' | 'views'; name?: string }
  | {
      type: 'personal-state:changed'
      workspaceId: string
      state: WorkspaceState
      completedViews?: CompiledView[]
    }
  | { type: 'env:changed'; workspaceId: string }
  | { type: 'workspaces-list:changed'; origin?: string }
  | { type: 'app-settings:changed'; settings: AppSettings }

export type ServerEvent = (SharedWorkspaceEvent & { workspaceId: string }) | HarnessEvent | AppEvent

export type ClientEvent =
  | ServerEvent
  | { type: 'app:connected' }
  | { type: 'workspace:connected'; workspaceId: string }
  | NavigationRequest

export function isSharedWorkspaceEvent(event: { type?: unknown }): event is SharedWorkspaceEvent {
  switch (event.type) {
    case 'widget:changed':
    case 'widgets-list:changed':
    case 'view:changed':
    case 'views-list:changed':
    case 'view:deleted':
    case 'workspace-config:changed':
    case 'scratchpad:changed':
    case 'sync:event':
      return true
    default:
      return false
  }
}
