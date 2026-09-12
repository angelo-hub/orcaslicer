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
}

// A settings-app-style row: label on the left, current value on the right, a
// chevron pointing at the picker sheet, and a separate "Edit" affordance
// that dives into the full parameter editor.
export function PresetRow({ label, value, disabled = false, onPickPress, editHref }: Props): React.JSX.Element {
  const router = useRouter()
  return (
    <View className="flex-row items-center gap-2 border-b border-gray-200 py-2 dark:border-neutral-800">
      <Pressable
        onPress={disabled ? undefined : onPickPress}
        className={`flex-1 flex-row items-center gap-2 ${disabled ? 'opacity-50' : 'active:opacity-60'}`}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value.length > 0 ? value : 'not chosen'}`}
      >
        <Text className="text-base text-black dark:text-white">{label}</Text>
        <Text
          numberOfLines={1}
          className="flex-1 text-right text-base text-gray-500 dark:text-gray-400"
        >
          {value.length > 0 ? value : 'Choose'}
        </Text>
        <Text className="ml-0.5 text-2xl leading-6 text-gray-400">›</Text>
      </Pressable>
      <View className="h-full w-px bg-gray-200 dark:bg-neutral-800" />
      <Pressable
        hitSlop={8}
        onPress={disabled ? undefined : () => router.push(editHref)}
        className={disabled ? 'opacity-50' : 'active:opacity-60'}
        accessibilityRole="button"
        accessibilityLabel={`Edit ${label} preset`}
      >
        <Text className="px-1 text-base text-blue-500">Edit</Text>
      </Pressable>
    </View>
  )
}
