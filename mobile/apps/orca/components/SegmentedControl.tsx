import React from 'react'
import { Pressable, Text, View } from 'react-native'

type Option<T extends string> = { value: T; label: string; disabled?: boolean }

type Props<T extends string> = {
  value: T
  options: readonly Option<T>[]
  onChange: (value: T) => void
}

// A compact iOS-style switch. The selected pill sits on the surface tint;
// unselected labels use the muted grouped-list style.
export function SegmentedControl<T extends string>({ value, options, onChange }: Props<T>): React.JSX.Element {
  return (
    <View className="flex-row gap-0.5 rounded-lg bg-gray-200 p-0.5 dark:bg-neutral-800">
      {options.map((opt) => {
        const selected = opt.value === value
        return (
          <Pressable
            key={opt.value}
            onPress={opt.disabled === true || selected ? undefined : () => onChange(opt.value)}
            className={[
              'flex-1 items-center rounded-md px-2 py-1',
              selected
                ? 'bg-white shadow-sm dark:bg-neutral-700'
                : 'bg-transparent',
              opt.disabled === true ? 'opacity-40' : '',
            ]
              .join(' ')
              .trim()}
          >
            <Text
              className={[
                'text-base',
                selected ? 'font-semibold text-black dark:text-white' : 'font-medium text-gray-600 dark:text-gray-300',
              ].join(' ')}
            >
              {opt.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}
