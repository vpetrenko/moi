import { DEFAULT_VIEWPORT, expect, takeSnapshot } from '@uiverify/bun'

import type { Identity } from '@/client/features/identity/types'
import type { WorkspaceMembersSnapshot } from '@/client/features/collab/members/types'
import type { ClientAppConfig, WorkspaceLayoutResponse } from '@/lib/types'

import { API, suite, WORKSPACE } from './fixtures'

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
    // Standalone Moi never asks Cloud for shared workspaces.
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
      await page.route('**/cloud/api/workspaces/shared', () => new Promise(() => {}))
      await page.route('**/api/workspaces/discover', () => new Promise(() => {}))
      await page.route('**/cloud/api/workspaces/invitations', () => new Promise(() => {}))
      await page.goto('/#/')
      await expect(page.getByRole('link', { name: 'Open acme-store', exact: true })).toBeVisible()
      await expect(page.getByText('Loading shared workspaces…')).toHaveCount(0)
      await expect(page.getByRole('heading', { name: 'Invitations' })).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Import other workspaces' })).toHaveCount(0)
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
    },
    {
      api: {
        '/api/config': {
          environment: 'cloud',
          demo: true,
          demoInstallUrl: 'https://moi.computer'
        } satisfies ClientAppConfig
      }
    }
  )

  test('new workspace', async page => {
    await page.goto('/#/')
    await page.getByRole('button', { name: 'New', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
  })
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
                    agentIds: [
                      'agent:pip',
                      'agent:cleo',
                      'agent:peach',
                      'agent:frankie',
                      'agent:shipmate'
                    ]
                  })
                })
              )
              socket.onmessage?.(
                new MessageEvent('message', {
                  data: JSON.stringify({
                    type: 'welcome',
                    version: 2,
                    connectionId: 'self',
                    users: [
                      message.profile,
                      { id: 'tony', name: 'Tony', email: 'tony@example.com', color: 'blue' }
                    ],
                    connections: [
                      ...['lee', 'sam', 'pat', 'agent:cleo'].map(id => ({
                        connectionId: id,
                        userId: id,
                        location: { page: 'overview', status: 'active' },
                        presence: []
                      })),
                      {
                        connectionId: 'self',
                        userId: message.profile.id,
                        location: { page: 'overview', status: 'active' },
                        presence: []
                      },
                      {
                        connectionId: 'tony',
                        userId: 'tony',
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
    const agents = page.getByRole('group', { name: 'Recently active agents' })
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
    const users = page.getByRole('group', { name: 'Active users', exact: true })
    await expect(users.getByText('+1')).toBeVisible()
    await page.getByRole('button', { name: 'Users in this workspace' }).locator('svg').hover()
    await expect(users.getByText('+1')).not.toBeVisible()
    await expect(users.getByRole('button', { name: 'pat', exact: true })).toBeVisible()
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
const REMOTE = 'shared-board'
const remoteBase = `/api/workspaces/${REMOTE}`
const ownerBase = '/api/workspaces/alice:owner-board'
const remotePage = `/#/workspace/${REMOTE}`
const remoteAnswers = {
  '/api/config': { environment: 'cloud', demo: false },
  '/cloud/api/me': sharingUser,
  [ownerBase]: {
    apiBase: '/api/workspaces/owner-board',
    isRemote: false,
    version: 2,
    name: 'Shared board',
    widgetGrid: []
  },
  [`${remoteBase}/skills`]: { skills: [], updateAvailable: false },
  [remoteBase]: {
    apiBase: ownerBase,
    isRemote: true,
    version: 2,
    remote: { user_id: 'alice', workspace_id: 'owner-board' },
    cwd: '/visitor',
    harness: 'claude-code'
  },
  [`${remoteBase}/state`]: { revision: 1, selected: {}, sessions: {}, pendingViews: {} },
  [`${remoteBase}/harness`]: API[`/api/workspaces/${WORKSPACE}/harness`],
  [`${remoteBase}/sessions`]: [],
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
  'remote workspace with the visitor’s own chat and settings',
  async page => {
    await page.goto(remotePage)
    await expect(page.getByRole('button', { name: 'Customize', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'New widget', exact: true })).toBeVisible()
    await expect(page.getByPlaceholder('Do anything')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Create tab', exact: true })).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Users in this workspace', exact: true })
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
  'manage connected agents in shared workspace settings',
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
    const remove = page.getByRole('menuitem', { name: 'Remove from workspace', exact: true })
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
    path: remoteBase,
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
  'shared workspace list error',
  async page => {
    await page.route('**/cloud/api/workspaces/shared', route =>
      route.fulfill({ status: 503, json: { error: 'Cloud unavailable' } })
    )
    await page.goto('/#/')
    await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible()
  },
  { api: { '/api/config': { environment: 'cloud', demo: false } } }
)

test(
  'shared workspace opening',
  async page => {
    await page.route('**/api/workspaces', route =>
      route.request().method() === 'POST' ? new Promise(() => {}) : route.fallback()
    )
    await page.goto('/#/workspace/alice:board')
    await expect(page.getByRole('status', { name: 'Opening shared workspace' })).toBeVisible()
  },
  { api: { ...remoteAnswers, '/api/workspaces/alice:board': remoteAnswers[ownerBase] } }
)
test(
  'shared workspace setup failure can be retried after access succeeds',
  async page => {
    let attempts = 0
    await page.route('**/api/workspaces', route => {
      if (route.request().method() !== 'POST') return route.fallback()
      attempts++
      return route.fulfill(
        attempts === 1
          ? { status: 503, body: 'Could not initialize workspace' }
          : { json: { id: REMOTE, path: '/visitor', addedAt: '' } }
      )
    })
    await page.goto('/#/workspace/alice:owner-board')
    await expect(page.getByText('Could not initialize workspace', { exact: false })).toBeVisible()
    await takeSnapshot('workspace registration failed')
    await page.getByRole('button', { name: 'Try again', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Shared board menu', exact: true })).toBeVisible()
    expect(attempts).toBe(2)
  },
  remoteOptions
)

test(
  'shared workspace access denied creates no reference and returns home',
  async page => {
    let registrations = 0
    await page.route(`**${ownerBase}`, route =>
      route.fulfill({ status: 404, json: { error: 'Workspace not available' } })
    )
    await page.route('**/api/workspaces', route => {
      if (route.request().method() !== 'POST') return route.fallback()
      registrations++
      return route.fulfill({ json: { id: REMOTE, path: '/visitor', addedAt: '' } })
    })
    await page.goto('/#/workspace/alice:owner-board')
    await expect(
      page.getByRole('heading', {
        name: 'Workspace not found or you don’t have access',
        exact: true
      })
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Try again', exact: true })).toHaveCount(0)
    expect(registrations).toBe(0)
    await takeSnapshot('workspace access denied')
    await page.getByRole('button', { name: 'Back to home', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Workspaces', exact: true })).toBeVisible()
    expect(registrations).toBe(0)
  },
  remoteOptions
)

test(
  'owner-qualified workspace registers and opens the local reference',
  async page => {
    let registrations = 0
    let checkedAccess = false
    await page.route(`**${ownerBase}`, route => {
      checkedAccess = true
      return route.fulfill({ json: remoteAnswers[ownerBase] })
    })
    await page.route('**/api/workspaces', route => {
      if (route.request().method() !== 'POST') return route.fallback()
      expect(checkedAccess).toBe(true)
      registrations++
      expect(route.request().method()).toBe('POST')
      return route.fulfill({ json: { id: REMOTE, path: '/visitor', addedAt: '' } })
    })
    await page.goto('/#/workspace/alice:owner-board')
    await expect(page.getByRole('button', { name: 'Shared board menu', exact: true })).toBeVisible()
    expect(registrations).toBe(1)
  },
  remoteOptions
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
          id: REMOTE,
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
  'home mixes unopened shares with registered workspaces',
  async page => {
    await page.route('**/api/workspaces', route =>
      route.request().method() === 'POST' ? new Promise(() => {}) : route.fallback()
    )
    await page.goto('/#/')
    const cards = page.getByRole('link', { name: /^Open / })
    await expect(cards).toHaveCount(3)
    await expect(page.getByRole('link', { name: 'Open Alpha', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Open Bravo', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Open Zebra', exact: true })).toBeVisible()
    await takeSnapshot('mixed workspace grid')
    await page.getByRole('link', { name: 'Open Alpha', exact: true }).click()
    await expect(page.getByRole('status', { name: 'Opening shared workspace' })).toBeVisible()
  },
  {
    api: {
      '/api/config': { environment: 'cloud', demo: false },
      '/api/workspaces': [
        { id: 'local', path: '/Zebra', name: 'Zebra', addedAt: '2026-01-01T00:00:00Z' },
        {
          id: 'registered',
          path: '/visitor',
          name: 'Bravo',
          addedAt: '2026-01-01T00:00:00Z',
          remote: { user_id: 'alice', workspace_id: 'board' }
        }
      ],
      '/api/workspaces/alice:board': { name: 'Bravo' },
      '/api/workspaces/bob:board': { name: 'Alpha' },
      '/cloud/api/workspaces/shared': {
        workspaces: [
          { id: 'board', owner: { id: 'alice', name: 'Alice' } },
          { id: 'board', owner: { id: 'bob', name: 'Bob' } }
        ]
      }
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
    await page.route('**/cloud/api/workspaces/shared', route =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          workspaces: accepted ? [{ id: 'owner-board', owner: { id: 'alice', name: 'Alice' } }] : []
        })
      })
    )
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
      if (route.request().method() !== 'POST') return route.fallback()
      expect(accepted && checkedAccess).toBe(true)
      registrations++
      expect(route.request().method()).toBe('POST')
      return route.fulfill({ json: { id: REMOTE, path: '/visitor', addedAt: '' } })
    })
    await page.goto('/#/')
    await expect(page.getByRole('button', { name: 'Accept', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Invitations', exact: true })).toBeVisible()
    await expect(page.getByText('Import other workspaces', { exact: true })).toBeVisible()
    await takeSnapshot('invitation below workspaces and above imports')
    await page.getByRole('button', { name: 'Accept', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Shared board menu', exact: true })).toBeVisible()
    expect(registrations).toBe(1)
  },
  {
    api: {
      ...remoteAnswers,
      '/api/workspaces/discover': [{ path: '/projects/notes', harnesses: ['claude-code'] }]
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
    await page.getByRole('button', { name: 'Accept', exact: true }).click()
    await expect(page.getByText('Could not accept invitation', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible()
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
              'shared-board': {
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
