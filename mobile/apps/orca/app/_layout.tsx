import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import React from 'react'

import { CoreProvider } from '@/lib/core'

export default function RootLayout(): React.JSX.Element {
  return (
    <CoreProvider>
      <StatusBar style="auto" />
      <Stack>
        <Stack.Screen name="index" options={{ title: 'OrcaSlicer' }} />
        <Stack.Screen name="presets/[kind]" options={{ title: 'Presets' }} />
        <Stack.Screen name="vendors" options={{ title: 'Printer profiles' }} />
      </Stack>
    </CoreProvider>
  )
}
