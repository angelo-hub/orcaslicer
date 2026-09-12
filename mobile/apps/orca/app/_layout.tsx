import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import React from 'react'

import { CoreProvider } from '@/lib/core'
import { useTheme } from '@/lib/theme'

// The Stack styling is set once at the root so every screen inherits the
// grouped-background look and a large iOS-style title on the home screen.
export default function RootLayout(): React.JSX.Element {
  const { colors, scheme } = useTheme()
  return (
    <CoreProvider>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.accent,
          headerTitleStyle: { color: colors.text },
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen
          name="index"
          options={{ title: 'OrcaSlicer', headerLargeTitle: true, headerTransparent: false }}
        />
        <Stack.Screen name="presets/[kind]" options={{ title: 'Choose preset' }} />
        <Stack.Screen name="settings/[kind]" options={{ title: 'Edit preset' }} />
        <Stack.Screen name="vendors" options={{ title: 'Printer profiles' }} />
        <Stack.Screen name="printers" options={{ title: 'Printers' }} />
      </Stack>
    </CoreProvider>
  )
}
