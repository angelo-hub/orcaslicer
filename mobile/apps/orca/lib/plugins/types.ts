// Orca Cloud plugins as the catalog and the on-disk install see them. The
// shapes mirror PluginDescriptor / PluginInstallState in src/slic3r/plugin so a
// plugin this app installs is one the desktop recognises, and the other way round.

export interface PluginChangelog {
  id: string
  version: string
  text: string
  /** Unix seconds as the service reports it, 0 when missing. */
  createdTime: number
}

export interface CloudPlugin {
  uuid: string
  name: string
  /** The latest version the cloud offers. */
  version: string
  author: string
  /** Cosmetic labels from the service ("Slicing pipeline"); not the capabilities. */
  typeLabels: string[]
  entryPackage: string
  sharingToken: string
  /** Pre-signed image URL, empty when the plugin has none. */
  thumbnailUrl: string
  changelog: PluginChangelog[]
  /** Created by the signed-in user. */
  isMine: boolean
}

export interface CatalogResult {
  plugins: CloudPlugin[]
  /** Subscribed ids the service no longer knows. */
  notFound: string[]
  /** Subscribed ids this account may no longer download. */
  unauthorized: string[]
}

export interface DownloadLink {
  pluginId: string
  url: string
  requestedOs: string
  returnedOs: string
}

export interface DownloadResult {
  links: DownloadLink[]
  notFound: { id: string; reason: string }[]
  unauthorized: string[]
}

export type PackageKind = 'py' | 'whl'

export type PermissionCategory =
  | 'fs_read'
  | 'fs_readwrite'
  | 'network_http'
  | 'network_socket'
  | 'process'

/** `.install_state.json`, exactly as PluginFsUtils.cpp writes and reads it. */
export interface InstallState {
  installed_from: 'local' | 'cloud'
  installed_version: string
  plugin_name: string
  enabled: boolean
  cloud_uuid?: string
  permissions: Record<PermissionCategory, string[]>
  capabilities: Record<string, boolean>[]
}

export interface InstalledPlugin {
  /** The directory name: the cloud uuid for a cloud plugin. */
  key: string
  dir: string
  /** The entry file inside `dir`, empty when none or more than one was found. */
  entryFile: string
  state: InstallState
}

export interface NativeCapability {
  name: string
  /** 'slicing-pipeline', 'pages', 'script', 'printer-connection', … */
  type: string
  enabled: boolean
}

/** A plugin as the core's runtime sees it; see Plugins::list_json in src/mobile/core. */
export interface NativePlugin {
  key: string
  name: string
  version: string
  installedVersion: string
  description: string
  author: string
  cloudUuid: string
  /** Auto-load on start, from the sidecar. */
  enabled: boolean
  loaded: boolean
  loading: boolean
  error: string
  dependencies: string[]
  capabilities: NativeCapability[]
}

/** One `name;uuid;capability` reference as presets store them. */
export interface CapabilityRef {
  name: string
  uuid: string
  capability: string
}
