import { describe, expect, test } from 'vitest'

import { pluginDeviceAddress, statusFromMessage } from './pluginStatus.ts'

describe('pluginDeviceAddress', () => {
  test('keeps the host out of a URL', () => {
    expect(pluginDeviceAddress('http://192.168.1.20:8883/')).toBe('192.168.1.20')
    expect(pluginDeviceAddress('printer.local')).toBe('printer.local')
    expect(pluginDeviceAddress(' https://x1c.lan/path?q=1 ')).toBe('x1c.lan')
  })
})

describe('statusFromMessage', () => {
  test('reads a Bambu-style print report', () => {
    const status = statusFromMessage({
      print: {
        gcode_state: 'RUNNING',
        mc_percent: 42,
        nozzle_temper: 219.5,
        nozzle_target_temper: 220,
        bed_temper: 59.8,
        bed_target_temper: 60,
        chamber_temper: 31,
        subtask_name: 'benchy',
      },
    })
    expect(status).toMatchObject({
      state: 'printing',
      progress: 0.42,
      file: 'benchy',
      nozzleTemperature: 219.5,
      nozzleTarget: 220,
      bedTemperature: 59.8,
      bedTarget: 60,
    })
    expect(status.sensors.map((s) => s.kind)).toEqual(['nozzle', 'bed', 'chamber'])
  })

  test('falls back to plain keys and clamps progress', () => {
    const status = statusFromMessage({
      state: 'paused',
      progress: 1.4,
      nozzle: 200,
      file: 'a.gcode',
    })
    expect(status).toMatchObject({
      state: 'paused',
      progress: 1,
      nozzleTemperature: 200,
      file: 'a.gcode',
    })
    expect(status.sensors).toHaveLength(1)
  })

  test('reports connecting before the first message and unknown without a state', () => {
    expect(statusFromMessage(null)).toEqual({ state: 'connecting', sensors: [] })
    expect(statusFromMessage({ print: {} }).state).toBe('unknown')
    expect(statusFromMessage({ print: { gcode_state: 'ODD' } }).state).toBe('odd')
  })
})
