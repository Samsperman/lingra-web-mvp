import { cardTemplates, diagnosis, lessonSteps } from './catalog.mjs'

const reviewStatuses = new Map([
  ['again', 'due'],
  ['known', 'known'],
  ['hide', 'hidden'],
])

function normaliseAnswer(answer) {
  return answer.normalize('NFKC')
    .toLowerCase()
    .replace(/(?<=\d):00\b/g, '')
    .replace(/\b([ap])\.\s*m\.?/g, '$1m')
    .replace(/[’']/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

export function newSession(goal, id) {
  const originalGoal = goal.trim()
  return {
    id,
    goal: originalGoal,
    goalSupported: /встреч|созвон|совещан|собеседован|\b(?:meeting|reschedule)\b/i.test(originalGoal),
    catalogVersion: 1,
    phase: 'diagnosis',
    plan: [],
    attempts: [],
    reviews: [],
    feedback: null,
    itemIndex: 0,
  }
}

function activeSpec(session) {
  if (session.phase === 'diagnosis') return diagnosis[session.itemIndex]
  if (session.phase === 'lesson') return lessonSteps[session.stepId]?.items[session.itemIndex]
}

export function currentItem(session) {
  const spec = activeSpec(session)
  if (!spec) return null

  const { id, type, title, prompt, passage, sourcePolicy, options, sample, placeholder, hint } = spec
  return {
    id, type, title, prompt, passage, sourcePolicy,
    options: options ? [...options] : undefined,
    sample, placeholder, hint,
  }
}

function evaluate(spec, answer) {
  const normalised = normaliseAnswer(answer)
  if (spec.answers.some(option => normaliseAnswer(option) === normalised)) return 'pass'
  const knownWrong = spec.wrongAnswers?.some(option => normaliseAnswer(option) === normalised)
  const anotherOption = spec.options?.some(option => normaliseAnswer(option) === normalised)
  return knownWrong || anotherOption || spec.type === 'shadowing' ? 'miss' : 'uncertain'
}

function feedbackText(spec, outcome, assisted, phase) {
  if (phase === 'diagnosis') {
    return 'Ответ сохранён. По результатам диагностики появится учебный маршрут.'
  }
  if (spec.type === 'shadowing') {
    return outcome === 'pass'
      ? 'Слова совпали с образцом. Качество произношения в этом упражнении не оценивается.'
      : 'Часть слов отличается от образца. Прослушайте его и попробуйте снова. ' + spec.explanation
  }
  if (outcome === 'uncertain') {
    return 'Эта формулировка вне вариантов, которые проверяет упражнение. ' + spec.explanation
  }
  if (outcome === 'pass' && assisted) {
    return 'Верно с подсказкой. Следующий ответ можно попробовать самостоятельно. ' + spec.explanation
  }
  return spec.explanation
}

function addReview(session, cardKey) {
  const id = session.id + ':' + cardKey
  const current = session.reviews.find(card => card.id === id)
  if (current?.status === 'known') {
    return session.reviews.map(card => card.id === id ? { ...card, status: 'due' } : card)
  }
  if (current) return session.reviews
  return [...session.reviews, { id, ...cardTemplates[cardKey], status: 'due' }]
}

export function submitAnswer(session, { itemId, answer, assisted = false, mode = 'text' }) {
  const spec = activeSpec(session)
  if (!spec || spec.id !== itemId || session.feedback || typeof answer !== 'string' || !answer.trim()) {
    return session
  }

  const cleaned = answer.trim()
  const usedHelp = Boolean(assisted) || spec.type === 'shadowing'
  const outcome = evaluate(spec, cleaned)
  const attempt = {
    itemId,
    answer: cleaned,
    correct: outcome === 'pass',
    assisted: usedHelp,
    mode,
    type: spec.type,
    phase: session.phase,
    outcome,
  }
  const reviews = outcome === 'miss' && spec.card ? addReview(session, spec.card) : session.reviews
  return {
    ...session,
    attempts: [...session.attempts, attempt],
    reviews,
    feedback: {
      correct: attempt.correct,
      uncertain: outcome === 'uncertain',
      text: feedbackText(spec, outcome, usedHelp, session.phase),
    },
  }
}

function refreshAvailability(plan) {
  const completed = new Set(plan.filter(step => step.status === 'completed').map(step => step.id))
  return plan.map(step => {
    if (completed.has(step.id)) return step
    const status = step.requires.every(id => completed.has(id)) ? 'available' : 'locked'
    return { ...step, status }
  })
}

function planEntry(id, requires, descriptionOverride) {
  const { type, title, description, explanation } = lessonSteps[id]
  return { id, type, title, description: descriptionOverride ?? description, explanation, requires }
}

function planFor(attempts) {
  const confirmed = id => attempts.some(attempt => attempt.itemId === id && attempt.correct && !attempt.assisted)
  const meaningConfirmed = confirmed('diagnosis-time')
  const grammarConfirmed = confirmed('diagnosis-move')
  const suggestionConfirmed = confirmed('diagnosis-suggestion')
  const foundations = []
  const observations = []

  if (!meaningConfirmed) {
    foundations.push(planEntry('meaning', []))
    observations.push('Потренируемся находить новое время в сообщении.')
  }
  if (!grammarConfirmed) {
    foundations.push(planEntry('destination', []))
    observations.push('Разберём, какой предлог вводит новый день после move.')
  }
  if (!suggestionConfirmed) observations.push('Потренируемся спрашивать, подходит ли собеседнику выбранное время.')

  if (!observations.length) {
    observations.push('Вы нашли новое время, выбрали нужный предлог и узнали подходящую реплику. Теперь попробуйте это в разговоре.')
  }

  const plan = refreshAvailability([
    ...foundations,
    planEntry('shadowing', foundations.map(step => step.id)),
    planEntry('conversation', ['shadowing'], suggestionConfirmed
      ? undefined
      : 'Потренируйте вопрос «Does … work for you?» и подтвердите время.'),
    planEntry('transfer', ['conversation']),
  ])
  return { plan, diagnosisSummary: observations.join(' ') }
}

export function startLesson(session, stepId) {
  if (session.phase !== 'plan' && session.phase !== 'done') return session
  const step = stepId === undefined
    ? session.plan.find(step => step.status === 'available')
    : session.plan.find(step => step.id === stepId && step.status === 'available')
  if (!step) return session
  return { ...session, phase: 'lesson', stepId: step.id, feedback: null, itemIndex: 0 }
}

function continueDiagnosis(session) {
  if (session.itemIndex < diagnosis.length - 1) {
    return { ...session, itemIndex: session.itemIndex + 1, feedback: null }
  }
  return { ...session, ...planFor(session.attempts), phase: 'plan', itemIndex: 0, feedback: null }
}

function progressFor(step, attempts) {
  const itemIds = new Set(step.items.map(item => item.id))
  return new Set(attempts.filter(attempt =>
    itemIds.has(attempt.itemId) && attempt.correct && (!attempt.assisted || step.type === 'shadowing')
  ).map(attempt => attempt.itemId))
}

export function continueLesson(session) {
  if (!session.feedback) return session
  if (session.phase === 'diagnosis') return continueDiagnosis(session)
  if (session.phase !== 'lesson') return session

  const step = lessonSteps[session.stepId]
  const confirmed = progressFor(step, session.attempts)
  if (confirmed.size >= step.required) {
    const plan = refreshAvailability(session.plan.map(entry =>
      entry.id === step.id ? { ...entry, status: 'completed' } : entry
    ))
    const phase = plan.every(entry => entry.status === 'completed') ? 'done' : 'plan'
    return { ...session, plan, phase, stepId: undefined, itemIndex: 0, feedback: null }
  }

  let itemIndex = session.itemIndex
  do {
    itemIndex = (itemIndex + 1) % step.items.length
  } while (confirmed.has(step.items[itemIndex].id))
  return { ...session, itemIndex, feedback: null }
}

export function reviewCard(session, cardId, action) {
  const status = reviewStatuses.get(action)
  if (!status || !session.reviews.some(card => card.id === cardId)) return session
  return {
    ...session,
    reviews: session.reviews.map(card => card.id === cardId ? { ...card, status } : card),
  }
}
