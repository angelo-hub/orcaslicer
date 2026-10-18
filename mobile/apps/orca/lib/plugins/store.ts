import { create } from 'zustand'

import { storedCloudUserId } from '../cloud/auth'
import { storage } from '../storage'
import { pluginApi } from './api'
import { installFromCloud, readInstalled, removeInstalled } from './install'
import { isNewer } from './semver'
import type { CatalogResult, CloudPlugin, InstalledPlugin } from './types'

// What the Plugins screens show: the cloud catalog (subscriptions plus the
// user's own uploads) and what is installed on this device, joined by uuid.

export type PluginStatus = 'idle' | 'loading' | 'error'

export interface PluginEntry {
  plugin: CloudPlugin
  installed: InstalledPlugin | null
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
  /** Uuids with an install, update or removal in flight. */
  busy: string[]
  refresh: () => Promise<void>
  rescan: () => void
  subscribe: (plugin: CloudPlugin) => Promise<void>
  unsubscribe: (uuid: string) => Promise<void>
  install: (plugin: CloudPlugin) => Promise<void>
  remove: (uuid: string) => Promise<void>
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

    rescan: () => {
      const uid = storedCloudUserId()
      set({ installed: uid === null ? [] : readInstalled(uid) })
    },

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
        await installFromCloud(uid, plugin)
        get().rescan()
      }),

    remove: (uuid) =>
      withBusy(uuid, async () => {
        const uid = storedCloudUserId()
        if (uid !== null) removeInstalled(uid, uuid)
        get().rescan()
      }),
  }
})

export function pluginEntries(
  state: Pick<PluginState, 'catalog' | 'installed' | 'unauthorized'>,
): PluginEntry[] {
  const installedById = new Map(state.installed.map((i) => [i.state.cloud_uuid ?? i.key, i]))
  return state.catalog.map((plugin) => {
    const installed = installedById.get(plugin.uuid) ?? null
    return {
      plugin,
      installed,
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
