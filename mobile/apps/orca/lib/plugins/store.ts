import { create } from 'zustand'

import { storedCloudUserId } from '../cloud/auth'
import { storage } from '../storage'
import { pluginApi } from './api'
import { installFromCloud, readInstalled, removeInstalled } from './install'
import { loadPlugin, rediscover, setCapabilityEnabled, unloadPlugin } from './native'
import { isNewer } from './semver'
import type { CatalogResult, CloudPlugin, InstalledPlugin, NativePlugin } from './types'

// What the Plugins screens show: the cloud catalog (subscriptions plus the user's own
// uploads), what is installed on this device, and what the core's runtime makes of it,
// joined by uuid.

export type PluginStatus = 'idle' | 'loading' | 'error'

export interface PluginEntry {
  plugin: CloudPlugin
  installed: InstalledPlugin | null
  /** The runtime's view, when the core has one and found the install. */
  native: NativePlugin | null
  /** Subscribed, but the account may no longer download it. */
  unauthorized: boolean
  updateAvailable: boolean
}

interface PluginState {
  catalog: CloudPlugin[]
  installed: InstalledPlugin[]
  unauthorized: string[]
  status: PluginStatus
  lastError: string
  lastRefreshAt: number
  /** Uuids with an install, update, removal, load or unload in flight. */
  busy: string[]
  /** The runtime's plugin list; empty when the core has no runtime. */
  runtime: NativePlugin[]
  refresh: () => Promise<void>
  rescan: () => void
  setRuntime: (plugins: NativePlugin[]) => void
  subscribe: (plugin: CloudPlugin) => Promise<void>
  unsubscribe: (uuid: string) => Promise<void>
  install: (plugin: CloudPlugin) => Promise<void>
  remove: (uuid: string) => Promise<void>
  load: (uuid: string) => Promise<void>
  unload: (uuid: string) => Promise<void>
  setCapability: (uuid: string, capability: string, enabled: boolean) => Promise<void>
}

const LAST_REFRESH_KEY = 'plugins:v1:lastRefresh'

function merge(subscriptions: CatalogResult, mine: CloudPlugin[]): CloudPlugin[] {
  const byId = new Map<string, CloudPlugin>()
  for (const p of subscriptions.plugins) byId.set(p.uuid, p)
  for (const p of mine) byId.set(p.uuid, { ...(byId.get(p.uuid) ?? p), ...p, isMine: true })
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

// The runtime reports an error as a string, empty for success; the store throws it so the
// screens' catch handlers show it. It names a plugin by its directory, the cloud uuid here.
function fail(error: string): void {
  if (error !== '') throw new Error(error)
}

export const usePluginStore = create<PluginState>((set, get) => {
  const withBusy = async (uuid: string, work: () => Promise<void>) => {
    set((s) => ({ busy: [...s.busy, uuid], lastError: '' }))
    try {
      await work()
    } catch (e) {
      set({ lastError: message(e) })
      throw e
    } finally {
      set((s) => ({ busy: s.busy.filter((b) => b !== uuid) }))
    }
  }
  return {
    catalog: [],
    installed: [],
    unauthorized: [],
    status: 'idle',
    lastError: '',
    lastRefreshAt: storage.getNumber(LAST_REFRESH_KEY) ?? 0,
    busy: [],
    runtime: [],

    rescan: () => {
      const uid = storedCloudUserId()
      set({ installed: uid === null ? [] : readInstalled(uid) })
    },

    setRuntime: (runtime) => set({ runtime }),

    refresh: async () => {
      get().rescan()
      set({ status: 'loading', lastError: '' })
      try {
        const [subscriptions, mine] = await Promise.all([
          pluginApi.subscriptions(),
          pluginApi.mine(),
        ])
        const now = Date.now()
        storage.set(LAST_REFRESH_KEY, now)
        set({
          catalog: merge(subscriptions, mine),
          unauthorized: subscriptions.unauthorized,
          status: 'idle',
          lastRefreshAt: now,
        })
      } catch (e) {
        set({ status: 'error', lastError: message(e) })
      }
    },

    subscribe: (plugin) =>
      withBusy(plugin.uuid, async () => {
        await pluginApi.subscribe(plugin.uuid)
        set((s) => ({
          catalog: merge({ plugins: s.catalog, notFound: [], unauthorized: [] }, [plugin]),
        }))
      }),

    unsubscribe: (uuid) =>
      withBusy(uuid, async () => {
        await pluginApi.unsubscribe([uuid])
        set((s) => ({ catalog: s.catalog.filter((p) => p.uuid !== uuid || p.isMine) }))
      }),

    install: (plugin) =>
      withBusy(plugin.uuid, async () => {
        const uid = storedCloudUserId()
        if (uid === null) throw new Error('Sign in to install plugins.')
        // A loaded copy keeps its module alive; drop it before the files change.
        if (get().runtime.some((p) => p.key === plugin.uuid && p.loaded))
          await unloadPlugin(plugin.uuid)
        await installFromCloud(uid, plugin)
        get().rescan()
        await rediscover()
      }),

    remove: (uuid) =>
      withBusy(uuid, async () => {
        if (get().runtime.some((p) => p.key === uuid && p.loaded)) await unloadPlugin(uuid)
        const user = storedCloudUserId()
        if (user !== null) removeInstalled(user, uuid)
        get().rescan()
        await rediscover()
      }),

    load: (uuid) => withBusy(uuid, async () => fail(await loadPlugin(uuid))),

    unload: (uuid) =>
      withBusy(uuid, async () => {
        if (!(await unloadPlugin(uuid))) throw new Error('The plugin could not be unloaded.')
      }),

    setCapability: (uuid, capability, enabled) =>
      withBusy(uuid, async () => fail(await setCapabilityEnabled(uuid, capability, enabled))),
  }
})

export function pluginEntries(
  state: Pick<PluginState, 'catalog' | 'installed' | 'unauthorized' | 'runtime'>,
): PluginEntry[] {
  const installedById = new Map(state.installed.map((i) => [i.state.cloud_uuid ?? i.key, i]))
  const nativeById = new Map(state.runtime.map((p) => [p.cloudUuid || p.key, p]))
  return state.catalog.map((plugin) => {
    const installed = installedById.get(plugin.uuid) ?? null
    return {
      plugin,
      installed,
      native: nativeById.get(plugin.uuid) ?? null,
      unauthorized: state.unauthorized.includes(plugin.uuid),
      updateAvailable:
        installed !== null &&
        plugin.version !== '' &&
        isNewer(plugin.version, installed.state.installed_version),
    }
  })
}

/** Installed plugins the catalog no longer lists (unsubscribed elsewhere). */
export function orphanedInstalls(
  state: Pick<PluginState, 'catalog' | 'installed'>,
): InstalledPlugin[] {
  const known = new Set(state.catalog.map((p) => p.uuid))
  return state.installed.filter((i) => !known.has(i.state.cloud_uuid ?? i.key))
}
