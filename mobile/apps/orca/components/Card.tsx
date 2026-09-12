import React from 'react'
import { StyleSheet, Text, View, type ViewStyle } from 'react-native'

import { radius, spacing, typography, useTheme } from '@/lib/theme'

type Props = {
  title?: string
  children: React.ReactNode
  style?: ViewStyle
}

// Card: the primary surface. On iOS the visual is a rounded rectangle over the
// grouped-background fill; the border is a hairline in the separator color so
// the card stays legible in both schemes.
export function Card({ title, children, style }: Props): React.JSX.Element {
  const { colors } = useTheme()
  return (
    <View style={style}>
      {title !== undefined && title !== '' ? (
        <Text
          style={{
            ...typography.section,
            color: colors.textSubdued,
            marginBottom: spacing.sm,
            paddingHorizontal: spacing.xs,
          }}
        >
          {title}
        </Text>
      ) : null}
      <View
        style={{
          backgroundColor: colors.surface,
          borderRadius: radius.md,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.separator,
          padding: spacing.md,
          gap: spacing.sm,
        }}
      >
        {children}
      </View>
    </View>
  )
}
