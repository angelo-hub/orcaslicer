import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'

let requested = false

// Fire-and-forget helper. iOS and Android 13+ gate local notifications behind a
// permission prompt; the first fire triggers the request. Foreground presentation is
// always on so the user sees a banner even without leaving the app.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
})

export async function notify(title: string, body?: string): Promise<void> {
  if (!requested) {
    requested = true
    if (Platform.OS === 'android') {
      // Android shows the permission prompt only once a channel exists.
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Print status',
        importance: Notifications.AndroidImportance.DEFAULT,
      })
    }
    const settings = await Notifications.getPermissionsAsync()
    if (settings.status !== 'granted') {
      const req = await Notifications.requestPermissionsAsync()
      if (req.status !== 'granted') return
    }
  }
  await Notifications.scheduleNotificationAsync({
    content: { title, body },
    trigger: null,
  })
}
