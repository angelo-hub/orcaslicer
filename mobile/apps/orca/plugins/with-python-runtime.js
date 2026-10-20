// Expo config plugin: put the Python runtime's standard library into the app.
//
// A core built with the plugin runtime (scripts/build_ios_core.sh -p) comes with
// Python.xcframework, which the orca-core podspec vendors so Python.framework is
// embedded like any dynamic framework. The standard library is not part of a
// framework, though: it has to be copied into the app, and its extension modules
// (.so) turned into one-binary frameworks, since iOS loads nothing else. BeeWare
// ships the shell functions that do both; this phase runs them after the app's
// resources are in place. With no Python.xcframework the phase does nothing, so
// the project stays the same whichever core is installed.
const { withXcodeProject } = require('expo/config-plugins')

const PHASE_NAME = 'Install Python runtime'

// Relative to the Xcode project (ios/), as BeeWare's helpers expect.
const XCFRAMEWORK = '../node_modules/react-native-orca-core/ios/Python.xcframework'

// Parts of the stdlib nothing on a phone needs; dropping them keeps the bundle small.
const PRUNE = ['test', 'idlelib', 'tkinter', 'turtledemo', 'ensurepip', 'lib2to3', 'pydoc_data']

const SCRIPT = `set -e
XCF="${XCFRAMEWORK}"
if [ ! -d "$PROJECT_DIR/$XCF" ]; then
  echo "No Python.xcframework next to the core; the plugin runtime is not part of this build."
  exit 0
fi
source "$PROJECT_DIR/$XCF/build/utils.sh"
install_stdlib "$XCF"
PYTHON_VER=$(ls -1 "$CODESIGNING_FOLDER_PATH/python/lib" | grep -E '^python3\\.[0-9]+$')
for name in ${PRUNE.join(' ')}; do
  rm -rf "$CODESIGNING_FOLDER_PATH/python/lib/$PYTHON_VER/$name"
done
echo "Installing Python $PYTHON_VER extension modules as frameworks..."
process_dylibs "$XCF" "python/lib/$PYTHON_VER/lib-dynload"
`

module.exports = function withPythonRuntime(config) {
  return withXcodeProject(config, (mod) => {
    const project = mod.modResults
    const target = project.getFirstTarget()
    const phases = project.hash.project.objects.PBXShellScriptBuildPhase ?? {}
    const exists = Object.values(phases).some((phase) => phase && phase.name === `"${PHASE_NAME}"`)
    if (!exists) {
      project.addBuildPhase([], 'PBXShellScriptBuildPhase', PHASE_NAME, target.uuid, {
        shellPath: '/bin/sh',
        shellScript: SCRIPT,
      })
    }
    return mod
  })
}
