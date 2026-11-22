import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { describe, expect, test } from 'bun:test'

import {
  ChatEmptyState,
  type ChatEmptyStateKind,
  resolveChatEmptyState
} from '@/client/features/chat/messages/chat-empty-state'

function renderState(kind: ChatEmptyStateKind): string {
  return renderToStaticMarkup(
    createElement(ChatEmptyState, {
      agent: 'boxy',
      kind,
      onSelectPrompt: () => undefined
    })
  )
}

describe('resolveChatEmptyState', () => {
  test('shows the workspace exploration state for a pending imported workspace', () => {
    expect(
      resolveChatEmptyState({
        tabId: 'overview',
        isViewDraft: false,
        isWorkspacePendingAnalysis: true
      })
    ).toBe('explore-workspace')
  })

  test('uses the overview empty state without pending analysis', () => {
    expect(
      resolveChatEmptyState({
        tabId: 'overview',
        isViewDraft: false,
        isWorkspacePendingAnalysis: false
      })
    ).toBe('overview-empty')
  })

  test('uses a separate empty state on other tabs', () => {
    expect(
      resolveChatEmptyState({
        tabId: 'scratchpad',
        isViewDraft: false,
        isWorkspacePendingAnalysis: false
      })
    ).toBe('tab-empty')
  })

  test('gives the pending view priority', () => {
    expect(
      resolveChatEmptyState({
        tabId: 'views/example',
        isViewDraft: true,
        isWorkspacePendingAnalysis: true
      })
    ).toBe('view-draft')
  })
})

describe('ChatEmptyState', () => {
  test('renders the selected empty state', () => {
    expect(renderState('explore-workspace')).toContain(
      'Your agent can explore this workspace and suggest useful widgets and views based on'
    )
    expect(renderState('explore-workspace')).toContain('Explore the workspace')
    expect(renderState('overview-empty')).toContain('create widgets and views')
    expect(renderState('tab-empty')).toContain('manage the view from here')
  })

  test('renders the focused new-view prompt', () => {
    const html = renderState('view-draft')

    expect(html).toContain('Describe the content, data, and key actions you need in the view')
  })
})
