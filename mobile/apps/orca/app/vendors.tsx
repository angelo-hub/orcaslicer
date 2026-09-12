import React, { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Alert, FlatList, Text, TextInput, View } from 'react-native'

import { Avatar } from '@/components/Avatar'
import { Button } from '@/components/Button'
import { useCore } from '@/lib/core'
import { availableVendors, installVendor, installedVendors, removeVendor } from '@/lib/profiles'

// Installs vendor profile folders from the OrcaSlicer repository into the
// core's resources directory, then reloads the presets.
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
    [reloadPresets],
  )

  const remove = useCallback(
    async (vendor: string) => {
      removeVendor(vendor)
      setInstalled(installedVendors())
      await reloadPresets()
    },
    [reloadPresets],
  )

  const needle = query.trim().toLowerCase()
  const vendors = (available ?? installed).filter((v) => needle === '' || v.toLowerCase().includes(needle))

  return (
    <View className="flex-1 bg-gray-100 dark:bg-black">
      <View className="gap-2 p-3">
        <TextInput
          className="rounded-xl border border-gray-200 bg-white p-3 text-base text-black dark:border-neutral-800 dark:bg-neutral-900 dark:text-white"
          placeholder="Search vendors"
          placeholderTextColor="#8e8e93"
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          autoCapitalize="none"
        />
        {error !== '' ? <Text className="text-base text-red-500">{error}</Text> : null}
        {available === null && error === '' ? <ActivityIndicator color="#0a84ff" /> : null}
      </View>
      <FlatList
        data={vendors}
        keyExtractor={(v) => v}
        contentContainerClassName="px-3 pb-8"
        ItemSeparatorComponent={() => <View className="h-px bg-gray-200 dark:bg-neutral-800" />}
        renderItem={({ item }) => {
          const isInstalled = installed.includes(item)
          const isWorking = working?.vendor === item
          return (
            <View className="flex-row items-center gap-3 bg-white px-2 py-3 dark:bg-neutral-900">
              <Avatar text={item} size={40} />
              <View className="flex-1">
                <Text className="text-base text-black dark:text-white">{item}</Text>
                {isInstalled && !isWorking ? (
                  <Text className="text-[13px] text-green-600 dark:text-green-400">Installed</Text>
                ) : (
                  <Text className="text-[13px] text-gray-500 dark:text-gray-400">Vendor bundle</Text>
                )}
              </View>
              {isWorking ? (
                <Text className="text-[13px] text-gray-600 dark:text-gray-300">
                  {working.total > 0 ? `${working.done} / ${working.total}` : 'Listing…'}
                </Text>
              ) : isInstalled ? (
                <View className="flex-row gap-1">
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
