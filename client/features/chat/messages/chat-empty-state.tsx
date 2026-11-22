import { IconFileSearch } from '@tabler/icons-react'
import type { ReactNode } from 'react'

import { AgentBlobatar } from '@/client/components/shared/agent-blobatar'
import {
  ChatPromptBubble,
  type ChatPromptBubble as ChatPrompt
} from '@/client/features/chat/messages/chat-prompt-bubbles'
import { cn } from '@/client/lib/cn'
import type { AgentTheme, WorkspaceTabId } from '@/lib/types'

export const WORKSPACE_ANALYSIS_PROMPT = {
  label: 'Explore the workspace',
  prompt: 'Explore this workspace and suggest what Moi can build based on its content',
  context: [
    'Explore the existing workspace files before making suggestions.',
    'Briefly explain what the workspace appears to be for and which content informed your ideas.',
    'Propose a focused set of useful widgets or views that fit the work already here.',
    'Wait for me to choose before building anything.'
  ],
  icon: IconFileSearch
} satisfies ChatPrompt

export type ChatEmptyStateKind = 'view-draft' | 'explore-workspace' | 'overview-empty' | 'tab-empty'

type ResolveChatEmptyStateOptions = {
  tabId: WorkspaceTabId
  isViewDraft: boolean
  isWorkspacePendingAnalysis: boolean
}

export function resolveChatEmptyState({
  tabId,
  isViewDraft,
  isWorkspacePendingAnalysis
}: ResolveChatEmptyStateOptions): ChatEmptyStateKind {
  if (isViewDraft) return 'view-draft'
  if (isWorkspacePendingAnalysis) return 'explore-workspace'
  return tabId === 'overview' ? 'overview-empty' : 'tab-empty'
}

type ChatEmptyStateProps = {
  agent: AgentTheme
  kind: ChatEmptyStateKind
  disabled?: boolean
  onSelectPrompt: (prompt: ChatPrompt) => void
}

export function ChatEmptyState({
  agent,
  kind,
  disabled = false,
  onSelectPrompt
}: ChatEmptyStateProps) {
  switch (kind) {
    case 'view-draft':
      return <ViewDraftState agent={agent} />
    case 'explore-workspace':
      return (
        <ExploreWorkspaceState agent={agent} disabled={disabled} onSelectPrompt={onSelectPrompt} />
      )
    case 'overview-empty':
      return <OverviewEmptyState agent={agent} />
    case 'tab-empty':
      return <TabEmptyState agent={agent} />
  }
}

type EmptyStateFrameProps = {
  agent: AgentTheme
  children: ReactNode
  className?: string
}

function EmptyStateFrame({ agent, children, className }: EmptyStateFrameProps) {
  return (
    <div className={cn('flex flex-1 flex-col items-center justify-center self-center', className)}>
      <AgentBlobatar preset={agent} color="secondary" expression="idle" className="mb-2" animated />

      {children}
    </div>
  )
}

type AgentStateProps = {
  agent: AgentTheme
}

function ViewDraftState({ agent }: AgentStateProps) {
  return (
    <EmptyStateFrame agent={agent} className="text-center text-muted-foreground">
      <p className="mx-auto max-w-xs px-8 text-sm">
        Describe the content, data, and key actions you need in the view
      </p>
    </EmptyStateFrame>
  )
}

type PromptStateProps = {
  agent: AgentTheme
  disabled?: boolean
  onSelectPrompt: (prompt: ChatPrompt) => void
}

function ExploreWorkspaceState({ agent, disabled = false, onSelectPrompt }: PromptStateProps) {
  return (
    <EmptyStateFrame agent={agent}>
      <div className="flex flex-col items-center gap-4">
        <div className="prose prose-sm max-w-xs min-w-0 text-center wrap-anywhere prose-inherit">
          <p>
            Your agent can explore this workspace and suggest useful widgets and views based on
            what’s already here
          </p>
        </div>
        <ChatPromptBubble
          prompt={WORKSPACE_ANALYSIS_PROMPT}
          disabled={disabled}
          onSelect={onSelectPrompt}
        />
      </div>
    </EmptyStateFrame>
  )
}

function OverviewEmptyState({ agent }: AgentStateProps) {
  return (
    <EmptyStateFrame agent={agent} className="text-center text-muted-foreground">
      <p className="mx-auto max-w-sm px-8 text-sm">
        Chat with your agent, create widgets and views, and manage your workspace context from here
      </p>
    </EmptyStateFrame>
  )
}

function TabEmptyState({ agent }: AgentStateProps) {
  return (
    <EmptyStateFrame agent={agent} className="text-center text-muted-foreground">
      <p className="mx-auto max-w-sm px-8 text-sm">
        Chat with your agent and manage the view from here
      </p>
    </EmptyStateFrame>
  )
}
