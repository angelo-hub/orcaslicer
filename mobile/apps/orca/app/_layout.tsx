import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import React from 'react'
import { useColorScheme } from 'nativewind'

import '../global.css'

import { CoreProvider } from '@/lib/core'
import { queryClient } from '@/lib/queries'
import { mmkvAsyncStorage } from '@/lib/storage'
import { DownloadsPill } from '@/ui/DownloadsPill'

// The Stack is styled once at the root so every screen inherits the
// grouped-background look and a large iOS-style title on the home screen.
// PersistQueryClientProvider owns the shared cache for GitHub profile
// lookups and per-printer status polls, backed by an MMKV-persisted store
// so vendor listings survive an app restart with no network hit.
const persister = createAsyncStoragePersister({ storage: mmkvAsyncStorage, key: 'orca-query-cache' })

export default function RootLayout(): React.JSX.Element {
  const { colorScheme } = useColorScheme()
  const dark = colorScheme === 'dark'
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: 24 * 60 * 60 * 1000,
        // Buster changes whenever the shape of a cached response changes so
        // stale data does not decode into new types.
        buster: 'v1',
      }}
    >
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
            options={{
              title: 'OrcaSlicer',
              headerLargeTitle: true,
              headerRight: () => <DownloadsPill />,
            }}
          />
          <Stack.Screen name="presets/[kind]" options={{ title: 'Choose preset' }} />
          <Stack.Screen name="settings/[kind]" options={{ title: 'Edit preset' }} />
          <Stack.Screen name="vendors" options={{ title: 'Choose printer' }} />
          <Stack.Screen name="printers" options={{ title: 'Printers' }} />
        </Stack>
      </CoreProvider>
    </PersistQueryClientProvider>
  )
}
