import type { InstallState, PackageKind, PermissionCategory } from './types'

// The `.install_state.json` sidecar next to a plugin's entry file. Written here
// with the same keys as PluginFsUtils.cpp's write_install_state so the desktop
// (and a future mobile runtime) reads it unchanged.

export const SIDECAR_FILE = '.install_state.json'
export const PLUGINS_DIR = 'orca_plugins'
export const SUBSCRIBED_DIR = '_subscribed'

export const PERMISSION_CATEGORIES: PermissionCategory[] = [
  'fs_read',
  'fs_readwrite',
  'network_http',
  'network_socket',
  'process',
]

export function emptyPermissions(): Record<PermissionCategory, string[]> {
  return { fs_read: [], fs_readwrite: [], network_http: [], network_socket: [], process: [] }
}

export function cloudInstallState(name: string, version: string, uuid: string): InstallState {
  return {
    installed_from: 'cloud',
    installed_version: version,
    plugin_name: name,
    enabled: true,
    cloud_uuid: uuid,
    permissions: emptyPermissions(),
    capabilities: [],
  }
}

/** Key order matches the desktop writer so the files diff cleanly. */
export function serializeInstallState(state: InstallState): string {
  const json: Record<string, unknown> = {
    installed_from: state.installed_from,
    installed_version: state.installed_version,
    plugin_name: state.plugin_name,
    enabled: state.enabled,
  }
  if (state.cloud_uuid !== undefined && state.cloud_uuid !== '') json.cloud_uuid = state.cloud_uuid
  json.permissions = state.permissions
  json.capabilities = state.capabilities
  return JSON.stringify(json, null, 2)
}

export function parseInstallState(text: string): InstallState | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const json = raw as Record<string, unknown>
  const permissions = emptyPermissions()
  const rawPermissions = (json.permissions ?? {}) as Record<string, unknown>
  for (const category of PERMISSION_CATEGORIES) {
    const list = rawPermissions[category]
    if (Array.isArray(list))
      permissions[category] = list.filter((v): v is string => typeof v === 'string')
  }
  const capabilities = Array.isArray(json.capabilities)
    ? json.capabilities.filter(
        (v): v is Record<string, boolean> => typeof v === 'object' && v !== null,
      )
    : []
  return {
    installed_from: json.installed_from === 'local' ? 'local' : 'cloud',
    installed_version: typeof json.installed_version === 'string' ? json.installed_version : '',
    plugin_name: typeof json.plugin_name === 'string' ? json.plugin_name : '',
    enabled: json.enabled === true,
    cloud_uuid: typeof json.cloud_uuid === 'string' ? json.cloud_uuid : undefined,
    permissions,
    capabilities,
  }
}

/** One entry file per plugin directory, named by the cloud uuid. */
export function packageFileName(uuid: string, kind: PackageKind): string {
  return `${uuid}.${kind}`
}

export function isEntryFile(name: string): boolean {
  return name.endsWith('.py') || name.endsWith('.whl')
}
