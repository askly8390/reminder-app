<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

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

const loadReminders = (): Reminder[] => {
  const savedReminders = localStorage.getItem('reminders')

  if (!savedReminders) {
    return []
  }

  try {
    return JSON.parse(savedReminders) as Reminder[]
  } catch {
    return []
  }
}

const isFormOpen = ref(false)
const reminderTitle = ref('')
const reminderDate = ref('')
const reminderTime = ref('')
const reminderRepeat = ref<ReminderRepeat>('none')

const reminderWeekdays = ref<number[]>([])

const editingOriginalDate = ref('')
const editingOriginalRepeat = ref<ReminderRepeat>('none')

const editingReminderId = ref<number | null>(null)

const reminders = ref<Reminder[]>(loadReminders())

const reminderFilter = ref<ReminderFilter>('all')

const reminderSearchQuery = ref('')
const isAutoLaunchEnabled = ref(false)
const isAutoLaunchLoading = ref(true)
const autoLaunchError = ref('')

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

watch(
  reminders,
  (newReminders): void => {
    localStorage.setItem('reminders', JSON.stringify(newReminders))
  },
  { deep: true }
)

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
}

const checkReminders = (): void => {
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

let reminderCheckInterval: ReturnType<typeof setInterval> | null = null

let removeReminderCompletedListener: (() => void) | null = null

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

  checkReminders()

  reminderCheckInterval = setInterval(checkReminders, 1000)

  void loadAutoLaunch()
})

onUnmounted(() => {
  if (reminderCheckInterval) {
    clearInterval(reminderCheckInterval)

    reminderCheckInterval = null
  }

  removeReminderCompletedListener?.()
  removeReminderCompletedListener = null
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

  <main v-else class="app">
    <section class="welcome-card">
      <p class="label">REMINDER APP</p>

      <h1>Напоминания</h1>

      <p v-if="filteredReminders.length === 0" class="empty-state">Напоминания не найдены</p>

      <ul v-else class="reminder-list">
        <li
          v-for="reminder in filteredReminders"
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
            <button type="button" @click="toggleReminderCompleted(reminder)">
              {{ reminder.completed ? 'Вернуть в работу' : 'Выполнено' }}
            </button>

            <button type="button" @click="editReminder(reminder)">Редактировать</button>

            <button type="button" @click="deleteReminder(reminder.id)">Удалить</button>
          </div>
        </li>
      </ul>

      <button type="button" @click="isFormOpen = true">Добавить напоминание</button>

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

      <form v-if="isFormOpen" class="reminder-form" @submit.prevent="saveReminder">
        <h2>
          {{ editingReminderId !== null ? 'Редактирование напоминания' : 'Новое напоминание' }}
        </h2>

        <label for="reminder-title"> Название </label>

        <input
          id="reminder-title"
          v-model="reminderTitle"
          type="text"
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

.reminder-list {
  display: grid;
  gap: 12px;
  margin: 0 0 24px;
  padding: 0;
  list-style: none;
  text-align: left;
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
