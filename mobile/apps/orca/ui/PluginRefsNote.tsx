import React from 'react'
import { Text, View } from 'react-native'

import { usePluginsEnabled } from '@/lib/flags'
import { checkRefs } from '@/lib/plugins/native'
import { presetPluginRefs } from '@/lib/plugins/refs'
import { usePluginStore } from '@/lib/plugins/store'
import { Icon } from '@/ui/Icon'

// A line under a preset that names the plugins it asks for and whether the runtime has
// them. A reference the runtime cannot resolve is skipped at slice time, so a synced
// desktop preset slices without that plugin; this says so instead of leaving the user to
// wonder why the output differs. The option reads are cheap, so the parent's re-render on
// a preset change is enough.

type Props = {
  session: { option(key: string): string }
  className?: string
}

const STATE_TEXT: Record<string, string> = {
  loaded: 'ready',
  disabled: 'switched off',
  installed: 'not loaded',
  missing: 'not on this device',
  error: 'failed to load',
}

export function PluginRefsNote({ session, className }: Props): React.JSX.Element | null {
  const enabled = usePluginsEnabled()
  // Subscribed so a load or unload re-renders the line.
  usePluginStore((s) => s.runtime)
  const refs = enabled ? presetPluginRefs(session) : []
  if (refs.length === 0) return null
  const states = checkRefs(refs)
  const line =
    states.length === 0
      ? `Uses ${refs.length === 1 ? 'plugin' : 'plugins'} ${[...new Set(refs.map((r) => r.name || r.uuid))].join(', ')}. This build cannot run plugins, so the preset slices without ${refs.length === 1 ? 'it' : 'them'}.`
      : refs
          .map((r) => {
            const s = states.find((x) => x.uuid === r.uuid && x.capability === r.capability)
            return `${r.name || r.capability}: ${STATE_TEXT[s?.state ?? 'missing'] ?? s?.state}`
          })
          .join(' · ')
  const allReady = states.length > 0 && states.every((s) => s.state === 'loaded')
  return (
    <View className={`flex-row items-start gap-2 ${className ?? ''}`}>
      <Icon name={allReady ? 'check' : 'info'} size={14} />
      <Text className="flex-1 text-footnote text-neutral-500 dark:text-neutral-400">{line}</Text>
    </View>
  )
}
