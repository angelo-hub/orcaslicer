import * as ScreenOrientation from 'expo-screen-orientation'
import { StatusBar } from 'expo-status-bar'
import React, { useEffect } from 'react'
import { Modal, Pressable, Text, View } from 'react-native'
import { OrcaViewport, type ViewportMode } from 'react-native-orca-core'

type Props = {
  sessionId: number
  mode: ViewportMode
  maxLayer: number
  showTravels: boolean
  revision: number
  visible: boolean
  onClose: () => void
  /** Optional overlay controls (segmented mode, layer scrubber…). Kept minimal on purpose so the plate is the focus. */
  children?: React.ReactNode
}

// Full-screen Modal that hosts the same native OrcaViewport as the home screen
// and locks the device to landscape while it is open. The native view already
// carries the orbit / two-finger pan / pinch / double-tap-to-fit gestures, so
// the fullscreen wrapper is purely presentational: black backdrop, a Done pill,
// and space for the caller's overlay controls.
export function FullscreenViewport({
  sessionId,
  mode,
  maxLayer,
  showTravels,
  revision,
  visible,
  onClose,
  children,
}: Props): React.JSX.Element {
  useEffect(() => {
    if (!visible) return
    let cancelled = false
    void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {
      /* device may not permit; leave orientation alone */
    })
    return () => {
      cancelled = true
      void ScreenOrientation.unlockAsync().catch(() => {})
      void cancelled
    }
  }, [visible])

  return (
    <Modal
      visible={visible}
      animationType="fade"
      presentationStyle="overFullScreen"
      supportedOrientations={['landscape', 'portrait']}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View className="flex-1 bg-black">
        <StatusBar style="light" hidden />
        <OrcaViewport
          style={{ flex: 1 }}
          sessionId={sessionId}
          mode={mode}
          maxLayer={maxLayer}
          showTravels={showTravels}
          revision={revision}
        />
        <Pressable
          onPress={onClose}
          hitSlop={12}
          className="absolute right-6 top-6 rounded-full bg-white/15 px-4 py-2 active:bg-white/25"
        >
          <Text className="text-[13px] font-semibold uppercase tracking-wider text-white">Done</Text>
        </Pressable>
        {children !== undefined ? (
          <View className="absolute inset-x-0 bottom-6 items-center">{children}</View>
        ) : null}
      </View>
    </Modal>
  )
}
