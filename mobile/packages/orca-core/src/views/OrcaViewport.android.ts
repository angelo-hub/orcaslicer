import React from 'react'
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import type { HybridRef } from 'react-native-nitro-modules'

import type { OrcaViewportMethods, OrcaViewportProps } from '../specs/OrcaViewport.nitro'

export type OrcaViewportRef = HybridRef<OrcaViewportProps, OrcaViewportMethods>

type Props = OrcaViewportProps & {
  style?: StyleProp<ViewStyle>
  /** Never called here: there is no native view to hand out a ref to. */
  hybridRef?: { f: (ref: OrcaViewportRef) => void }
}

/**
 * Stands in for the native viewport until the Vulkan backend lands (see the Android
 * port's issue list). Metro picks this file on Android and OrcaViewport.ts, the Nitro
 * View, on iOS; the app renders both with the same props and never learns the difference.
 *
 * A .ts file, not .tsx: Metro tries the extensions in order and a platform variant only
 * wins over the plain file of the same extension, so OrcaViewport.android.tsx would lose
 * to OrcaViewport.ts.
 */
export function OrcaViewport({ style }: Props): React.JSX.Element {
  return React.createElement(
    View,
    { style: [styles.container, style] },
    React.createElement(
      Text,
      { style: styles.label },
      'The 3D view is not available on Android yet.',
    ),
  )
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#edf0f2',
  },
  label: {
    color: '#5c6368',
    fontSize: 15,
    textAlign: 'center',
    paddingHorizontal: 24,
  },
})
