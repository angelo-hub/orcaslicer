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

// Settings-app-style row: title with the current selection under it, and two
// tap targets on the right — a chevron that opens the picker sheet and an
// "Edit" pill that jumps to the full parameter editor. The row draws its own
// separator so a stack of rows inside a padded=false Card composes cleanly.
export function PresetRow({ label, value, disabled = false, onPickPress, editHref, last = false }: Props): React.JSX.Element {
  const router = useRouter()
  return (
    <View
      className={`flex-row items-center px-4 py-3 ${last ? '' : 'border-b border-gray-100 dark:border-neutral-800'}`}
    >
      <Pressable
        onPress={disabled ? undefined : onPickPress}
        className={`flex-1 flex-row items-center gap-2 ${disabled ? 'opacity-40' : 'active:opacity-60'}`}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value.length > 0 ? value : 'not chosen'}`}
      >
        <View className="flex-1">
          <Text className="text-[15px] font-medium text-black dark:text-white">{label}</Text>
          <Text numberOfLines={1} className="mt-0.5 text-[13px] text-gray-500 dark:text-gray-400">
            {value.length > 0 ? value : 'Not selected'}
          </Text>
        </View>
        <Text className="text-2xl leading-5 text-gray-300 dark:text-neutral-600">›</Text>
      </Pressable>
      <Pressable
        hitSlop={8}
        onPress={disabled ? undefined : () => router.push(editHref)}
        className={`ml-3 rounded-full bg-gray-100 px-3 py-1 dark:bg-neutral-800 ${disabled ? 'opacity-40' : 'active:opacity-60'}`}
        accessibilityRole="button"
        accessibilityLabel={`Edit ${label} preset`}
      >
        <Text className="text-[13px] font-semibold text-blue-500">Edit</Text>
      </Pressable>
    </View>
  )
}
