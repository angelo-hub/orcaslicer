import { useRouter } from 'expo-router'
import React, { useEffect } from 'react'
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'

import { useCloudStore } from '@/lib/cloud/store'
import {
  orphanedInstalls,
  pluginEntries,
  usePluginStore,
  type PluginEntry,
} from '@/lib/plugins/store'
import { relativeTime } from '@/lib/time'
import { Button } from '@/ui/Button'
import { Card } from '@/ui/Card'
import { EmptyState } from '@/ui/EmptyState'
import { Icon } from '@/ui/Icon'

// The Orca Cloud plugins this account subscribes to or published, and which of
// them are installed on this device. Installing only downloads the package: the
// runtime is a separate, optional part of the core.

function entryLine(entry: PluginEntry): string {
  const parts: string[] = []
  if (entry.plugin.version !== '') parts.push(`v${entry.plugin.version}`)
  if (entry.plugin.author !== '') parts.push(entry.plugin.author)
  if (entry.plugin.typeLabels.length > 0) parts.push(entry.plugin.typeLabels.join(', '))
  return parts.join(' · ')
}

function badge(entry: PluginEntry): { text: string; tone: string } | null {
  if (entry.unauthorized) return { text: 'Unavailable', tone: 'text-red-600 dark:text-red-400' }
  if (entry.native?.loaded) return { text: 'Loaded', tone: 'text-green-700 dark:text-green-400' }
  if (entry.native !== null && entry.native.error !== '')
    return { text: 'Failed', tone: 'text-red-600 dark:text-red-400' }
  if (entry.updateAvailable) return { text: 'Update', tone: 'text-amber-600 dark:text-amber-400' }
  if (entry.installed !== null)
    return { text: 'Installed', tone: 'text-green-700 dark:text-green-400' }
  return null
}

function PluginRow({
  entry,
  last,
  onPress,
}: {
  entry: PluginEntry
  last: boolean
  onPress: () => void
}) {
  const b = badge(entry)
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className={`flex-row items-center gap-3 px-4 py-3 active:bg-neutral-100 dark:active:bg-neutral-800 ${last ? '' : 'border-b border-neutral-100 dark:border-neutral-800'}`}
    >
      <View className="flex-1">
        <Text className="text-subhead font-medium text-neutral-900 dark:text-neutral-100">
          {entry.plugin.name}
          {entry.plugin.isMine ? (
            <Text className="text-neutral-400 dark:text-neutral-500"> · yours</Text>
          ) : null}
        </Text>
        <Text
          className="mt-0.5 text-footnote text-neutral-500 dark:text-neutral-400"
          numberOfLines={1}
        >
          {entryLine(entry)}
        </Text>
      </View>
      {b !== null ? <Text className={`text-footnote font-medium ${b.tone}`}>{b.text}</Text> : null}
      <Icon name="chevron" size={16} />
    </Pressable>
  )
}

export default function PluginsScreen(): React.JSX.Element {
  const router = useRouter()
  const user = useCloudStore((s) => s.user)
  const store = usePluginStore()
  const entries = pluginEntries(store)
  const orphans = orphanedInstalls(store)

  useEffect(() => {
    if (user !== null) void store.refresh()
    else store.rescan()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  if (user === null) {
    return (
      <View className="flex-1 bg-neutral-50 dark:bg-neutral-950 p-5">
        <Card>
          <EmptyState
            icon="cloud"
            title="Sign in to use cloud plugins"
            body="Plugins you subscribe to on Orca Cloud appear here, ready to install on this device."
            action={{ title: 'Orca Cloud account', onPress: () => router.push('/account') }}
          />
        </Card>
      </View>
    )
  }

  const subtitle =
    store.status === 'loading'
      ? 'Refreshing…'
      : store.status === 'error'
        ? `Could not refresh: ${store.lastError}`
        : store.lastRefreshAt > 0
          ? `Refreshed ${relativeTime(store.lastRefreshAt)}`
          : undefined

  return (
    <ScrollView
      className="flex-1 bg-neutral-50 dark:bg-neutral-950"
      contentContainerClassName="gap-5 p-5 pb-10"
      refreshControl={
        <RefreshControl
          refreshing={store.status === 'loading'}
          onRefresh={() => void store.refresh()}
        />
      }
    >
      <Card title="Your plugins" subtitle={subtitle} padded={false} index={0}>
        {entries.length === 0 ? (
          <EmptyState
            icon="cloud"
            title="No plugins yet"
            body="Subscribe to plugins on Orca Cloud and they show up here."
            action={{ title: 'Refresh', onPress: () => void store.refresh() }}
          />
        ) : (
          entries.map((entry, i) => (
            <PluginRow
              key={entry.plugin.uuid}
              entry={entry}
              last={i === entries.length - 1}
              onPress={() =>
                router.push({ pathname: '/plugins/[uuid]', params: { uuid: entry.plugin.uuid } })
              }
            />
          ))
        )}
      </Card>

      {orphans.length > 0 ? (
        <Card
          title="Installed, not subscribed"
          subtitle="On this device, but no longer in your cloud subscriptions"
          padded={false}
          index={1}
        >
          {orphans.map((plugin, i) => (
            <View
              key={plugin.key}
              className={`flex-row items-center gap-3 px-4 py-3 ${i === orphans.length - 1 ? '' : 'border-b border-neutral-100 dark:border-neutral-800'}`}
            >
              <View className="flex-1">
                <Text className="text-subhead font-medium text-neutral-900 dark:text-neutral-100">
                  {plugin.state.plugin_name || plugin.key}
                </Text>
                <Text className="mt-0.5 text-footnote text-neutral-500 dark:text-neutral-400">
                  v{plugin.state.installed_version}
                </Text>
              </View>
              <Button
                title="Remove"
                variant="ghost"
                loading={store.busy.includes(plugin.key)}
                onPress={() => void store.remove(plugin.key).catch(() => {})}
              />
            </View>
          ))}
        </Card>
      ) : null}

      <Text className="px-1 text-footnote text-neutral-400 dark:text-neutral-500">
        Installing downloads the plugin to this device in the same layout the desktop app uses.
        Running plugins needs a core built with the Python runtime, which this build does not
        include.
      </Text>
    </ScrollView>
  )
}
