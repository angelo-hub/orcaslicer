import { loadedPrinterAgents } from '../plugins/native'
import { moonraker } from './moonraker'
import { octoprint } from './octoprint'
import { pluginPrinter } from './plugin'
import type { PrinterClient, PrinterHost, PrinterHostKind } from './types'

export type {
  HeatedTool,
  PluginHostRef,
  PrinterClient,
  PrinterHost,
  PrinterHostKind,
  PrinterStatus,
  Sensor,
  SensorKind,
  UploadOptions,
} from './types'
export { normalizeUrl } from './types'
export { loadPrinters, savePrinters } from './store'

export const HOST_KINDS: Array<{ kind: PrinterHostKind; label: string; hint: string }> = [
  {
    kind: 'moonraker',
    label: 'Klipper (Moonraker)',
    hint: 'http://printer.local or http://192.168.1.20:7125',
  },
  { kind: 'octoprint', label: 'OctoPrint', hint: 'http://octopi.local, application key required' },
]

/** The kinds the editor offers: the HTTP hosts, plus a plugin kind while a loaded plugin
 * provides a printer connection. */
export function hostKinds(): typeof HOST_KINDS {
  return loadedPrinterAgents().length > 0
    ? [
        ...HOST_KINDS,
        { kind: 'plugin', label: 'Plugin', hint: 'printer address, as the plugin expects it' },
      ]
    : HOST_KINDS
}

export function kindLabel(kind: PrinterHostKind): string {
  return kind === 'moonraker'
    ? 'Klipper (Moonraker)'
    : kind === 'octoprint'
      ? 'OctoPrint'
      : 'Plugin'
}

export function clientFor(host: PrinterHost): PrinterClient {
  return host.kind === 'moonraker' ? moonraker : host.kind === 'plugin' ? pluginPrinter : octoprint
}
