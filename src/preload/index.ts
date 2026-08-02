import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

type ReminderNotification = {
  id: number
  title: string
  date: string
  time: string
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
