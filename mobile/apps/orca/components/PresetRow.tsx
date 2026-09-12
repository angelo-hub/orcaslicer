import { Link } from 'expo-router'
import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { spacing, typography, useTheme } from '@/lib/theme'

type Props = {
  label: string
  value: string
  disabled?: boolean
  pickHref: React.ComponentProps<typeof Link>['href']
  editHref: React.ComponentProps<typeof Link>['href']
}

// A settings-app-style row: title on the left, current value in the muted
// column on the right, chevron pointing at the picker screen. A separate
// "Edit" affordance drops into the full parameter editor for that preset
// kind. The whole label + value area is one press target.
export function PresetRow({ label, value, disabled = false, pickHref, editHref }: Props): React.JSX.Element {
  const { colors } = useTheme()
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: spacing.sm,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: colors.separator,
      }}
    >
      <Link href={pickHref} asChild>
        <Pressable
          disabled={disabled}
          style={({ pressed }) => ({
            flex: 1,
            opacity: disabled ? 0.5 : pressed ? 0.6 : 1,
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.sm,
          })}
        >
          <Text style={{ ...typography.body, color: colors.text, flexShrink: 0 }}>{label}</Text>
          <Text
            style={{ ...typography.body, color: colors.textSubdued, flex: 1, textAlign: 'right' }}
            numberOfLines={1}
          >
            {value.length > 0 ? value : 'Choose'}
          </Text>
          <Text style={{ color: colors.textSubdued, fontSize: 20, lineHeight: 20 }}>›</Text>
        </Pressable>
      </Link>
      <Link href={editHref} asChild>
        <Pressable
          disabled={disabled}
          style={({ pressed }) => ({
            marginLeft: spacing.md,
            paddingVertical: spacing.xs,
            paddingHorizontal: spacing.sm,
            opacity: disabled ? 0.5 : pressed ? 0.6 : 1,
          })}
        >
          <Text style={{ ...typography.body, color: colors.accent }}>Edit</Text>
        </Pressable>
      </Link>
    </View>
  )
}
