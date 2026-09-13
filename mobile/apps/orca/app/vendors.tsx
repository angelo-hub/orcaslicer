import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import React, { useMemo, useState } from 'react'
import { ActivityIndicator, Alert, Image, Pressable, SectionList, Text, TextInput, View } from 'react-native'

import { Avatar } from '@/ui/Avatar'
import { Button } from '@/ui/Button'
import { useCore } from '@/lib/core'
import {
  availablePrinters,
  DEFAULT_PROFILE_SOURCE,
  installVendor,
  installedVendors,
  removeVendor,
  type AvailablePrinter,
} from '@/lib/profiles'
import { queryKeys } from '@/lib/queries'

// Printer-first browser: users pick the specific printer they own. Installing
// happens under the hood — we fetch the vendor bundle the picked printer
// belongs to, then land the user back at the home screen with that printer
// preset selected.
export default function VendorsScreen(): React.JSX.Element {
  const router = useRouter()
  const { reloadPresets, session } = useCore()
  const client = useQueryClient()
  const [query, setQuery] = useState('')
  const [busyPrinter, setBusyPrinter] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  const printers = useQuery({
    queryKey: queryKeys.availablePrinters,
    queryFn: () => availablePrinters(),
  })
  const installed = useQuery({
    queryKey: queryKeys.installedVendors,
    queryFn: () => installedVendors(),
    staleTime: Infinity,
  })

  const install = useMutation({
    mutationFn: async (p: AvailablePrinter) => {
      setBusyPrinter(`${p.vendor}::${p.model}`)
      setProgress({ done: 0, total: 0 })
      const alreadyInstalled = installed.data?.includes(p.vendor) === true
      if (!alreadyInstalled) {
        removeVendor(p.vendor)
        await installVendor(p.vendor, (done, total) => setProgress({ done, total }))
      }
      await client.invalidateQueries({ queryKey: queryKeys.installedVendors })
      await reloadPresets()
      // Select the picked model as the printer preset. The compat filter will
      // narrow filaments and processes on the home screen automatically.
      try {
        if (session !== null) {
          const candidates = session.presets('printer')
          // Prefer the exact model name; the 0.4 nozzle variant if present.
          const exact = candidates.find((c) => c.name === p.model && c.vendor === p.vendor)
          const withNozzle = candidates.find(
            (c) => c.vendor === p.vendor && c.name.startsWith(`${p.model} `),
          )
          const pick = exact ?? withNozzle
          if (pick !== undefined) session.selectPreset('printer', pick.name)
        }
      } catch {
        // Selection is best effort; the user can pick on the home screen.
      }
    },
    onSuccess: () => router.back(),
    onError: (error, p) => {
      Alert.alert(`Could not install ${p.model}`, String(error))
      removeVendor(p.vendor)
      void client.invalidateQueries({ queryKey: queryKeys.installedVendors })
    },
    onSettled: () => {
      setBusyPrinter(null)
      setProgress(null)
    },
  })

  const needle = query.trim().toLowerCase()
  const sections = useMemo(() => {
    const list = (printers.data ?? []).filter(
      (p) =>
        needle === '' ||
        p.model.toLowerCase().includes(needle) ||
        p.vendorName.toLowerCase().includes(needle) ||
        p.vendor.toLowerCase().includes(needle),
    )
    const byVendor = new Map<string, AvailablePrinter[]>()
    for (const p of list) {
      const items = byVendor.get(p.vendorName) ?? []
      items.push(p)
      byVendor.set(p.vendorName, items)
    }
    return Array.from(byVendor.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([title, data]) => ({ title, data: data.sort((a, b) => a.model.localeCompare(b.model)) }))
  }, [printers.data, needle])

  return (
    <View className="flex-1 bg-neutral-50 dark:bg-neutral-950">
      <View className="border-b border-neutral-100 px-5 pb-3 pt-3 dark:border-neutral-800">
        <View className="flex-row items-center rounded-2xl bg-neutral-100 px-3 py-2 dark:bg-neutral-900">
          <Text className="mr-2 text-[15px] text-neutral-400">Search</Text>
          <TextInput
            className="flex-1 text-[15px] text-neutral-900 dark:text-neutral-100"
            placeholder="Printer or manufacturer…"
            placeholderTextColor="#9ca3af"
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
            autoCapitalize="none"
            clearButtonMode="while-editing"
          />
        </View>
        {printers.isError ? <Text className="pt-2 text-[13px] text-red-500">{String(printers.error)}</Text> : null}
      </View>
      {printers.isPending ? (
        <View className="flex-1 items-center justify-center gap-2">
          <ActivityIndicator />
          <Text className="text-[13px] text-neutral-500">Loading printer catalog…</Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => `${item.vendor}::${item.model}`}
          stickySectionHeadersEnabled
          contentContainerClassName="pb-10"
          renderSectionHeader={({ section }) => (
            <View className="bg-neutral-50 px-5 pb-1 pt-5 dark:bg-neutral-950">
              <Text className="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500 dark:text-neutral-400">
                {section.title}
              </Text>
            </View>
          )}
          renderItem={({ item, index, section }) => {
            const id = `${item.vendor}::${item.model}`
            const isBusy = busyPrinter === id
            const isInstalled = installed.data?.includes(item.vendor) === true
            const first = index === 0
            const last = index === section.data.length - 1
            return (
              <View className="px-5">
                <View
                  className={`flex-row items-center gap-3 bg-white px-4 py-3 dark:bg-neutral-900 ${first ? 'rounded-t-2xl' : ''} ${last ? 'rounded-b-2xl' : ''}`}
                >
                  <PrinterCover vendor={item.vendor} model={item.model} />
                  <View className="flex-1">
                    <Text className="text-[15px] font-semibold tracking-tight text-neutral-900 dark:text-neutral-100" numberOfLines={1}>
                      {item.model}
                    </Text>
                    <Text className="mt-0.5 text-[13px] text-neutral-500 dark:text-neutral-400">
                      {isInstalled ? 'Installed · tap to select' : `${item.vendorName} · downloads on tap`}
                    </Text>
                  </View>
                  {isBusy ? (
                    <View className="items-end">
                      <ActivityIndicator />
                      {progress !== null && progress.total > 0 ? (
                        <Text className="mt-1 text-[11px] tabular-nums text-neutral-500">
                          {progress.done} / {progress.total}
                        </Text>
                      ) : null}
                    </View>
                  ) : (
                    <Button
                      title={isInstalled ? 'Select' : 'Install'}
                      variant={isInstalled ? 'secondary' : 'primary'}
                      onPress={() => install.mutate(item)}
                      disabled={busyPrinter !== null}
                    />
                  )}
                </View>
                {!last ? <View className="ml-16 h-px bg-neutral-100 dark:bg-neutral-800" /> : null}
              </View>
            )
          }}
          ListEmptyComponent={
            <View className="items-center px-5 py-16">
              <Text className="text-[15px] text-neutral-500">Nothing matches your search.</Text>
            </View>
          }
        />
      )}
    </View>
  )
}

function PrinterCover({ vendor, model }: { vendor: string; model: string }): React.JSX.Element {
  const [ok, setOk] = useState(true)
  const url = `https://raw.githubusercontent.com/${DEFAULT_PROFILE_SOURCE.owner}/${DEFAULT_PROFILE_SOURCE.repo}/${DEFAULT_PROFILE_SOURCE.ref}/${encodeURI(`resources/profiles/${vendor}/${model}_cover.png`)}`
  if (!ok) return <Avatar text={model} size={44} />
  return (
    <Image
      source={{ uri: url }}
      className="h-11 w-11 rounded-xl bg-neutral-100 dark:bg-neutral-800"
      resizeMode="contain"
      onError={() => setOk(false)}
    />
  )
}
