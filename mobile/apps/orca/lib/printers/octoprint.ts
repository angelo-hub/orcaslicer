import { filePart, normalizeUrl, type PrinterClient, type PrinterHost, type PrinterStatus, type UploadOptions } from './types'

// OctoPrint. API reference: https://docs.octoprint.org/en/master/api/

function headers(host: PrinterHost): Record<string, string> {
  return { 'X-Api-Key': host.apiKey ?? '' }
}

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(`OctoPrint ${response.status} ${response.statusText}`)
  }
  return (await response.json()) as T
}

interface Version {
  server: string
  text: string
}

interface Job {
  state: string
  progress: { completion: number | null }
  job: { file: { name: string | null } }
}

interface Printer {
  temperature: {
    tool0?: { actual: number; target: number }
    bed?: { actual: number; target: number }
  }
}

export const octoprint: PrinterClient = {
  async info(host) {
    const base = normalizeUrl(host.url)
    const version = await json<Version>(await fetch(`${base}/api/version`, { headers: headers(host) }))
    return version.text
  },

  async status(host): Promise<PrinterStatus> {
    const base = normalizeUrl(host.url)
    const job = await json<Job>(await fetch(`${base}/api/job`, { headers: headers(host) }))
    const status: PrinterStatus = {
      state: job.state,
      progress: job.progress.completion === null ? undefined : job.progress.completion / 100,
      file: job.job.file.name ?? undefined,
    }
    // /api/printer answers 409 while the printer is disconnected; temperatures are optional.
    const printerResponse = await fetch(`${base}/api/printer?exclude=sd,state`, { headers: headers(host) })
    if (printerResponse.ok) {
      const printer = (await printerResponse.json()) as Printer
      status.nozzleTemperature = printer.temperature.tool0?.actual
      status.nozzleTarget = printer.temperature.tool0?.target
      status.bedTemperature = printer.temperature.bed?.actual
      status.bedTarget = printer.temperature.bed?.target
    }
    return status
  },

  async upload(host, options: UploadOptions) {
    const base = normalizeUrl(host.url)
    const body = new FormData()
    body.append('file', filePart(options.path, options.filename))
    body.append('select', 'true')
    body.append('print', options.startPrint ? 'true' : 'false')
    const response = await fetch(`${base}/api/files/local`, { method: 'POST', headers: headers(host), body })
    if (!response.ok) {
      throw new Error(`Upload failed: OctoPrint ${response.status} ${await response.text()}`)
    }
  },

  async pause(host) { await job(host, 'pause', 'pause') },
  async resume(host) { await job(host, 'pause', 'resume') },
  async cancel(host) { await job(host, 'cancel') },
}

async function job(host: PrinterHost, command: 'pause' | 'cancel', action?: 'pause' | 'resume' | 'toggle'): Promise<void> {
  const base = normalizeUrl(host.url)
  const body = action !== undefined ? { command, action } : { command }
  const response = await fetch(`${base}/api/job`, {
    method: 'POST',
    headers: { ...headers(host), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`OctoPrint ${command} failed: ${response.status} ${await response.text()}`)
}
