import React, { forwardRef } from 'react'
import { ActivityIndicator, Pressable, Text, type PressableProps } from 'react-native'

type Variant = 'primary' | 'secondary' | 'ghost' | 'destructive'
type Size = 'md' | 'lg'

type Props = Omit<PressableProps, 'style' | 'className'> & {
  title: string
  variant?: Variant
  size?: Size
  loading?: boolean
  fullWidth?: boolean
  className?: string
}

const sizeContainer: Record<Size, string> = {
  md: 'min-h-[44px] px-4 py-2.5',
  lg: 'min-h-[52px] px-5 py-3.5',
}
const variantContainer: Record<Variant, string> = {
  primary: 'bg-blue-500 active:bg-blue-600',
  secondary: 'bg-gray-100 active:bg-gray-200 dark:bg-neutral-800 dark:active:bg-neutral-700',
  ghost: 'bg-transparent active:bg-gray-100 dark:active:bg-neutral-800',
  destructive: 'bg-red-500 active:bg-red-600',
}
const variantText: Record<Variant, string> = {
  primary: 'text-white',
  secondary: 'text-blue-500',
  ghost: 'text-blue-500',
  destructive: 'text-white',
}
const sizeText: Record<Size, string> = {
  md: 'text-[15px] font-semibold',
  lg: 'text-[17px] font-semibold',
}

export const Button = forwardRef<React.ComponentRef<typeof Pressable>, Props>(function Button(
  {
    title,
    onPress,
    variant = 'primary',
    size = 'md',
    disabled = false,
    loading = false,
    fullWidth = false,
    className,
    ...rest
  },
  ref,
) {
  const isDisabled = disabled || loading
  const classes = [
    'items-center justify-center rounded-xl',
    sizeContainer[size],
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
        <Text className={`${sizeText[size]} ${variantText[variant]}`}>{title}</Text>
      )}
    </Pressable>
  )
})
