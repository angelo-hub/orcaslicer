import { Directory, File, Paths } from 'expo-file-system'

// Printer, filament and process profiles are not bundled with the app. They are fetched
// from the OrcaSlicer repository into the core's resources directory: the vendor index
// files first, then one vendor folder at a time when the user installs a vendor.

/** Repository and ref the profiles are fetched from. */
export interface ProfileSource {
  owner: string
  repo: string
  ref: string
}

export const DEFAULT_PROFILE_SOURCE: ProfileSource = {
  owner: 'OrcaSlicer',
  repo: 'OrcaSlicer',
  ref: 'main',
}

interface GitHubEntry {
  name: string
  path: string
  type: 'file' | 'dir'
  download_url: string | null
}

async function listDirectory(source: ProfileSource, path: string): Promise<GitHubEntry[]> {
  const url = `https://api.github.com/repos/${source.owner}/${source.repo}/contents/${path}?ref=${encodeURIComponent(source.ref)}`
  const response = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } })
  if (!response.ok) {
    throw new Error(`GitHub ${response.status} listing ${path}`)
  }
  return (await response.json()) as GitHubEntry[]
}

async function download(entry: GitHubEntry, into: Directory): Promise<void> {
  if (entry.download_url === null) {
    throw new Error(`No download URL for ${entry.path}`)
  }
  const target = new File(into, entry.name)
  if (target.exists) {
    target.delete()
  }
  await File.downloadFileAsync(entry.download_url, into)
}

/** The core's resources directory. Profiles live under resources/profiles. */
export function resourcesDirectory(): Directory {
  return new Directory(Paths.document, 'OrcaSlicer', 'resources')
}

/** The core's data directory: app config, user presets, logs. */
export function dataDirectory(): Directory {
  return new Directory(Paths.document, 'OrcaSlicer', 'data')
}

export function profilesDirectory(): Directory {
  return new Directory(resourcesDirectory(), 'profiles')
}

/** Absolute filesystem path of a directory, as the native core expects it. */
export function nativePath(directory: Directory): string {
  return decodeURIComponent(directory.uri.replace(/^file:\/\//, ''))
}

export function ensureDirectories(): void {
  for (const dir of [resourcesDirectory(), dataDirectory(), profilesDirectory()]) {
    if (!dir.exists) {
      dir.create({ intermediates: true })
    }
  }
}

/** Vendor ids that have an index file on disk. */
export function installedVendors(): string[] {
  const dir = profilesDirectory()
  if (!dir.exists) {
    return []
  }
  return dir
    .list()
    .filter((entry): entry is File => entry instanceof File && entry.name.endsWith('.json'))
    .map((file) => file.name.replace(/\.json$/, ''))
    .sort()
}

/** Vendor ids available at the source. One GitHub API call. */
export async function availableVendors(source: ProfileSource = DEFAULT_PROFILE_SOURCE): Promise<string[]> {
  const entries = await listDirectory(source, 'resources/profiles')
  return entries
    .filter((entry) => entry.type === 'file' && entry.name.endsWith('.json'))
    .map((entry) => entry.name.replace(/\.json$/, ''))
    .sort()
}

/**
 * Downloads a vendor's index file and its profile folder. Roughly one API call per
 * subfolder plus one download per file; a vendor is 1 to 10 MB.
 */
export async function installVendor(
  vendor: string,
  onProgress?: (done: number, total: number) => void,
  source: ProfileSource = DEFAULT_PROFILE_SOURCE
): Promise<void> {
  ensureDirectories()
  const root = profilesDirectory()

  const index = (await listDirectory(source, 'resources/profiles')).find((entry) => entry.name === `${vendor}.json`)
  if (index === undefined) {
    throw new Error(`Vendor ${vendor} not found at ${source.owner}/${source.repo}@${source.ref}`)
  }

  // Collect every file first so progress has a total.
  const files: Array<{ entry: GitHubEntry; into: Directory }> = [{ entry: index, into: root }]
  const walk = async (path: string, into: Directory): Promise<void> => {
    for (const entry of await listDirectory(source, path)) {
      if (entry.type === 'dir') {
        await walk(entry.path, new Directory(into, entry.name))
      } else {
        files.push({ entry, into })
      }
    }
  }
  await walk(`resources/profiles/${vendor}`, new Directory(root, vendor))

  let done = 0
  for (const { entry, into } of files) {
    if (!into.exists) {
      into.create({ intermediates: true })
    }
    await download(entry, into)
    done += 1
    onProgress?.(done, files.length)
  }
}

export function removeVendor(vendor: string): void {
  const root = profilesDirectory()
  const index = new File(root, `${vendor}.json`)
  if (index.exists) {
    index.delete()
  }
  const folder = new Directory(root, vendor)
  if (folder.exists) {
    folder.delete()
  }
}
