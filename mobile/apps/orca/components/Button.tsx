import React, { forwardRef } from 'react'
import { ActivityIndicator, Pressable, Text, type PressableProps } from 'react-native'

type Variant = 'primary' | 'secondary' | 'ghost' | 'destructive'

// The remaining Pressable props pass through. Typed as an intersection rather than a
// string index signature: forwardRef's PropsWithoutRef turns a type with an index
// signature into one where every named prop is unknown.
type Props = Omit<PressableProps, 'onPress' | 'disabled' | 'className'> & {
  title: string
  onPress?: () => void
  variant?: Variant
  disabled?: boolean
  loading?: boolean
  fullWidth?: boolean
  className?: string
}

// Variant-driven class sets. Using strings so NativeWind can pre-compile them
// at build time; a runtime template would trip the JIT-safe extractor.
const containerBase =
  'min-h-[44px] items-center justify-center rounded-xl px-3 py-3'
const variantContainer: Record<Variant, string> = {
  primary: 'bg-blue-500 active:opacity-80',
  secondary: 'bg-gray-200 dark:bg-neutral-800 active:opacity-80',
  ghost: 'bg-transparent active:opacity-60',
  destructive: 'bg-red-500 active:opacity-80',
}
const variantText: Record<Variant, string> = {
  primary: 'text-white',
  secondary: 'text-blue-500',
  ghost: 'text-blue-500',
  destructive: 'text-white',
}

export const Button = forwardRef<React.ComponentRef<typeof Pressable>, Props>(function Button(
  { title, onPress, variant = 'primary', disabled = false, loading = false, fullWidth = false, className, ...rest },
  ref,
) {
  const isDisabled = disabled || loading
  const classes = [
    containerBase,
    variantContainer[variant],
    fullWidth ? 'self-stretch' : 'self-start',
    isDisabled ? 'opacity-40' : '',
    className ?? '',
  ]
    .join(' ')
    .trim()
  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled }}
      onPress={isDisabled ? undefined : onPress}
      {...rest}
      className={classes}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' || variant === 'destructive' ? '#ffffff' : '#0a84ff'} />
      ) : (
        <Text className={`text-base font-semibold ${variantText[variant]}`}>{title}</Text>
      )}
    </Pressable>
  )
})
