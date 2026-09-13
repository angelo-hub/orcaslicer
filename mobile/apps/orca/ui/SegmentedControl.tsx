import React from 'react'
import { Pressable, Text, View } from 'react-native'

type Option<T extends string> = { value: T; label: string; disabled?: boolean }

type Props<T extends string> = {
  value: T
  options: readonly Option<T>[]
  onChange: (value: T) => void
}

// Modern iOS-style switch. Sits on a soft neutral track; the selected pill
// is white in light mode and a lifted neutral in dark, with just enough
// shadow to read as a switch rather than a toggle.
export function SegmentedControl<T extends string>({ value, options, onChange }: Props<T>): React.JSX.Element {
  return (
    <View className="flex-row rounded-2xl bg-neutral-100 p-1 dark:bg-neutral-800">
      {options.map((opt) => {
        const selected = opt.value === value
        return (
          <Pressable
            key={opt.value}
            onPress={opt.disabled === true || selected ? undefined : () => onChange(opt.value)}
            className={[
              'flex-1 items-center rounded-xl py-2',
              selected ? 'bg-white shadow-soft dark:bg-neutral-600' : 'bg-transparent',
              opt.disabled === true ? 'opacity-40' : '',
            ]
              .join(' ')
              .trim()}
          >
            <Text
              className={
                selected
                  ? 'text-[14px] font-semibold tracking-tight text-neutral-950 dark:text-neutral-50'
                  : 'text-[14px] font-medium text-neutral-500 dark:text-neutral-400'
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
