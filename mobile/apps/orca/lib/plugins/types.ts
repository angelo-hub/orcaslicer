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

/** One `name;uuid;capability` reference as presets store them. */
export interface CapabilityRef {
  name: string
  uuid: string
  capability: string
}
