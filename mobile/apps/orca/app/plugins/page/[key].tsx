import { Stack, useLocalSearchParams } from 'expo-router'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Text, View } from 'react-native'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'
import { getOrcaCore } from 'react-native-orca-core'

import { PAGE_BRIDGE, dispatchScript, pageMessageData } from '@/lib/plugins/pageBridge'
import { subscribePageMessages } from '@/lib/plugins/native'
import { nativePath, resourcesDirectory } from '@/lib/profiles'

// A plugin's page: the HTML a pages capability returns, in a web view with the same
// window.orca bridge the desktop's plugin tabs inject. Messages from the page go to the
// plugin's on_message; the plugin's post_message comes back as a page-message event
// while this screen is open.

export default function PluginPageScreen(): React.JSX.Element {
  const { key, cap, title } = useLocalSearchParams<{ key: string; cap: string; title?: string }>()
  const core = getOrcaCore()
  const web = useRef<React.ComponentRef<typeof WebView>>(null)
  const [html, setHtml] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (key === undefined || cap === undefined) return
    let open = true
    const load = async () => {
      try {
        const page = await core.pluginPageHtml(key, cap)
        const openError = await core.pluginPageOpen(key, cap)
        if (openError !== '') throw new Error(openError)
        if (open) setHtml(page)
      } catch (e) {
        if (open) setError(e instanceof Error ? e.message : String(e))
      }
    }
    void load()
    const unsubscribe = subscribePageMessages(key, cap, (messageJson) => {
      web.current?.injectJavaScript(dispatchScript(messageJson))
    })
    return () => {
      open = false
      unsubscribe()
      core.pluginPageClose(key, cap)
    }
  }, [core, key, cap])

  const onMessage = useCallback(
    async (ev: WebViewMessageEvent) => {
      if (key === undefined || cap === undefined) return
      const data = pageMessageData(ev.nativeEvent.data)
      if (data === undefined) return
      const sendError = await core.pluginPageSend(key, cap, data)
      if (sendError !== '') setError(sendError)
    },
    [core, key, cap],
  )

  return (
    <View className="flex-1 bg-white dark:bg-neutral-950">
      <Stack.Screen options={{ title: title ?? cap ?? 'Plugin' }} />
      {error !== '' ? (
        <View className="border-b border-red-200 bg-red-50 px-4 py-2 dark:border-red-900 dark:bg-red-950">
          <Text className="text-footnote text-red-700 dark:text-red-300" selectable>
            {error}
          </Text>
        </View>
      ) : null}
      {html === null ? (
        <View className="flex-1 items-center justify-center">
          {error === '' ? <ActivityIndicator /> : null}
        </View>
      ) : (
        <WebView
          ref={web}
          originWhitelist={['*']}
          // The desktop serves pages from resources/web so relative assets resolve there.
          source={{ html, baseUrl: `file://${nativePath(resourcesDirectory())}/web/` }}
          injectedJavaScriptBeforeContentLoaded={PAGE_BRIDGE}
          onMessage={(ev) => void onMessage(ev)}
          allowFileAccess
          allowFileAccessFromFileURLs
          allowsInlineMediaPlayback
          style={{ flex: 1 }}
        />
      )}
    </View>
  )
}
