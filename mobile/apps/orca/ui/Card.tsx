import React from 'react'
import Animated, { FadeInDown } from 'react-native-reanimated'
import { Text, View } from 'react-native'

type Props = {
  title?: string
  subtitle?: string
  action?: React.ReactNode
  padded?: boolean
  children: React.ReactNode
  className?: string
  /** Optional stagger index for the entering animation. */
  index?: number
}

// Grouped surface with soft shadow, no border. Reanimated's FadeInDown gives
// it a subtle rise on mount; passing `index` staggers a list of cards.
export function Card({
  title,
  subtitle,
  action,
  padded = true,
  children,
  className,
  index = 0,
}: Props): React.JSX.Element {
  const hasHeader = title !== undefined || subtitle !== undefined || action !== undefined
  return (
    <Animated.View entering={FadeInDown.duration(320).delay(index * 60).springify().damping(18)} className={className}>
      {hasHeader ? (
        <View className="mb-2 flex-row items-end justify-between px-1">
          <View className="flex-1 pr-2">
            {title !== undefined ? (
              <Text className="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500 dark:text-neutral-400">
                {title}
              </Text>
            ) : null}
            {subtitle !== undefined ? (
              <Text className="mt-1 text-[13px] text-neutral-500 dark:text-neutral-400" numberOfLines={1}>
                {subtitle}
              </Text>
            ) : null}
          </View>
          {action}
        </View>
      ) : null}
      <View
        className={`overflow-hidden rounded-3xl bg-white shadow-soft dark:bg-neutral-900 ${padded ? 'gap-3 p-4' : ''}`}
      >
        {children}
      </View>
    </Animated.View>
  )
}

export function Row({
  last,
  children,
  className,
}: {
  last?: boolean
  children: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <View
      className={`px-4 py-3 ${last === true ? '' : 'border-b border-neutral-100 dark:border-neutral-800'} ${className ?? ''}`}
    >
      {children}
    </View>
  )
}
