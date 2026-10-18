#!/usr/bin/env node
// The paths the mobile port owns in this fork of OrcaSlicer: the app, the façade and
// its tests, and the iOS build. Upstream never touches them, so a commit that does is
// ours, and every release tool counts commits by them.
//
// release-please cannot list paths to include; a package is one directory. The mobile
// package is therefore the repository root, with every directory that holds none of
// these paths excluded. Upstream's commits, which a sync merge brings in by the
// thousand and some of which are conventional, then stay out of the changelog. Loose
// files in the root, src/, tests/, deps/ and scripts/ cannot be excluded and still
// count, so an upstream commit touching only those can show up; that is rare.
//
// Usage: node owned-paths.mjs --list     the paths, one per line (for git log/diff)
//        node owned-paths.mjs --write    regenerates exclude-paths in the release config
//        node owned-paths.mjs --check    fails when exclude-paths is out of date
//
// --write runs on every upstream sync, since a directory upstream adds would
// otherwise count as ours.

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const CONFIG = join(repo, '.github', 'release-please-config.json')

export const OWNED_PATHS = [
  'mobile',
  'src/mobile',
  'tests/mobile',
  'scripts/build_ios_core.sh',
  'deps/deps-ios.cmake',
  '.github/workflows/build_ios.yml',
  '.github/workflows/mobile_release.yml',
]

// Workflow changes are ci commits, which the changelog hides anyway, and .github/ holds
// upstream's workflows too; release-please leaves the whole directory out.
const RELEASE_PATHS = OWNED_PATHS.filter((p) => !p.startsWith('.github/'))

const git = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' }).trim()
const subdirectories = (dir) =>
  git('ls-tree', '-d', '--name-only', 'HEAD', ...(dir ? [`${dir}/`] : []))
    .split('\n')
    .filter(Boolean)

// Every directory at HEAD that holds no release path, as high up the tree as possible.
export function excludePaths() {
  const out = []
  const walk = (dir) => {
    for (const d of subdirectories(dir)) {
      if (RELEASE_PATHS.includes(d)) continue
      if (RELEASE_PATHS.some((p) => p.startsWith(`${d}/`))) walk(d)
      else out.push(d)
    }
  }
  walk('')
  return out.sort()
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const mode = process.argv[2]
  if (mode === '--list') {
    console.log(OWNED_PATHS.join('\n'))
  } else if (mode === '--write' || mode === '--check') {
    const config = JSON.parse(readFileSync(CONFIG, 'utf8'))
    const pkg = config.packages['.']
    const wanted = excludePaths()
    const current = pkg['exclude-paths'] ?? []
    if (mode === '--check') {
      if (JSON.stringify(current) !== JSON.stringify(wanted)) {
        console.error('exclude-paths in .github/release-please-config.json is out of date;')
        console.error('run: node mobile/scripts/owned-paths.mjs --write')
        process.exit(1)
      }
    } else {
      pkg['exclude-paths'] = wanted
      writeFileSync(CONFIG, `${JSON.stringify(config, null, 2)}\n`)
    }
  } else {
    console.error('usage: owned-paths.mjs --list | --write | --check')
    process.exit(2)
  }
}
