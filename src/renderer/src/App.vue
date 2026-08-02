<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
type Reminder = {
  id: number
  title: string
  date: string
  time: string
  notified?: boolean
  completed?: boolean
}

type ReminderFilter = 'all' | 'active' | 'completed'

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

  if (editingReminderId.value !== null) {
    const reminder = reminders.value.find((item) => item.id === editingReminderId.value)

    if (reminder) {
      reminder.title = reminderTitle.value
      reminder.date = reminderDate.value
      reminder.time = reminderTime.value
      reminder.notified = false
    }
  } else {
    reminders.value.push({
      id: Date.now(),
      title: reminderTitle.value,
      date: reminderDate.value,
      time: reminderTime.value,
      notified: false,
      completed: false
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
  reminder.completed = !reminder.completed
}

const editReminder = (reminder: Reminder): void => {
  editingReminderId.value = reminder.id
  reminderTitle.value = reminder.title
  reminderDate.value = reminder.date
  reminderTime.value = reminder.time
  isFormOpen.value = true
}

const checkReminders = (): void => {
  const currentTime = Date.now()

  reminders.value.forEach((reminder) => {
    if (reminder.notified || reminder.completed) {
      return
    }

    const reminderTime = new Date(`${reminder.date}T${reminder.time}`).getTime()

    if (currentTime >= reminderTime) {
      window.api.showNotification(reminder.title)
      reminder.notified = true
    }
  })
}

const loadAutoLaunch = async (): Promise<void> => {
  try {
    isAutoLaunchEnabled.value = await window.api.getAutoLaunch()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    autoLaunchError.value = `Не удалось изменить настройку автозапуска: ${message}`
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
let reminderCheckInterval: ReturnType<typeof setInterval> | undefined

onMounted(() => {
  checkReminders()
  reminderCheckInterval = setInterval(checkReminders, 1000)

  void loadAutoLaunch()
})

onUnmounted(() => {
  if (reminderCheckInterval) {
    clearInterval(reminderCheckInterval)
  }
})
</script>

<template>
  <main class="app">
    <section class="welcome-card">
      <p class="label">REMINDER APP</p>
      <h1>Напоминания</h1>

      <p v-if="filteredReminders.length === 0" class="empty-state">Напоминания не найдены</p>

      <ul v-else class="reminder-list">
        <li
          v-for="reminder in filteredReminders"
          :key="reminder.id"
          :class="['reminder-item', { 'reminder-item--completed': reminder.completed }]"
        >
          <strong>{{ reminder.title }}</strong>
          <span>{{ reminder.date }} в {{ reminder.time }}</span>

          <button type="button" @click="toggleReminderCompleted(reminder)">
            {{ reminder.completed ? 'Вернуть в работу' : 'Выполнено' }}
          </button>

          <button type="button" @click="editReminder(reminder)">Редактировать</button>

          <button type="button" @click="deleteReminder(reminder.id)">Удалить</button>
        </li>
      </ul>

      <button type="button" @click="isFormOpen = true">Добавить напоминание</button>

      <div class="reminder-filters">
        <button
          type="button"
          :class="{ active: reminderFilter === 'all' }"
          @click="reminderFilter = 'all'"
        >
          Все
        </button>

        <button
          type="button"
          :class="{ active: reminderFilter === 'active' }"
          @click="reminderFilter = 'active'"
        >
          Активные
        </button>

        <button
          type="button"
          :class="{ active: reminderFilter === 'completed' }"
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

        <label for="reminder-title">Название</label>
        <input
          id="reminder-title"
          v-model="reminderTitle"
          type="text"
          placeholder="Например: позвонить врачу"
        />
        <label for="reminder-date">Дата</label>
        <input id="reminder-date" v-model="reminderDate" type="date" />

        <label for="reminder-time">Время</label>
        <input id="reminder-time" v-model="reminderTime" type="time" />

        <button type="submit">
          {{ editingReminderId !== null ? 'Сохранить' : 'Добавить' }}
        </button>
        <button type="button" @click="closeForm">Закрыть</button>
      </form>
      <section class="settings-card">
        <h2>Настройки</h2>

        <div class="settings-row">
          <div class="settings-info">
            <strong>Запускать вместе с Windows</strong>
            <span>
              {{ isAutoLaunchEnabled ? 'Автозапуск включён' : 'Автозапуск выключен' }}
            </span>
          </div>

          <button
            type="button"
            role="switch"
            class="auto-launch-toggle"
            :class="{ 'auto-launch-toggle--active': isAutoLaunchEnabled }"
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
  display: grid;
  place-items: center;
  padding: 32px;
  background: #f3f4f6;
  color: #1f2937;
  font-family: 'Segoe UI', sans-serif;
}

.welcome-card {
  width: 100%;
  max-width: 520px;
  padding: 40px;
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
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  background: #f8fafc;
}

.reminder-item strong {
  overflow-wrap: anywhere;
}

.reminder-item span {
  flex-shrink: 0;
  color: #64748b;
  font-size: 14px;
}

.reminder-item button {
  flex-shrink: 0;
  padding: 8px 12px;
  border: none;
  border-radius: 8px;
  background: #fee2e2;
  color: #b91c1c;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
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

.reminder-form input {
  width: 100%;
  height: 44px;
  padding: 0 12px;
  border: 1px solid #cbd5e1;
  border-radius: 10px;
  background: white;
  color: #172033;
  font: inherit;
}

.reminder-form input:focus {
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
  background-color: #f0fdf4;
}

.reminder-item--completed strong {
  color: #64748b;
  text-decoration: line-through;
}

.reminder-filters {
  display: flex;
  gap: 8px;
  margin: 16px 0;
}

.reminder-filters button {
  background-color: #e2e8f0;
  color: #0f172a;
}

.reminder-filters button.active {
  background-color: #2563eb;
  color: #ffffff;
}

.reminder-search {
  width: 100%;
  margin-bottom: 16px;
  padding: 10px 12px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
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
  background-color: #f8fafc;
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
</style>
