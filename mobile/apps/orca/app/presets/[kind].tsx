import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import React, { useMemo, useState } from 'react'
import { FlatList, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native'
import type { PresetInfo, PresetKind } from 'react-native-orca-core'

import { useSession } from '@/lib/core'

const TITLES: Record<PresetKind, string> = { printer: 'Printer', filament: 'Filament', process: 'Process' }

function isPresetKind(value: string | string[] | undefined): value is PresetKind {
  return value === 'printer' || value === 'filament' || value === 'process'
}

export default function PresetListScreen(): React.JSX.Element {
  const params = useLocalSearchParams<{ kind: string }>()
  const kind: PresetKind = isPresetKind(params.kind) ? params.kind : 'printer'
  const session = useSession()
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [compatibleOnly, setCompatibleOnly] = useState(kind !== 'printer')

  const presets = useMemo<PresetInfo[]>(() => {
    if (session === null || session.isBusy) return []
    const needle = query.trim().toLowerCase()
    return session
      .presets(kind)
      .filter((p) => !compatibleOnly || p.isCompatible || kind === 'printer')
      .filter((p) => needle === '' || p.name.toLowerCase().includes(needle))
  }, [session, kind, query, compatibleOnly])

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: TITLES[kind] }} />
      <TextInput
        style={styles.search}
        placeholder="Search"
        value={query}
        onChangeText={setQuery}
        autoCorrect={false}
        autoCapitalize="none"
        clearButtonMode="while-editing"
      />
      {kind !== 'printer' ? (
        <View style={styles.row}>
          <Text style={styles.grow}>Only presets compatible with the selected printer</Text>
          <Switch value={compatibleOnly} onValueChange={setCompatibleOnly} />
        </View>
      ) : null}
      <FlatList
        data={presets}
        keyExtractor={(p) => p.name}
        ListEmptyComponent={<Text style={styles.muted}>No presets match</Text>}
        renderItem={({ item }) => (
          <Pressable
            style={styles.item}
            onPress={() => {
              if (session !== null && session.selectPreset(kind, item.name)) {
                router.back()
              }
            }}>
            <Text style={[styles.name, item.isSelected && styles.selected]}>{item.name}</Text>
            <Text style={styles.muted}>
              {item.vendor || (item.isUser ? 'user preset' : '')}
              {item.isCompatible ? '' : ' · not compatible'}
            </Text>
          </Pressable>
        )}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  search: { margin: 12, padding: 10, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: '#999' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingBottom: 8 },
  grow: { flex: 1 },
  item: { paddingVertical: 10, paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#ccc' },
  name: { fontSize: 16 },
  selected: { fontWeight: '700' },
  muted: { color: '#666', padding: 4 },
})
