import React from 'react'
import { Pressable, Text, View } from 'react-native'

type Option<T extends string> = { value: T; label: string; disabled?: boolean }

type Props<T extends string> = {
  value: T
  options: readonly Option<T>[]
  onChange: (value: T) => void
}

// A compact iOS-style switch. The selected pill sits on the elevated
// surface; unselected labels use the muted grouped-list style.
export function SegmentedControl<T extends string>({ value, options, onChange }: Props<T>): React.JSX.Element {
  return (
    <View className="flex-row rounded-lg bg-gray-200/70 p-1 dark:bg-neutral-800">
      {options.map((opt) => {
        const selected = opt.value === value
        return (
          <Pressable
            key={opt.value}
            onPress={opt.disabled === true || selected ? undefined : () => onChange(opt.value)}
            className={[
              'flex-1 items-center rounded-md py-1.5',
              selected ? 'bg-white shadow-sm dark:bg-neutral-600' : 'bg-transparent',
              opt.disabled === true ? 'opacity-40' : '',
            ]
              .join(' ')
              .trim()}
          >
            <Text
              className={
                selected
                  ? 'text-[14px] font-semibold text-black dark:text-white'
                  : 'text-[14px] font-medium text-gray-600 dark:text-gray-300'
              }
            >
              {opt.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}
