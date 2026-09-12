import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { radius, spacing, typography, useTheme } from '@/lib/theme'

type Option<T extends string> = { value: T; label: string; disabled?: boolean }

type Props<T extends string> = {
  value: T
  options: readonly Option<T>[]
  onChange: (value: T) => void
}

// SegmentedControl: a compact iOS-style two-or-three-way switch. Kept tiny —
// no animations, no drag — the selected pill sits on the elevated surface so
// the segment reads as inset in both light and dark schemes.
export function SegmentedControl<T extends string>({ value, options, onChange }: Props<T>): React.JSX.Element {
  const { colors } = useTheme()
  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: colors.ghost,
        borderRadius: radius.sm,
        padding: 2,
        gap: 2,
      }}
    >
      {options.map((opt) => {
        const selected = opt.value === value
        return (
          <Pressable
            key={opt.value}
            onPress={opt.disabled === true || selected ? undefined : () => onChange(opt.value)}
            style={{
              flex: 1,
              paddingVertical: spacing.xs,
              paddingHorizontal: spacing.sm,
              borderRadius: radius.sm - 2,
              backgroundColor: selected ? colors.surfaceElevated : 'transparent',
              alignItems: 'center',
              opacity: opt.disabled === true ? 0.4 : 1,
              borderWidth: selected ? StyleSheet.hairlineWidth : 0,
              borderColor: colors.separator,
            }}
          >
            <Text
              style={{
                ...typography.body,
                fontWeight: selected ? '600' : '500',
                color: selected ? colors.text : colors.textMuted,
              }}
            >
              {opt.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}
