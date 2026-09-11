import React, { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Button, FlatList, StyleSheet, Text, TextInput, View } from 'react-native'

import { useCore } from '@/lib/core'
import { availableVendors, installVendor, installedVendors, removeVendor } from '@/lib/profiles'

// Installs vendor profile folders from the OrcaSlicer repository into the core's
// resources directory, then reloads the presets.
export default function VendorsScreen(): React.JSX.Element {
  const { reloadPresets } = useCore()
  const [available, setAvailable] = useState<string[] | null>(null)
  const [installed, setInstalled] = useState<string[]>(installedVendors())
  const [query, setQuery] = useState('')
  const [working, setWorking] = useState<{ vendor: string; done: number; total: number } | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    availableVendors()
      .then(setAvailable)
      .catch((e: unknown) => setError(String(e)))
  }, [])

  const install = useCallback(
    async (vendor: string) => {
      setWorking({ vendor, done: 0, total: 0 })
      try {
        await installVendor(vendor, (done, total) => setWorking({ vendor, done, total }))
        setInstalled(installedVendors())
        await reloadPresets()
      } catch (e) {
        Alert.alert(`Could not install ${vendor}`, String(e))
      } finally {
        setWorking(null)
      }
    },
    [reloadPresets]
  )

  const remove = useCallback(
    async (vendor: string) => {
      removeVendor(vendor)
      setInstalled(installedVendors())
      await reloadPresets()
    },
    [reloadPresets]
  )

  const needle = query.trim().toLowerCase()
  const vendors = (available ?? installed).filter((v) => needle === '' || v.toLowerCase().includes(needle))

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.search}
        placeholder="Search vendors"
        value={query}
        onChangeText={setQuery}
        autoCorrect={false}
        autoCapitalize="none"
      />
      {error !== '' ? <Text style={styles.error}>{error}</Text> : null}
      {available === null && error === '' ? <ActivityIndicator /> : null}
      <FlatList
        data={vendors}
        keyExtractor={(v) => v}
        renderItem={({ item }) => {
          const isInstalled = installed.includes(item)
          const isWorking = working?.vendor === item
          return (
            <View style={styles.row}>
              <Text style={styles.grow}>{item}</Text>
              {isWorking ? (
                <Text style={styles.muted}>
                  {working.total > 0 ? `${working.done}/${working.total}` : 'listing'}
                </Text>
              ) : isInstalled ? (
                <Button title="Remove" onPress={() => remove(item)} disabled={working !== null} />
              ) : (
                <Button title="Install" onPress={() => install(item)} disabled={working !== null} />
              )}
            </View>
          )
        }}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  search: { margin: 12, padding: 10, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: '#999' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#ccc' },
  grow: { flex: 1 },
  muted: { color: '#666' },
  error: { color: '#b00020', paddingHorizontal: 12 },
})
