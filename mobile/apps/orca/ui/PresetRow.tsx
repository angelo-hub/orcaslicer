import { useRouter } from 'expo-router'
import React from 'react'
import { Pressable, Text, View } from 'react-native'

type Href = Parameters<ReturnType<typeof useRouter>['push']>[0]

type Props = {
  label: string
  value: string
  disabled?: boolean
  onPickPress: () => void
  editHref: Href
  last?: boolean
}

export function PresetRow({ label, value, disabled = false, onPickPress, editHref, last = false }: Props): React.JSX.Element {
  const router = useRouter()
  const isEmpty = value.length === 0 || value.startsWith('Default ')
  return (
    <View
      className={`flex-row items-center px-4 py-3 ${last ? '' : 'border-b border-neutral-100 dark:border-neutral-800'}`}
    >
      <Pressable
        onPress={disabled ? undefined : onPickPress}
        className={`flex-1 flex-row items-center gap-2 ${disabled ? 'opacity-40' : 'active:opacity-60'}`}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${!isEmpty ? value : 'not chosen'}`}
      >
        <View className="flex-1">
          <Text className="text-[15px] font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
            {label}
          </Text>
          <Text
            numberOfLines={1}
            className={`mt-0.5 text-[13px] ${isEmpty ? 'italic text-neutral-400 dark:text-neutral-500' : 'text-neutral-500 dark:text-neutral-400'}`}
          >
            {isEmpty ? 'Tap to choose' : value}
          </Text>
        </View>
        <Text className="text-[20px] leading-5 text-neutral-300 dark:text-neutral-600">›</Text>
      </Pressable>
      <Pressable
        hitSlop={8}
        onPress={disabled ? undefined : () => router.push(editHref)}
        className={`ml-3 rounded-full bg-neutral-100 px-3 py-1.5 dark:bg-neutral-800 ${disabled ? 'opacity-40' : 'active:opacity-60'}`}
        accessibilityRole="button"
        accessibilityLabel={`Edit ${label} preset`}
      >
        <Text className="text-[12px] font-semibold uppercase tracking-wider text-neutral-600 dark:text-neutral-300">
          Edit
        </Text>
      </Pressable>
    </View>
  )
}
