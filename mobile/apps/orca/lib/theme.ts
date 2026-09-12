// A small design token set. Colors follow iOS system-color conventions so the
// palette reads correctly in either scheme; typography and spacing come out of
// the 8pt grid Apple's HIG uses. Consumers reach for `useTheme()` and pull
// the fields they need.
import { useColorScheme } from 'react-native'

const light = {
  bg: '#f2f2f7',
  surface: '#ffffff',
  surfaceElevated: '#ffffff',
  border: '#c6c6c8',
  separator: '#e5e5ea',
  text: '#000000',
  textMuted: '#3c3c43',
  textSubdued: '#8e8e93',
  accent: '#0a84ff',
  accentText: '#ffffff',
  success: '#34c759',
  warning: '#ff9500',
  danger: '#ff3b30',
  ghost: 'rgba(120, 120, 128, 0.16)',
} as const

const dark: typeof light = {
  bg: '#000000',
  surface: '#1c1c1e',
  surfaceElevated: '#2c2c2e',
  border: '#38383a',
  separator: '#38383a',
  text: '#ffffff',
  textMuted: 'rgba(235, 235, 245, 0.85)',
  textSubdued: 'rgba(235, 235, 245, 0.6)',
  accent: '#0a84ff',
  accentText: '#ffffff',
  success: '#30d158',
  warning: '#ff9f0a',
  danger: '#ff453a',
  ghost: 'rgba(118, 118, 128, 0.32)',
}

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const
export const radius = { sm: 8, md: 12, lg: 16 } as const
export const typography = {
  title: { fontSize: 22, fontWeight: '700' as const, letterSpacing: -0.4 },
  section: { fontSize: 13, fontWeight: '600' as const, letterSpacing: 0.4, textTransform: 'uppercase' as const },
  body: { fontSize: 16, fontWeight: '400' as const },
  bodyStrong: { fontSize: 16, fontWeight: '600' as const },
  caption: { fontSize: 13, fontWeight: '400' as const },
}

export type ThemeColors = typeof light

export function useTheme(): { colors: ThemeColors; scheme: 'light' | 'dark' } {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light'
  return { colors: scheme === 'dark' ? dark : light, scheme }
}
