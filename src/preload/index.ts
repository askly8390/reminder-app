import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  showNotification: (reminderTitle: string): void => {
    ipcRenderer.send('show-notification', reminderTitle)
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
