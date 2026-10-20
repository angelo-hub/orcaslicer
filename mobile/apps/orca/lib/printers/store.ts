import { File } from 'expo-file-system'

import { dataDirectory, ensureDirectories } from '../profiles'
import type { PrinterHost } from './types'

// printers.json in the core's data directory. Synchronous on purpose: the list is tiny
// and screens read it during render.

function storeFile(): File {
  return new File(dataDirectory(), 'printers.json')
}

function isHost(value: unknown): value is PrinterHost {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  if (typeof v.id !== 'string' || typeof v.name !== 'string' || typeof v.url !== 'string')
    return false
  if (v.kind === 'moonraker' || v.kind === 'octoprint') return true
  if (v.kind !== 'plugin') return false
  const p = v.plugin as Record<string, unknown> | undefined
  return (
    typeof p === 'object' &&
    p !== null &&
    typeof p.key === 'string' &&
    typeof p.capability === 'string' &&
    typeof p.devId === 'string'
  )
}

export function loadPrinters(): PrinterHost[] {
  const file = storeFile()
  if (!file.exists) return []
  try {
    const parsed: unknown = JSON.parse(file.textSync())
    return Array.isArray(parsed) ? parsed.filter(isHost) : []
  } catch {
    return []
  }
}

export function savePrinters(printers: PrinterHost[]): void {
  ensureDirectories()
  storeFile().write(JSON.stringify(printers, null, 2))
}
