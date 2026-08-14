<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { buildCalendarDays, type CalendarDay } from './calendar'

type ReminderRepeat = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly'

type Reminder = {
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

type ReminderFilter = 'all' | 'active' | 'completed'

type AppView = 'list' | 'calendar'

type UpdateState =
  'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'up-to-date' | 'error'

type UpdateStatus = {
  state: UpdateState
  currentVersion: string
  availableVersion?: string
  percent?: number
  message?: string
}

const repeatLabels: Record<ReminderRepeat, string> = {
  none: 'Не повторять',
  daily: 'Ежедневно',
  weekly: 'По дням недели',
  monthly: 'Ежемесячно',
  yearly: 'Ежегодно'
}

const weekDays = [
  { value: 1, label: 'Пн', title: 'Понедельник' },
  { value: 2, label: 'Вт', title: 'Вторник' },
  { value: 3, label: 'Ср', title: 'Среда' },
  { value: 4, label: 'Чт', title: 'Четверг' },
  { value: 5, label: 'Пт', title: 'Пятница' },
  { value: 6, label: 'Сб', title: 'Суббота' },
  { value: 0, label: 'Вс', title: 'Воскресенье' }
] as const

const calendarWeekDays = weekDays.map((day) => day.label)
const COLLAPSED_REMINDER_COUNT = 5
const CALENDAR_VISIBLE_OCCURRENCE_COUNT = 3

const getReminderRepeat = (reminder: Reminder): ReminderRepeat => {
  return reminder.repeat ?? 'none'
}

const getReminderWeekdays = (reminder: Reminder): number[] => {
  const savedWeekdays = reminder.repeatWeekdays?.filter(
    (day) => Number.isInteger(day) && day >= 0 && day <= 6
  )

  if (savedWeekdays?.length) {
    return [...new Set(savedWeekdays)]
  }

  const reminderDate = new Date(`${reminder.date}T00:00:00`)

  if (Number.isNaN(reminderDate.getTime())) {
    return []
  }

  return [reminderDate.getDay()]
}

const getReminderRepeatLabel = (reminder: Reminder): string => {
  const repeat = getReminderRepeat(reminder)

  if (repeat !== 'weekly') {
    return repeatLabels[repeat]
  }

  const selectedWeekdays = getReminderWeekdays(reminder)

  const labels = weekDays
    .filter((day) => selectedWeekdays.includes(day.value))
    .map((day) => day.label.toLowerCase())

  return labels.length ? `По дням недели: ${labels.join(', ')}` : repeatLabels.weekly
}

const formatDateForInput = (date: Date): string => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

const getDaysInMonth = (year: number, month: number): number => {
  return new Date(year, month + 1, 0).getDate()
}

const addRepeatInterval = (
  date: Date,
  repeat: Exclude<ReminderRepeat, 'none'>,
  repeatDay: number,
  repeatMonth: number,
  repeatWeekdays: number[]
): Date => {
  const nextDate = new Date(date)

  if (repeat === 'daily') {
    nextDate.setDate(nextDate.getDate() + 1)
    return nextDate
  }

  if (repeat === 'weekly') {
    const activeWeekdays = repeatWeekdays.length ? repeatWeekdays : [nextDate.getDay()]

    for (let offset = 1; offset <= 7; offset += 1) {
      const candidate = new Date(nextDate)

      candidate.setDate(candidate.getDate() + offset)

      if (activeWeekdays.includes(candidate.getDay())) {
        return candidate
      }
    }

    nextDate.setDate(nextDate.getDate() + 7)
    return nextDate
  }

  if (repeat === 'monthly') {
    const nextMonth = new Date(
      nextDate.getFullYear(),
      nextDate.getMonth() + 1,
      1,
      nextDate.getHours(),
      nextDate.getMinutes()
    )

    nextMonth.setDate(
      Math.min(repeatDay, getDaysInMonth(nextMonth.getFullYear(), nextMonth.getMonth()))
    )

    return nextMonth
  }

  let nextYear = nextDate.getFullYear() + 1

  while (getDaysInMonth(nextYear, repeatMonth) < repeatDay) {
    nextYear += 1
  }

  return new Date(nextYear, repeatMonth, repeatDay, nextDate.getHours(), nextDate.getMinutes())
}

const completeReminder = (reminder: Reminder): void => {
  const repeat = getReminderRepeat(reminder)

  if (repeat === 'none') {
    reminder.completed = true
    return
  }

  let nextDate = new Date(`${reminder.date}T${reminder.time}`)

  if (Number.isNaN(nextDate.getTime())) {
    reminder.completed = true
    return
  }

  const repeatDay = reminder.repeatDay ?? nextDate.getDate()

  const repeatMonth = reminder.repeatMonth ?? nextDate.getMonth()

  const repeatWeekdays = repeat === 'weekly' ? getReminderWeekdays(reminder) : []

  let iterations = 0

  do {
    nextDate = addRepeatInterval(nextDate, repeat, repeatDay, repeatMonth, repeatWeekdays)

    iterations += 1
  } while (nextDate.getTime() <= Date.now() && iterations < 10000)

  reminder.date = formatDateForInput(nextDate)
  reminder.completed = false
}

const searchParams = new URLSearchParams(window.location.search)

const isNotificationMode = searchParams.get('mode') === 'notification'

const notificationReminder = {
  id: Number(searchParams.get('id')),
  title: searchParams.get('title') ?? 'Без названия',
  date: searchParams.get('date') ?? '',
  time: searchParams.get('time') ?? ''
}

const notificationDateTime = computed(() => {
  const reminderDate = new Date(`${notificationReminder.date}T${notificationReminder.time}`)

  if (Number.isNaN(reminderDate.getTime())) {
    return `${notificationReminder.date} ` + `в ${notificationReminder.time}`
  }

  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(reminderDate)
})

const completeNotificationReminder = (event: Event): void => {
  const checkbox = event.currentTarget as HTMLInputElement

  if (!checkbox.checked || notificationReminder.id <= 0) {
    return
  }

  window.api.completeReminder(notificationReminder.id)
}

const loadLegacyReminders = (): Reminder[] => {
  const savedReminders = localStorage.getItem('reminders')

  if (!savedReminders) {
    return []
  }

  try {
    const parsedReminders: unknown = JSON.parse(savedReminders)

    return Array.isArray(parsedReminders) ? (parsedReminders as Reminder[]) : []
  } catch {
    return []
  }
}

const mergeReminderStores = (
  storedReminders: Reminder[],
  legacyReminders: Reminder[]
): { reminders: Reminder[]; restoredCount: number } => {
  const reminders = [...storedReminders]
  const knownReminderIds = new Set(storedReminders.map((reminder) => reminder.id))

  for (const legacyReminder of legacyReminders) {
    if (knownReminderIds.has(legacyReminder.id)) {
      continue
    }

    reminders.push(legacyReminder)
    knownReminderIds.add(legacyReminder.id)
  }

  return {
    reminders,
    restoredCount: reminders.length - storedReminders.length
  }
}

const isFormOpen = ref(false)
const reminderTitleInput = ref<HTMLInputElement | null>(null)
const reminderTitle = ref('')
const reminderDate = ref('')
const reminderTime = ref('')
const reminderRepeat = ref<ReminderRepeat>('none')

const reminderWeekdays = ref<number[]>([])

const editingOriginalDate = ref('')
const editingOriginalRepeat = ref<ReminderRepeat>('none')

const editingReminderId = ref<number | null>(null)

const reminders = ref<Reminder[]>([])
const isReminderStorageLoading = ref(true)
const isReminderStorageReady = ref(false)
const reminderStorageError = ref('')
const reminderStorageNotice = ref('')

const reminderFilter = ref<ReminderFilter>('all')
const reminderSearchQuery = ref('')
const activeView = ref<AppView>('list')
const isReminderListExpanded = ref(false)
const calendarMonth = ref(new Date(new Date().getFullYear(), new Date().getMonth(), 1))
const isAutoLaunchEnabled = ref(false)
const isAutoLaunchLoading = ref(true)
const autoLaunchError = ref('')
const updateStatus = ref<UpdateStatus>({
  state: 'idle',
  currentVersion: '1.3.0'
})
const updateActionError = ref('')

const updateStatusText = computed(() => {
  const status = updateStatus.value

  if (status.state === 'checking') {
    return 'Проверяем наличие новой версии...'
  }

  if (status.state === 'available') {
    return `Доступна версия ${status.availableVersion ?? ''}`.trim()
  }

  if (status.state === 'downloading') {
    return `Загрузка обновления: ${Math.round(status.percent ?? 0)}%`
  }

  if (status.state === 'downloaded') {
    return `Версия ${status.availableVersion ?? ''} готова к установке`.trim()
  }

  if (status.state === 'up-to-date') {
    return 'Установлена последняя версия'
  }

  if (status.state === 'error') {
    return 'Не удалось проверить обновления'
  }

  if (status.message) {
    return status.message
  }

  return 'Обновления проверяются автоматически'
})

const filteredReminders = computed(() => {
  const searchQuery = reminderSearchQuery.value.trim().toLowerCase()

  return [...reminders.value]
    .filter((reminder) => {
      const matchesFilter =
        reminderFilter.value === 'all' ||
        (reminderFilter.value === 'active' && !reminder.completed) ||
        (reminderFilter.value === 'completed' && reminder.completed)

      const matchesSearch = reminder.title.toLowerCase().includes(searchQuery)

      return matchesFilter && matchesSearch
    })
    .sort((firstReminder, secondReminder) => {
      if (firstReminder.completed !== secondReminder.completed) {
        return firstReminder.completed ? 1 : -1
      }

      const firstDateTime = new Date(`${firstReminder.date}T${firstReminder.time}`).getTime()

      const secondDateTime = new Date(`${secondReminder.date}T${secondReminder.time}`).getTime()

      return firstDateTime - secondDateTime
    })
})

const visibleReminders = computed(() => {
  if (isReminderListExpanded.value) {
    return filteredReminders.value
  }

  return filteredReminders.value.slice(0, COLLAPSED_REMINDER_COUNT)
})

const hiddenReminderCount = computed(() => {
  return Math.max(0, filteredReminders.value.length - visibleReminders.value.length)
})

const calendarMonthLabel = computed(() => {
  const monthName = new Intl.DateTimeFormat('ru-RU', { month: 'long' }).format(calendarMonth.value)
  const capitalizedMonthName = monthName.charAt(0).toUpperCase() + monthName.slice(1)

  return `${capitalizedMonthName}, ${calendarMonth.value.getFullYear()}`
})

const calendarDays = computed<CalendarDay<Reminder>[]>(() => {
  return buildCalendarDays(calendarMonth.value, reminders.value, CALENDAR_VISIBLE_OCCURRENCE_COUNT)
})

watch([reminderFilter, reminderSearchQuery], () => {
  isReminderListExpanded.value = false
})

watch(
  reminders,
  (newReminders): void => {
    if (!isReminderStorageReady.value) {
      return
    }

    const remindersSnapshot = newReminders.map((reminder) => ({
      ...reminder,
      repeatWeekdays: reminder.repeatWeekdays ? [...reminder.repeatWeekdays] : undefined
    }))

    void window.api
      .saveReminders(remindersSnapshot)
      .then(() => {
        reminderStorageError.value = ''
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)

        reminderStorageError.value = `Не удалось сохранить напоминания: ${message}`
      })
  },
  { deep: true }
)

const loadReminderStorage = async (): Promise<void> => {
  const legacyReminders = loadLegacyReminders()

  try {
    const storedData = await window.api.loadReminders()

    if (storedData.initialized) {
      const mergedStore = mergeReminderStores(storedData.reminders, legacyReminders)

      reminders.value = mergedStore.reminders

      if (legacyReminders.length > 0) {
        await window.api.saveReminders(mergedStore.reminders)
        localStorage.removeItem('reminders')
      }

      if (storedData.recoveredFromBackup) {
        reminderStorageNotice.value = 'Данные восстановлены из резервной копии'
      }

      if (mergedStore.restoredCount > 0) {
        const recoveryNotice = `Восстановлено напоминаний из версии 1.1.0: ${mergedStore.restoredCount}`

        reminderStorageNotice.value = reminderStorageNotice.value
          ? `${reminderStorageNotice.value}. ${recoveryNotice}`
          : recoveryNotice
      }
    } else {
      reminders.value = legacyReminders
      await window.api.saveReminders(legacyReminders)
      localStorage.removeItem('reminders')

      if (legacyReminders.length > 0) {
        reminderStorageNotice.value = 'Существующие напоминания перенесены в новое хранилище'
      }
    }

    await nextTick()
    isReminderStorageReady.value = true
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    reminders.value = legacyReminders
    reminderStorageError.value =
      `Не удалось открыть хранилище напоминаний: ${message}. ` +
      'Добавление и изменение временно отключены.'
  } finally {
    isReminderStorageLoading.value = false
  }
}

const focusReminderTitle = async (): Promise<void> => {
  await nextTick()
  reminderTitleInput.value?.focus()
}

const openNewReminderForm = (): void => {
  closeForm()
  isFormOpen.value = true
  void focusReminderTitle()
}

const openNewReminderFromCalendar = (): void => {
  activeView.value = 'list'
  openNewReminderForm()
}

const toggleReminderList = (): void => {
  isReminderListExpanded.value = !isReminderListExpanded.value
}

const changeCalendarMonth = (offset: number): void => {
  calendarMonth.value = new Date(
    calendarMonth.value.getFullYear(),
    calendarMonth.value.getMonth() + offset,
    1
  )
}

const showCurrentMonth = (): void => {
  const today = new Date()

  calendarMonth.value = new Date(today.getFullYear(), today.getMonth(), 1)
}

const closeForm = (): void => {
  editingReminderId.value = null
  reminderTitle.value = ''
  reminderDate.value = ''
  reminderTime.value = ''
  reminderRepeat.value = 'none'
  reminderWeekdays.value = []
  editingOriginalDate.value = ''
  editingOriginalRepeat.value = 'none'
  isFormOpen.value = false
}

const saveReminder = (): void => {
  if (!reminderTitle.value || !reminderDate.value || !reminderTime.value) {
    return
  }

  const reminderDateTime = new Date(`${reminderDate.value}T${reminderTime.value}`)

  const reminderTimestamp = reminderDateTime.getTime()

  if (Number.isNaN(reminderTimestamp) || reminderTimestamp <= Date.now()) {
    window.alert('Выберите будущие дату и время')

    return
  }

  if (reminderRepeat.value === 'weekly') {
    if (reminderWeekdays.value.length === 0) {
      window.alert('Выберите хотя бы один день недели')

      return
    }

    if (!reminderWeekdays.value.includes(reminderDateTime.getDay())) {
      window.alert('Дата первого напоминания должна приходиться на один из выбранных дней недели')

      return
    }
  }

  if (editingReminderId.value !== null) {
    const reminder = reminders.value.find((item) => item.id === editingReminderId.value)

    if (reminder) {
      const shouldKeepRepeatAnchor =
        reminderDate.value === editingOriginalDate.value &&
        reminderRepeat.value === editingOriginalRepeat.value

      reminder.title = reminderTitle.value
      reminder.date = reminderDate.value
      reminder.time = reminderTime.value
      reminder.repeat = reminderRepeat.value
      reminder.repeatWeekdays =
        reminderRepeat.value === 'weekly' ? [...reminderWeekdays.value] : undefined

      if (!shouldKeepRepeatAnchor) {
        reminder.repeatDay = reminderDateTime.getDate()

        reminder.repeatMonth = reminderDateTime.getMonth()
      } else {
        reminder.repeatDay ??= reminderDateTime.getDate()

        reminder.repeatMonth ??= reminderDateTime.getMonth()
      }

      if (reminderRepeat.value !== 'none') {
        reminder.completed = false
      }
    }
  } else {
    reminders.value.push({
      id: Date.now(),
      title: reminderTitle.value,
      date: reminderDate.value,
      time: reminderTime.value,
      completed: false,
      repeat: reminderRepeat.value,
      repeatDay: reminderDateTime.getDate(),
      repeatMonth: reminderDateTime.getMonth(),
      repeatWeekdays: reminderRepeat.value === 'weekly' ? [...reminderWeekdays.value] : undefined
    })
  }

  closeForm()
}

const deleteReminder = (id: number): void => {
  const shouldDelete = window.confirm('Удалить это напоминание?')

  if (!shouldDelete) {
    return
  }

  reminders.value = reminders.value.filter((reminder) => reminder.id !== id)
}

const toggleReminderCompleted = (reminder: Reminder): void => {
  if (reminder.completed) {
    reminder.completed = false
    return
  }

  completeReminder(reminder)
}

const editReminder = (reminder: Reminder): void => {
  editingReminderId.value = reminder.id
  reminderTitle.value = reminder.title
  reminderDate.value = reminder.date
  reminderTime.value = reminder.time

  reminderRepeat.value = getReminderRepeat(reminder)

  editingOriginalDate.value = reminder.date

  editingOriginalRepeat.value = getReminderRepeat(reminder)

  reminderWeekdays.value =
    getReminderRepeat(reminder) === 'weekly' ? getReminderWeekdays(reminder) : []
  isFormOpen.value = true
  void focusReminderTitle()
}

const editReminderFromCalendar = (reminder: Reminder): void => {
  activeView.value = 'list'
  editReminder(reminder)
}

const checkReminders = (): void => {
  if (!isReminderStorageReady.value || isFormOpen.value) {
    return
  }

  const currentTime = Date.now()

  reminders.value.forEach((reminder) => {
    if (reminder.completed) {
      return
    }

    const reminderTime = new Date(`${reminder.date}T${reminder.time}`).getTime()

    if (!Number.isNaN(reminderTime) && currentTime >= reminderTime) {
      window.api.showReminder({
        id: reminder.id,
        title: reminder.title,
        date: reminder.date,
        time: reminder.time
      })
    }
  })
}

const loadAutoLaunch = async (): Promise<void> => {
  try {
    isAutoLaunchEnabled.value = await window.api.getAutoLaunch()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    autoLaunchError.value = 'Не удалось изменить настройку ' + `автозапуска: ${message}`
  } finally {
    isAutoLaunchLoading.value = false
  }
}

const toggleAutoLaunch = async (): Promise<void> => {
  const nextValue = !isAutoLaunchEnabled.value

  isAutoLaunchLoading.value = true
  autoLaunchError.value = ''

  try {
    isAutoLaunchEnabled.value = await window.api.setAutoLaunch(nextValue)
  } catch {
    autoLaunchError.value = 'Не удалось изменить настройку автозапуска'
  } finally {
    isAutoLaunchLoading.value = false
  }
}

const loadUpdateStatus = async (): Promise<void> => {
  try {
    updateStatus.value = await window.api.getUpdateStatus()
  } catch (error) {
    updateActionError.value = error instanceof Error ? error.message : String(error)
  }
}

const checkForUpdates = async (): Promise<void> => {
  updateActionError.value = ''

  try {
    await window.api.checkForUpdates()
  } catch (error) {
    updateActionError.value = error instanceof Error ? error.message : String(error)
  }
}

const downloadUpdate = async (): Promise<void> => {
  updateActionError.value = ''

  try {
    await window.api.downloadUpdate()
  } catch (error) {
    updateActionError.value = error instanceof Error ? error.message : String(error)
  }
}

const installUpdate = async (): Promise<void> => {
  updateActionError.value = ''

  try {
    await window.api.installUpdate()
  } catch (error) {
    updateActionError.value = error instanceof Error ? error.message : String(error)
  }
}

let reminderCheckInterval: ReturnType<typeof setInterval> | null = null

let removeReminderCompletedListener: (() => void) | null = null
let removeUpdateStatusListener: (() => void) | null = null

onMounted(() => {
  if (isNotificationMode) {
    return
  }

  removeReminderCompletedListener = window.api.onReminderCompleted((reminderId) => {
    const reminder = reminders.value.find((item) => item.id === reminderId)

    if (reminder) {
      completeReminder(reminder)
    }
  })

  removeUpdateStatusListener = window.api.onUpdateStatus((status) => {
    updateStatus.value = status
    updateActionError.value = ''
  })

  void loadReminderStorage().then(() => {
    checkReminders()
  })

  reminderCheckInterval = setInterval(checkReminders, 1000)

  void loadAutoLaunch()
  void loadUpdateStatus()
})

onUnmounted(() => {
  if (reminderCheckInterval) {
    clearInterval(reminderCheckInterval)

    reminderCheckInterval = null
  }

  removeReminderCompletedListener?.()
  removeReminderCompletedListener = null

  removeUpdateStatusListener?.()
  removeUpdateStatusListener = null
})
</script>

<template>
  <main v-if="isNotificationMode" class="notification-page">
    <section class="notification-popup" role="alertdialog" aria-labelledby="notification-title">
      <div class="notification-heading">
        <div class="notification-icon">!</div>

        <div class="notification-content">
          <p class="notification-label">Напоминание</p>

          <h1 id="notification-title" class="notification-title">
            {{ notificationReminder.title }}
          </h1>
        </div>
      </div>

      <p class="notification-datetime">
        {{ notificationDateTime }}
      </p>

      <label class="notification-checkbox">
        <input type="checkbox" @change="completeNotificationReminder" />

        <span>Выполнено</span>
      </label>
    </section>
  </main>

  <main
    v-else
    :class="[
      'app',
      {
        'app--calendar': activeView === 'calendar'
      }
    ]"
  >
    <section
      :class="[
        'welcome-card',
        {
          'welcome-card--calendar': activeView === 'calendar'
        }
      ]"
    >
      <header class="app-heading">
        <p class="label">REMINDER APP</p>

        <h1>Напоминания</h1>
      </header>

      <nav class="view-switcher" aria-label="Режим отображения">
        <button
          type="button"
          :class="{
            active: activeView === 'list'
          }"
          :aria-pressed="activeView === 'list'"
          @click="activeView = 'list'"
        >
          Список
        </button>

        <button
          type="button"
          :class="{
            active: activeView === 'calendar'
          }"
          :aria-pressed="activeView === 'calendar'"
          @click="activeView = 'calendar'"
        >
          Календарь
        </button>
      </nav>

      <section v-if="activeView === 'list'" class="list-view">
        <p v-if="isReminderStorageLoading" class="empty-state">Загрузка напоминаний...</p>

        <p v-else-if="filteredReminders.length === 0" class="empty-state">Напоминания не найдены</p>

        <ul v-else class="reminder-list">
          <li
            v-for="reminder in visibleReminders"
            :key="reminder.id"
            :class="[
              'reminder-item',
              {
                'reminder-item--completed': reminder.completed
              }
            ]"
          >
            <div class="reminder-info">
              <strong class="reminder-title">
                {{ reminder.title }}
              </strong>

              <span class="reminder-date">
                {{ reminder.date }}
                в
                {{ reminder.time }}
              </span>

              <span v-if="getReminderRepeat(reminder) !== 'none'" class="reminder-repeat">
                {{ getReminderRepeatLabel(reminder) }}
              </span>
            </div>

            <div class="reminder-actions">
              <button
                type="button"
                :disabled="!isReminderStorageReady"
                @click="toggleReminderCompleted(reminder)"
              >
                {{ reminder.completed ? 'Вернуть в работу' : 'Выполнено' }}
              </button>

              <button
                type="button"
                :disabled="!isReminderStorageReady"
                @click="editReminder(reminder)"
              >
                Редактировать
              </button>

              <button
                type="button"
                :disabled="!isReminderStorageReady"
                @click="deleteReminder(reminder.id)"
              >
                Удалить
              </button>
            </div>
          </li>
        </ul>

        <button
          v-if="filteredReminders.length > COLLAPSED_REMINDER_COUNT"
          type="button"
          class="reminder-list-toggle"
          :aria-expanded="isReminderListExpanded"
          @click="toggleReminderList"
        >
          <span>
            {{ isReminderListExpanded ? 'Свернуть' : `Развернуть (${hiddenReminderCount})` }}
          </span>

          <span
            :class="[
              'reminder-list-toggle__arrow',
              {
                'reminder-list-toggle__arrow--expanded': isReminderListExpanded
              }
            ]"
            aria-hidden="true"
          >
            ↓
          </span>
        </button>

        <button type="button" :disabled="!isReminderStorageReady" @click="openNewReminderForm">
          Добавить напоминание
        </button>

        <div class="reminder-filters">
          <button
            type="button"
            :class="{
              active: reminderFilter === 'all'
            }"
            @click="reminderFilter = 'all'"
          >
            Все
          </button>

          <button
            type="button"
            :class="{
              active: reminderFilter === 'active'
            }"
            @click="reminderFilter = 'active'"
          >
            Активные
          </button>

          <button
            type="button"
            :class="{
              active: reminderFilter === 'completed'
            }"
            @click="reminderFilter = 'completed'"
          >
            Выполненные
          </button>
        </div>

        <input
          v-model.trim="reminderSearchQuery"
          class="reminder-search"
          type="search"
          placeholder="Поиск напоминаний"
        />

        <form
          v-if="isFormOpen && isReminderStorageReady"
          class="reminder-form"
          @submit.prevent="saveReminder"
        >
          <h2>
            {{ editingReminderId !== null ? 'Редактирование напоминания' : 'Новое напоминание' }}
          </h2>

          <label for="reminder-title"> Название </label>

          <input
            id="reminder-title"
            ref="reminderTitleInput"
            v-model="reminderTitle"
            type="text"
            autocomplete="off"
            placeholder="Например: позвонить врачу"
          />

          <label for="reminder-date"> Дата </label>

          <input id="reminder-date" v-model="reminderDate" type="date" />

          <label for="reminder-time"> Время </label>

          <input id="reminder-time" v-model="reminderTime" type="time" />

          <label for="reminder-repeat"> Повторение </label>

          <select id="reminder-repeat" v-model="reminderRepeat">
            <option value="none">Не повторять</option>

            <option value="daily">Ежедневно</option>

            <option value="weekly">По дням недели</option>

            <option value="monthly">Ежемесячно</option>

            <option value="yearly">Ежегодно</option>
          </select>

          <fieldset v-if="reminderRepeat === 'weekly'" class="repeat-weekdays">
            <legend>Дни недели</legend>

            <div class="repeat-weekdays-grid">
              <label
                v-for="day in weekDays"
                :key="day.value"
                :title="day.title"
                :class="[
                  'repeat-weekday',
                  {
                    'repeat-weekday--active': reminderWeekdays.includes(day.value)
                  }
                ]"
              >
                <input v-model="reminderWeekdays" type="checkbox" :value="day.value" />

                <span>{{ day.label }}</span>
              </label>
            </div>
          </fieldset>

          <button type="submit">
            {{ editingReminderId !== null ? 'Сохранить' : 'Добавить' }}
          </button>

          <button type="button" @click="closeForm">Закрыть</button>
        </form>

        <section class="settings-card">
          <h2>Настройки</h2>

          <div class="settings-row">
            <div class="settings-info">
              <strong> Запускать вместе с Windows </strong>

              <span>
                {{ isAutoLaunchEnabled ? 'Автозапуск включён' : 'Автозапуск выключен' }}
              </span>
            </div>

            <button
              type="button"
              role="switch"
              class="auto-launch-toggle"
              :class="{
                'auto-launch-toggle--active': isAutoLaunchEnabled
              }"
              :aria-checked="isAutoLaunchEnabled"
              :disabled="isAutoLaunchLoading"
              aria-label="Запускать вместе с Windows"
              @click="toggleAutoLaunch"
            >
              <span class="auto-launch-toggle__thumb"></span>
            </button>
          </div>

          <p v-if="autoLaunchError" class="settings-error">
            {{ autoLaunchError }}
          </p>

          <div class="update-settings">
            <div class="settings-info">
              <strong>Обновления</strong>

              <span>Текущая версия: {{ updateStatus.currentVersion }}</span>

              <span>{{ updateStatusText }}</span>
            </div>

            <progress
              v-if="updateStatus.state === 'downloading'"
              class="update-progress"
              max="100"
              :value="updateStatus.percent ?? 0"
            ></progress>

            <button
              v-if="updateStatus.state === 'available'"
              type="button"
              class="update-button"
              @click="downloadUpdate"
            >
              Скачать обновление
            </button>

            <button
              v-else-if="updateStatus.state === 'downloaded'"
              type="button"
              class="update-button"
              @click="installUpdate"
            >
              Перезапустить и установить
            </button>

            <button
              v-else-if="updateStatus.state !== 'downloading'"
              type="button"
              class="update-button update-button--secondary"
              :disabled="updateStatus.state === 'checking'"
              @click="checkForUpdates"
            >
              Проверить обновления
            </button>

            <p v-if="updateActionError" class="settings-error">
              {{ updateActionError }}
            </p>
          </div>

          <p v-if="reminderStorageNotice" class="settings-notice">
            {{ reminderStorageNotice }}
          </p>

          <p v-if="reminderStorageError" class="settings-error">
            {{ reminderStorageError }}
          </p>
        </section>
      </section>

      <section v-else class="calendar-view" aria-label="Календарь напоминаний">
        <header class="calendar-toolbar">
          <div class="calendar-navigation">
            <button
              type="button"
              class="calendar-navigation__button"
              aria-label="Предыдущий месяц"
              @click="changeCalendarMonth(-1)"
            >
              ‹
            </button>

            <h2>{{ calendarMonthLabel }}</h2>

            <button
              type="button"
              class="calendar-navigation__button"
              aria-label="Следующий месяц"
              @click="changeCalendarMonth(1)"
            >
              ›
            </button>
          </div>

          <div class="calendar-toolbar__actions">
            <button type="button" class="calendar-today-button" @click="showCurrentMonth">
              Сегодня
            </button>

            <button
              type="button"
              class="calendar-add-button"
              :disabled="!isReminderStorageReady"
              @click="openNewReminderFromCalendar"
            >
              Добавить
            </button>
          </div>
        </header>

        <div class="calendar-weekdays" aria-hidden="true">
          <span v-for="dayLabel in calendarWeekDays" :key="dayLabel">
            {{ dayLabel }}
          </span>
        </div>

        <div class="calendar-grid">
          <article
            v-for="day in calendarDays"
            :key="day.key"
            :class="[
              'calendar-day',
              {
                'calendar-day--outside': !day.isCurrentMonth,
                'calendar-day--today': day.isToday
              }
            ]"
          >
            <div class="calendar-day__header">
              <time :datetime="day.key">{{ day.dayNumber }}</time>

              <span v-if="day.isToday">Сегодня</span>
            </div>

            <div class="calendar-day__occurrences">
              <button
                v-for="occurrence in day.visibleOccurrences"
                :key="occurrence.key"
                type="button"
                :class="[
                  'calendar-occurrence',
                  {
                    'calendar-occurrence--completed': occurrence.reminder.completed,
                    'calendar-occurrence--repeating':
                      getReminderRepeat(occurrence.reminder) !== 'none'
                  }
                ]"
                :title="`${occurrence.reminder.title}, ${occurrence.reminder.time}`"
                @click="editReminderFromCalendar(occurrence.reminder)"
              >
                <span class="calendar-occurrence__time">{{ occurrence.reminder.time }}</span>

                <span class="calendar-occurrence__title">
                  {{ occurrence.reminder.title }}
                </span>
              </button>

              <span v-if="day.hiddenOccurrenceCount > 0" class="calendar-day__more">
                +{{ day.hiddenOccurrenceCount }} ещё
              </span>
            </div>
          </article>
        </div>

        <p v-if="isReminderStorageLoading" class="calendar-loading">Загрузка напоминаний...</p>
      </section>
    </section>
  </main>
</template>

<style scoped>
.app {
  min-height: 100vh;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: clamp(12px, 4vw, 32px);
  box-sizing: border-box;
  background: #f3f4f6;
  color: #1f2937;
  font-family: 'Segoe UI', sans-serif;
}

.app--calendar {
  height: 100vh;
  min-height: 0;
  padding: 12px;
  overflow: hidden;
}

.welcome-card {
  width: 100%;
  max-width: 960px;
  min-width: 0;
  padding: clamp(20px, 4vw, 40px);
  box-sizing: border-box;
  border-radius: 20px;
  background: #ffffff;
  box-shadow: 0 16px 40px rgb(0 0 0 / 10%);
  text-align: center;
}

.welcome-card--calendar {
  height: calc(100vh - 24px);
  max-width: 1280px;
  display: flex;
  flex-direction: column;
  padding: 14px 16px 16px;
  overflow: hidden;
}

.app-heading {
  flex: 0 0 auto;
}

.welcome-card--calendar .app-heading {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 12px;
}

.label {
  margin: 0 0 12px;
  color: #7c3aed;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 2px;
}

h1 {
  margin: 0 0 12px;
  font-size: 36px;
}

.welcome-card--calendar h1 {
  margin-bottom: 4px;
  font-size: 26px;
}

.welcome-card--calendar .label {
  margin-bottom: 4px;
  font-size: 11px;
}

.welcome-card > p:not(.label) {
  margin: 0 0 28px;
  color: #6b7280;
  font-size: 16px;
}

button {
  padding: 12px 20px;
  border: 0;
  border-radius: 10px;
  background: #7c3aed;
  color: #ffffff;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.view-switcher {
  width: min(100%, 360px);
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px;
  margin: 4px auto 20px;
  padding: 4px;
  border-radius: 12px;
  background: #e2e8f0;
}

.view-switcher button {
  padding: 9px 14px;
  background: transparent;
  color: #475569;
  font-size: 14px;
}

.view-switcher button.active {
  background: #ffffff;
  color: #6d28d9;
  box-shadow: 0 2px 7px rgb(15 23 42 / 12%);
}

.welcome-card--calendar .view-switcher {
  width: 300px;
  margin: 2px auto 10px;
}

.welcome-card--calendar .view-switcher button {
  padding: 6px 12px;
}

.list-view {
  min-width: 0;
}

.reminder-list {
  display: grid;
  gap: 12px;
  margin: 0 0 24px;
  padding: 0;
  list-style: none;
  text-align: left;
}

.reminder-list-toggle {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin: -8px 0 16px;
  padding: 9px 16px;
  border: 1px solid #ddd6fe;
  background: #f5f3ff;
  color: #6d28d9;
  font-size: 14px;
}

.reminder-list-toggle:hover {
  background: #ede9fe;
}

.reminder-list-toggle__arrow {
  display: inline-block;
  font-size: 18px;
  line-height: 1;
  transition: transform 0.2s ease;
}

.reminder-list-toggle__arrow--expanded {
  transform: rotate(180deg);
}

.reminder-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 16px 24px;
  padding: 16px;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  background: #f8fafc;
}

.reminder-info {
  min-width: 0;
  display: grid;
  gap: 6px;
}

.reminder-title {
  min-width: 0;
  color: #0f172a;
  font-size: 16px;
  line-height: 1.4;
  overflow-wrap: anywhere;
}

.reminder-date {
  color: #64748b;
  font-size: 14px;
}

.reminder-repeat {
  width: fit-content;
  padding: 4px 8px;
  border-radius: 999px;
  background: #ede9fe;
  color: #6d28d9;
  font-size: 12px;
  font-weight: 700;
}

.reminder-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.reminder-actions button {
  flex: 0 0 auto;
  padding: 8px 12px;
  border: none;
  border-radius: 8px;
  background: #fee2e2;
  color: #b91c1c;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}

.reminder-item button:hover {
  background: #fecaca;
}

.reminder-form {
  display: grid;
  gap: 10px;
  margin-top: 24px;
  padding: 24px;
  border: 1px solid #e2e8f0;
  border-radius: 16px;
  background: #f8fafc;
  text-align: left;
}

.reminder-form h2 {
  margin: 0 0 8px;
  text-align: center;
}

.reminder-form label {
  color: #334155;
  font-size: 14px;
  font-weight: 600;
}

.reminder-form input,
.reminder-form select {
  width: 100%;
  height: 44px;
  padding: 0 12px;
  border: 1px solid #cbd5e1;
  border-radius: 10px;
  box-sizing: border-box;
  background: #ffffff;
  color: #172033;
  font: inherit;
}

.reminder-form input:focus,
.reminder-form select:focus {
  border-color: #7c3aed;
  outline: 3px solid #ede9fe;
}

.reminder-form button {
  width: 100%;
  margin-top: 8px;
}

.reminder-form button + button {
  margin-top: 0;
  background: #e2e8f0;
  color: #334155;
}

.reminder-item--completed {
  opacity: 0.65;
  background: #f0fdf4;
}

.reminder-item--completed strong {
  color: #64748b;
  text-decoration: line-through;
}

.reminder-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 16px 0;
}

.reminder-filters button {
  flex: 1 1 120px;
  background: #e2e8f0;
  color: #0f172a;
}

.reminder-filters button.active {
  background: #2563eb;
  color: #ffffff;
}

.reminder-search {
  width: 100%;
  margin-bottom: 16px;
  padding: 10px 12px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  box-sizing: border-box;
  font-size: 14px;
}

.reminder-search:focus {
  border-color: #2563eb;
  outline: none;
}

.empty-state {
  margin: 16px 0;
  padding: 24px;
  border: 1px dashed #cbd5e1;
  border-radius: 8px;
  background: #f8fafc;
  color: #64748b;
  text-align: center;
}

.calendar-view {
  position: relative;
  min-height: 0;
  flex: 1 1 auto;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  text-align: left;
}

.calendar-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}

.calendar-navigation,
.calendar-toolbar__actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.calendar-navigation h2 {
  min-width: 190px;
  margin: 0;
  color: #0f172a;
  font-size: 20px;
  text-align: center;
}

.calendar-navigation .calendar-navigation__button {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  padding: 0 0 3px;
  border: 1px solid #cbd5e1;
  background: #ffffff;
  color: #334155;
  font-size: 26px;
  line-height: 1;
}

.calendar-navigation .calendar-navigation__button:hover,
.calendar-today-button:hover {
  border-color: #a78bfa;
  background: #f5f3ff;
  color: #6d28d9;
}

.calendar-toolbar .calendar-today-button,
.calendar-toolbar .calendar-add-button {
  padding: 8px 12px;
  font-size: 13px;
}

.calendar-toolbar .calendar-today-button {
  border: 1px solid #cbd5e1;
  background: #ffffff;
  color: #334155;
}

.calendar-weekdays {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  border: 1px solid #d8dee8;
  border-bottom: 0;
  border-radius: 10px 10px 0 0;
  overflow: hidden;
  background: #f8fafc;
}

.calendar-weekdays span {
  padding: 5px 6px;
  border-right: 1px solid #d8dee8;
  color: #64748b;
  font-size: 12px;
  font-weight: 700;
  text-align: center;
}

.calendar-weekdays span:last-child {
  border-right: 0;
}

.calendar-grid {
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  grid-template-rows: repeat(6, minmax(0, 1fr));
  border-top: 1px solid #d8dee8;
  border-left: 1px solid #d8dee8;
  border-radius: 0 0 10px 10px;
  overflow: hidden;
  background: #ffffff;
}

.calendar-day {
  min-width: 0;
  min-height: 0;
  padding: 4px;
  border-right: 1px solid #d8dee8;
  border-bottom: 1px solid #d8dee8;
  background: #ffffff;
  overflow: hidden;
}

.calendar-day--outside {
  background: #f8fafc;
}

.calendar-day--today {
  background: #faf5ff;
  box-shadow: inset 0 0 0 2px #8b5cf6;
}

.calendar-day__header {
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  margin-bottom: 2px;
  color: #334155;
  font-size: 11px;
  font-weight: 700;
}

.calendar-day--outside .calendar-day__header {
  color: #94a3b8;
}

.calendar-day__header span {
  min-width: 0;
  color: #7c3aed;
  font-size: 9px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.calendar-day__occurrences {
  min-height: 0;
  display: grid;
  gap: 2px;
}

.calendar-day__occurrences .calendar-occurrence {
  min-width: 0;
  height: 17px;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 4px;
  padding: 1px 4px;
  border: 1px solid #ddd6fe;
  border-left: 3px solid #8b5cf6;
  border-radius: 4px;
  background: #f5f3ff;
  color: #4c1d95;
  font-size: 10px;
  font-weight: 600;
  text-align: left;
}

.calendar-day__occurrences .calendar-occurrence:hover {
  border-color: #8b5cf6;
  background: #ede9fe;
}

.calendar-day__occurrences .calendar-occurrence--repeating {
  border-left-color: #2563eb;
  background: #eff6ff;
  color: #1e40af;
}

.calendar-day__occurrences .calendar-occurrence--completed {
  border-color: #cbd5e1;
  background: #f1f5f9;
  color: #64748b;
  text-decoration: line-through;
}

.calendar-occurrence__time {
  font-variant-numeric: tabular-nums;
}

.calendar-occurrence__title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.calendar-day__more {
  display: block;
  padding-left: 3px;
  color: #64748b;
  font-size: 9px;
  font-weight: 700;
}

.calendar-loading {
  position: absolute;
  inset: 70px 0 0;
  display: grid;
  place-items: center;
  margin: 0;
  border-radius: 10px;
  background: rgb(255 255 255 / 78%);
  color: #64748b;
  font-size: 14px;
}

.settings-card {
  margin-top: 24px;
  padding: 20px;
  border: 1px solid #e2e8f0;
  border-radius: 16px;
  background: #f8fafc;
  text-align: left;
}

.settings-card h2 {
  margin: 0 0 16px;
  font-size: 20px;
}

.settings-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}

.settings-info {
  display: grid;
  gap: 4px;
}

.settings-info span {
  color: #64748b;
  font-size: 14px;
}

.auto-launch-toggle {
  position: relative;
  flex-shrink: 0;
  width: 50px;
  height: 28px;
  padding: 3px;
  border-radius: 999px;
  background: #cbd5e1;
  transition: background-color 0.2s;
}

.auto-launch-toggle--active {
  background: #7c3aed;
}

.auto-launch-toggle__thumb {
  display: block;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #ffffff;
  box-shadow: 0 2px 5px rgb(0 0 0 / 20%);
  transition: transform 0.2s;
}

.auto-launch-toggle--active .auto-launch-toggle__thumb {
  transform: translateX(22px);
}

.auto-launch-toggle:disabled {
  cursor: wait;
  opacity: 0.6;
}

.settings-error {
  margin: 12px 0 0;
  color: #b91c1c;
  font-size: 14px;
}

.update-settings {
  display: grid;
  gap: 12px;
  margin-top: 20px;
  padding-top: 20px;
  border-top: 1px solid #e2e8f0;
}

.update-progress {
  width: 100%;
  height: 10px;
  accent-color: #7c3aed;
}

.update-button {
  width: fit-content;
  padding: 9px 14px;
  font-size: 13px;
}

.update-button--secondary {
  background: #e2e8f0;
  color: #334155;
}

.settings-notice {
  margin: 12px 0 0;
  color: #166534;
  font-size: 14px;
}

.notification-page {
  min-height: 100vh;
  display: grid;
  padding: 12px;
  box-sizing: border-box;
  background: #f1f5f9;
  color: #0f172a;
  font-family: 'Segoe UI', sans-serif;
}

.notification-popup {
  min-width: 0;
  display: flex;
  flex-direction: column;
  padding: 16px;
  box-sizing: border-box;
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  background: #ffffff;
  box-shadow: 0 12px 32px rgb(15 23 42 / 16%);
}

.notification-heading {
  min-width: 0;
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr);
  align-items: start;
  gap: 12px;
}

.notification-icon {
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border-radius: 12px;
  background: #dbeafe;
  color: #2563eb;
  font-size: 22px;
  font-weight: 700;
}

.notification-content {
  min-width: 0;
}

.notification-label {
  margin: 0;
  color: #2563eb;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.notification-title {
  margin: 3px 0 0;
  color: #0f172a;
  font-size: 18px;
  line-height: 1.3;
  overflow-wrap: anywhere;
}

.notification-datetime {
  margin: 10px 0;
  color: #64748b;
  font-size: 13px;
}

.notification-checkbox {
  min-height: 40px;
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: auto;
  padding: 0 12px;
  border-radius: 10px;
  background: #dcfce7;
  color: #166534;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  user-select: none;
}

.notification-checkbox input {
  width: 18px;
  height: 18px;
  margin: 0;
  accent-color: #16a34a;
  cursor: pointer;
}

:global(html),
:global(body),
:global(#app) {
  min-height: 100%;
  margin: 0;
}

.repeat-weekdays {
  margin: 2px 0 4px;
  padding: 0;
  border: 0;
}

.repeat-weekdays legend {
  margin-bottom: 8px;
  color: #334155;
  font-size: 14px;
  font-weight: 600;
}

.repeat-weekdays-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 6px;
}

.reminder-form .repeat-weekday {
  min-width: 0;
  min-height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 0 6px;
  border: 1px solid #cbd5e1;
  border-radius: 9px;
  background: #ffffff;
  font-size: 13px;
  cursor: pointer;
}

.reminder-form .repeat-weekday--active {
  border-color: #7c3aed;
  background: #ede9fe;
  color: #6d28d9;
}

.reminder-form .repeat-weekday input {
  width: 16px;
  height: 16px;
  margin: 0;
  padding: 0;
  accent-color: #7c3aed;
  cursor: pointer;
}

@media (max-width: 700px) {
  .reminder-item {
    grid-template-columns: minmax(0, 1fr);
    align-items: stretch;
  }

  .reminder-actions {
    justify-content: flex-start;
  }
}

@media (max-width: 480px) {
  .repeat-weekdays-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
  .welcome-card {
    padding: 20px 16px;
    border-radius: 16px;
  }

  .reminder-actions {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
  }

  .reminder-actions button {
    width: 100%;
  }
}
</style>
