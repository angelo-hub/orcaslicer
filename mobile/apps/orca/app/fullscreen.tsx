import * as ScreenOrientation from 'expo-screen-orientation'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import React, { useEffect } from 'react'
import { Pressable, Text, View } from 'react-native'
import { OrcaViewport, type ViewportMode } from 'react-native-orca-core'

import { useSession } from '@/lib/core'

// Full-screen viewport route. Renders through the router (not a Modal portal),
// so react-navigation's context stays intact and any React state upstream
// re-renders cleanly. The device is locked to landscape while the route is
// mounted and released on unmount. Gestures (orbit / two-finger pan / pinch /
// double-tap-to-fit) live on the native metal view and do not need any
// bridging.
export default function FullscreenScreen(): React.JSX.Element {
  const router = useRouter()
  const session = useSession()
  const params = useLocalSearchParams<{ mode?: string; layer?: string }>()
  const mode: ViewportMode = params.mode === 'preview' ? 'preview' : 'scene'
  const layer = params.layer !== undefined ? Number.parseInt(params.layer, 10) : -1
  const maxLayer = Number.isFinite(layer) ? layer : -1

  useEffect(() => {
    void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {})
    return () => {
      void ScreenOrientation.unlockAsync().catch(() => {})
    }
  }, [])

  if (session === null) {
    return (
      <View className="flex-1 items-center justify-center bg-black">
        <Stack.Screen options={{ headerShown: false }} />
        <Text className="text-[15px] text-white/70">Loading…</Text>
      </View>
    )
  }

  return (
    <View className="flex-1 bg-black">
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar style="light" hidden />
      <OrcaViewport
        style={{ flex: 1 }}
        sessionId={session.id}
        mode={mode}
        maxLayer={maxLayer}
        showTravels={false}
        revision={0}
      />
      <Pressable
        onPress={() => router.back()}
        hitSlop={12}
        className="absolute right-6 top-6 rounded-full bg-white/15 px-4 py-2 active:bg-white/25"
      >
        <Text className="text-[13px] font-semibold uppercase tracking-wider text-white">Done</Text>
      </Pressable>
      <View className="absolute inset-x-0 bottom-6 items-center">
        <Text className="rounded-full bg-white/10 px-3 py-1 text-[12px] font-medium uppercase tracking-wider text-white/80">
          {mode === 'preview' ? 'Preview' : 'Objects'}
        </Text>
      </View>
    </View>
  )
}
