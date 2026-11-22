import type { TablerIcon } from '@tabler/icons-react'

import { Button } from '@/client/components/ui/button'

export type ChatPromptBubble = {
  label: string
  prompt: string
  context: readonly string[]
  icon: TablerIcon
}

type ChatPromptBubbleProps = {
  prompt: ChatPromptBubble
  disabled?: boolean
  onSelect: (prompt: ChatPromptBubble) => void
}

export function ChatPromptBubble({ prompt, disabled = false, onSelect }: ChatPromptBubbleProps) {
  const Icon = prompt.icon

  return (
    <Button
      type="button"
      size="sm"
      disabled={disabled}
      onClick={() => onSelect(prompt)}
      className="h-auto items-start justify-start gap-2 rounded-lg p-2 px-3 text-left leading-snug whitespace-normal"
    >
      <Icon stroke={2} aria-hidden className="mt-0.5" />
      <span>{prompt.label}</span>
    </Button>
  )
}
