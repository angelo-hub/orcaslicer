import type { PrinterStatus, Sensor } from './types'

// The pure half of the plugin printer client: how a plugin's status report becomes a
// PrinterStatus, and how a stored address becomes what the plugin connects to. Kept apart
// from plugin.ts, which needs the native core, so these have unit tests.

/** The address the plugin connects to: the host name or IP out of the stored URL. */
export function pluginDeviceAddress(url: string): string {
  return url
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/[/:?#].*$/, '')
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? v : undefined
}

// A Bambu-style `print` report's gcode_state, as the desktop's device panel reads it.
const BAMBU_STATE: Record<string, string> = {
  RUNNING: 'printing',
  PAUSE: 'paused',
  IDLE: 'ready',
  FINISH: 'complete',
  FAILED: 'error',
  PREPARE: 'printing',
  SLICING: 'printing',
}

/**
 * A status out of the last message the plugin pushed. Reads the fields a Bambu-style
 * `print` report carries, with plain keys ({state, progress, nozzle, bed, chamber, file})
 * as the fallback, so a plugin for another printer can report those and still show up.
 */
export function statusFromMessage(message: Record<string, unknown> | null): PrinterStatus {
  if (message === null) return { state: 'connecting', sensors: [] }
  const print = (
    typeof message.print === 'object' && message.print !== null ? message.print : message
  ) as Record<string, unknown>
  const gcodeState = str(print.gcode_state)
  const state =
    gcodeState !== undefined
      ? (BAMBU_STATE[gcodeState] ?? gcodeState.toLowerCase())
      : (str(print.state) ?? 'unknown')
  const percent = num(print.mc_percent)
  const progress = percent !== undefined ? percent / 100 : num(print.progress)
  const nozzle = num(print.nozzle_temper) ?? num(print.nozzle)
  const nozzleTarget = num(print.nozzle_target_temper) ?? num(print.nozzle_target)
  const bed = num(print.bed_temper) ?? num(print.bed)
  const bedTarget = num(print.bed_target_temper) ?? num(print.bed_target)
  const chamber = num(print.chamber_temper) ?? num(print.chamber)
  const sensors: Sensor[] = []
  if (nozzle !== undefined)
    sensors.push({ name: 'Nozzle', kind: 'nozzle', current: nozzle, target: nozzleTarget })
  if (bed !== undefined) sensors.push({ name: 'Bed', kind: 'bed', current: bed, target: bedTarget })
  if (chamber !== undefined) sensors.push({ name: 'Chamber', kind: 'chamber', current: chamber })
  return {
    state,
    progress: progress !== undefined ? Math.max(0, Math.min(1, progress)) : undefined,
    file: str(print.subtask_name) ?? str(print.gcode_file) ?? str(print.file),
    nozzleTemperature: nozzle,
    nozzleTarget,
    bedTemperature: bed,
    bedTarget,
    sensors,
  }
}
