import React, { forwardRef } from 'react'
import { ActivityIndicator, Pressable, Text, type ViewStyle } from 'react-native'

import { radius, spacing, typography, useTheme, type ThemeColors } from '@/lib/theme'

type Variant = 'primary' | 'secondary' | 'ghost' | 'destructive'

type Props = {
  title: string
  onPress?: () => void
  variant?: Variant
  disabled?: boolean
  loading?: boolean
  fullWidth?: boolean
  style?: ViewStyle
  // expo-router's <Link asChild> wraps a Pressable and hands the child an
  // onPress. Accept extra unknown fields so TypeScript is happy at the call
  // site.
  [extra: string]: unknown
}

function palette(colors: ThemeColors, variant: Variant, disabled: boolean, pressed: boolean) {
  const dim = disabled ? 0.4 : pressed ? 0.85 : 1
  switch (variant) {
    case 'primary':
      return { bg: colors.accent, fg: colors.accentText, opacity: dim }
    case 'destructive':
      return { bg: colors.danger, fg: '#ffffff', opacity: dim }
    case 'ghost':
      return { bg: 'transparent', fg: colors.accent, opacity: disabled ? 0.4 : pressed ? 0.6 : 1 }
    case 'secondary':
    default:
      return { bg: colors.ghost, fg: colors.accent, opacity: dim }
  }
}

// Button: a Pressable in tint-colored fill variants. Height and radius match
// the iOS "Filled" button style; a spinner replaces the label while loading
// so callers do not need to swap components mid-flight.
export const Button = forwardRef<React.ComponentRef<typeof Pressable>, Props>(function Button(
  { title, onPress, variant = 'primary', disabled = false, loading = false, fullWidth = false, style, ...rest },
  ref,
) {
  const { colors } = useTheme()
  const isDisabled = disabled || loading
  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled }}
      onPress={isDisabled ? undefined : onPress}
      {...rest}
      style={({ pressed }) => {
        const p = palette(colors, variant, isDisabled, pressed)
        return [
          {
            backgroundColor: p.bg,
            opacity: p.opacity,
            paddingVertical: 12,
            paddingHorizontal: spacing.md,
            borderRadius: radius.md,
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 44,
            alignSelf: fullWidth ? 'stretch' : 'flex-start',
          },
          style,
        ]
      }}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' || variant === 'destructive' ? '#ffffff' : colors.accent} />
      ) : (
        <Text style={{ ...typography.bodyStrong, color: palette(colors, variant, isDisabled, false).fg }}>
          {title}
        </Text>
      )}
    </Pressable>
  )
})
