import React from 'react'
import { View } from 'react-native'

import { radius, useTheme } from '@/lib/theme'

type Props = { percent: number }

// A slim progress track. Percent is clamped so the caller does not have to.
export function ProgressBar({ percent }: Props): React.JSX.Element {
  const { colors } = useTheme()
  const p = Math.max(0, Math.min(100, percent))
  return (
    <View style={{ height: 4, borderRadius: 2, backgroundColor: colors.ghost, overflow: 'hidden' }}>
      <View style={{ height: '100%', width: `${p}%`, backgroundColor: colors.accent, borderRadius: radius.sm }} />
    </View>
  )
}
