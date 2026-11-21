import { createElement } from 'react'

import claudeIcon from '@/client/assets/claude.svg'
import hermesIcon from '@/client/assets/hermes.png'
import openaiIcon from '@/client/assets/openai.svg'
import openclawIcon from '@/client/assets/openclaw.svg'
import { resolveIdentityIcon } from '@/client/lib/identity-icon-registry'
import { cn } from '@/client/lib/cn'
import { DEFAULT_PRIMARY_COLOR, deriveThemeColors, resolveThemeColorOverrides } from '@/lib/themes'
import type { WorkspaceIcon as WorkspaceIconValue, WorkspaceLayout, HarnessType } from '@/lib/types'

export const harnessIcon: Record<HarnessType, string> = {
  'claude-code': claudeIcon,
  openclaw: openclawIcon,
  codex: openaiIcon,
  hermes: hermesIcon
}

type WorkspaceIconProps = {
  className?: string
  icon?: WorkspaceIconValue
  harness?: HarnessType | null
  workspaceTheme?: WorkspaceLayout['theme']
}

function renderIconContent(
  icon: WorkspaceIconValue | undefined,
  themed: boolean,
  fallbackIcon: string
) {
  switch (icon?.type) {
    case 'emoji':
      return (
        <span
          aria-hidden="true"
          className={cn(
            'flex size-full translate-y-[2cqi] items-center justify-center font-[Apple_Color_Emoji,Segoe_UI_Emoji,Noto_Color_Emoji,sans-serif] leading-none',
            themed ? 'text-[60cqi]' : 'text-[85cqi]'
          )}
        >
          {icon.value}
        </span>
      )
    case 'upload':
      return <img src={icon.value} alt="" className="size-full" />
    case 'glyph': {
      const Glyph = resolveIdentityIcon(icon.value)
      if (Glyph) {
        return createElement(Glyph, {
          'aria-hidden': true,
          stroke: 1.75,
          className: themed ? 'size-[70%]' : 'size-[95%] text-foreground'
        })
      }
      // Fall through to the default provider icon.
    }
    default:
      return <img src={fallbackIcon} alt="" className="size-[95%]" />
  }
}

export function WorkspaceIcon({ className, icon, harness, workspaceTheme }: WorkspaceIconProps) {
  const themed = icon?.type !== 'upload' && icon?.background === 'theme'
  const colors = themed
    ? (resolveThemeColorOverrides(workspaceTheme) ?? deriveThemeColors(DEFAULT_PRIMARY_COLOR))
    : undefined
  const fallbackIcon = harnessIcon[harness ?? 'claude-code']

  return (
    <span
      className={cn(
        '@container inline-flex shrink-0 items-center justify-center overflow-hidden',
        themed && 'shadow-[inset_0_0_1rem_rgba(255,255,255,0.3)]',
        className
      )}
      style={
        colors ? { backgroundColor: colors.primary, color: colors.primaryForeground } : undefined
      }
    >
      {renderIconContent(icon, themed, fallbackIcon)}
    </span>
  )
}
