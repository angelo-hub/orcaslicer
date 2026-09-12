import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { OptionDefinition } from 'react-native-orca-core'

import {
  decodeScalar,
  editorKind,
  encodeScalar,
  escapeCStyle,
  groupByCategory,
  splitStrings,
  unescapeCStyle,
  visibleInMode,
} from './options.ts'

function def(partial: Partial<OptionDefinition>): OptionDefinition {
  return {
    key: 'k',
    kind: 'process',
    type: 'float',
    vector: false,
    nullable: false,
    readonly: false,
    label: 'Label',
    fullLabel: '',
    category: 'Quality',
    tooltip: '',
    unit: 'mm',
    mode: 0,
    ...partial,
  }
}

test('C-style escapes round-trip', () => {
  const text = 'M104 S{temperature}\n; "quoted" \\ tab\t'
  assert.equal(unescapeCStyle(escapeCStyle(text)), text)
  assert.equal(escapeCStyle('a\nb'), '"a\\nb"')
  assert.equal(unescapeCStyle('plain'), 'plain')
})

test('string vectors split on unquoted semicolons only', () => {
  assert.deepEqual(splitStrings('"a;b";"c"'), ['"a;b"', '"c"'])
  assert.deepEqual(splitStrings('"x\\";y";"z"'), ['"x\\";y"', '"z"'])
  assert.deepEqual(splitStrings(''), [])
})

test('single-element vectors get scalar editors, longer ones stay raw', () => {
  const temps = def({ key: 'nozzle_temperature', type: 'int', vector: true })
  assert.equal(editorKind(temps, '220'), 'number')
  assert.equal(editorKind(temps, '220,215'), 'raw')
  assert.equal(editorKind(def({ type: 'bool' }), '1'), 'bool')
  assert.equal(editorKind(def({ type: 'enum' }), 'grid'), 'enum')
  assert.equal(editorKind(def({ key: 'filament_start_gcode', type: 'string', vector: true }), '"M104"'), 'code')
})

test('scalar encode keeps the vector shape', () => {
  const temps = def({ key: 'nozzle_temperature', type: 'int', vector: true })
  assert.equal(decodeScalar(temps, '220,215'), '220')
  assert.equal(encodeScalar(temps, '220,215', '230'), '230,215')
  assert.equal(encodeScalar(temps, '220', '230'), '230')

  const gcode = def({ key: 'filament_start_gcode', type: 'string', vector: true })
  assert.equal(decodeScalar(gcode, '"M104 S200\\nG28"'), 'M104 S200\nG28')
  assert.equal(encodeScalar(gcode, '"old"', 'M104\n'), '"M104\\n"')
})

test('mode filter and category grouping', () => {
  const simple = def({ key: 'a', mode: 0 })
  const expert = def({ key: 'b', mode: 2, category: 'Speed' })
  assert.equal(visibleInMode(expert, 'simple'), false)
  assert.equal(visibleInMode(expert, 'expert'), true)
  assert.equal(visibleInMode(simple, 'simple'), true)
  const groups = groupByCategory([simple, expert, def({ key: 'c', category: '' })])
  assert.deepEqual(
    groups.map((g) => [g.category, g.options.map((o) => o.key)]),
    [
      ['Quality', ['a']],
      ['Speed', ['b']],
      ['Other', ['c']],
    ]
  )
})
