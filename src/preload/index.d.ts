import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      showNotification: (reminderTitle: string) => void
      getAutoLaunch: () => Promise<boolean>
      setAutoLaunch: (enabled: boolean) => Promise<boolean>
    }
  }
}
