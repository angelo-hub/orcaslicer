import Constants from 'expo-constants'
import { create } from 'zustand'

import { storage } from './storage'

// Feature flags. Each one is off unless the build turns it on (`extra` in
// app.config.ts, from an EXPO_PUBLIC_* variable) or the developer section on
// the About screen overrides it on this device. The override wins so a release
// build can still be tested without rebuilding.

const PLUGINS_OVERRIDE_KEY = 'prefs:v1:pluginsEnabled'

const extra = (Constants.expoConfig?.extra ?? {}) as { plugins?: boolean }

function readPluginsEnabled(): boolean {
  return storage.getBoolean(PLUGINS_OVERRIDE_KEY) ?? extra.plugins ?? false
}

interface FlagState {
  /** Orca Cloud plugins: the catalog screen and, when the core has it, the runtime. */
  plugins: boolean
  setPlugins: (enabled: boolean | null) => void
}

const useFlagStore = create<FlagState>((set) => ({
  plugins: readPluginsEnabled(),
  setPlugins: (enabled) => {
    if (enabled === null) storage.remove(PLUGINS_OVERRIDE_KEY)
    else storage.set(PLUGINS_OVERRIDE_KEY, enabled)
    set({ plugins: readPluginsEnabled() })
  },
}))

export function pluginsEnabled(): boolean {
  return useFlagStore.getState().plugins
}

export function usePluginsEnabled(): boolean {
  return useFlagStore((s) => s.plugins)
}

export function setPluginsOverride(enabled: boolean | null): void {
  useFlagStore.getState().setPlugins(enabled)
}
