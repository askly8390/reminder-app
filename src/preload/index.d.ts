import { ElectronAPI } from '@electron-toolkit/preload'

type ReminderNotification = {
  id: number
  title: string
  date: string
  time: string
}

type ReminderRepeat = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly'

type StoredReminder = {
  id: number
  title: string
  date: string
  time: string
  completed?: boolean
  repeat?: ReminderRepeat
  repeatDay?: number
  repeatMonth?: number
  repeatWeekdays?: number[]
}

type ReminderLoadResult = {
  initialized: boolean
  recoveredFromBackup: boolean
  reminders: StoredReminder[]
}

type UpdateState =
  'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'up-to-date' | 'error'

type UpdateStatus = {
  state: UpdateState
  currentVersion: string
  availableVersion?: string
  percent?: number
  message?: string
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
      loadReminders: () => Promise<ReminderLoadResult>
      saveReminders: (reminders: StoredReminder[]) => Promise<void>
      getUpdateStatus: () => Promise<UpdateStatus>
      checkForUpdates: () => Promise<void>
      downloadUpdate: () => Promise<void>
      installUpdate: () => Promise<void>
      onUpdateStatus: (callback: (status: UpdateStatus) => void) => () => void
    }
  }
}
