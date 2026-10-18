import { CloudRequestError, request } from '../cloud/api'
import { CLOUD_WEB } from '../cloud/config'
import { nextOffset, parseCatalog, parseDownload } from './parse'
import type { CatalogResult, CloudPlugin, DownloadResult, PluginChangelog } from './types'

// The plugin endpoints of the Orca Cloud API, as OrcaCloudServiceAgent.cpp
// calls them. Downloads are presigned links fetched without the token and
// without a hash, as on the desktop.

const BASE = '/api/v1/plugins'
const PAGE = 100

// The service knows macosx, windows and linux; packages are pure Python, so the
// macOS build serves iOS. `returned_os` says when the service fell back.
const DOWNLOAD_QUERY = 'os=macosx&arch=arm64'

async function json(res: Response, what: string): Promise<Record<string, unknown>> {
  if (!res.ok) throw new CloudRequestError(`${what} failed (${res.status})`, res.status)
  return (await res.json()) as Record<string, unknown>
}

export const pluginApi = {
  /** Plugins the account subscribes to. */
  async subscriptions(): Promise<CatalogResult> {
    const res = await request(`${BASE}/subscriptions?include=changelog`, { method: 'GET' })
    return parseCatalog(await json(res, 'Listing subscriptions'), false)
  },

  /** Plugins the account published, every page. */
  async mine(): Promise<CloudPlugin[]> {
    const out: CloudPlugin[] = []
    let offset: number | null = 0
    while (offset !== null) {
      const res = await request(`${BASE}/mine?limit=${PAGE}&offset=${offset}&include=changelog`, {
        method: 'GET',
      })
      const root = await json(res, 'Listing your plugins')
      out.push(...parseCatalog(root, true).plugins)
      offset = nextOffset(root, offset)
    }
    return out
  },

  async subscribe(uuid: string): Promise<void> {
    const res = await request(`${BASE}/subscriptions`, {
      method: 'POST',
      body: JSON.stringify({ plugin_id: uuid }),
    })
    // 409: already subscribed.
    if (!res.ok && res.status !== 409)
      throw new CloudRequestError(`Subscribing failed (${res.status})`, res.status)
  },

  async unsubscribe(uuids: string[]): Promise<void> {
    if (uuids.length === 0) return
    const res = await request(`${BASE}/subscriptions?ids=${encodeURIComponent(uuids.join(','))}`, {
      method: 'DELETE',
    })
    if (!res.ok && res.status !== 404)
      throw new CloudRequestError(`Unsubscribing failed (${res.status})`, res.status)
  },

  /** Presigned links for the given plugins, at their latest version unless given. */
  async downloadLinks(ids: { uuid: string; version?: string }[]): Promise<DownloadResult> {
    const res = await request(`${BASE}/download?${DOWNLOAD_QUERY}`, {
      method: 'POST',
      body: JSON.stringify({
        data: ids.map(({ uuid, version }) =>
          version === undefined ? { plugin_id: uuid } : { plugin_id: uuid, version },
        ),
      }),
    })
    if (res.status === 404) return { links: [], notFound: [], unauthorized: [] }
    return parseDownload(await json(res, 'Requesting the download'))
  },

  async changelog(uuid: string): Promise<PluginChangelog[]> {
    const res = await request(`${BASE}/${encodeURIComponent(uuid)}/changelog?limit=${PAGE}`, {
      method: 'GET',
    })
    const root = await json(res, 'Loading the changelog')
    return (
      parseCatalog({ data: [{ uuid, changelog: root.data ?? root.changelog }] }, false).plugins[0]
        ?.changelog ?? []
    )
  },

  /** The package bytes behind a presigned link. */
  async fetchPackage(url: string): Promise<Uint8Array> {
    const res = await fetch(url)
    if (!res.ok) throw new CloudRequestError(`Download failed (${res.status})`, res.status)
    return new Uint8Array(await res.arrayBuffer())
  },
}

export function pluginWebUrl(plugin: { sharingToken: string; uuid: string }): string {
  return plugin.sharingToken === ''
    ? `${CLOUD_WEB}/app/plugins/plugin-hub/${plugin.uuid}`
    : `${CLOUD_WEB}/p/${plugin.sharingToken}`
}
