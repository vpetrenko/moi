import { type ReactNode, useState } from 'react'

import { IconRobot, IconKey, IconPlugConnected, IconSettings } from '@tabler/icons-react'

import { Button } from '@/client/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/client/components/ui/dialog'

import { useAppConfig } from '@/client/api/app-config'
import { useWorkspaceLayoutCtx } from '../workspace-layout-context'
import { AgentsSettings } from './agents-settings'
import { ConnectorsSettings } from './connectors-settings'
import { EnvironmentSettings } from './environment-settings'
import { GeneralSettings } from './general-settings'

export { DialogTrigger as WorkspaceSettingsDialogTrigger } from '@/client/components/ui/dialog'

type SettingsNav = 'general' | 'connectors' | 'environment' | 'agents'

const NAV: { id: SettingsNav; label: string; icon: typeof IconSettings }[] = [
  { id: 'general', label: 'General', icon: IconSettings },
  { id: 'connectors', label: 'Connectors', icon: IconPlugConnected },
  { id: 'environment', label: 'Environment', icon: IconKey },
  { id: 'agents', label: 'Agents', icon: IconRobot }
]

type WorkspaceSettingsDialogProps = {
  children: ReactNode
}

export function WorkspaceSettingsDialog({ children }: WorkspaceSettingsDialogProps) {
  const [page, setPage] = useState<SettingsNav>('general')

  const { environment } = useAppConfig()
  const { isRemote } = useWorkspaceLayoutCtx()
  const pages = NAV.filter(item => {
    if (item.id === 'environment') return !isRemote
    if (item.id === 'agents') return environment === 'cloud'
    return true
  })

  return (
    <Dialog>
      {children}
      <DialogContent className="flex h-[min(680px,90vh)] w-[880px] gap-0 overflow-hidden p-0 sm:max-w-[94vw]">
        <DialogTitle className="sr-only">Space settings</DialogTitle>

        {/* Sidebar nav — top padding lines the "Settings" label up with the
            page title across the divider. */}
        <nav className="flex w-48 shrink-0 flex-col gap-0.5 border-r bg-muted p-3">
          <p className="px-2.5 pt-4 pb-2 text-xs text-muted-foreground">Settings</p>
          {pages.map(item => (
            <Button
              key={item.id}
              type="button"
              variant={page === item.id ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setPage(item.id)}
              className="justify-start"
            >
              <item.icon stroke={1.75} />
              {item.label}
            </Button>
          ))}
        </nav>

        {/* Page */}
        <div className="relative scrollbar-thin min-w-0 flex-1 overflow-y-auto">
          <div className="px-8 py-7">
            {page === 'agents' && <AgentsSettings />}
            {page === 'general' && <GeneralSettings />}
            {page === 'connectors' && <ConnectorsSettings />}
            {page === 'environment' && <EnvironmentSettings />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
