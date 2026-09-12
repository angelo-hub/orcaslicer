// Expo config plugin: weak-link SwiftUICore in the app's Podfile.
//
// The iOS 26 SDK's SwiftUICore.tbd has an allowed-clients list; a non-first-party
// app that links it directly fails at link time. React Native's Swift-bridged
// pods pull it in as an implicit runtime dependency, so we rewrite every pod's
// OTHER_LDFLAGS in the post_install hook — "-framework SwiftUICore" becomes
// "-weak_framework SwiftUICore".
//
// The block is inserted next to react_native_post_install so it survives
// re-runs of `expo prebuild`.
const { withDangerousMod } = require('@expo/config-plugins')
const fs = require('node:fs')
const path = require('node:path')

const HOOK_MARKER = '# SwiftUICore weak-link fix'

const PATCH = `
    ${HOOK_MARKER}
    installer.pods_project.targets.each do |t|
      t.build_configurations.each do |c|
        flags = Array(c.build_settings['OTHER_LDFLAGS'] || ['$(inherited)'])
        cleaned = []
        i = 0
        while i < flags.length
          if flags[i] == '-framework' && flags[i + 1] == 'SwiftUICore'
            i += 2
            next
          end
          cleaned << flags[i]
          i += 1
        end
        cleaned += ['-weak_framework', 'SwiftUICore']
        c.build_settings['OTHER_LDFLAGS'] = cleaned
      end
    end
`

module.exports = function withSwiftUICoreWeakLink(config) {
  return withDangerousMod(config, [
    'ios',
    async (mod) => {
      const podfilePath = path.join(mod.modRequest.platformProjectRoot, 'Podfile')
      let contents = fs.readFileSync(podfilePath, 'utf8')
      if (contents.includes(HOOK_MARKER)) return mod

      // Insert right after the react_native_post_install(...) call closes.
      const anchor = /react_native_post_install\([^)]*\)\s*\n/m
      if (!anchor.test(contents)) {
        throw new Error(
          'with-swiftui-core-weak-link: could not find react_native_post_install in Podfile',
        )
      }
      contents = contents.replace(anchor, (m) => m + PATCH)
      fs.writeFileSync(podfilePath, contents)
      return mod
    },
  ])
}
