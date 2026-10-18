import { Directory, File } from 'expo-file-system'

import { dataDirectory } from '../profiles'
import { pluginApi } from './api'
import { sniffPackageKind } from './parse'
import {
  PLUGINS_DIR,
  SIDECAR_FILE,
  SUBSCRIBED_DIR,
  cloudInstallState,
  isEntryFile,
  packageFileName,
  parseInstallState,
  serializeInstallState,
} from './sidecar'
import type { CloudPlugin, InstalledPlugin } from './types'

// Where cloud plugins live on this device: the desktop's layout, one directory
// per plugin under data/orca_plugins/_subscribed/<user id>/<uuid>/, holding the
// entry file and its .install_state.json. A plugin dir the desktop wrote reads
// the same way.

const META_FILE = 'cloud_meta.json'

export function subscribedDirectory(userId: string): Directory {
  return new Directory(dataDirectory(), PLUGINS_DIR, SUBSCRIBED_DIR, userId)
}

export function pluginDirectory(userId: string, uuid: string): Directory {
  return new Directory(subscribedDirectory(userId), uuid)
}

export function readInstalled(userId: string): InstalledPlugin[] {
  const root = subscribedDirectory(userId)
  if (!root.exists) return []
  const out: InstalledPlugin[] = []
  for (const entry of root.list()) {
    if (!(entry instanceof Directory)) continue
    const sidecar = new File(entry, SIDECAR_FILE)
    if (!sidecar.exists) continue
    const state = parseInstallState(sidecar.textSync())
    if (state === null) continue
    const entries = entry.list().filter((e) => e instanceof File && isEntryFile(e.name))
    out.push({
      key: entry.name,
      dir: entry.uri,
      entryFile: entries.length === 1 ? entries[0]!.name : '',
      state,
    })
  }
  return out
}

export class PluginInstallError extends Error {}

/** Downloads the latest package and writes the plugin directory. */
export async function installFromCloud(userId: string, plugin: CloudPlugin): Promise<void> {
  const links = await pluginApi.downloadLinks([{ uuid: plugin.uuid }])
  const link = links.links.find((l) => l.pluginId === plugin.uuid)
  if (link === undefined) {
    const reason = links.notFound.find((n) => n.id === plugin.uuid)?.reason
    throw new PluginInstallError(
      links.unauthorized.includes(plugin.uuid)
        ? 'This account may not download the plugin.'
        : (reason ?? 'The cloud has no package for this plugin.'),
    )
  }
  const bytes = await pluginApi.fetchPackage(link.url)
  if (bytes.length === 0) throw new PluginInstallError('The downloaded package is empty.')
  const kind = sniffPackageKind(bytes)

  const dir = pluginDirectory(userId, plugin.uuid)
  // Replace in place: a stale entry file next to the new one would make the
  // loader's "exactly one entry" check fail.
  if (dir.exists) dir.delete()
  dir.create({ intermediates: true })
  new File(dir, packageFileName(plugin.uuid, kind)).write(bytes)
  new File(dir, SIDECAR_FILE).write(
    serializeInstallState(cloudInstallState(plugin.name, plugin.version, plugin.uuid)),
  )
  // Mobile-only bookkeeping, kept out of the sidecar the desktop rewrites.
  new File(dir, META_FILE).write(
    JSON.stringify({ requested_os: link.requestedOs, returned_os: link.returnedOs }, null, 2),
  )
}

export function removeInstalled(userId: string, uuid: string): void {
  const dir = pluginDirectory(userId, uuid)
  if (dir.exists) dir.delete()
}
