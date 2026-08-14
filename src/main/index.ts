import { app, shell, BrowserWindow, ipcMain, Menu, Notification, Tray, screen } from 'electron'
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'path'
import { optimizer, is } from '@electron-toolkit/utils'
import { autoUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater'
import icon from '../../build/icon.ico?asset'

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

type ReminderStore = {
  schemaVersion: 1
  updatedAt: string
  reminders: StoredReminder[]
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
const REMINDER_STORE_SCHEMA_VERSION = 1
const REMINDER_STORE_FILE_NAME = 'reminders.json'
const MAX_REMINDER_BACKUPS = 10
const UPDATE_CHECK_DELAY_MS = 15_000
const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000
const VALID_REPEAT_VALUES = new Set<ReminderRepeat>([
  'none',
  'daily',
  'weekly',
  'monthly',
  'yearly'
])

let reminderWriteQueue: Promise<void> = Promise.resolve()
let updateCheckInterval: ReturnType<typeof setInterval> | null = null
let updateNotificationVersion: string | null = null
let updateStatus: UpdateStatus = {
  state: 'idle',
  currentVersion: app.getVersion()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeOptionalInteger(value: unknown): number | undefined {
  return Number.isInteger(value) ? (value as number) : undefined
}

function normalizeReminder(value: unknown): StoredReminder {
  if (
    !isRecord(value) ||
    !Number.isSafeInteger(value.id) ||
    typeof value.title !== 'string' ||
    typeof value.date !== 'string' ||
    typeof value.time !== 'string'
  ) {
    throw new Error('Файл напоминаний содержит некорректную запись')
  }

  const repeat =
    typeof value.repeat === 'string' && VALID_REPEAT_VALUES.has(value.repeat as ReminderRepeat)
      ? (value.repeat as ReminderRepeat)
      : undefined

  const repeatWeekdays = Array.isArray(value.repeatWeekdays)
    ? [
        ...new Set(
          value.repeatWeekdays.filter(
            (day): day is number => Number.isInteger(day) && day >= 0 && day <= 6
          )
        )
      ]
    : undefined

  return {
    id: value.id as number,
    title: value.title,
    date: value.date,
    time: value.time,
    completed: typeof value.completed === 'boolean' ? value.completed : undefined,
    repeat,
    repeatDay: normalizeOptionalInteger(value.repeatDay),
    repeatMonth: normalizeOptionalInteger(value.repeatMonth),
    repeatWeekdays
  }
}

function normalizeReminders(value: unknown): StoredReminder[] {
  if (!Array.isArray(value)) {
    throw new Error('Файл напоминаний имеет неизвестный формат')
  }

  return value.map(normalizeReminder)
}

function parseReminderStore(fileContents: string): StoredReminder[] {
  const parsedData: unknown = JSON.parse(fileContents)

  // Поддерживаем и объект текущей версии, и массив на случай ранних тестовых сборок.
  if (Array.isArray(parsedData)) {
    return normalizeReminders(parsedData)
  }

  if (!isRecord(parsedData) || parsedData.schemaVersion !== REMINDER_STORE_SCHEMA_VERSION) {
    throw new Error('Версия файла напоминаний не поддерживается')
  }

  return normalizeReminders(parsedData.reminders)
}

function getReminderDataDirectory(): string {
  return join(app.getPath('userData'), 'data')
}

function getReminderStorePath(): string {
  return join(getReminderDataDirectory(), REMINDER_STORE_FILE_NAME)
}

function getReminderBackupDirectory(): string {
  return join(getReminderDataDirectory(), 'backups')
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function getBackupFileNames(): Promise<string[]> {
  const backupDirectory = getReminderBackupDirectory()

  if (!(await pathExists(backupDirectory))) {
    return []
  }

  return (await readdir(backupDirectory))
    .filter((fileName) => fileName.startsWith('reminders-') && fileName.endsWith('.json'))
    .sort()
    .reverse()
}

async function pruneReminderBackups(): Promise<void> {
  const backupDirectory = getReminderBackupDirectory()
  const backupFileNames = await getBackupFileNames()
  const expiredBackups = backupFileNames.slice(MAX_REMINDER_BACKUPS)

  await Promise.all(
    expiredBackups.map((fileName) => rm(join(backupDirectory, fileName), { force: true }))
  )
}

async function backupCurrentReminderStore(): Promise<void> {
  const storePath = getReminderStorePath()

  if (!(await pathExists(storePath))) {
    return
  }

  const backupDirectory = getReminderBackupDirectory()
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = join(backupDirectory, `reminders-${timestamp}.json`)

  await mkdir(backupDirectory, { recursive: true })
  await copyFile(storePath, backupPath)
  await pruneReminderBackups()
}

async function writeReminderStore(reminders: StoredReminder[], createBackup = true): Promise<void> {
  const dataDirectory = getReminderDataDirectory()
  const storePath = getReminderStorePath()
  const temporaryPath = `${storePath}.${process.pid}.${Date.now()}.tmp`
  const store: ReminderStore = {
    schemaVersion: REMINDER_STORE_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    reminders
  }

  await mkdir(dataDirectory, { recursive: true })

  if (createBackup) {
    await backupCurrentReminderStore()
  }

  try {
    await writeFile(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600
    })

    await rm(storePath, { force: true })
    await rename(temporaryPath, storePath)
  } catch (error) {
    await rm(temporaryPath, { force: true })
    throw error
  }
}

async function loadReminderStore(): Promise<ReminderLoadResult> {
  const storePath = getReminderStorePath()

  if (!(await pathExists(storePath))) {
    return {
      initialized: false,
      recoveredFromBackup: false,
      reminders: []
    }
  }

  try {
    return {
      initialized: true,
      recoveredFromBackup: false,
      reminders: parseReminderStore(await readFile(storePath, 'utf8'))
    }
  } catch (storeError) {
    const backupDirectory = getReminderBackupDirectory()
    const backupFileNames = await getBackupFileNames()

    for (const backupFileName of backupFileNames) {
      try {
        const reminders = parseReminderStore(
          await readFile(join(backupDirectory, backupFileName), 'utf8')
        )

        await writeReminderStore(reminders, false)

        return {
          initialized: true,
          recoveredFromBackup: true,
          reminders
        }
      } catch {
        // Пробуем следующую резервную копию.
      }
    }

    throw storeError
  }
}

function saveReminderStore(value: unknown): Promise<void> {
  const reminders = normalizeReminders(value)

  reminderWriteQueue = reminderWriteQueue
    .catch(() => undefined)
    .then(() => writeReminderStore(reminders))

  return reminderWriteQueue
}

function assertMainWindowSender(senderId: number): void {
  if (!mainWindow || mainWindow.webContents.id !== senderId) {
    throw new Error('Операция доступна только из основного окна')
  }
}

function setUpdateStatus(status: Omit<UpdateStatus, 'currentVersion'>): void {
  updateStatus = {
    currentVersion: app.getVersion(),
    ...status
  }

  mainWindow?.webContents.send('update-status-changed', updateStatus)
}

function getUpdateErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function showUpdateNotification(info: UpdateInfo): void {
  if (!Notification.isSupported() || updateNotificationVersion === info.version) {
    return
  }

  updateNotificationVersion = info.version

  const notification = new Notification({
    title: 'Доступно обновление',
    body: `Версия ${info.version} готова к загрузке`,
    icon
  })

  notification.on('click', showMainWindow)
  notification.show()
}

async function checkForUpdates(): Promise<void> {
  if (!app.isPackaged) {
    setUpdateStatus({
      state: 'idle',
      message: 'Проверка обновлений работает в установленной версии приложения'
    })
    return
  }

  if (updateStatus.state === 'checking' || updateStatus.state === 'downloading') {
    return
  }

  setUpdateStatus({ state: 'checking' })

  try {
    await autoUpdater.checkForUpdates()
  } catch (error) {
    setUpdateStatus({
      state: 'error',
      message: getUpdateErrorMessage(error)
    })
  }
}

async function downloadUpdate(): Promise<void> {
  if (!app.isPackaged || updateStatus.state !== 'available') {
    return
  }

  setUpdateStatus({
    state: 'downloading',
    availableVersion: updateStatus.availableVersion,
    percent: 0
  })

  try {
    await autoUpdater.downloadUpdate()
  } catch (error) {
    setUpdateStatus({
      state: 'error',
      availableVersion: updateStatus.availableVersion,
      message: getUpdateErrorMessage(error)
    })
  }
}

function installDownloadedUpdate(): void {
  if (!app.isPackaged || updateStatus.state !== 'downloaded') {
    return
  }

  isQuitting = true
  autoUpdater.quitAndInstall(false, true)
}

function setupAutoUpdater(): void {
  if (!app.isPackaged) {
    return
  }

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.autoRunAppAfterInstall = true

  autoUpdater.on('checking-for-update', () => {
    setUpdateStatus({ state: 'checking' })
  })

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    setUpdateStatus({
      state: 'available',
      availableVersion: info.version
    })
    showUpdateNotification(info)
  })

  autoUpdater.on('update-not-available', () => {
    setUpdateStatus({ state: 'up-to-date' })
  })

  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    setUpdateStatus({
      state: 'downloading',
      availableVersion: updateStatus.availableVersion,
      percent: Math.max(0, Math.min(100, progress.percent))
    })
  })

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    setUpdateStatus({
      state: 'downloaded',
      availableVersion: info.version,
      percent: 100
    })
    showMainWindow()
  })

  autoUpdater.on('error', (error: Error) => {
    console.error('Update error:', error)
    setUpdateStatus({
      state: 'error',
      availableVersion: updateStatus.availableVersion,
      message: error.message
    })
  })

  const firstUpdateCheck = setTimeout(() => {
    void checkForUpdates()
  }, UPDATE_CHECK_DELAY_MS)

  firstUpdateCheck.unref()

  updateCheckInterval = setInterval(() => {
    void checkForUpdates()
  }, UPDATE_CHECK_INTERVAL_MS)

  updateCheckInterval.unref()
}

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
    width: 1180,
    height: 800,
    minWidth: 760,
    minHeight: 650,
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

ipcMain.handle('load-reminders', (event) => {
  assertMainWindowSender(event.sender.id)
  return loadReminderStore()
})

ipcMain.handle('save-reminders', (event, reminders: unknown) => {
  assertMainWindowSender(event.sender.id)
  return saveReminderStore(reminders)
})

ipcMain.handle('get-update-status', (event) => {
  assertMainWindowSender(event.sender.id)
  return updateStatus
})

ipcMain.handle('check-for-updates', (event) => {
  assertMainWindowSender(event.sender.id)
  return checkForUpdates()
})

ipcMain.handle('download-update', (event) => {
  assertMainWindowSender(event.sender.id)
  return downloadUpdate()
})

ipcMain.handle('install-update', (event) => {
  assertMainWindowSender(event.sender.id)
  installDownloadedUpdate()
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

const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    showMainWindow()
  })

  app.whenReady().then(() => {
    app.setAppUserModelId(process.execPath)

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    ipcMain.on('ping', () => console.log('pong'))

    createWindow()
    createTray()
    setupAutoUpdater()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
      } else {
        showMainWindow()
      }
    })
  })
}

app.on('before-quit', () => {
  isQuitting = true

  if (updateCheckInterval) {
    clearInterval(updateCheckInterval)
    updateCheckInterval = null
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
