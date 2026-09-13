import React, { useCallback, useState } from 'react'
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated'
import { Pressable, Text, View } from 'react-native'

import { storage } from '@/lib/storage'

type Props = {
  title?: string
  subtitle?: string
  action?: React.ReactNode
  padded?: boolean
  children: React.ReactNode
  className?: string
  /** Optional stagger index for the entering animation. */
  index?: number
  /** When set, the card header becomes a tap target that hides / shows the body. Persisted across app launches under `card:collapsed:<key>`. */
  collapsible?: boolean
  collapseKey?: string
  defaultCollapsed?: boolean
}

// Grouped surface with soft shadow, no border. Reanimated's FadeInDown gives
// it a subtle rise on mount; passing `index` staggers a list of cards.
// Collapsible mode tucks the body away with a spring layout transition and
// persists the open/closed state under an MMKV key so the layout the user
// arranged sticks between launches.
export function Card({
  title,
  subtitle,
  action,
  padded = true,
  children,
  className,
  index = 0,
  collapsible = false,
  collapseKey,
  defaultCollapsed = false,
}: Props): React.JSX.Element {
  const persistKey = collapsible ? `card:collapsed:${collapseKey ?? title ?? ''}` : null
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (persistKey === null) return false
    const stored = storage.getBoolean(persistKey)
    return stored ?? defaultCollapsed
  })
  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev
      if (persistKey !== null) storage.set(persistKey, next)
      return next
    })
  }, [persistKey])

  const hasHeader = title !== undefined || subtitle !== undefined || action !== undefined || collapsible

  const Header = (
    <View className="flex-row items-end justify-between px-1">
      <View className="flex-1 pr-2">
        {title !== undefined ? (
          <View className="flex-row items-center gap-2">
            <Text className="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500 dark:text-neutral-400">
              {title}
            </Text>
            {collapsible ? (
              <Text
                className={`text-[13px] leading-3 text-neutral-400 dark:text-neutral-500 ${collapsed ? '' : 'rotate-90'}`}
                style={{ transform: [{ rotate: collapsed ? '0deg' : '90deg' }] }}
              >
                ›
              </Text>
            ) : null}
          </View>
        ) : null}
        {subtitle !== undefined ? (
          <Text className="mt-1 text-[13px] text-neutral-500 dark:text-neutral-400" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {action}
    </View>
  )

  return (
    <Animated.View
      layout={LinearTransition.springify().damping(20)}
      entering={FadeInDown.duration(320).delay(index * 60).springify().damping(18)}
      className={className}
    >
      {hasHeader ? (
        collapsible ? (
          <Pressable onPress={toggle} hitSlop={4} className="mb-2 active:opacity-60">
            {Header}
          </Pressable>
        ) : (
          <View className="mb-2">{Header}</View>
        )
      ) : null}
      {!collapsed ? (
        <Animated.View
          layout={LinearTransition.springify().damping(20)}
          className={`overflow-hidden rounded-3xl bg-white shadow-soft dark:bg-neutral-900 ${padded ? 'gap-3 p-4' : ''}`}
        >
          {children}
        </Animated.View>
      ) : null}
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
