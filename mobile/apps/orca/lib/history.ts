import type { SliceStatistics } from 'react-native-orca-core'

import { storage } from './storage'

// Small MMKV-backed list of successful slices. Version the key so a future
// shape change can be busted without decoding stale entries into new types.
const KEY = 'history:v1'
const MAX_ENTRIES = 20

export interface HistoryEntry {
  id: string
  at: number
  printer: string
  filament: string
  process: string
  objectNames: string[]
  sourcePaths: string[]
  stats: SliceStatistics
  gcodePath: string | null
}

function read(): HistoryEntry[] {
  const raw = storage.getString(KEY)
  if (raw === undefined) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as HistoryEntry[]) : []
  } catch {
    return []
  }
}

function write(entries: HistoryEntry[]): void {
  storage.set(KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)))
}

export function history(): HistoryEntry[] {
  return read()
}

export function pushHistory(entry: Omit<HistoryEntry, 'id' | 'at'>): HistoryEntry {
  const full: HistoryEntry = {
    ...entry,
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    at: Date.now(),
  }
  write([full, ...read()])
  return full
}

export function removeHistory(id: string): void {
  write(read().filter((e) => e.id !== id))
}

export function clearHistory(): void {
  storage.remove(KEY)
}
