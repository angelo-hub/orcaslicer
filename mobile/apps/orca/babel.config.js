// NativeWind v5 preview transforms className via its own babel plugin; the
// jsxImportSource trick some v4 setups use is not needed here (and would
// emit "not listed in exports" warnings, because the preview package does
// not ship its own jsx-runtime).
module.exports = function (api) {
  api.cache(true)
  return {
    presets: ['babel-preset-expo', 'nativewind/babel'],
  }
}
