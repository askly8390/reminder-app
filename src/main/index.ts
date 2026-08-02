import { app, shell, BrowserWindow, ipcMain, Menu, Tray, screen } from 'electron'
import { join } from 'path'
import { optimizer, is } from '@electron-toolkit/utils'
import icon from '../../build/icon.ico?asset'

type ReminderNotification = {
  id: number
  title: string
  date: string
  time: string
}

let mainWindow: BrowserWindow | null = null
let notificationWindow: BrowserWindow | null = null
let currentNotification: ReminderNotification | null = null
let tray: Tray | null = null
let isQuitting = false

const notificationQueue: ReminderNotification[] = []
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

  app.setLoginItemSettings({
    openAtLogin: false,
    path: process.execPath,
    args: AUTO_LAUNCH_ARGS,
    name: 'reminder-app'
  })

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
    show: false,
    autoHideMenuBar: true,
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
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
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function enqueueNotification(reminder: ReminderNotification): void {
  const isAlreadyActive = currentNotification?.id === reminder.id
  const isAlreadyQueued = notificationQueue.some(
    (queuedReminder) => queuedReminder.id === reminder.id
  )

  if (isAlreadyActive || isAlreadyQueued) {
    return
  }

  notificationQueue.push(reminder)
  showNextNotification()
}

function showNextNotification(): void {
  if (isQuitting || notificationWindow || notificationQueue.length === 0) {
    return
  }

  const reminder = notificationQueue.shift()

  if (!reminder) {
    return
  }

  currentNotification = reminder

  const windowWidth = 380
  const windowHeight = 210
  const windowMargin = 16
  const { workArea } = screen.getPrimaryDisplay()

  const popupWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x: workArea.x + workArea.width - windowWidth - windowMargin,
    y: workArea.y + workArea.height - windowHeight - windowMargin,
    show: false,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  notificationWindow = popupWindow

  popupWindow.on('ready-to-show', () => {
    popupWindow.showInactive()
  })

  popupWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
    }
  })

  popupWindow.on('closed', () => {
    if (notificationWindow === popupWindow) {
      notificationWindow = null
      currentNotification = null
    }

    showNextNotification()
  })

  const query = {
    mode: 'notification',
    id: String(reminder.id),
    title: reminder.title,
    date: reminder.date,
    time: reminder.time
  }

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    const notificationUrl = new URL(process.env['ELECTRON_RENDERER_URL'])

    Object.entries(query).forEach(([key, value]) => {
      notificationUrl.searchParams.set(key, value)
    })

    void popupWindow.loadURL(notificationUrl.toString())
  } else {
    void popupWindow.loadFile(join(__dirname, '../renderer/index.html'), {
      query
    })
  }
}

ipcMain.handle('get-auto-launch', () => {
  return getAutoLaunch()
})

ipcMain.handle('set-auto-launch', (_event, enabled: boolean) => {
  return setAutoLaunch(enabled)
})

ipcMain.on('show-reminder', (_event, reminder: ReminderNotification) => {
  enqueueNotification(reminder)
})

ipcMain.on('complete-reminder', (event, reminderId: number) => {
  if (
    !notificationWindow ||
    event.sender !== notificationWindow.webContents ||
    currentNotification?.id !== reminderId
  ) {
    return
  }

  mainWindow?.webContents.send('reminder-completed', reminderId)

  // destroy() закрывает окно программно, обходя запрет ручного закрытия.
  notificationWindow.destroy()
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
