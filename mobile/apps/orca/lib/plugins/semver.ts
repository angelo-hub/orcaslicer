// Version ordering for "update available", matching PluginManager's use of
// Semver::parse with a plain string comparison when a version does not parse.

interface Parsed {
  nums: [number, number, number]
  prerelease: string[]
}

function parse(version: string): Parsed | null {
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
    version.trim(),
  )
  if (m === null) return null
  return {
    nums: [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)],
    prerelease: m[4] === undefined ? [] : m[4].split('.'),
  }
}

function compareIdentifiers(a: string, b: string): number {
  const na = /^\d+$/.test(a)
  const nb = /^\d+$/.test(b)
  if (na && nb) return Number(a) - Number(b)
  if (na) return -1
  if (nb) return 1
  return a < b ? -1 : a > b ? 1 : 0
}

/** Negative when `a` is older than `b`, zero when equal, positive when newer. */
export function compareVersions(a: string, b: string): number {
  const pa = parse(a)
  const pb = parse(b)
  if (pa === null || pb === null) return a < b ? -1 : a > b ? 1 : 0
  for (let i = 0; i < 3; i++) {
    const d = (pa.nums[i] ?? 0) - (pb.nums[i] ?? 0)
    if (d !== 0) return d
  }
  // A release outranks any prerelease of the same number.
  if (pa.prerelease.length === 0 || pb.prerelease.length === 0)
    return pb.prerelease.length - pa.prerelease.length
  const n = Math.max(pa.prerelease.length, pb.prerelease.length)
  for (let i = 0; i < n; i++) {
    const ia = pa.prerelease[i]
    const ib = pb.prerelease[i]
    if (ia === undefined) return -1
    if (ib === undefined) return 1
    const c = compareIdentifiers(ia, ib)
    if (c !== 0) return c
  }
  return 0
}

export function isNewer(candidate: string, installed: string): boolean {
  return compareVersions(candidate, installed) > 0
}
