import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import React from 'react'
import { useColorScheme } from 'nativewind'

import '../global.css'

import { CoreProvider } from '@/lib/core'

// The Stack is styled once at the root so every screen inherits the
// grouped-background look and a large iOS-style title on the home screen.
// NativeWind's className handles dark mode automatically via useColorScheme.
export default function RootLayout(): React.JSX.Element {
  const { colorScheme } = useColorScheme()
  const dark = colorScheme === 'dark'
  return (
    <CoreProvider>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: dark ? '#1c1c1e' : '#ffffff' },
          headerTintColor: '#0a84ff',
          headerTitleStyle: { color: dark ? '#ffffff' : '#000000' },
          contentStyle: { backgroundColor: dark ? '#000000' : '#f2f2f7' },
        }}
      >
        <Stack.Screen
          name="index"
          options={{ title: 'OrcaSlicer', headerLargeTitle: true }}
        />
        <Stack.Screen name="presets/[kind]" options={{ title: 'Choose preset' }} />
        <Stack.Screen name="settings/[kind]" options={{ title: 'Edit preset' }} />
        <Stack.Screen name="vendors" options={{ title: 'Printer profiles' }} />
        <Stack.Screen name="printers" options={{ title: 'Printers' }} />
      </Stack>
    </CoreProvider>
  )
}
