import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import React from 'react'
import { Alert, Linking, ScrollView, Switch, Text, View } from 'react-native'
import { getOrcaCore } from 'react-native-orca-core'

import { pluginWebUrl } from '@/lib/plugins/api'
import { runtimeError } from '@/lib/plugins/native'
import { pluginEntries, usePluginStore } from '@/lib/plugins/store'
import { Button } from '@/ui/Button'
import { Card } from '@/ui/Card'

// One cloud plugin: what it is, whether it is on this device, whether the core's
// runtime has it loaded, and the actions the desktop's Plugins dialog offers for it.

function when(seconds: number): string {
  return seconds > 0 ? new Date(seconds * 1000).toLocaleDateString() : ''
}

const fail = (title: string) => (e: unknown) =>
  Alert.alert(title, e instanceof Error ? e.message : String(e))

export default function PluginScreen(): React.JSX.Element {
  const { uuid } = useLocalSearchParams<{ uuid: string }>()
  const router = useRouter()
  const store = usePluginStore()
  const entry = pluginEntries(store).find((e) => e.plugin.uuid === uuid)
  const runtime = getOrcaCore().pluginsSupported

  if (entry === undefined) {
    return (
      <View className="flex-1 bg-neutral-50 dark:bg-neutral-950 p-5">
        <Card title="Plugin not found">
          <Text className="text-subhead text-neutral-600 dark:text-neutral-300">
            It is no longer in your subscriptions. Pull to refresh the list.
          </Text>
        </Card>
      </View>
    )
  }

  const { plugin, installed, native, unauthorized, updateAvailable } = entry
  const busy = store.busy.includes(plugin.uuid)

  const removeInstall = () =>
    Alert.alert('Remove from this device?', 'The plugin stays in your subscriptions.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => void store.remove(plugin.uuid).catch(fail('Could not remove')),
      },
    ])

  const unsubscribe = () =>
    Alert.alert(
      'Unsubscribe?',
      'Removes the plugin from your Orca Cloud subscriptions and from this device.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unsubscribe',
          style: 'destructive',
          onPress: () =>
            void store
              .remove(plugin.uuid)
              .then(() => store.unsubscribe(plugin.uuid))
              .then(() => router.back())
              .catch(fail('Could not unsubscribe')),
        },
      ],
    )

  const installedLine =
    installed === null
      ? 'Not on this device'
      : updateAvailable
        ? `v${installed.state.installed_version} on this device · v${plugin.version} available`
        : `v${installed.state.installed_version} on this device`

  const runtimeLine = !runtime
    ? 'This build of the app cannot run plugins.'
    : runtimeError() !== ''
      ? `The plugin runtime did not start: ${runtimeError()}`
      : native === null
        ? 'Not seen by the runtime yet.'
        : native.loading
          ? 'Loading…'
          : native.loaded
            ? 'Loaded'
            : native.error !== ''
              ? 'Not loaded'
              : 'Not loaded'

  return (
    <ScrollView
      className="flex-1 bg-neutral-50 dark:bg-neutral-950"
      contentContainerClassName="gap-4 p-5 pb-10"
    >
      <Stack.Screen options={{ title: plugin.name }} />

      <Card title={plugin.name} subtitle={plugin.author === '' ? undefined : `by ${plugin.author}`}>
        {plugin.typeLabels.length > 0 ? (
          <Text className="text-subhead text-neutral-600 dark:text-neutral-300">
            {plugin.typeLabels.join(' · ')}
          </Text>
        ) : null}
        {native !== null && native.description !== '' ? (
          <Text className="text-subhead leading-5 text-neutral-600 dark:text-neutral-300">
            {native.description}
          </Text>
        ) : null}
        <Text className="text-subhead text-neutral-500 dark:text-neutral-400">{installedLine}</Text>
        {unauthorized ? (
          <Text className="text-subhead text-red-600 dark:text-red-400">
            Your account can no longer download this plugin.
          </Text>
        ) : null}
        <View className="mt-3 gap-2">
          {installed === null || updateAvailable ? (
            <Button
              title={installed === null ? 'Install on this device' : `Update to v${plugin.version}`}
              fullWidth
              loading={busy}
              disabled={unauthorized}
              onPress={() => void store.install(plugin).catch(fail('Could not install'))}
            />
          ) : null}
          {installed !== null ? (
            <Button
              title="Remove from this device"
              variant="secondary"
              fullWidth
              disabled={busy}
              onPress={removeInstall}
            />
          ) : null}
          <Button
            title="Open on Orca Cloud"
            variant="secondary"
            fullWidth
            onPress={() => void Linking.openURL(pluginWebUrl(plugin))}
          />
          {!plugin.isMine ? (
            <Button
              title="Unsubscribe"
              variant="ghost"
              fullWidth
              disabled={busy}
              onPress={unsubscribe}
            />
          ) : null}
        </View>
      </Card>

      {installed !== null ? (
        <Card title="On this device" subtitle={runtimeLine} index={1}>
          {native !== null && native.error !== '' ? (
            <Text className="text-footnote leading-4 text-red-600 dark:text-red-400" selectable>
              {native.error}
            </Text>
          ) : null}
          {native !== null && native.dependencies.length > 0 ? (
            <Text className="text-footnote text-neutral-500 dark:text-neutral-400">
              Declares Python packages: {native.dependencies.join(', ')}. Packages cannot be
              installed on this device, so the plugin only runs if it works without them.
            </Text>
          ) : null}
          {native !== null && native.loaded ? (
            <View className="gap-2">
              {native.capabilities.map((cap) => (
                <View key={cap.name} className="flex-row items-center justify-between">
                  <View className="flex-1 pr-3">
                    <Text className="text-subhead text-neutral-900 dark:text-neutral-100">
                      {cap.name}
                    </Text>
                    <Text className="text-footnote text-neutral-500 dark:text-neutral-400">
                      {cap.type}
                    </Text>
                  </View>
                  <Switch
                    value={cap.enabled}
                    disabled={busy}
                    onValueChange={(v) =>
                      void store
                        .setCapability(plugin.uuid, cap.name, v)
                        .catch(fail('Could not change the capability'))
                    }
                  />
                </View>
              ))}
            </View>
          ) : null}
          {runtime && native !== null ? (
            <View className="mt-3 gap-2">
              {native.loaded ? (
                <Button
                  title="Unload"
                  variant="secondary"
                  fullWidth
                  loading={busy}
                  onPress={() => void store.unload(plugin.uuid).catch(fail('Could not unload'))}
                />
              ) : (
                <Button
                  title="Load"
                  fullWidth
                  loading={busy || native.loading}
                  onPress={() => void store.load(plugin.uuid).catch(fail('Could not load'))}
                />
              )}
            </View>
          ) : null}
        </Card>
      ) : null}

      {plugin.changelog.length > 0 ? (
        <Card title="Changelog" padded={false} index={2}>
          {plugin.changelog.map((c, i) => (
            <View
              key={c.id}
              className={`px-4 py-3 ${i === plugin.changelog.length - 1 ? '' : 'border-b border-neutral-100 dark:border-neutral-800'}`}
            >
              <Text className="text-subhead font-medium text-neutral-900 dark:text-neutral-100">
                v{c.version}
                {when(c.createdTime) === '' ? (
                  ''
                ) : (
                  <Text className="font-normal text-neutral-400 dark:text-neutral-500">
                    {' '}
                    · {when(c.createdTime)}
                  </Text>
                )}
              </Text>
              {c.text !== '' ? (
                <Text className="mt-1 text-footnote leading-4 text-neutral-600 dark:text-neutral-300">
                  {c.text}
                </Text>
              ) : null}
            </View>
          ))}
        </Card>
      ) : null}
    </ScrollView>
  )
}
