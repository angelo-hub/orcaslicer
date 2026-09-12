import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import React, { useState } from 'react'
import { ActivityIndicator, Alert, FlatList, Text, TextInput, View } from 'react-native'

import { Avatar } from '@/components/Avatar'
import { Button } from '@/components/Button'
import { useCore } from '@/lib/core'
import { availableVendors, installVendor, installedVendors, removeVendor } from '@/lib/profiles'
import { queryKeys } from '@/lib/queries'

// Installs vendor profile folders from the OrcaSlicer repository into the
// core's resources directory, then reloads the presets. TanStack Query owns
// the GitHub listing cache and the retry policy, and mutations invalidate the
// installed-vendor list so the UI reflects the new state on the next paint.
export default function VendorsScreen(): React.JSX.Element {
  const { reloadPresets } = useCore()
  const client = useQueryClient()
  const [query, setQuery] = useState('')
  const [progress, setProgress] = useState<{ vendor: string; done: number; total: number } | null>(null)

  const available = useQuery({
    queryKey: queryKeys.availableVendors,
    queryFn: () => availableVendors(),
  })
  const installed = useQuery({
    queryKey: queryKeys.installedVendors,
    queryFn: () => installedVendors(),
    // The list on disk cannot change without our own mutations, so this
    // query stays fresh forever and refetches only on explicit invalidate.
    staleTime: Infinity,
  })

  const install = useMutation({
    mutationFn: async (vendor: string) => {
      setProgress({ vendor, done: 0, total: 0 })
      // Wipe any partial install first so a re-install (say, after a bad
      // download landed an empty file) starts from a clean slate.
      removeVendor(vendor)
      await installVendor(vendor, (done, total) => setProgress({ vendor, done, total }))
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: queryKeys.installedVendors })
      await reloadPresets()
    },
    onError: (error, vendor) => {
      Alert.alert(`Could not install ${vendor}`, String(error))
      removeVendor(vendor)
      void client.invalidateQueries({ queryKey: queryKeys.installedVendors })
    },
    onSettled: () => setProgress(null),
  })

  const remove = useMutation({
    mutationFn: (vendor: string) => Promise.resolve(removeVendor(vendor)),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: queryKeys.installedVendors })
      await reloadPresets()
    },
  })

  const busy = install.isPending || remove.isPending
  const installedList = installed.data ?? []
  const availableList = available.data ?? installedList
  const needle = query.trim().toLowerCase()
  const vendors = availableList.filter((v) => needle === '' || v.toLowerCase().includes(needle))

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
        {available.isError ? (
          <Text className="text-base text-red-500">{String(available.error)}</Text>
        ) : null}
        {available.isPending ? <ActivityIndicator color="#0a84ff" /> : null}
      </View>
      <FlatList
        data={vendors}
        keyExtractor={(v) => v}
        contentContainerClassName="px-3 pb-8"
        ItemSeparatorComponent={() => <View className="h-px bg-gray-200 dark:bg-neutral-800" />}
        renderItem={({ item }) => {
          const isInstalled = installedList.includes(item)
          const isWorking = progress?.vendor === item
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
                  {progress.total > 0 ? `${progress.done} / ${progress.total}` : 'Listing…'}
                </Text>
              ) : isInstalled ? (
                <View className="flex-row gap-1">
                  <Button title="Reinstall" variant="secondary" onPress={() => install.mutate(item)} disabled={busy} />
                  <Button title="Remove" variant="ghost" onPress={() => remove.mutate(item)} disabled={busy} />
                </View>
              ) : (
                <Button title="Install" onPress={() => install.mutate(item)} disabled={busy} />
              )}
            </View>
          )
        }}
      />
    </View>
  )
}
