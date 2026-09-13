import { filePart, normalizeUrl, type PrinterClient, type PrinterHost, type PrinterStatus, type UploadOptions } from './types'

// Moonraker (Klipper). API reference: https://moonraker.readthedocs.io/en/latest/web_api/

function headers(host: PrinterHost): Record<string, string> {
  return host.apiKey !== undefined && host.apiKey !== '' ? { 'X-Api-Key': host.apiKey } : {}
}

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(`Moonraker ${response.status} ${response.statusText}`)
  }
  return (await response.json()) as T
}

interface ServerInfo {
  result: { klippy_state: string; moonraker_version?: string }
}

interface ObjectsQuery {
  result: {
    status: {
      print_stats?: { state?: string; filename?: string }
      display_status?: { progress?: number }
      extruder?: { temperature?: number; target?: number }
      heater_bed?: { temperature?: number; target?: number }
    }
  }
}

export const moonraker: PrinterClient = {
  async info(host) {
    const base = normalizeUrl(host.url)
    const info = await json<ServerInfo>(await fetch(`${base}/server/info`, { headers: headers(host) }))
    return `Moonraker ${info.result.moonraker_version ?? ''} (Klipper ${info.result.klippy_state})`.trim()
  },

  async status(host): Promise<PrinterStatus> {
    const base = normalizeUrl(host.url)
    const query = 'print_stats=state,filename&display_status=progress&extruder=temperature,target&heater_bed=temperature,target'
    const data = await json<ObjectsQuery>(await fetch(`${base}/printer/objects/query?${query}`, { headers: headers(host) }))
    const s = data.result.status
    return {
      state: s.print_stats?.state ?? 'unknown',
      progress: s.display_status?.progress,
      file: s.print_stats?.filename,
      nozzleTemperature: s.extruder?.temperature,
      nozzleTarget: s.extruder?.target,
      bedTemperature: s.heater_bed?.temperature,
      bedTarget: s.heater_bed?.target,
    }
  },

  async upload(host, options: UploadOptions) {
    const base = normalizeUrl(host.url)
    const body = new FormData()
    body.append('file', filePart(options.path, options.filename))
    body.append('root', 'gcodes')
    body.append('print', options.startPrint ? 'true' : 'false')
    const response = await fetch(`${base}/server/files/upload`, { method: 'POST', headers: headers(host), body })
    if (!response.ok) {
      throw new Error(`Upload failed: Moonraker ${response.status} ${await response.text()}`)
    }
  },

  async pause(host) { await control(host, 'pause') },
  async resume(host) { await control(host, 'resume') },
  async cancel(host) { await control(host, 'cancel') },
}

async function control(host: PrinterHost, action: 'pause' | 'resume' | 'cancel'): Promise<void> {
  const base = normalizeUrl(host.url)
  const response = await fetch(`${base}/printer/print/${action}`, { method: 'POST', headers: headers(host) })
  if (!response.ok) throw new Error(`Moonraker ${action} failed: ${response.status} ${await response.text()}`)
}
