import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

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

const api = {
  showReminder: (reminder: ReminderNotification): void => {
    ipcRenderer.send('show-reminder', reminder)
  },

  completeReminder: (reminderId: number): void => {
    ipcRenderer.send('complete-reminder', reminderId)
  },

  onReminderCompleted: (callback: (reminderId: number) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, reminderId: number): void => {
      callback(reminderId)
    }

    ipcRenderer.on('reminder-completed', listener)

    return () => {
      ipcRenderer.removeListener('reminder-completed', listener)
    }
  },

  getAutoLaunch: (): Promise<boolean> => {
    return ipcRenderer.invoke('get-auto-launch')
  },

  setAutoLaunch: (enabled: boolean): Promise<boolean> => {
    return ipcRenderer.invoke('set-auto-launch', enabled)
  },

  loadReminders: (): Promise<ReminderLoadResult> => {
    return ipcRenderer.invoke('load-reminders')
  },

  saveReminders: (reminders: StoredReminder[]): Promise<void> => {
    return ipcRenderer.invoke('save-reminders', reminders)
  },

  getUpdateStatus: (): Promise<UpdateStatus> => {
    return ipcRenderer.invoke('get-update-status')
  },

  checkForUpdates: (): Promise<void> => {
    return ipcRenderer.invoke('check-for-updates')
  },

  downloadUpdate: (): Promise<void> => {
    return ipcRenderer.invoke('download-update')
  },

  installUpdate: (): Promise<void> => {
    return ipcRenderer.invoke('install-update')
  },

  onUpdateStatus: (callback: (status: UpdateStatus) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, status: UpdateStatus): void => {
      callback(status)
    }

    ipcRenderer.on('update-status-changed', listener)

    return () => {
      ipcRenderer.removeListener('update-status-changed', listener)
    }
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
