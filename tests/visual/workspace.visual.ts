import { DEFAULT_VIEWPORT, expect, takeSnapshot } from '@uiverify/bun'

import type { Identity } from '@/client/features/identity/types'
import type { WorkspaceMembersSnapshot } from '@/client/features/collab/members/types'
import type { ClientAppConfig, WorkspaceEntry, WorkspaceLayoutResponse } from '@/lib/types'

import { API, HARNESSES, suite, WORKSPACE } from './fixtures'

const { describe, test } = suite(import.meta.path)
const WORKSPACE_PAGE = `/#/workspace/${WORKSPACE}`

test('floating chat keeps its open and closed state after reload', async page => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'moi:ui',
      JSON.stringify({
        version: 0,
        state: { workspaces: { northwind: { layoutMode: 'fullscreen' } } }
      })
    )
  })
  await page.goto(WORKSPACE_PAGE)
  await page.getByRole('button', { name: 'Agent', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Close chat', exact: true })).toBeVisible()
  await page.goto(WORKSPACE_PAGE)
  await expect(page.getByRole('button', { name: 'Close chat', exact: true })).toBeVisible()
  await takeSnapshot('chat restored after reload')
  await page.getByRole('button', { name: 'Close chat', exact: true }).click()
  await page.goto(WORKSPACE_PAGE)
  await expect(page.getByRole('button', { name: 'Agent', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Close chat', exact: true })).toHaveCount(0)
})

describe('Workspace', () => {
  test('home', async page => {
    // Standalone Moi never asks Cloud for remote workspaces.
    const cloudRequests: string[] = []
    await page.route('**/cloud/api/workspaces/**', route => {
      cloudRequests.push(route.request().url())
      return route.fulfill({ status: 500, body: 'Unexpected Cloud request' })
    })
    const requested = Promise.withResolvers<void>()
    const settings = Promise.withResolvers<void>()
    await page.route('**/api/settings', async route => {
      requested.resolve()
      await settings.promise
      await route.fallback()
    })
    await page.goto('/#/')
    await requested.promise
    await expect(page.getByRole('status', { name: 'Loading onboarding' })).toHaveCount(0)
    await takeSnapshot('waiting for settings')
    settings.resolve()
    await expect(page.getByText('acme-store').first()).toBeVisible()
    await takeSnapshot()
    expect(cloudRequests).toEqual([])
  })

  test(
    'home shows workspace cards while optional lists load',
    async page => {
      await page.route('**/api/workspaces/suggestions', () => new Promise(() => {}))
      await page.route('**/cloud/api/workspaces/invitations', () => new Promise(() => {}))
      await page.goto('/#/')
      await expect(page.getByRole('link', { name: 'Open acme-store', exact: true })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Invitations' })).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Suggestions' })).toHaveCount(0)
    },
    { api: { '/api/config': { environment: 'cloud', demo: false } } }
  )

  test(
    'onboarding',
    async page => {
      await page.goto('/#/')
      await expect(page.getByRole('heading', { name: 'Choose your agent' })).toBeVisible()
    },
    { api: { '/api/settings': { showOnboarding: true, autoUpdateSkills: false } } }
  )

  test(
    'theme',
    async page => {
      await page.goto(WORKSPACE_PAGE)
      await page.getByRole('button', { name: 'Theme' }).click()
      await expect(page.getByRole('button', { name: 'Close panel' })).toBeVisible()
    },
    { viewports: { '': DEFAULT_VIEWPORT, short: { width: 920, height: 420 } } }
  )

  test(
    'workspace menu keeps the themed icon tile on hover',
    async page => {
      await page.goto(WORKSPACE_PAGE)
      const trigger = page.getByRole('button', { name: WORKSPACE + ' menu', exact: true })
      await trigger.hover()
      await expect(trigger.locator('svg.tabler-icon-dots')).toBeVisible()
      await takeSnapshot('workspace menu hovered')
      await trigger.click()
      const theme = page.getByRole('menuitem', { name: 'Theme' })
      await theme.hover()
      await expect(trigger.locator('svg.tabler-icon-dots')).toBeVisible()
      await takeSnapshot('workspace menu open')
      await theme.click()
      await expect(trigger.locator('svg.tabler-icon-book')).toBeVisible()
    },
    {
      api: {
        [`/api/workspaces/${WORKSPACE}`]: {
          ...(API[`/api/workspaces/${WORKSPACE}`] as WorkspaceLayoutResponse),
          icon: { type: 'glyph', value: 'book', background: 'theme' }
        }
      }
    }
  )

  test(
    'demo home',
    async page => {
      // The demo serves home at /demo; a query string must not break the match.
      await page.goto('/#/demo?ref=launch')
      await expect(page.getByText('acme-store').first()).toBeVisible()
      await expect(page.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/demo')
      await expect(page.getByRole('button', { name: 'Suggestions', exact: true })).toHaveCount(0)
    },
    {
      api: {
        '/api/config': {
          environment: 'cloud',
          demo: true,
          demoInstallUrl: 'https://moi.computer'
        } satisfies ClientAppConfig,
        '/api/workspaces/suggestions': [{ path: '/projects/notes', harnesses: ['codex'] }]
      }
    }
  )

  test('new workspace', async page => {
    await page.goto('/#/')
    await page.getByRole('button', { name: 'New', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await takeSnapshot()
    await page.getByRole('textbox', { name: 'Workspace name' }).fill('Project notes')
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await expect(page.getByRole('button', { name: /Claude/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await takeSnapshot('workspace agent')
  })

  test(
    'import preselects a detected connected agent',
    async page => {
      await page.goto('/#/')
      const suggestions = page.getByRole('button', { name: 'Suggestions', exact: true })
      await expect(suggestions).toHaveAttribute('aria-expanded', 'false')
      await suggestions.click()
      await page.getByRole('button', { name: 'Add', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'Import notes' })
      await expect(dialog.getByRole('button', { name: /ChatGPT/ })).toHaveAttribute(
        'aria-pressed',
        'true'
      )
      await takeSnapshot('import agent')
    },
    { api: { '/api/workspaces/suggestions': [{ path: '/projects/notes', harnesses: ['codex'] }] } }
  )
})

const sharingUser: Identity = {
  id: 'sharing-owner',
  type: 'user',
  name: 'Alex',
  email: 'alex@example.com',
  isAnonymous: false
}
test(
  'sharing duplicate invitation toast',
  async page => {
    await page.goto(WORKSPACE_PAGE)
    await page.getByRole('button', { name: 'Alex (You), open sharing' }).click()
    await expect(page.getByText('tony@example.com', { exact: true }).first()).toBeVisible()
    await page.getByRole('textbox', { name: 'Email', exact: true }).fill('TONY@EXAMPLE.COM')
    await page.getByRole('button', { name: 'Invite', exact: true }).click()
    await expect(page.getByText('The user is already invited', { exact: true })).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Email', exact: true })).toHaveValue('')
    await expect(page.getByRole('button', { name: 'Invite', exact: true })).toBeDisabled()
  },
  {
    api: {
      '/api/config': {
        environment: 'cloud',
        demo: false,
        demoInstallUrl: '/'
      } satisfies ClientAppConfig,
      '/cloud/api/me': sharingUser
    },
    members: [
      {
        id: WORKSPACE,
        members: [sharingUser],
        invitations: [
          { id: 'invite-tony', email: 'tony@example.com', expiresAt: '2099-01-01T00:00:00Z' }
        ]
      }
    ]
  }
)

test(
  'active avatar tooltip and sharing controls',
  async page => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => {} } })
      const NativeWebSocket = window.WebSocket
      window.WebSocket = new Proxy(NativeWebSocket, {
        construct(target, args) {
          if (!/\/api\/workspaces\/[^/]+\/events$/.test(String(args[0])))
            return Reflect.construct(target, args)
          const socket = {
            readyState: 1,
            onopen: undefined as (() => void) | undefined,
            onmessage: undefined as ((event: MessageEvent) => void) | undefined,
            onclose: undefined as (() => void) | undefined,
            send(data: string) {
              const message = JSON.parse(data)
              if (message.type !== 'join') return
              socket.onmessage?.(
                new MessageEvent('message', {
                  data: JSON.stringify({
                    type: 'agent-activity:changed',
                    agentIds: ['pip', 'cleo', 'peach', 'frankie', 'shipmate']
                  })
                })
              )
              socket.onmessage?.(
                new MessageEvent('message', {
                  data: JSON.stringify({
                    type: 'welcome',
                    version: 1,
                    connectionId: 'self',
                    profiles: [
                      message.profile,
                      {
                        type: 'user',
                        id: 'tony',
                        name: 'Tony',
                        email: 'tony@example.com',
                        color: 'blue'
                      }
                    ],
                    connections: [
                      ...['lee', 'sam', 'pat', 'cleo'].map(id => ({
                        connectionId: id,
                        identityId: id,
                        location: { page: 'overview', status: 'active' },
                        presence: []
                      })),
                      {
                        connectionId: 'self',
                        identityId: message.profile.id,
                        location: { page: 'overview', status: 'active' },
                        presence: []
                      },
                      {
                        connectionId: 'tony',
                        identityId: 'tony',
                        location: { page: 'scratchpad', status: 'active' },
                        presence: []
                      }
                    ]
                  })
                })
              )
            },
            close() {
              socket.readyState = 3
              queueMicrotask(() => socket.onclose?.())
            }
          }
          queueMicrotask(() => socket.onopen?.())
          return socket
        }
      })
    })
    await page.goto(WORKSPACE_PAGE)
    const agents = page.getByRole('group', { name: 'Active agents' })
    await expect(agents.getByLabel('Pip')).toBeVisible()
    await expect(agents.getByLabel('Cleo')).toBeVisible()
    await expect(agents.getByText('+1')).toBeVisible()
    await agents.getByLabel('Pip').hover()
    await expect(agents.getByLabel('Shipmate')).toBeVisible()
    await expect(agents.getByText('+1')).not.toBeVisible()
    const tooltip = page.locator('[data-slot="tooltip-content"]')
    await agents.getByLabel('Pip').hover()
    await expect(tooltip.getByText('Pip', { exact: true })).toBeVisible()
    await expect(tooltip.getByText('Active now', { exact: true })).toBeVisible()
    await takeSnapshot('recent agent tooltip')
    await tooltip.getByText('Active now', { exact: true }).hover()
    await expect(agents.getByText('+1')).toBeVisible()
    await expect(agents.getByLabel('Shipmate')).not.toBeVisible()
    await agents.getByLabel('Cleo').hover()
    await expect(tooltip.getByText('Overview', { exact: true })).toBeVisible()
    await expect(tooltip.getByText('Active now', { exact: true })).not.toBeVisible()
    await agents.getByLabel('Pip').click()
    await expect(page.getByRole('textbox', { name: 'Email', exact: true })).not.toBeVisible()
    const profiles = page.getByRole('group', { name: 'Active people', exact: true })
    await expect(profiles.getByText('+1')).toBeVisible()
    await page.getByRole('button', { name: 'Members in this workspace' }).locator('svg').hover()
    await expect(profiles.getByText('+1')).not.toBeVisible()
    await expect(profiles.getByRole('button', { name: 'pat', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Tony', exact: true }).hover()
    await expect(
      page.locator('[data-slot="tooltip-content"]').getByText('Scratchpad', { exact: true })
    ).toBeVisible()
    await takeSnapshot('active page tooltip')
    await page.getByRole('button', { name: 'Tony', exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'Email', exact: true })).not.toBeVisible()
    await page.getByRole('button', { name: 'Alex (You), open sharing', exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'Email', exact: true })).toBeVisible()
    const members = page.getByRole('list', { name: 'Who has access' })
    await expect(members.getByText('alex@example.com', { exact: true })).toBeVisible()
    await expect(members.getByText('Tony', { exact: true })).toBeVisible()
    await expect(members.getByText('tony@example.com', { exact: true })).toBeVisible()
    await expect(
      page.locator('li:has([aria-label="Alex"])').getByText('Owner', { exact: true })
    ).toBeVisible()
    await expect(members.getByText('Owner', { exact: true })).toHaveCount(1)
    await expect(
      page
        .getByRole('region', { name: 'Invite your agent' })
        .getByRole('button', { name: 'Copy prompt' })
    ).toBeVisible()
    await takeSnapshot('sharing from own avatar')
    await page.route('**/agent-invitations', () => new Promise(() => {}))
    await page.getByRole('button', { name: 'Copy prompt' }).click()
    await expect(page.getByRole('button', { name: 'Loading invite…' })).toBeVisible()
    await takeSnapshot('loading agent invite')
    await page.getByRole('button', { name: 'Alex (You), open sharing', exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'Email', exact: true })).not.toBeVisible()
  },
  {
    api: {
      '/api/config': {
        environment: 'cloud',
        demo: false,
        demoInstallUrl: '/'
      } satisfies ClientAppConfig,
      '/cloud/api/me': sharingUser
    },
    members: [
      {
        id: WORKSPACE,
        members: [
          sharingUser,
          { id: 'pip', type: 'agent', name: 'Pip', client: 'dot' },
          { id: 'cleo', type: 'agent', name: 'Cleo', client: 'duet' },
          { id: 'peach', type: 'agent', name: 'Peach', client: 'muse' },
          { id: 'frankie', type: 'agent', name: 'Frankie', client: 'instinct' },
          { id: 'shipmate', type: 'agent', name: 'Shipmate', client: 'town-assistant' },
          { id: 'tony', type: 'user', name: 'Tony', email: 'tony@example.com', isAnonymous: false },
          ...['lee', 'sam', 'pat'].map(id => ({
            id,
            type: 'user' as const,
            name: id,
            email: id + '@example.com',
            isAnonymous: false
          }))
        ],
        invitations: []
      }
    ]
  }
)

// Cloud browsers fetch owner content directly. Chats, the agent and preferences stay with the visitor.
const REFERENCE_ID = 'remote-board'
const referenceBase = `/api/workspaces/${REFERENCE_ID}`
const ownerBase = '/api/workspaces/alice:owner-board'
const remotePage = `/#/workspace/${REFERENCE_ID}`
const remoteAnswers = {
  '/api/config': { environment: 'cloud', demo: false },
  '/cloud/api/me': sharingUser,
  '/api/workspaces': [
    {
      id: REFERENCE_ID,
      path: '/visitor',
      addedAt: '',
      remote: { user_id: 'alice', workspace_id: 'owner-board' }
    }
  ],
  [ownerBase]: {
    apiBase: '/api/workspaces/owner-board',
    isRemote: false,
    version: 2,
    name: 'Shared board',
    widgetGrid: []
  },
  [`${referenceBase}/skills`]: { skills: [], updateAvailable: false },
  [referenceBase]: {
    apiBase: ownerBase,
    isRemote: true,
    version: 2,
    remote: { user_id: 'alice', workspace_id: 'owner-board' },
    cwd: '/visitor',
    harness: 'claude-code'
  },
  [`${referenceBase}/state`]: { revision: 1, selected: {}, sessions: {}, pendingViews: {} },
  [`${referenceBase}/harness`]: API[`/api/workspaces/${WORKSPACE}/harness`],
  [`${referenceBase}/sessions`]: [],
  [`${ownerBase}/widgets`]: { widgets: [] },
  [`${ownerBase}/views`]: { views: [] },
  [`${ownerBase}/applet-thumbnails`]: { thumbnails: [] }
}

// The owner's list reaches a visitor under the owner's address.
const remoteOptions = {
  api: remoteAnswers,
  members: [
    { id: 'alice:owner-board', members: [sharingUser], invitations: [] }
  ] satisfies WorkspaceMembersSnapshot[]
}

test(
  'an open workspace shows the access-denied screen when it disappears from the server list',
  async page => {
    const accessCheck = Promise.withResolvers<void>()
    await page.route('**/api/workspaces', async route => {
      await accessCheck.promise
      return route.fulfill({ json: [] })
    })
    await page.goto(remotePage)
    try {
      await expect(page.getByPlaceholder('Do anything')).toBeVisible()
    } finally {
      accessCheck.resolve()
    }
    await expect(
      page.getByRole('heading', { name: 'Workspace not found or you don’t have access' })
    ).toBeVisible()
    await expect(page.getByPlaceholder('Do anything')).toHaveCount(0)
    await takeSnapshot('lost workspace access')
  },
  remoteOptions
)

test(
  'remote workspace with the visitor’s own chat and settings',
  async page => {
    await page.goto(remotePage)
    await expect(page.getByRole('button', { name: 'Customize', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'New widget', exact: true })).toBeVisible()
    await expect(page.getByPlaceholder('Do anything')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Create tab', exact: true })).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Members in this workspace', exact: true })
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Alex (You), open sharing' })).toBeVisible()
    await takeSnapshot('remote overview')
    await page.getByRole('button', { name: 'Shared board menu', exact: true }).click()
    await expect(page.getByRole('menuitem', { name: 'Theme', exact: true })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Settings', exact: true })).toBeVisible()
  },
  remoteOptions
)

test(
  'manage connected agents in remote workspace settings',
  async page => {
    const requests: string[] = []
    await page.route(`**/cloud${ownerBase}/members/bot-membership`, route => {
      requests.push(route.request().method())
      return route.fulfill({ status: 204 })
    })
    await page.goto(remotePage)
    const sharing = page.getByRole('button', { name: 'Alex (You), open sharing' })
    await sharing.click()
    const people = page.getByRole('list', { name: 'Who has access' })
    await expect(people.getByText('Alex', { exact: true })).toBeVisible()
    await expect(people.getByText('Trip bot')).toHaveCount(0)
    await sharing.click()
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Environment', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Agents', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Agents' })).toBeVisible()
    const menu = page.getByRole('dialog').getByRole('button', { name: 'More options', exact: true })
    await expect(menu).toBeVisible()
    await expect(page.locator('[aria-label="Trip bot"] img')).toBeVisible()
    await expect(page.getByText('Trip bot', { exact: true })).toBeVisible()
    await expect(page.getByText('Grok Bot', { exact: true })).toBeVisible()
    await takeSnapshot('connected workspace agents')
    await menu.click()
    const remove = page.getByRole('menuitem', { name: 'Remove', exact: true })
    await expect(remove).toBeVisible()
    await takeSnapshot('workspace agent options')
    await remove.click()
    await expect(page.getByText('No agents connected to this workspace.')).toBeVisible()
    expect(requests).toEqual(['DELETE'])
  },
  {
    ...remoteOptions,
    members: [
      {
        id: 'alice:owner-board',
        members: [
          sharingUser,
          {
            type: 'agent',
            id: 'bot',
            client: 'grok-bot',
            name: 'Trip bot',
            membershipId: 'bot-membership'
          }
        ],
        invitations: []
      }
    ]
  }
)

for (const failure of [
  {
    name: 'missing local reference',
    path: referenceBase,
    status: 404,
    message: 'Workspace not found'
  },
  {
    name: 'owner access denied',
    path: ownerBase,
    status: 404,
    message: 'Workspace not available'
  },
  {
    name: 'owner unavailable',
    path: ownerBase,
    status: 502,
    message: 'Couldn’t reach the workspace owner'
  }
]) {
  test(
    `workspace info ${failure.name} shows the appropriate recovery action`,
    async page => {
      let requests = 0
      let available = false
      await page.route(`**${failure.path}`, route => {
        requests++
        return route.fulfill(
          available
            ? { json: remoteAnswers[failure.path as keyof typeof remoteAnswers] }
            : { status: failure.status, body: failure.message }
        )
      })
      await page.goto(remotePage)
      if (failure.status === 404) {
        await expect(
          page.getByRole('heading', {
            name: 'Workspace not found or you don’t have access',
            exact: true
          })
        ).toBeVisible()
        await expect(page.getByRole('button', { name: 'Try again', exact: true })).toHaveCount(0)
        expect(requests).toBe(1)
        await takeSnapshot('workspace not found')
        await page.getByRole('button', { name: 'Back to home', exact: true }).click()
        await expect(page.getByRole('heading', { name: 'Workspaces', exact: true })).toBeVisible()
        return
      }
      await expect(page.getByText(failure.message, { exact: true })).toBeVisible()
      expect(requests).toBe(1)
      await takeSnapshot('workspace info failed')
      available = true
      await page.getByRole('button', { name: 'Try again', exact: true }).click()
      await expect(
        page.getByRole('button', { name: 'Shared board menu', exact: true })
      ).toBeVisible()
      expect(requests).toBe(2)
    },
    remoteOptions
  )
}

test(
  'home trash lists deleted workspaces with restore',
  async page => {
    const restore = Promise.withResolvers<void>()
    await page.route('**/api/workspaces/trash/old-store/restore', async route => {
      await restore.promise
      return route.fulfill({ json: { id: 'old-store', name: 'Old storefront' } })
    })
    await page.goto('/#/')
    const trash = page.getByRole('button', { name: 'Trash', exact: true })
    await expect(trash).toHaveAttribute('aria-expanded', 'false')
    const note = page.getByText('30 days', { exact: false })
    await expect(note).not.toBeVisible()
    await trash.click()
    await expect(note).toBeVisible()
    const row = page.getByText('Old storefront').locator('..')
    const button = row.getByRole('button', { name: 'Restore' })
    await button.click()
    try {
      await expect(button).toBeDisabled()
      await takeSnapshot('restore pending')
    } finally {
      restore.resolve()
    }
    await expect(page.getByText('Old storefront')).toHaveCount(0)
    await expect(page.getByText('Launch notes')).toBeVisible()
  },
  {
    api: {
      '/api/config': { environment: 'cloud', demo: false },
      '/api/workspaces/trash': [
        {
          id: 'old-store',
          path: '/projects/Old storefront',
          addedAt: '',
          trashedAt: '2026-05-01T10:00:00Z'
        },
        {
          id: 'notes',
          path: '/projects/notes',
          addedAt: '',
          name: 'Launch notes',
          trashedAt: '2026-05-10T10:00:00Z'
        }
      ] satisfies WorkspaceEntry[]
    }
  }
)

test(
  'a member leaves a remote workspace from settings',
  async page => {
    let attempts = 0
    await page.route(`**${referenceBase}`, route => {
      if (route.request().method() !== 'DELETE') return route.fallback()
      attempts++
      if (attempts === 1)
        return route.fulfill({ status: 503, json: { error: 'Cloud unavailable' } })
      return route.fulfill({ json: { success: true } })
    })
    await page.goto(remotePage)
    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('button', { name: 'General' }).click()
    const leave = page.getByRole('button', { name: 'Leave', exact: true })
    await expect(leave).toBeVisible()
    await takeSnapshot('leave workspace settings')
    await leave.click()
    await expect(page.getByText('Couldn’t leave workspace')).toBeVisible()
    await leave.click()
    await expect(page.getByRole('heading', { name: 'Create your first workspace' })).toBeVisible()
  },
  remoteOptions
)

test(
  'remote workspace opening',
  async page => {
    await page.route(`**${ownerBase}`, () => new Promise(() => {}))
    await page.goto('/#/workspace/alice:owner-board')
    await expect(page.getByRole('status', { name: 'Loading', exact: true })).toBeVisible()
  },
  remoteOptions
)
test(
  'remote workspace setup failure can be retried after access succeeds',
  async page => {
    let attempts = 0
    await page.route('**/api/workspaces', route => {
      if (route.request().method() !== 'POST') return route.fallback()
      attempts++
      return route.fulfill(
        attempts === 1
          ? { status: 503, body: 'Could not initialize workspace' }
          : { json: { id: REFERENCE_ID, path: '/visitor', addedAt: '' } }
      )
    })
    await page.goto('/#/workspace/alice:owner-board')
    await expect(page.getByText('Could not initialize workspace', { exact: false })).toBeVisible()
    await takeSnapshot('workspace registration failed')
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect(page.getByRole('button', { name: 'Shared board menu', exact: true })).toBeVisible()
    expect(attempts).toBe(2)
  },
  remoteOptions
)

test(
  'remote workspace access denied creates no reference and returns home',
  async page => {
    let registrations = 0
    await page.route(`**${ownerBase}`, route =>
      route.fulfill({ status: 404, json: { error: 'Workspace not available' } })
    )
    await page.route('**/api/workspaces', route => {
      if (route.request().method() !== 'POST') return route.fallback()
      registrations++
      return route.fulfill({ json: { id: REFERENCE_ID, path: '/visitor', addedAt: '' } })
    })
    await page.goto('/#/workspace/alice:owner-board')
    await expect(
      page.getByRole('heading', {
        name: 'Workspace not found or you don’t have access',
        exact: true
      })
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Try again', exact: true })).toHaveCount(0)
    await takeSnapshot('workspace access denied')
    await page.getByRole('button', { name: 'Back to home', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Workspaces', exact: true })).toBeVisible()
    expect(registrations).toBe(0)
  },
  remoteOptions
)

test(
  'opening a synced reference by local ID asks for an agent only until one is saved',
  async page => {
    let chosen: string | undefined
    await page.route(`**${referenceBase}`, route =>
      route.fulfill({ json: { ...remoteAnswers[referenceBase], harness: chosen } })
    )
    await page.route(`**${referenceBase}/harness`, route => {
      if (route.request().method() !== 'PATCH') return route.fallback()
      chosen = 'claude-code'
      return route.fulfill({ json: { id: REFERENCE_ID, harness: chosen } })
    })
    await page.goto(remotePage)
    const picker = page.getByRole('dialog', { name: 'Add shared workspace' })
    await picker.getByRole('button', { name: /Claude/ }).click()
    await picker.getByRole('button', { name: 'Add workspace', exact: true }).click()
    const menu = page.getByRole('button', { name: 'Shared board menu', exact: true })
    await expect(menu).toBeVisible()
    await page.route('**/api/workspaces', route =>
      route.request().method() === 'POST'
        ? route.fulfill({ json: { id: REFERENCE_ID } })
        : route.fallback()
    )
    await page.goto('/#/workspace/alice:owner-board')
    await expect(menu).toBeVisible()
    await expect(picker).toHaveCount(0)
  },
  remoteOptions
)

test(
  'remote workspace opens before asking for the chosen agent login',
  async page => {
    let chosen: string | undefined
    await page.route(`**${referenceBase}`, route =>
      route.fulfill({ json: { ...remoteAnswers[referenceBase], harness: chosen } })
    )
    await page.route(`**${referenceBase}/harness`, route => {
      if (route.request().method() !== 'PATCH') return route.fallback()
      chosen = 'codex'
      return route.fulfill({ json: { id: REFERENCE_ID, harness: chosen } })
    })
    await page.route('**/api/workspaces', route => {
      if (route.request().method() !== 'POST') return route.fallback()
      return route.fulfill({ json: { id: REFERENCE_ID, path: '/visitor', addedAt: '' } })
    })
    await page.goto('/#/workspace/alice:owner-board')
    const picker = page.getByRole('dialog', { name: 'Add shared workspace' })
    await picker.getByRole('button', { name: /ChatGPT/ }).click()
    await takeSnapshot('choose an agent on first open')
    await picker.getByRole('button', { name: 'Add workspace', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Set up ChatGPT' })).toBeVisible()
    await takeSnapshot('sign in after opening a remote workspace')
  },
  {
    ...remoteOptions,
    viewports: { '': DEFAULT_VIEWPORT, narrow: { width: 390, height: 844 } },
    api: {
      ...remoteAnswers,
      [`${referenceBase}/harness`]: {
        harness: 'codex',
        availability: { status: 'available' },
        models: []
      },
      '/api/harnesses/status': {
        ...HARNESSES,
        codex: { availability: { status: 'login-required', reason: 'Log in to ChatGPT' } }
      }
    }
  }
)

test(
  'home shows local cards while an owner wakes',
  async page => {
    await page.route(`**${ownerBase}`, () => new Promise(() => {}))
    await page.goto('/#/')
    await expect(
      page.getByRole('link', { name: 'Open Local workspace', exact: true })
    ).toBeVisible()
    await expect(page.getByRole('link', { name: 'Open owner-board', exact: true })).toBeVisible()
    await takeSnapshot('home while owner wakes')
  },
  {
    api: {
      ...remoteAnswers,
      '/api/workspaces': [
        { id: WORKSPACE, path: '/local', addedAt: '', name: 'Local workspace' },
        {
          id: REFERENCE_ID,
          path: '/visitor',
          addedAt: '',
          name: 'owner-board',
          remote: { user_id: 'alice', workspace_id: 'owner-board' }
        }
      ]
    }
  }
)

test(
  'accept invitation registers and opens the workspace',
  async page => {
    let accepted = false
    let registrations = 0
    await page.route('**/cloud/api/workspaces/invitations', route =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          invitations: accepted
            ? []
            : [{ id: 'invite', workspaceName: 'Team notes', inviter: { name: 'Alice' } }]
        })
      })
    )
    await page.route('**/cloud/api/invitations/invite/accept', route => {
      accepted = true
      return route.fulfill({
        json: { success: true, remote: { user_id: 'alice', workspace_id: 'owner-board' } }
      })
    })
    let checkedAccess = false
    await page.route(`**${ownerBase}`, route => {
      checkedAccess = accepted
      return route.fulfill(
        accepted
          ? { json: remoteAnswers[ownerBase] }
          : { status: 404, json: { error: 'Workspace not available' } }
      )
    })
    await page.route('**/api/workspaces', route => {
      if (route.request().method() !== 'POST')
        return route.fulfill({
          json: registrations ? remoteAnswers['/api/workspaces'] : API['/api/workspaces']
        })
      expect(accepted && checkedAccess).toBe(true)
      registrations++
      return route.fulfill({ json: { id: REFERENCE_ID, path: '/visitor', addedAt: '' } })
    })
    await page.goto('/#/')
    await expect(page.getByRole('button', { name: 'Add', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Suggestions', exact: true })).toBeVisible()
    await takeSnapshot('invitation below workspaces and above imports')
    const invitations = page.getByRole('button', { name: 'Invitations', exact: true })
    await expect(invitations).toHaveAttribute('aria-expanded', 'true')
    await invitations.click()
    await expect(page.getByText('Invited by Alice')).not.toBeVisible()
    await invitations.click()
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Add shared workspace' })
    await expect(dialog.getByText('Choose an agent for Team notes')).toBeVisible()
    expect(accepted).toBe(false)
    await dialog.getByRole('button', { name: /Claude/ }).click()
    await dialog.getByRole('button', { name: 'Add workspace', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Shared board menu', exact: true })).toBeVisible()
    expect(registrations).toBe(1)
  },
  {
    api: {
      ...remoteAnswers,
      '/api/workspaces/suggestions': [{ path: '/projects/notes', harnesses: ['claude-code'] }]
    }
  }
)

test(
  'invitation failure can be retried without leaving home',
  async page => {
    await page.route('**/cloud/api/invitations/invite/accept', route =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{"error":"Could not accept invitation"}'
      })
    )
    await page.goto('/#/')
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Add shared workspace' })
    await dialog.getByRole('button', { name: /Claude/ }).click()
    const add = dialog.getByRole('button', { name: 'Add workspace', exact: true })
    await add.click()
    await expect(page.getByText('Could not accept invitation', { exact: true })).toBeVisible()
    await expect(add).not.toBeDisabled()
  },
  {
    api: {
      '/api/config': { environment: 'cloud', demo: false },
      '/cloud/api/workspaces/invitations': {
        invitations: [{ id: 'invite', workspaceName: 'Team notes', inviter: { name: 'Alice' } }]
      }
    }
  }
)

test(
  'failed owner view discovery can be retried',
  async page => {
    let unavailable = true
    // This browser session last visited the view before the owner's failure.
    await page.addInitScript(() => {
      sessionStorage.setItem(
        'moi:workspace-session',
        JSON.stringify({
          state: {
            workspaces: {
              'remote-board': {
                activeTab: 'views/counter',
                chatOpen: false
              }
            }
          },
          version: 0
        })
      )
    })
    await page.route(`**${ownerBase}/views`, route =>
      route.fulfill(
        unavailable
          ? { status: 503, body: 'Owner unavailable' }
          : { json: { views: [{ id: 'counter', status: 'compiled', title: 'Counter' }] } }
      )
    )
    await page.route(`**${ownerBase}/views/counter/module*`, route =>
      route.fulfill({
        contentType: 'text/javascript',
        body: 'export default function Counter() { return "Recovered owner view" }'
      })
    )
    await page.goto(remotePage)
    await expect(page.getByText('Couldn’t load workspace content', { exact: true })).toBeVisible()
    await takeSnapshot('owner content unavailable')
    unavailable = false
    await page.getByRole('button', { name: 'Try again', exact: true }).click()
    await expect(page.getByText('Recovered owner view', { exact: true })).toBeVisible()
  },
  remoteOptions
)
