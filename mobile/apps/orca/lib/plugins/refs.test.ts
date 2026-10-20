import { describe, expect, test } from 'vitest'

import { parseCapabilityRef, presetPluginRefs } from './refs.ts'

describe('parseCapabilityRef', () => {
  test('splits name;uuid;capability', () => {
    expect(parseCapabilityRef('Stamp;uuid-1;G-code stamp')).toEqual({
      name: 'Stamp',
      uuid: 'uuid-1',
      capability: 'G-code stamp',
    })
  })

  test('rejects anything else', () => {
    expect(parseCapabilityRef('')).toBeNull()
    expect(parseCapabilityRef('Stamp;uuid-1')).toBeNull()
    expect(parseCapabilityRef('Stamp;;cap')).toBeNull()
  })
})

describe('presetPluginRefs', () => {
  test('reads both options, dedupes, and survives a failing read', () => {
    const values: Record<string, string> = {
      slicing_pipeline_plugin: '"Stamp;uuid-1;G-code stamp";"Inset;uuid-2;Inset"',
      plugins: '"Stamp;uuid-1;G-code stamp";junk',
    }
    const session = {
      option: (key: string) => {
        const v = values[key]
        if (v === undefined) throw new Error('busy')
        return v
      },
    }
    expect(presetPluginRefs(session).map((r) => r.uuid)).toEqual(['uuid-1', 'uuid-2'])
    expect(presetPluginRefs({ option: () => '' })).toEqual([])
  })
})
