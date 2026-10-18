import { splitStrings } from '../options'
import type { CapabilityRef } from './types'

// Presets name the plugins they need as `name;uuid;capability` strings in the
// `plugins` and `slicing_pipeline_plugin` options (PrintConfig.cpp). Without a
// runtime the core ignores them, so the app reads them itself to say so.

export const PLUGIN_OPTIONS = ['slicing_pipeline_plugin', 'plugins'] as const

export function parseCapabilityRef(ref: string): CapabilityRef | null {
  const parts = ref.split(';')
  if (parts.length !== 3) return null
  const [name = '', uuid = '', capability = ''] = parts.map((p) => p.trim())
  if (uuid === '' || capability === '') return null
  return { name, uuid, capability }
}

interface OptionSource {
  option(key: string): string
}

/** Every plugin reference in the selected presets, without duplicates. */
export function presetPluginRefs(session: OptionSource): CapabilityRef[] {
  const seen = new Set<string>()
  const out: CapabilityRef[] = []
  for (const key of PLUGIN_OPTIONS) {
    let serialized = ''
    try {
      serialized = session.option(key)
    } catch {
      continue
    }
    for (const value of splitStrings(serialized)) {
      const ref = parseCapabilityRef(value)
      const id = ref === null ? '' : `${ref.uuid};${ref.capability}`
      if (ref === null || seen.has(id)) continue
      seen.add(id)
      out.push(ref)
    }
  }
  return out
}
