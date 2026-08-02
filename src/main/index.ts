import { app, shell, BrowserWindow, ipcMain, Notification, Menu, Tray } from 'electron'
import { join } from 'path'
import { optimizer, is } from '@electron-toolkit/utils'
import icon from '../../build/icon.ico?asset'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
const shouldStartHidden = process.argv.includes('--hidden')
const AUTO_LAUNCH_ARGS = ['--hidden']
function getAutoLaunch(): boolean {
  if (process.platform !== 'win32' || !app.isPackaged) {
    return false
  }

  return app.getLoginItemSettings({
    path: process.execPath,
    args: AUTO_LAUNCH_ARGS
  }).openAtLogin
}

function setAutoLaunch(enabled: boolean): boolean {
  if (process.platform !== 'win32' || !app.isPackaged) {
    return false
  }

  // Удаляем запись с отдельным именем,
  // которую создали во время предыдущих попыток
  app.setLoginItemSettings({
    openAtLogin: false,
    path: process.execPath,
    args: AUTO_LAUNCH_ARGS,
    name: 'reminder-app'
  })

  // Создаём или удаляем единственную основную запись
  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: process.execPath,
    args: AUTO_LAUNCH_ARGS
  })

  return getAutoLaunch()
}

function showMainWindow(): void {
  if (!mainWindow) {
    createWindow()
    return
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }

  mainWindow.show()
  mainWindow.focus()
}

function createTray(): void {
  if (tray) {
    return
  }

  tray = new Tray(icon)
  tray.setToolTip('Напоминания')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Открыть',
      click: showMainWindow
    },
    {
      type: 'separator'
    },
    {
      label: 'Выйти',
      click: () => {
        isQuitting = true
        app.quit()
      }
    }
  ])

  tray.setContextMenu(contextMenu)
  tray.on('click', showMainWindow)
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    minWidth: 420,
    minHeight: 560,
    show: false
    // остальное без изменений
  })

  mainWindow.on('ready-to-show', () => {
    if (!shouldStartHidden) {
      mainWindow?.show()
    }
  })

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

ipcMain.handle('get-auto-launch', () => {
  return getAutoLaunch()
})

ipcMain.handle('set-auto-launch', (_event, enabled: boolean) => {
  return setAutoLaunch(enabled)
})

ipcMain.on('show-notification', (_event, reminderTitle: string) => {
  if (!Notification.isSupported()) {
    return
  }

  new Notification({
    title: 'Напоминание',
    body: reminderTitle,
    icon
  }).show()
})

app.whenReady().then(() => {
  app.setAppUserModelId(process.execPath)
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.on('ping', () => console.log('pong'))

  createWindow()
  createTray()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    } else {
      showMainWindow()
    }
  })
})

app.on('before-quit', () => {
  isQuitting = true
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
