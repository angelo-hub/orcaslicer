import React, { useMemo, useState } from 'react'
import { FlatList, Image, Modal, Pressable, Text, TextInput, View } from 'react-native'
import type { PresetInfo, PresetKind } from 'react-native-orca-core'

import { Avatar } from '@/components/Avatar'
import { DEFAULT_PROFILE_SOURCE } from '@/lib/profiles'

type Props = {
  kind: PresetKind
  title: string
  presets: PresetInfo[]
  selected: string
  visible: boolean
  onPick: (name: string) => void
  onClose: () => void
}

const KIND_LABEL: Record<PresetKind, string> = {
  printer: 'printer',
  filament: 'filament',
  process: 'process',
}

// A bottom-sheet-style Modal that lists presets, filtered by a search field.
// Printer rows try to fetch a cover image straight from the profiles source
// and fall back to a colored initials disc when the image is missing so the
// layout stays consistent.
export function PresetPicker({ kind, title, presets, selected, visible, onPick, onClose }: Props): React.JSX.Element {
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()

  const filtered = useMemo(() => {
    const items = presets.filter((p) => (needle === '' || p.name.toLowerCase().includes(needle)) && p.isCompatible)
    items.sort((a, b) => {
      if (a.isSelected !== b.isSelected) return a.isSelected ? -1 : 1
      if (a.isSystem !== b.isSystem) return a.isSystem ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    return items
  }, [presets, needle])

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View className="flex-1 bg-gray-100 dark:bg-black">
        <View className="flex-row items-center justify-between px-4 pb-2 pt-3">
          <Text className="text-xl font-bold text-black dark:text-white">{title}</Text>
          <Pressable hitSlop={8} onPress={onClose} className="active:opacity-60">
            <Text className="text-base font-semibold text-blue-500">Done</Text>
          </Pressable>
        </View>
        <View className="px-4 pb-2">
          <TextInput
            className="rounded-xl border border-gray-200 bg-white p-3 text-base text-black dark:border-neutral-800 dark:bg-neutral-900 dark:text-white"
            placeholder={`Search ${KIND_LABEL[kind]} presets`}
            placeholderTextColor="#8e8e93"
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
            autoCapitalize="none"
          />
        </View>
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.name}
          contentContainerClassName="px-4 pb-8"
          ItemSeparatorComponent={() => <View className="h-px bg-gray-200 dark:bg-neutral-800" />}
          ListEmptyComponent={
            <View className="items-center p-6">
              <Text className="text-base text-gray-500 dark:text-gray-400">
                {presets.length === 0 ? 'No presets installed yet.' : 'Nothing matches your search.'}
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <PresetItem
              item={item}
              kind={kind}
              isSelected={item.name === selected || item.isSelected}
              onPick={() => onPick(item.name)}
            />
          )}
        />
      </View>
    </Modal>
  )
}

function coverURL(kind: PresetKind, vendor: string, name: string): string | null {
  if (kind !== 'printer' || vendor === '') return null
  const src = DEFAULT_PROFILE_SOURCE
  const path = `resources/profiles/${vendor}/${name}_cover.png`
  return `https://raw.githubusercontent.com/${src.owner}/${src.repo}/${src.ref}/${encodeURI(path)}`
}

function PresetItem({
  item,
  kind,
  isSelected,
  onPick,
}: {
  item: PresetInfo
  kind: PresetKind
  isSelected: boolean
  onPick: () => void
}): React.JSX.Element {
  const [imageOK, setImageOK] = useState(true)
  const url = coverURL(kind, item.vendor, item.name)
  return (
    <Pressable
      onPress={onPick}
      className="flex-row items-center gap-3 px-2 py-3 active:bg-gray-200 dark:active:bg-neutral-800"
    >
      {url !== null && imageOK ? (
        <Image
          source={{ uri: url }}
          className="h-11 w-11 rounded-lg bg-gray-100 dark:bg-neutral-800"
          resizeMode="contain"
          onError={() => setImageOK(false)}
        />
      ) : (
        <Avatar text={item.name} size={44} />
      )}
      <View className="flex-1">
        <Text className="text-base text-black dark:text-white" numberOfLines={1}>
          {item.name}
        </Text>
        {item.vendor !== '' ? (
          <Text className="text-[13px] text-gray-500 dark:text-gray-400">
            {item.vendor}
            {item.isUser ? ' · user' : item.isSystem ? ' · system' : ''}
          </Text>
        ) : null}
      </View>
      {isSelected ? <Text className="text-xl text-blue-500">✓</Text> : null}
    </Pressable>
  )
}
