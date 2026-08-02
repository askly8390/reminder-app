import { ElectronAPI } from '@electron-toolkit/preload'

type ReminderNotification = {
  id: number
  title: string
  date: string
  time: string
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      showReminder: (reminder: ReminderNotification) => void
      completeReminder: (reminderId: number) => void
      onReminderCompleted: (callback: (reminderId: number) => void) => () => void
      getAutoLaunch: () => Promise<boolean>
      setAutoLaunch: (enabled: boolean) => Promise<boolean>
    }
  }
}
