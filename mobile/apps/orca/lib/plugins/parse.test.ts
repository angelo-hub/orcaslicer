import { describe, expect, test } from 'vitest'

import {
  nextOffset,
  parseCatalog,
  parseDownload,
  parseNativePlugins,
  sniffPackageKind,
} from './parse.ts'

const item = {
  uuid: '3992f039-64b9-49eb-b34c-cf63b84fd581',
  name: '  Spool Tracker ',
  version: '1.2.0',
  type_label: ['Pages'],
  entry_package: 'spool_tracker',
  sharing_token: 'abc123',
  creator_display_name: 'Someone',
  main_image: { media_type: 'image', access_url: 'https://cdn/x.png' },
  changelog: [
    {
      id: 'c1',
      plugin_id: '3992f039-64b9-49eb-b34c-cf63b84fd581',
      version: '1.1.0',
      changelog: 'old',
      created_time: 10,
    },
    { id: 'c2', version: '1.2.0', changelog: 'new', created_time: 20 },
  ],
}

describe('parseCatalog', () => {
  test('reads a subscription row the way the desktop does', () => {
    const result = parseCatalog({ data: [item], not_found: ['gone'], unauthorised: ['no'] }, false)
    expect(result.notFound).toEqual(['gone'])
    expect(result.unauthorized).toEqual(['no'])
    const [plugin] = result.plugins
    expect(plugin).toMatchObject({
      uuid: item.uuid,
      name: 'Spool Tracker',
      version: '1.2.0',
      author: 'Someone',
      typeLabels: ['Pages'],
      entryPackage: 'spool_tracker',
      sharingToken: 'abc123',
      thumbnailUrl: 'https://cdn/x.png',
      isMine: false,
    })
    expect(plugin!.changelog.map((c) => c.version)).toEqual(['1.2.0', '1.1.0'])
  })

  test('falls back from id and drops a raw user id as author', () => {
    const [plugin] = parseCatalog(
      {
        data: [
          { id: 'p1', name: 'X', creator_display_name: '3992f039-64b9-49eb-b34c-cf63b84fd581' },
        ],
      },
      true,
    ).plugins
    expect(plugin).toMatchObject({ uuid: 'p1', author: '', isMine: true, changelog: [] })
  })

  test('skips rows without an id and tolerates a missing data array', () => {
    expect(parseCatalog({ data: [{ name: 'nameless' }] }, false).plugins).toEqual([])
    expect(parseCatalog({}, false).plugins).toEqual([])
  })
})

describe('nextOffset', () => {
  test('stops on a null, missing or non-advancing cursor', () => {
    expect(nextOffset({ next_offset: 100 }, 0)).toBe(100)
    expect(nextOffset({ next_offset: null }, 0)).toBeNull()
    expect(nextOffset({}, 0)).toBeNull()
    expect(nextOffset({ next_offset: 100 }, 100)).toBeNull()
  })
})

describe('parseDownload', () => {
  test('keeps rows with a link and reports the rest', () => {
    const result = parseDownload({
      data: [
        {
          plugin_id: 'a',
          download_link: 'https://x/a',
          requested_os: 'macosx',
          returned_os: 'linux',
        },
        { plugin_id: 'b' },
      ],
      not_found: [{ id: 'c', reason: 'no package' }],
      unauthorised: ['d'],
    })
    expect(result.links).toEqual([
      { pluginId: 'a', url: 'https://x/a', requestedOs: 'macosx', returnedOs: 'linux' },
    ])
    expect(result.notFound).toEqual([{ id: 'c', reason: 'no package' }])
    expect(result.unauthorized).toEqual(['d'])
  })
})

describe('sniffPackageKind', () => {
  test('tells a wheel from a script by the zip signature', () => {
    expect(sniffPackageKind(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0]))).toBe('whl')
    expect(sniffPackageKind(new TextEncoder().encode('# /// script\n'))).toBe('py')
    expect(sniffPackageKind(new Uint8Array([]))).toBe('py')
  })
})

describe('parseNativePlugins', () => {
  test('reads the runtime list and drops rows without a key', () => {
    const list = parseNativePlugins(
      JSON.stringify([
        {
          key: 'uuid-1',
          name: 'Spool',
          version: '1.0.0',
          installed_version: '1.0.0',
          cloud_uuid: 'uuid-1',
          enabled: true,
          loaded: true,
          loading: false,
          error: '',
          dependencies: ['requests'],
          capabilities: [{ name: 'Spool page', type: 'pages', enabled: true }],
        },
        { name: 'keyless' },
      ]),
    )
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({
      key: 'uuid-1',
      loaded: true,
      dependencies: ['requests'],
      capabilities: [{ name: 'Spool page', type: 'pages', enabled: true }],
    })
    expect(parseNativePlugins('not json')).toEqual([])
  })
})
