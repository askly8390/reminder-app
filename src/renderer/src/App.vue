<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
type Reminder = {
  id: number
  title: string
  date: string
  time: string
  notified?: boolean
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
const editingReminderId = ref<number | null>(null)
const reminders = ref<Reminder[]>(loadReminders())
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
      notified: false
    })
  }
  closeForm()
}

const deleteReminder = (id: number): void => {
  reminders.value = reminders.value.filter((reminder) => reminder.id !== id)
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
    if (reminder.notified) {
      return
    }

    const reminderTime = new Date(`${reminder.date}T${reminder.time}`).getTime()

    if (currentTime >= reminderTime) {
      window.api.showNotification(reminder.title)
      reminder.notified = true
    }
  })
}

let reminderCheckInterval: ReturnType<typeof setInterval> | undefined

onMounted(() => {
  checkReminders()
  reminderCheckInterval = setInterval(checkReminders, 1000)
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
      <ul v-if="reminders.length" class="reminder-list">
        <li v-for="reminder in reminders" :key="reminder.id" class="reminder-item">
          <strong>{{ reminder.title }}</strong>
          <span>{{ reminder.date }} в {{ reminder.time }}</span>
          <button type="button" @click="editReminder(reminder)">Редактировать</button>
          <button type="button" @click="deleteReminder(reminder.id)">Удалить</button>
        </li>
      </ul>

      <p v-else>Здесь будет находиться список созданных напоминаний.</p>

      <button type="button" @click="isFormOpen = true">Добавить напоминание</button>

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
</style>
