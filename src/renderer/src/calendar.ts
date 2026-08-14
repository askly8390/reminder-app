export type CalendarReminder = {
  id: number
  title: string
  date: string
  time: string
  completed?: boolean
  repeat?: 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly'
  repeatDay?: number
  repeatMonth?: number
  repeatWeekdays?: number[]
}

export type CalendarOccurrence<T extends CalendarReminder> = {
  key: string
  reminder: T
}

export type CalendarDay<T extends CalendarReminder> = {
  key: string
  dayNumber: number
  isCurrentMonth: boolean
  isToday: boolean
  visibleOccurrences: CalendarOccurrence<T>[]
  hiddenOccurrenceCount: number
}

const formatDateKey = (date: Date): string => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

const getDaysInMonth = (year: number, month: number): number => {
  return new Date(year, month + 1, 0).getDate()
}

const parseReminderDate = (date: string): Date | null => {
  const parsedDate = new Date(`${date}T00:00:00`)

  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate
}

const getRepeatWeekdays = (reminder: CalendarReminder, firstOccurrenceDate: Date): number[] => {
  const savedWeekdays = reminder.repeatWeekdays?.filter(
    (day) => Number.isInteger(day) && day >= 0 && day <= 6
  )

  return savedWeekdays?.length ? [...new Set(savedWeekdays)] : [firstOccurrenceDate.getDay()]
}

const isReminderScheduledForDate = (reminder: CalendarReminder, date: Date): boolean => {
  const firstOccurrenceDate = parseReminderDate(reminder.date)

  if (!firstOccurrenceDate) {
    return false
  }

  const dateKey = formatDateKey(date)
  const repeat = reminder.repeat ?? 'none'

  if (reminder.completed || repeat === 'none') {
    return reminder.date === dateKey
  }

  if (date.getTime() < firstOccurrenceDate.getTime()) {
    return false
  }

  if (repeat === 'daily') {
    return true
  }

  if (repeat === 'weekly') {
    return getRepeatWeekdays(reminder, firstOccurrenceDate).includes(date.getDay())
  }

  const repeatDay = reminder.repeatDay ?? firstOccurrenceDate.getDate()

  if (repeat === 'monthly') {
    return (
      date.getDate() === Math.min(repeatDay, getDaysInMonth(date.getFullYear(), date.getMonth()))
    )
  }

  const repeatMonth = reminder.repeatMonth ?? firstOccurrenceDate.getMonth()

  return date.getMonth() === repeatMonth && date.getDate() === repeatDay
}

export const buildCalendarDays = <T extends CalendarReminder>(
  calendarMonth: Date,
  reminders: T[],
  visibleOccurrenceCount: number
): CalendarDay<T>[] => {
  const displayedMonth = calendarMonth.getMonth()
  const displayedYear = calendarMonth.getFullYear()
  const monthStart = new Date(displayedYear, displayedMonth, 1)
  const mondayBasedOffset = (monthStart.getDay() + 6) % 7
  const gridStart = new Date(displayedYear, displayedMonth, 1 - mondayBasedOffset)
  const todayKey = formatDateKey(new Date())

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart)

    date.setDate(gridStart.getDate() + index)

    const key = formatDateKey(date)
    const occurrences = reminders
      .filter((reminder) => isReminderScheduledForDate(reminder, date))
      .sort((firstReminder, secondReminder) =>
        firstReminder.time.localeCompare(secondReminder.time)
      )
      .map((reminder) => ({
        key: `${reminder.id}-${key}`,
        reminder
      }))

    return {
      key,
      dayNumber: date.getDate(),
      isCurrentMonth: date.getMonth() === displayedMonth,
      isToday: key === todayKey,
      visibleOccurrences: occurrences.slice(0, visibleOccurrenceCount),
      hiddenOccurrenceCount: Math.max(0, occurrences.length - visibleOccurrenceCount)
    }
  })
}
