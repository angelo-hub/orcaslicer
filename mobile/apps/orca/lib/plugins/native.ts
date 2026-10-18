import { Paths } from 'expo-file-system'
import { Alert } from 'react-native'
import type { OrcaCore, PluginEvent } from 'react-native-orca-core'

import { nativePath } from '../profiles'
import { showToast } from '../toast'
import { parseNativePlugins } from './parse'
import type { NativePlugin } from './types'

// The plugin runtime inside the core, when the installed core has one. The app starts it
// once (the Python standard library ships in the bundle under python/), keeps it told
// which cloud user's plugins to scan, and answers what plugins ask: a permission, a
// message box. Everything Python-bound is a Promise on the native side, so a plugin that
// waits for an answer never holds the JS thread.

type Listener = (plugins: NativePlugin[]) => void

let core: OrcaCore | null = null
let initialized = false
let initError = ''
let onChange: Listener | null = null

export function runtimeSupported(c: OrcaCore): boolean {
  return c.pluginsSupported
}

export function runtimeError(): string {
  return initError
}

/** Starts the runtime and scans for plugins. Safe to call again; later calls only rescan. */
export async function ensurePluginRuntime(
  c: OrcaCore,
  cloudUserId: string,
  listener: Listener,
): Promise<void> {
  core = c
  onChange = listener
  if (!c.pluginsSupported) return
  if (!initialized) {
    c.setPluginEventListener(handleEvent)
    initError = await c.pluginsInitialize(nativePath(Paths.bundle) + '/python', cloudUserId)
    if (initError !== '') return
    initialized = true
  } else {
    c.pluginsSetCloudUser(cloudUserId)
  }
  await rediscover()
}

export async function rediscover(): Promise<string> {
  if (core === null || !initialized) return ''
  const error = await core.pluginsDiscover()
  publish()
  return error
}

export function nativePlugins(): NativePlugin[] {
  if (core === null || !initialized) return []
  return parseNativePlugins(core.pluginList())
}

export async function loadPlugin(key: string): Promise<string> {
  if (core === null || !initialized) return 'The plugin runtime is not running.'
  const error = await core.pluginLoad(key)
  publish()
  return error
}

export async function unloadPlugin(key: string): Promise<boolean> {
  if (core === null || !initialized) return false
  const ok = await core.pluginUnload(key)
  publish()
  return ok
}

export async function setCapabilityEnabled(
  key: string,
  capability: string,
  enabled: boolean,
): Promise<string> {
  if (core === null || !initialized) return 'The plugin runtime is not running.'
  const error = await core.pluginSetCapabilityEnabled(key, capability, enabled)
  publish()
  return error
}

function publish(): void {
  onChange?.(nativePlugins())
}

function answer(event: PluginEvent, value: string): void {
  if (core !== null && event.requestId !== 0) core.pluginAnswer(event.requestId, value)
}

function payload(event: PluginEvent): Record<string, unknown> {
  try {
    const raw = JSON.parse(event.payloadJson) as unknown
    return typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

const CATEGORY_TEXT: Record<string, string> = {
  fs_read: 'read',
  fs_readwrite: 'read and write',
  fs_create: 'create',
  fs_delete: 'delete',
  network_http: 'make an HTTP request to',
  network_socket: 'open a network connection to',
}

// The buttons orca.host.ui.message offers and the ids the plugin receives, as on the desktop.
const BUTTONS: Record<string, string[]> = {
  ok: ['ok'],
  ok_cancel: ['cancel', 'ok'],
  yes_no: ['no', 'yes'],
  yes_no_cancel: ['cancel', 'no', 'yes'],
}

function handleEvent(event: PluginEvent): void {
  const data = payload(event)
  switch (event.kind) {
    case 'permission-request': {
      const name = String(data.plugin_name ?? event.pluginKey)
      const category = String(data.category ?? '')
      const targets = Array.isArray(data.targets) ? data.targets.map(String) : []
      const verb = CATEGORY_TEXT[category]
      const what =
        verb === undefined
          ? `Plugin "${name}" asks for permission for the Python event "${String(data.event ?? '')}".`
          : `Plugin "${name}" wants to ${verb}:\n\n${targets.join('\n')}`
      // Allowing is remembered in the plugin's .install_state.json, as on the desktop.
      Alert.alert('Plugin permission', what, [
        { text: 'Deny', style: 'cancel', onPress: () => answer(event, 'deny') },
        { text: 'Allow', onPress: () => answer(event, 'allow') },
      ])
      return
    }
    case 'ui-message': {
      const ids = BUTTONS[String(data.buttons ?? 'ok')] ?? BUTTONS.ok!
      Alert.alert(
        String(data.title ?? 'Plugin'),
        String(data.text ?? ''),
        ids.map((id) => ({
          text: id.charAt(0).toUpperCase() + id.slice(1),
          style: id === 'cancel' ? 'cancel' : 'default',
          onPress: () => answer(event, id),
        })),
        { cancelable: false },
      )
      return
    }
    case 'ui-progress': {
      const message = String(data.message ?? '')
      if (data.open === true && message !== '') showToast(message)
      return
    }
    case 'plugin-state':
      publish()
      return
    default:
      return
  }
}
