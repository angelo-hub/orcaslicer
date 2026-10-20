import { describe, expect, test } from 'vitest'

import { compareVersions, isNewer } from './semver.ts'

describe('compareVersions', () => {
  test('orders numeric parts and pads missing ones', () => {
    expect(isNewer('1.2.1', '1.2.0')).toBe(true)
    expect(isNewer('1.10.0', '1.9.0')).toBe(true)
    expect(isNewer('2', '1.9.9')).toBe(true)
    expect(compareVersions('1.2', '1.2.0')).toBe(0)
    expect(compareVersions('v1.2.0', '1.2.0')).toBe(0)
  })

  test('ranks a release above its prereleases and prereleases by identifier', () => {
    expect(isNewer('1.0.0', '1.0.0-beta.2')).toBe(true)
    expect(isNewer('1.0.0-beta.2', '1.0.0-beta.1')).toBe(true)
    expect(isNewer('1.0.0-beta.10', '1.0.0-beta.9')).toBe(true)
    expect(isNewer('1.0.0-rc.1', '1.0.0-beta.9')).toBe(true)
    expect(isNewer('1.0.0-beta', '1.0.0-alpha.1')).toBe(true)
  })

  test('ignores build metadata', () => {
    expect(compareVersions('1.0.0+a', '1.0.0+b')).toBe(0)
  })

  test('falls back to string order when a side does not parse', () => {
    expect(isNewer('b', 'a')).toBe(true)
    expect(isNewer('1.0.0', 'latest')).toBe(false)
  })
})
