import { describe, expect, test } from 'vitest'

import {
  cloudInstallState,
  isEntryFile,
  packageFileName,
  parseInstallState,
  serializeInstallState,
} from './sidecar.ts'

describe('install state sidecar', () => {
  test('writes the keys PluginFsUtils.cpp expects, in its order', () => {
    const text = serializeInstallState(cloudInstallState('Spool Tracker', '1.2.0', 'uuid-1'))
    expect(Object.keys(JSON.parse(text))).toEqual([
      'installed_from',
      'installed_version',
      'plugin_name',
      'enabled',
      'cloud_uuid',
      'permissions',
      'capabilities',
    ])
    expect(JSON.parse(text)).toMatchObject({
      installed_from: 'cloud',
      installed_version: '1.2.0',
      plugin_name: 'Spool Tracker',
      enabled: true,
      cloud_uuid: 'uuid-1',
      permissions: {
        fs_read: [],
        fs_readwrite: [],
        network_http: [],
        network_socket: [],
        process: [],
      },
      capabilities: [],
    })
  })

  test('omits cloud_uuid for a local plugin', () => {
    const state = { ...cloudInstallState('x', '1', ''), installed_from: 'local' as const }
    expect(JSON.parse(serializeInstallState(state))).not.toHaveProperty('cloud_uuid')
  })

  test('round-trips what the desktop wrote', () => {
    const desktop = `{
  "capabilities": [{ "Spool page": true }],
  "cloud_uuid": "uuid-1",
  "enabled": false,
  "installed_from": "cloud",
  "installed_version": "1.1.0",
  "permissions": { "fs_read": ["/tmp"], "network_http": ["api.spoolman.local"] },
  "plugin_name": "Spool Tracker"
}`
    const state = parseInstallState(desktop)
    expect(state).toEqual({
      installed_from: 'cloud',
      installed_version: '1.1.0',
      plugin_name: 'Spool Tracker',
      enabled: false,
      cloud_uuid: 'uuid-1',
      permissions: {
        fs_read: ['/tmp'],
        fs_readwrite: [],
        network_http: ['api.spoolman.local'],
        network_socket: [],
        process: [],
      },
      capabilities: [{ 'Spool page': true }],
    })
    expect(parseInstallState(serializeInstallState(state!))).toEqual(state)
  })

  test('rejects malformed text', () => {
    expect(parseInstallState('not json')).toBeNull()
    expect(parseInstallState('[]')).toBeNull()
  })

  test('names the entry file by uuid and kind', () => {
    expect(packageFileName('uuid-1', 'whl')).toBe('uuid-1.whl')
    expect(isEntryFile('uuid-1.py')).toBe(true)
    expect(isEntryFile('.install_state.json')).toBe(false)
  })
})
