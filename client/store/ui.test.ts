import { beforeEach, describe, expect, test } from 'bun:test'

import { createUiStore } from './ui'

const storedValues = new Map<string, string>()
const localStorage = {
  getItem: (key: string) => storedValues.get(key) ?? null,
  setItem: (key: string, value: string) => storedValues.set(key, value),
  removeItem: (key: string) => storedValues.delete(key)
}

const useUiStore = createUiStore(localStorage)

beforeEach(() => {
  storedValues.clear()
  useUiStore.setState({
    workspaceIdsPendingAnalysis: [],
    workspaces: {},
    composerDrafts: {}
  })
})

describe('workspace analysis', () => {
  test('persists the pending-analysis workspace until a message is sent', () => {
    useUiStore.getState().markWorkspacePendingAnalysis('ws-1')
    useUiStore.getState().markWorkspacePendingAnalysis('ws-1')

    expect(useUiStore.getState().workspaceIdsPendingAnalysis).toEqual(['ws-1'])
    expect(JSON.parse(storedValues.get('moi:ui') ?? '{}')).toMatchObject({
      state: { workspaceIdsPendingAnalysis: ['ws-1'] }
    })

    useUiStore.getState().clearWorkspacePendingAnalysis('ws-1')

    expect(useUiStore.getState().workspaceIdsPendingAnalysis).toEqual([])
    expect(JSON.parse(storedValues.get('moi:ui') ?? '{}')).toMatchObject({
      state: { workspaceIdsPendingAnalysis: [] }
    })
  })
})

describe('composer drafts', () => {
  test('defaults to no drafts when hydrating UI state saved before drafts existed', () => {
    storedValues.set(
      'moi:ui',
      JSON.stringify({
        state: {
          discoveredWorkspacesOpen: false,
          workspaceIdsPendingAnalysis: []
        },
        version: 0
      })
    )

    const restoredStore = createUiStore(localStorage)

    expect(restoredStore.getState().composerDrafts).toEqual({})
  })

  test('persists drafts per workspace and restores them in a new store', () => {
    useUiStore.getState().setComposerDraft('ws-1', 'Build a dashboard')
    useUiStore.getState().setComposerDraft('ws-2', 'Summarize this workspace')

    const restoredStore = createUiStore(localStorage)

    expect(restoredStore.getState().composerDrafts).toEqual({
      'ws-1': 'Build a dashboard',
      'ws-2': 'Summarize this workspace'
    })
  })

  test('removes a workspace draft when it is cleared', () => {
    useUiStore.getState().setComposerDraft('ws-1', 'Keep me')
    useUiStore.getState().setComposerDraft('ws-2', 'Send me')
    useUiStore.getState().setComposerDraft('ws-2', null)

    expect(useUiStore.getState().composerDrafts).toEqual({ 'ws-1': 'Keep me' })
    expect(JSON.parse(storedValues.get('moi:ui') ?? '{}')).toMatchObject({
      state: { composerDrafts: { 'ws-1': 'Keep me' } }
    })
  })
})

describe('pending view drafts', () => {
  test('keeps an empty draft distinct from no draft', () => {
    useUiStore.getState().setComposerDraft('draft-1', 'Chart of expenses')
    useUiStore.getState().setComposerDraft('draft-1', '')

    // Deleted text must stay deleted — a missing entry falls back to the
    // view's server-saved requirements in the composer.
    expect(useUiStore.getState().composerDrafts).toEqual({ 'draft-1': '' })

    useUiStore.getState().setComposerDraft('draft-1', null)

    expect(useUiStore.getState().composerDrafts).toEqual({})
  })

  test('clearing a missing draft leaves state untouched', () => {
    const before = useUiStore.getState()

    useUiStore.getState().setComposerDraft('draft-x', null)

    expect(useUiStore.getState()).toBe(before)
  })
})

test('a pending view draft follows chat creation and native renames, including empty text', () => {
  const draft = JSON.stringify(['ws-1', 'draft:views/cards'])
  const temporary = JSON.stringify(['ws-1', 'temporary'])
  const native = JSON.stringify(['ws-1', 'native'])
  const otherWorkspace = JSON.stringify(['ws-2', 'draft:views/cards'])
  useUiStore.getState().setComposerDraft(draft, '')
  useUiStore.getState().setComposerDraft(otherWorkspace, 'Other workspace')
  useUiStore.getState().moveComposerDraft(draft, temporary)
  useUiStore.getState().moveComposerDraft(temporary, native)
  expect(useUiStore.getState().composerDrafts).toEqual({
    [native]: '',
    [otherWorkspace]: 'Other workspace'
  })
  useUiStore.getState().moveComposerDraft(native, draft)
  expect(useUiStore.getState().composerDrafts[draft]).toBe('')
})

test('chat layout persists per workspace in one browser, independent of another', () => {
  const patch = {
    layoutMode: 'fullscreen' as const,
    dockedChatWidth: 480,
    popupChatWidth: 520
  }
  useUiStore.getState().setWorkspaceUi('one', patch)
  useUiStore.getState().setWorkspaceUi('two', { popupChatWidth: 600 })
  useUiStore.getState().setWorkspaceUi('one', { popupChatWidth: 560 })
  const restored = createUiStore(localStorage).getState()
  expect(restored.workspaces.one).toEqual({ ...patch, popupChatWidth: 560 })
  expect(restored.workspaces.two).toEqual({
    layoutMode: 'split',
    dockedChatWidth: 360,
    popupChatWidth: 600
  })
  const otherBrowser = createUiStore({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {}
  })
  expect(otherBrowser.getState().workspaces).toEqual({})
})
