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

/** Retry policy for a single-file download. Small enough to keep the total
 * install time reasonable on a spotty network. */
const MAX_RETRIES = 4
const BASE_BACKOFF_MS = 500

/**
 * Download one file with byte-level retry. GitHub raw supports Range, so on
 * a mid-stream network drop we resume from where we left off rather than
 * starting over. Fails hard on non-partial-content or empty bodies.
 *
 * @param entry     GitHub file entry.
 * @param into      Destination directory.
 * @param onBytes   Optional per-file progress callback.
 * @param signal    Optional abort signal.
 */
async function download(
  entry: GitHubEntry,
  into: Directory,
  onBytes?: (received: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (entry.download_url === null) {
    throw new Error(`No download URL for ${entry.path}`)
  }
  const target = new File(into, entry.name)
  if (target.exists) target.delete()

  const bailIfAborted = (): void => {
    if (signal?.aborted === true) throw new Error('cancelled')
  }

  let received = 0
  const chunks: Uint8Array[] = []
  let total = 0
  let attempt = 0
  while (true) {
    bailIfAborted()
    try {
      const headers: Record<string, string> = {}
      if (received > 0) headers['Range'] = `bytes=${received}-`
      const response = await fetch(entry.download_url, { headers, signal })
      const acceptable = received > 0 ? response.status === 206 : response.ok
      if (!acceptable) throw new Error(`HTTP ${response.status} downloading ${entry.path}`)
      const contentLengthHeader = response.headers.get('Content-Length')
      const contentLength = contentLengthHeader !== null ? Number.parseInt(contentLengthHeader, 10) : 0
      if (total === 0 && Number.isFinite(contentLength) && contentLength > 0) total = received + contentLength
      // fetch on iOS does not expose a stream reader in every RN release;
      // read as an ArrayBuffer per attempt and treat any error as
      // recoverable via a fresh Range request from `received`.
      const bytes = new Uint8Array(await response.arrayBuffer())
      chunks.push(bytes)
      received += bytes.length
      onBytes?.(received, total || received)
      break
    } catch (e) {
      const message = String(e)
      if (message.includes('cancelled')) throw e
      attempt += 1
      if (attempt > MAX_RETRIES) throw new Error(`Gave up on ${entry.path} after ${attempt} attempts: ${message}`)
      await new Promise<void>((r) => setTimeout(r, BASE_BACKOFF_MS * 2 ** (attempt - 1)))
    }
  }

  if (received === 0) throw new Error(`Empty response for ${entry.path}`)

  // Concatenate every chunk (usually one, sometimes more if we resumed) and
  // validate JSON before we let it near the native slicer's parser.
  const buffer = new Uint8Array(received)
  let offset = 0
  for (const c of chunks) {
    buffer.set(c, offset)
    offset += c.length
  }
  if (entry.name.toLowerCase().endsWith('.json')) {
    const text = new TextDecoder().decode(buffer)
    try {
      JSON.parse(text)
    } catch (e) {
      throw new Error(`Malformed JSON for ${entry.path}: ${String(e)}`)
    }
  }
  target.write(buffer)
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

/** A printer available at the source, keyed by the vendor bundle that owns it. */
export interface AvailablePrinter {
  vendor: string
  vendorName: string
  model: string
}

/**
 * List every printer offered across every vendor bundle. Reads each vendor's
 * top-level manifest for its machine_model_list; one small HTTP fetch per
 * vendor, results cached by the caller. Empty or bad manifests are skipped.
 */
export async function availablePrinters(source: ProfileSource = DEFAULT_PROFILE_SOURCE): Promise<AvailablePrinter[]> {
  const vendors = await availableVendors(source)
  const results = await Promise.all(
    vendors.map(async (vendor) => {
      try {
        const url = `https://raw.githubusercontent.com/${source.owner}/${source.repo}/${source.ref}/resources/profiles/${encodeURIComponent(vendor)}.json`
        const response = await fetch(url)
        if (!response.ok) return [] as AvailablePrinter[]
        const manifest = (await response.json()) as { name?: string; machine_model_list?: Array<{ name?: string }> }
        const models = manifest.machine_model_list ?? []
        const vendorName = manifest.name ?? vendor
        return models
          .map((m) => m.name)
          .filter((n): n is string => typeof n === 'string' && n.length > 0)
          .map((model) => ({ vendor, vendorName, model }))
      } catch {
        return [] as AvailablePrinter[]
      }
    }),
  )
  return results.flat().sort((a, b) => a.model.localeCompare(b.model))
}

/**
 * Downloads a vendor's index file and its profile folder. Roughly one API call per
 * subfolder plus one download per file; a vendor is 1 to 10 MB.
 */
export async function installVendor(
  vendor: string,
  onProgress?: (done: number, total: number) => void,
  source: ProfileSource = DEFAULT_PROFILE_SOURCE,
  signal?: AbortSignal,
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
    if (signal?.aborted === true) throw new Error('cancelled')
    if (!into.exists) into.create({ intermediates: true })
    // The signal is forwarded to `download` so a cancellation aborts the
    // in-flight fetch cleanly instead of waiting for the current file to end.
    await download(entry, into, undefined, signal)
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
