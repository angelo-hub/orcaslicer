import { getOrcaCore } from 'react-native-orca-core'

import { subscribeAgentMessages } from '../plugins/native'
import { pluginDeviceAddress, statusFromMessage } from './pluginStatus'
import type { PrinterClient, PrinterHost } from './types'

// A printer-connection plugin as a PrinterClient. The plugin owns the connection and
// pushes status as it sees fit through its message callback; this keeps the last message
// per printer (pluginStatus.ts reads it) and sends commands as the JSON the desktop's
// device panel sends, which a plugin for another protocol translates.

interface Last {
  at: number
  message: Record<string, unknown>
}

const connected = new Map<string, Promise<void>>()
const last = new Map<string, Last>()
const unsubscribes = new Map<string, () => void>()

function ref(host: PrinterHost): NonNullable<PrinterHost['plugin']> {
  if (host.plugin === undefined) throw new Error('Not a plugin printer')
  return host.plugin
}

function ensureConnected(host: PrinterHost): Promise<void> {
  const r = ref(host)
  const existing = connected.get(host.id)
  if (existing !== undefined) return existing
  const core = getOrcaCore()
  const listen = `${r.key}\n${r.capability}`
  if (!unsubscribes.has(listen)) {
    unsubscribes.set(
      listen,
      subscribeAgentMessages(r.key, r.capability, (devId, message) => {
        let parsed: unknown = null
        try {
          parsed = JSON.parse(message)
        } catch {
          parsed = { raw: message }
        }
        if (typeof parsed === 'object' && parsed !== null)
          last.set(devId, { at: Date.now(), message: parsed as Record<string, unknown> })
      }),
    )
  }
  const pending = (async () => {
    const error = await core.pluginAgentConnect(
      r.key,
      r.capability,
      r.devId,
      pluginDeviceAddress(host.url),
      host.username ?? '',
      host.apiKey ?? '',
      /^https:/i.test(host.url),
    )
    if (error !== '') {
      connected.delete(host.id)
      throw new Error(error)
    }
  })()
  connected.set(host.id, pending)
  return pending
}

async function send(host: PrinterHost, command: Record<string, unknown>): Promise<void> {
  await ensureConnected(host)
  const r = ref(host)
  const error = await getOrcaCore().pluginAgentSend(
    r.key,
    r.capability,
    r.devId,
    JSON.stringify(command),
  )
  if (error !== '') throw new Error(error)
}

let sequence = 0
function printCommand(
  command: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  sequence += 1
  return { print: { command, sequence_id: String(sequence), ...extra } }
}

export const pluginPrinter: PrinterClient = {
  async info(host) {
    const r = ref(host)
    const raw = await getOrcaCore().pluginAgentInfo(r.key, r.capability)
    const info = JSON.parse(raw) as { name?: string; version?: string; error?: string }
    if (info.error !== undefined && info.error !== '') throw new Error(info.error)
    await ensureConnected(host)
    return `${info.name ?? r.capability} ${info.version ?? ''}`.trim()
  },

  async status(host) {
    await ensureConnected(host)
    const entry = last.get(ref(host).devId)
    return statusFromMessage(entry?.message ?? null)
  },

  async upload(host, options) {
    if (!options.startPrint)
      throw new Error('A plugin printer starts the print as it uploads; turn on "start print".')
    await ensureConnected(host)
    const r = ref(host)
    const name = options.filename.replace(/\.gcode$/i, '')
    const error = await getOrcaCore().pluginAgentPrint(
      r.key,
      r.capability,
      JSON.stringify({
        dev_id: r.devId,
        dev_name: host.name,
        dev_ip: pluginDeviceAddress(host.url),
        username: host.username ?? '',
        password: host.apiKey ?? '',
        use_ssl: /^https:/i.test(host.url),
        filename: options.path,
        dst_file: options.filename,
        task_name: name,
        project_name: name,
        plate_index: 0,
      }),
    )
    if (error !== '') throw new Error(error)
  },

  pause: (host) => send(host, printCommand('pause')),
  resume: (host) => send(host, printCommand('resume')),
  cancel: (host) => send(host, printCommand('stop')),

  setTemperature: (host, tool, target) =>
    send(
      host,
      printCommand('gcode_line', {
        param: `${tool === 'nozzle' ? 'M104' : 'M140'} S${Math.round(target)}\n`,
      }),
    ),

  async webcamUrl() {
    return null
  },
}
