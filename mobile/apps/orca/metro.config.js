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
config.resolver.disableHierarchicalLookup = true
// pnpm's virtual store keeps every package at .pnpm/<name>@<version>_<peers>/node_modules/<name>.
// Metro follows symlinks by default; leave that on so require walks the same
// tree the runtime linker would.
config.resolver.unstable_enableSymlinks = true

module.exports = withNativeWind(config, { input: './global.css' })
