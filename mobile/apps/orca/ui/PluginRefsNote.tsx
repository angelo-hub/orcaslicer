import React from 'react'
import { Text, View } from 'react-native'

import { usePluginsEnabled } from '@/lib/flags'
import { presetPluginRefs } from '@/lib/plugins/refs'
import { Icon } from '@/ui/Icon'

// A line under a preset that names the plugins it asks for. The core has no
// plugin runtime, so a synced desktop preset slices without them; this says so
// instead of leaving the user to wonder why the output differs. The two option
// reads are cheap, so the parent's re-render on a preset change is enough.

type Props = {
  session: { option(key: string): string }
  className?: string
}

export function PluginRefsNote({ session, className }: Props): React.JSX.Element | null {
  const enabled = usePluginsEnabled()
  const refs = enabled ? presetPluginRefs(session) : []
  if (refs.length === 0) return null
  const names = [...new Set(refs.map((r) => r.name || r.uuid))].join(', ')
  return (
    <View className={`flex-row items-start gap-2 ${className ?? ''}`}>
      <Icon name="info" size={14} />
      <Text className="flex-1 text-footnote text-neutral-500 dark:text-neutral-400">
        Uses {refs.length === 1 ? 'plugin' : 'plugins'} {names}. Plugins do not run on this device
        yet, so the preset slices without them.
      </Text>
    </View>
  )
}
