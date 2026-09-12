import { Stack, useLocalSearchParams } from 'expo-router'
import React, { useCallback, useMemo, useState } from 'react'
import { Button, FlatList, Modal, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native'
import { getOptionDefinitions, type OptionDefinition, type OrcaSession, type PresetKind } from 'react-native-orca-core'

import { useSession } from '@/lib/core'
import {
  decodeBool,
  decodePercent,
  decodeScalar,
  editorKind,
  encodeBool,
  encodePercent,
  encodeScalar,
  groupByCategory,
  matchesQuery,
  visibleInMode,
  type OptionMode,
} from '@/lib/options'

// The parameter editor. Nothing here is written per option: rows are generated from the
// option definitions the core exports, grouped by category and filtered by mode and
// search, and every edit goes through Session.set_option in serialized form.

const TITLES: Record<PresetKind, string> = { printer: 'Printer settings', filament: 'Filament settings', process: 'Process settings' }
const MODES: OptionMode[] = ['simple', 'advanced', 'expert']

function isPresetKind(value: string | string[] | undefined): value is PresetKind {
  return value === 'printer' || value === 'filament' || value === 'process'
}

interface RowProps {
  def: OptionDefinition
  session: OrcaSession
  modified: boolean
  onChanged: () => void
}

function OptionRow({ def, session, modified, onChanged }: RowProps): React.JSX.Element {
  const serialized = session.option(def.key)
  const kind = editorKind(def, serialized)
  const [draft, setDraft] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const [picking, setPicking] = useState(false)

  const commit = useCallback(
    (value: string) => {
      const ok = session.setOption(def.key, value)
      setError(!ok)
      if (ok) onChanged()
    },
    [def.key, session, onChanged]
  )

  const scalar = decodeScalar(def, serialized)
  const label = def.label !== '' ? def.label : def.key

  let editor: React.JSX.Element
  switch (kind) {
    case 'bool':
      editor = <Switch value={decodeBool(scalar)} disabled={def.readonly} onValueChange={(v) => commit(encodeScalar(def, serialized, encodeBool(v)))} />
      break
    case 'enum': {
      const index = def.enumValues?.indexOf(scalar) ?? -1
      const shown = index >= 0 ? (def.enumLabels?.[index] ?? scalar) : scalar
      editor = (
        <View>
          <Button title={shown === '' ? 'Choose' : shown} disabled={def.readonly} onPress={() => setPicking(true)} />
          <Modal visible={picking} animationType="slide" onRequestClose={() => setPicking(false)}>
            <FlatList
              data={def.enumValues ?? []}
              keyExtractor={(v) => v}
              contentContainerStyle={styles.modalList}
              renderItem={({ item, index: i }) => (
                <Pressable
                  style={styles.modalItem}
                  onPress={() => {
                    setPicking(false)
                    commit(encodeScalar(def, serialized, item))
                  }}>
                  <Text style={[styles.value, item === scalar && styles.selected]}>{def.enumLabels?.[i] ?? item}</Text>
                </Pressable>
              )}
              ListFooterComponent={<Button title="Cancel" onPress={() => setPicking(false)} />}
            />
          </Modal>
        </View>
      )
      break
    }
    case 'number':
    case 'percent':
    case 'float_or_percent':
    case 'text':
    case 'code':
    case 'raw': {
      const isPercent = kind === 'percent'
      const shownValue = draft ?? (isPercent ? decodePercent(scalar) : kind === 'raw' ? serialized : scalar)
      editor = (
        <View style={styles.inputRow}>
          <TextInput
            style={[styles.input, kind === 'code' && styles.code, error && styles.inputError]}
            value={shownValue}
            editable={!def.readonly}
            multiline={kind === 'code'}
            autoCorrect={false}
            autoCapitalize="none"
            keyboardType={kind === 'number' || kind === 'percent' ? 'numbers-and-punctuation' : 'default'}
            onChangeText={setDraft}
            onBlur={() => {
              if (draft === null) return
              const value = isPercent ? encodePercent(draft) : draft
              commit(kind === 'raw' ? value : encodeScalar(def, serialized, value))
              setDraft(null)
            }}
          />
          {def.unit !== '' ? <Text style={styles.unit}>{def.unit}</Text> : null}
          {isPercent ? <Text style={styles.unit}>%</Text> : null}
        </View>
      )
      break
    }
  }

  return (
    <View style={styles.row}>
      <View style={styles.labelColumn}>
        <Text style={styles.label}>
          {modified ? '● ' : ''}
          {label}
        </Text>
        {def.tooltip !== '' ? (
          <Text style={styles.tooltip} numberOfLines={3}>
            {def.tooltip}
          </Text>
        ) : null}
        {error ? <Text style={styles.error}>Not a valid value for this option</Text> : null}
      </View>
      <View style={styles.editorColumn}>{editor}</View>
    </View>
  )
}

export default function SettingsScreen(): React.JSX.Element {
  const params = useLocalSearchParams<{ kind: string }>()
  const kind: PresetKind = isPresetKind(params.kind) ? params.kind : 'process'
  const session = useSession()
  const [mode, setMode] = useState<OptionMode>('simple')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)

  const onChanged = useCallback(() => setRevision((r) => r + 1), [])

  const definitions = useMemo(
    () => getOptionDefinitions().filter((d) => d.kind === kind && visibleInMode(d, mode) && matchesQuery(d, query)),
    [kind, mode, query]
  )
  const groups = useMemo(() => groupByCategory(definitions), [definitions])
  const shownGroups = category === null ? groups : groups.filter((g) => g.category === category)
  const modified = useMemo(() => new Set(session?.modifiedOptions(kind) ?? []), [session, kind, revision])

  if (session === null) {
    return <View />
  }

  const rows: Array<{ header: string } | { def: OptionDefinition }> = []
  for (const group of shownGroups) {
    rows.push({ header: group.category })
    for (const def of group.options) rows.push({ def })
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: `${TITLES[kind]}: ${session.selectedPreset(kind)}` }} />
      <View style={styles.toolbar}>
        <TextInput style={styles.search} placeholder="Search settings" value={query} onChangeText={setQuery} autoCorrect={false} autoCapitalize="none" clearButtonMode="while-editing" />
        <View style={styles.modes}>
          {MODES.map((m) => (
            <Pressable key={m} onPress={() => setMode(m)} style={[styles.modeChip, mode === m && styles.modeChipActive]}>
              <Text style={mode === m ? styles.modeTextActive : styles.modeText}>{m}</Text>
            </Pressable>
          ))}
          {modified.size > 0 ? (
            <Button
              title={`Discard ${modified.size}`}
              onPress={() => {
                session.discardModifiedOptions(kind)
                onChanged()
              }}
            />
          ) : null}
        </View>
        <FlatList
          horizontal
          data={[null, ...groups.map((g) => g.category)]}
          keyExtractor={(c) => c ?? '*'}
          showsHorizontalScrollIndicator={false}
          renderItem={({ item }) => (
            <Pressable onPress={() => setCategory(item)} style={[styles.modeChip, category === item && styles.modeChipActive]}>
              <Text style={category === item ? styles.modeTextActive : styles.modeText}>{item ?? 'All'}</Text>
            </Pressable>
          )}
        />
      </View>
      <FlatList
        data={rows}
        extraData={revision}
        keyExtractor={(row) => ('header' in row ? `#${row.header}` : row.def.key)}
        ListEmptyComponent={<Text style={styles.tooltip}>No settings match</Text>}
        renderItem={({ item }) =>
          'header' in item ? (
            <Text style={styles.header}>{item.header}</Text>
          ) : (
            <OptionRow def={item.def} session={session} modified={modified.has(item.def.key)} onChanged={onChanged} />
          )
        }
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  toolbar: { padding: 12, gap: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#ccc' },
  search: { padding: 10, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: '#999' },
  modes: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  modeChip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, backgroundColor: '#eee', marginRight: 6 },
  modeChipActive: { backgroundColor: '#0d7f62' },
  modeText: { color: '#333' },
  modeTextActive: { color: '#fff', fontWeight: '600' },
  header: { fontWeight: '700', fontSize: 15, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 6, color: '#444' },
  row: { flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#ddd' },
  labelColumn: { flex: 1, gap: 2 },
  editorColumn: { width: 150, justifyContent: 'center' },
  label: { fontSize: 15 },
  tooltip: { color: '#666', fontSize: 12 },
  error: { color: '#b00020', fontSize: 12 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  input: { flex: 1, padding: 8, borderRadius: 6, borderWidth: StyleSheet.hairlineWidth, borderColor: '#999', textAlign: 'right' },
  inputError: { borderColor: '#b00020' },
  code: { textAlign: 'left', fontFamily: 'Menlo', fontSize: 12, minHeight: 80 },
  unit: { color: '#666' },
  value: { fontSize: 16 },
  selected: { fontWeight: '700' },
  modalList: { paddingVertical: 48 },
  modalItem: { paddingVertical: 12, paddingHorizontal: 20, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#ccc' },
})
