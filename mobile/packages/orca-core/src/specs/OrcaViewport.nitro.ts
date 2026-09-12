import type { HybridView, HybridViewMethods, HybridViewProps } from 'react-native-nitro-modules'

// The 3D viewport. A Metal view on iOS that reads geometry straight from the native
// session (found by id), so no mesh or toolpath data crosses the JavaScript boundary.

export type ViewportMode = 'scene' | 'preview'

export interface OrcaViewportProps extends HybridViewProps {
  /** OrcaSession.id of the session to draw. 0 draws only the bed. */
  sessionId: number
  /** 'scene' draws the objects on the bed, 'preview' the toolpath of the last export. */
  mode: ViewportMode
  /** Highest layer id to draw in preview mode; -1 draws every layer. */
  maxLayer: number
  /** Draw travel moves in preview mode. */
  showTravels: boolean
  /** Bump to re-read geometry from the session after the model or the print changed. */
  revision: number
}

export interface OrcaViewportMethods extends HybridViewMethods {
  /** Frames the bed and everything on it. */
  fit(): void
}

// iOS only for now; the Android (OpenGL ES) view comes with the Android port.
export type OrcaViewport = HybridView<OrcaViewportProps, OrcaViewportMethods, { ios: 'swift' }>
