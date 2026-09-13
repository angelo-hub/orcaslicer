import React from 'react'
import { Text, View } from 'react-native'

type Props = {
  title?: string
  subtitle?: string
  action?: React.ReactNode
  padded?: boolean
  children: React.ReactNode
  className?: string
}

// Grouped-list card. An optional section header sits above the surface in
// the muted style iOS uses, with room for a right-aligned action. `padded`
// controls interior padding: on when the card holds free-form content, off
// when it holds a list of rows that draw their own padding + separators.
export function Card({
  title,
  subtitle,
  action,
  padded = true,
  children,
  className,
}: Props): React.JSX.Element {
  const hasHeader = title !== undefined || subtitle !== undefined || action !== undefined
  return (
    <View className={className}>
      {hasHeader ? (
        <View className="mb-2 flex-row items-end justify-between px-1">
          <View className="flex-1 pr-2">
            {title !== undefined ? (
              <Text className="text-[13px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                {title}
              </Text>
            ) : null}
            {subtitle !== undefined ? (
              <Text className="mt-0.5 text-[13px] text-gray-400 dark:text-gray-500">{subtitle}</Text>
            ) : null}
          </View>
          {action}
        </View>
      ) : null}
      <View
        className={`overflow-hidden rounded-2xl bg-white dark:bg-neutral-900 ${padded ? 'gap-3 p-4' : ''}`}
      >
        {children}
      </View>
    </View>
  )
}

// Row inside a padded=false Card. Renders a separator under itself unless it
// is the last row (the caller passes `last`).
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
      className={`px-4 py-3 ${last === true ? '' : 'border-b border-gray-100 dark:border-neutral-800'} ${className ?? ''}`}
    >
      {children}
    </View>
  )
}
