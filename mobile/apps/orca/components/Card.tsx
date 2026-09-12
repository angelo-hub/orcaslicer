import React from 'react'
import { Text, View } from 'react-native'

type Props = {
  title?: string
  children: React.ReactNode
  className?: string
}

// Card: a rounded surface with a hairline border. The optional title renders
// above the card in the muted section-header style iOS uses.
export function Card({ title, children, className }: Props): React.JSX.Element {
  return (
    <View className={className}>
      {title !== undefined && title !== '' ? (
        <Text className="mb-2 px-1 text-[13px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          {title}
        </Text>
      ) : null}
      <View className="gap-2 rounded-2xl border border-gray-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
        {children}
      </View>
    </View>
  )
}
