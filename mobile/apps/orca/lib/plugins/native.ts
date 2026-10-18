import { Paths } from 'expo-file-system'
import { Alert } from 'react-native'
import type { OrcaCore, PluginEvent } from 'react-native-orca-core'

import { nativePath } from '../profiles'
import { showToast } from '../toast'
import {
  parseNativePlugins,
  parseRefStates,
  parseScriptResult,
  type RefState,
  type RefStatus,
  type ScriptResult,
} from './parse'
import { presetPluginRefs } from './refs'
import type { CapabilityRef, NativePlugin } from './types'

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

type PageListener = (messageJson: string) => void
const pageListeners = new Map<string, Set<PageListener>>()

/** Messages a plugin posts to one of its pages, while a screen shows that page. */
export function subscribePageMessages(
  key: string,
  capability: string,
  fn: PageListener,
): () => void {
  const id = `${key}\n${capability}`
  const set = pageListeners.get(id) ?? new Set<PageListener>()
  set.add(fn)
  pageListeners.set(id, set)
  return () => {
    set.delete(fn)
    if (set.size === 0) pageListeners.delete(id)
  }
}

/** What the runtime makes of a preset's plugin references; empty without a runtime. */
export function checkRefs(refs: CapabilityRef[]): RefStatus[] {
  if (core === null || !initialized || refs.length === 0) return []
  return parseRefStates(core.pluginCheckRefs(JSON.stringify(refs)))
}

const REF_PROBLEM: Record<RefState, string | null> = {
  loaded: null,
  disabled: 'is switched off',
  installed: 'is not loaded',
  missing: 'is not installed on this device',
  error: 'failed to load',
}

/**
 * Before a slice: true when every plugin the presets ask for is ready, or the user chose
 * to slice without the ones that are not. The hooks skip unresolved references, so the
 * slice itself never fails over them; it just runs without that plugin.
 */
export function confirmPluginRefs(session: { option(key: string): string }): Promise<boolean> {
  if (core === null || !initialized) return Promise.resolve(true)
  const refs = presetPluginRefs(session)
  const problems = checkRefs(refs)
    .map((status) => {
      const problem = REF_PROBLEM[status.state]
      const ref = refs.find((r) => r.uuid === status.uuid && r.capability === status.capability)
      return problem === null ? null : `${ref?.name || status.capability} ${problem}`
    })
    .filter((line): line is string => line !== null)
  if (problems.length === 0) return Promise.resolve(true)
  return new Promise((resolve) => {
    Alert.alert(
      'Plugins not ready',
      `${problems.join('\n')}\n\nThe preset will slice without ${problems.length === 1 ? 'it' : 'them'}.`,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Slice anyway', onPress: () => resolve(true) },
      ],
      { cancelable: false },
    )
  })
}

export async function runScript(key: string, capability: string): Promise<ScriptResult> {
  if (core === null || !initialized)
    return {
      status: 'fatal_error',
      message: '',
      data: '',
      error: 'The plugin runtime is not running.',
    }
  return parseScriptResult(await core.pluginRunScript(key, capability))
}

type AgentListener = (devId: string, message: string) => void
const agentListeners = new Map<string, Set<AgentListener>>()

/** What a printer-connection plugin reports through its message callback. */
export function subscribeAgentMessages(
  key: string,
  capability: string,
  fn: AgentListener,
): () => void {
  const id = `${key}\n${capability}`
  const set = agentListeners.get(id) ?? new Set<AgentListener>()
  set.add(fn)
  agentListeners.set(id, set)
  return () => {
    set.delete(fn)
    if (set.size === 0) agentListeners.delete(id)
  }
}

export interface LoadedAgent {
  key: string
  capability: string
  pluginName: string
}

/** The printer-connection capabilities loaded right now. */
export function loadedPrinterAgents(): LoadedAgent[] {
  return nativePlugins().flatMap((p) =>
    p.loaded
      ? p.capabilities
          .filter((c) => c.type === 'printer-connection' && c.enabled)
          .map((c) => ({ key: p.key, capability: c.name, pluginName: p.name }))
      : [],
  )
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
    case 'page-message': {
      const set = pageListeners.get(`${event.pluginKey}\n${event.capability}`)
      if (set !== undefined) for (const fn of set) fn(event.payloadJson)
      return
    }
    case 'agent-message': {
      const set = agentListeners.get(`${event.pluginKey}\n${event.capability}`)
      if (set === undefined) return
      const devId = String(data.dev_id ?? '')
      const message = String(data.message ?? '')
      for (const fn of set) fn(devId, message)
      return
    }
    case 'agent-print': {
      const message = String(data.message ?? '')
      if (message !== '') showToast(message)
      return
    }
    default:
      return
  }
}
