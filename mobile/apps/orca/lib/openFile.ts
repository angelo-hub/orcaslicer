import { Directory, File, Paths } from 'expo-file-system'
import * as FileSystem from 'expo-file-system/legacy'
import { Platform } from 'react-native'

import { PRESET_FILE_PATTERN } from './presetFiles'

// Files that reach the app from outside: handed over by Files.app, a share sheet or a
// deep link, or returned by the document picker. Models go to the plate, preset files to
// the importer; anything else is ignored.
//
// iOS delivers file:// URLs into the app's sandbox, name and extension included. Android
// delivers content:// URIs, which the core cannot open and which often carry neither name
// nor extension, so the content is copied into the cache under an extension read from the
// URI's last segment or, failing that, from the bytes: the core picks its loader by
// extension. Such copies are temporary and the caller removes them after the import.

export const MODEL_FILE_PATTERN = /\.(3mf|stl|obj|step|stp|amf)$/i

export type OpenedKind = 'model' | 'presets'

export type OpenedFile = {
  kind: OpenedKind
  path: string
  /** True for a cache copy the caller should discard once imported. */
  temporary: boolean
} | null

/**
 * Whether the document picker should copy into the cache. iOS already hands out a
 * sandboxed copy (`asCopy`); a second copy would leak. Android hands out content://
 * URIs, so the picker's copy, which keeps the document's extension, is the only local file.
 */
export const PICKER_COPY = Platform.OS === 'android'

/** The local path of a file:// URL, as the core expects it. */
export function filePath(uri: string): string {
  return decodeURIComponent(uri.replace(/^file:\/\//, ''))
}

/** What to do with a file, by its name. */
export function classifyName(name: string): OpenedKind | null {
  if (MODEL_FILE_PATTERN.test(name)) return 'model'
  if (PRESET_FILE_PATTERN.test(name)) return 'presets'
  return null
}

/** The extension of a name the app knows how to open, lower-case, or null. */
export function knownExtension(name: string): string | null {
  if (classifyName(name) === null) return null
  return /\.([a-z0-9_]+)$/i.exec(name)?.[1]?.toLowerCase() ?? null
}

/**
 * The decoded last segment of a URI. Some Android providers end the document id with the
 * file name ("primary:Download/model.3mf"), others use opaque ids, so this is a first guess.
 */
export function lastSegment(uri: string): string {
  let decoded = uri
  try {
    decoded = decodeURIComponent(uri)
  } catch {
    /* keep the raw form */
  }
  return decoded.split(/[/:]/).pop() ?? ''
}

function ascii(bytes: Uint8Array, limit = 512): string {
  let out = ''
  const n = Math.min(bytes.length, limit)
  for (let i = 0; i < n; ++i) out += String.fromCharCode(bytes[i]!)
  return out
}

/**
 * The extension a file's bytes reveal, for a file whose name has none. `head` is the
 * start of the file, `tail` its end (a zip's central directory lists its entries there in
 * plain text), `size` its length. Null when nothing matches.
 */
export function extensionFromBytes(
  head: Uint8Array,
  tail: Uint8Array,
  size: number,
): string | null {
  const start = ascii(head)
  if (start.startsWith('PK\u0003\u0004')) {
    const directory = ascii(tail, tail.length)
    if (directory.includes('3D/3dmodel.model')) return '3mf'
    // A preset bundle is a zip of preset JSON files.
    if (directory.includes('.json')) return 'zip'
    return null
  }
  if (start.startsWith('ISO-10303-21')) return 'step'
  if (/^solid\b/.test(start)) return 'stl'
  if (start.startsWith('<?xml') && /<amf\b/.test(start)) return 'amf'
  if (/^\s*\{/.test(start)) return 'json'
  if (/^(#|v |vn |vt |o |g |mtllib )/m.test(start)) return 'obj'
  // Binary STL: an 80-byte header, a triangle count and 50 bytes per triangle.
  if (size > 84 && (size - 84) % 50 === 0) return 'stl'
  return null
}

async function readBytes(uri: string, position: number, length: number): Promise<Uint8Array> {
  if (length <= 0) return new Uint8Array(0)
  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64', position, length })
  const binary = atob(base64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; ++i) out[i] = binary.charCodeAt(i)
  return out
}

/**
 * Copies a content:// URI into Caches/open under the extension the URI or the bytes
 * reveal and returns the copy's path, or null when the type could not be told.
 */
export async function copyContentToCache(uri: string): Promise<string | null> {
  const dir = new Directory(Paths.cache, 'open')
  if (!dir.exists) dir.create({ intermediates: true })
  const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const temp = new File(dir, `${stamp}.bin`)
  await FileSystem.copyAsync({ from: uri, to: temp.uri })
  let extension = knownExtension(lastSegment(uri))
  if (extension === null) {
    const info = await FileSystem.getInfoAsync(temp.uri)
    const size = info.exists ? (info.size ?? 0) : 0
    const tailLength = Math.min(size, 64 * 1024)
    const [head, tail] = await Promise.all([
      readBytes(temp.uri, 0, Math.min(size, 512)),
      readBytes(temp.uri, size - tailLength, tailLength),
    ])
    extension = extensionFromBytes(head, tail, size)
  }
  if (extension === null) {
    temp.delete()
    return null
  }
  const target = new File(dir, `${stamp}.${extension}`)
  if (target.exists) target.delete()
  temp.move(target)
  return filePath(target.uri)
}

/** Resolves a URL the system handed to the app into a local file and what to do with it. */
export async function resolveOpenedUrl(raw: string): Promise<OpenedFile> {
  if (!/^content:\/\//i.test(raw)) {
    let path: string
    try {
      path = filePath(raw)
    } catch {
      return null
    }
    const kind = classifyName(path)
    return kind === null ? null : { kind, path, temporary: false }
  }
  const path = await copyContentToCache(raw)
  if (path === null) return null
  const kind = classifyName(path)
  if (kind === null) {
    discardCopy(path)
    return null
  }
  return { kind, path, temporary: true }
}

/** The local path of a document the picker returned. */
export function pickedPath(asset: { uri: string }): string {
  return filePath(asset.uri)
}

/** Removes a temporary copy; best effort, and a no-op where the picker made none. */
export function discardCopy(path: string): void {
  if (!PICKER_COPY) return
  try {
    new File(path).delete()
  } catch {
    /* the cache copy; best effort */
  }
}
