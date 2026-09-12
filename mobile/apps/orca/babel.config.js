// Expo's default babel preset plus NativeWind's className transform. Ordering
// matters: NativeWind must come after the preset so it sees the JSX after
// Expo's preset expands it.
module.exports = function (api) {
  api.cache(true)
  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
  }
}
