import React, { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Alert, FlatList, StyleSheet, Text, TextInput, View } from 'react-native'

import { Button } from '@/components/Button'
import { useCore } from '@/lib/core'
import { availableVendors, installVendor, installedVendors, removeVendor } from '@/lib/profiles'
import { radius, spacing, typography, useTheme } from '@/lib/theme'

// Installs vendor profile folders from the OrcaSlicer repository into the core's
// resources directory, then reloads the presets.
export default function VendorsScreen(): React.JSX.Element {
  const { colors } = useTheme()
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
        // Wipe any partial install first so a re-install (say, after a bad
        // download landed an empty file) starts from a clean slate.
        removeVendor(vendor)
        await installVendor(vendor, (done, total) => setWorking({ vendor, done, total }))
        setInstalled(installedVendors())
        await reloadPresets()
      } catch (e) {
        Alert.alert(`Could not install ${vendor}`, String(e))
        removeVendor(vendor)
        setInstalled(installedVendors())
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
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ padding: spacing.md, gap: spacing.sm }}>
        <TextInput
          style={{
            padding: spacing.md,
            borderRadius: radius.md,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: colors.separator,
            backgroundColor: colors.surface,
            color: colors.text,
            ...typography.body,
          }}
          placeholder="Search vendors"
          placeholderTextColor={colors.textSubdued}
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          autoCapitalize="none"
        />
        {error !== '' ? <Text style={{ ...typography.body, color: colors.danger }}>{error}</Text> : null}
        {available === null && error === '' ? <ActivityIndicator color={colors.accent} /> : null}
      </View>
      <FlatList
        data={vendors}
        keyExtractor={(v) => v}
        contentContainerStyle={{ paddingHorizontal: spacing.md, paddingBottom: spacing.xl }}
        ItemSeparatorComponent={() => <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.separator }} />}
        renderItem={({ item }) => {
          const isInstalled = installed.includes(item)
          const isWorking = working?.vendor === item
          return (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.sm,
                paddingVertical: spacing.md,
                paddingHorizontal: spacing.sm,
                backgroundColor: colors.surface,
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ ...typography.body, color: colors.text }}>{item}</Text>
                {isInstalled && !isWorking ? (
                  <Text style={{ ...typography.caption, color: colors.success }}>Installed</Text>
                ) : null}
              </View>
              {isWorking ? (
                <Text style={{ ...typography.caption, color: colors.textMuted }}>
                  {working.total > 0 ? `${working.done} / ${working.total}` : 'Listing…'}
                </Text>
              ) : isInstalled ? (
                <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                  <Button title="Reinstall" variant="secondary" onPress={() => install(item)} disabled={working !== null} />
                  <Button title="Remove" variant="ghost" onPress={() => remove(item)} disabled={working !== null} />
                </View>
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
