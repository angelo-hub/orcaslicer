// Monorepo + pnpm + NativeWind Metro config, following Expo's guidance for
// SDK 54+ isolated installs. The workspace root is added as a watch folder
// so Metro sees @tanstack/react-query, react-native-css and friends inside
// pnpm's virtual store, and both node_modules directories are searched so a
// package can resolve whether it is deduped at the workspace root or in the
// app.
const { getDefaultConfig } = require('expo/metro-config')
const { withNativeWind } = require('nativewind/metro')
const path = require('node:path')

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '../..')

const config = getDefaultConfig(projectRoot)

config.watchFolders = [workspaceRoot]
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
]
// Hierarchical lookup stays on: pnpm's isolated store puts every
// transitive dep as a symlink inside .pnpm/<pkg>@<ver>_<peers>/node_modules/,
// and Metro reaches those by walking up from the importing file — the same
// path Node uses. Disabling the lookup broke imports like @expo/metro-runtime
// from expo-router's own entry file.
config.resolver.disableHierarchicalLookup = false
config.resolver.unstable_enableSymlinks = true

module.exports = withNativeWind(config, { input: './global.css' })
