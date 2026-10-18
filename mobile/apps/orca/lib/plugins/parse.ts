import type {
  CatalogResult,
  CloudPlugin,
  DownloadResult,
  NativePlugin,
  PackageKind,
  PluginChangelog,
} from './types'

// Pure decoders for the plugin endpoints, following the field choices in
// OrcaCloudServiceAgent.cpp (parse_cloud_author, parse_cloud_display_types,
// the subscriptions and download loops) so both clients read a response alike.

type Json = Record<string, unknown>

function str(item: Json, key: string): string {
  const v = item[key]
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : ''
}

function strings(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string')
  if (typeof value === 'string' && value !== '') return [value]
  return []
}

function idList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((v) =>
      typeof v === 'string' ? v : typeof v === 'object' && v !== null ? str(v as Json, 'id') : '',
    )
    .filter((v) => v !== '')
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// The display name degrades to the username and then to the raw user id when
// the cloud cannot resolve a profile; a bare id is dropped rather than shown.
function parseAuthor(item: Json): string {
  let author = str(item, 'creator_display_name')
  if (author === '' || UUID.test(author)) author = str(item, 'creator_username')
  return UUID.test(author) ? '' : author
}

function parseChangelog(uuid: string, value: unknown): PluginChangelog[] {
  if (!Array.isArray(value)) return []
  const entries = value
    .filter((v): v is Json => typeof v === 'object' && v !== null)
    .map((item) => ({
      id: str(item, 'id'),
      version: str(item, 'version'),
      text: str(item, 'changelog'),
      createdTime: Number(item.created_time ?? 0) || 0,
    }))
  // Newest first, as sort_plugin_changelog orders it.
  entries.sort((a, b) => b.createdTime - a.createdTime)
  return entries.length === 0
    ? []
    : entries.map((e) => ({ ...e, id: e.id || `${uuid}@${e.version}` }))
}

export function parseCloudPlugin(item: Json, isMine: boolean): CloudPlugin | null {
  const uuid = str(item, 'uuid') || str(item, 'id')
  if (uuid === '') return null
  const image = item.main_image
  const thumbnailUrl =
    typeof image === 'object' && image !== null ? str(image as Json, 'access_url') : ''
  return {
    uuid,
    name: str(item, 'name').trim() || uuid,
    version: str(item, 'version'),
    author: parseAuthor(item),
    typeLabels: strings(item.type_label ?? item.type),
    entryPackage: str(item, 'entry_package'),
    sharingToken: str(item, 'sharing_token'),
    thumbnailUrl,
    changelog: parseChangelog(uuid, item.changelog),
    isMine,
  }
}

export function parseCatalog(root: Json, isMine: boolean): CatalogResult {
  const data = Array.isArray(root.data) ? root.data : []
  return {
    plugins: data
      .filter((v): v is Json => typeof v === 'object' && v !== null)
      .map((item) => parseCloudPlugin(item, isMine))
      .filter((p): p is CloudPlugin => p !== null),
    notFound: idList(root.not_found),
    unauthorized: idList(root.unauthorised),
  }
}

/** The page cursor of /plugins/mine, null when the listing is complete. */
export function nextOffset(root: Json, current: number): number | null {
  const next = root.next_offset
  if (typeof next !== 'number' || next <= current) return null
  return next
}

export function parseDownload(root: Json): DownloadResult {
  const data = Array.isArray(root.data) ? root.data : []
  const notFound = Array.isArray(root.not_found) ? root.not_found : []
  return {
    links: data
      .filter((v): v is Json => typeof v === 'object' && v !== null)
      .map((item) => ({
        pluginId: str(item, 'plugin_id'),
        url: str(item, 'download_link'),
        requestedOs: str(item, 'requested_os'),
        returnedOs: str(item, 'returned_os'),
      }))
      .filter((row) => row.pluginId !== '' && row.url !== ''),
    notFound: notFound
      .filter((v): v is Json => typeof v === 'object' && v !== null)
      .map((item) => ({ id: str(item, 'id'), reason: str(item, 'reason') })),
    unauthorized: idList(root.unauthorised),
  }
}

/** The core's plugin list (Plugins::list_json), tolerant of a malformed row. */
export function parseNativePlugins(text: string): NativePlugin[] {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return []
  }
  if (!Array.isArray(raw)) return []
  return raw
    .filter((v): v is Json => typeof v === 'object' && v !== null)
    .map((item) => ({
      key: str(item, 'key'),
      name: str(item, 'name'),
      version: str(item, 'version'),
      installedVersion: str(item, 'installed_version'),
      description: str(item, 'description'),
      author: str(item, 'author'),
      cloudUuid: str(item, 'cloud_uuid'),
      enabled: item.enabled === true,
      loaded: item.loaded === true,
      loading: item.loading === true,
      error: str(item, 'error'),
      dependencies: strings(item.dependencies),
      capabilities: (Array.isArray(item.capabilities) ? item.capabilities : [])
        .filter((c): c is Json => typeof c === 'object' && c !== null)
        .map((c) => ({ name: str(c, 'name'), type: str(c, 'type'), enabled: c.enabled === true })),
    }))
    .filter((p) => p.key !== '')
}

/** A wheel is a zip; anything else is treated as a single Python file. */
export function sniffPackageKind(bytes: Uint8Array): PackageKind {
  return bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
    ? 'whl'
    : 'py'
}
