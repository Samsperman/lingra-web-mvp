import assert from 'node:assert/strict'
import test from 'node:test'
import {
  continueLesson,
  currentItem,
  newSession,
  reviewCard,
  startLesson,
  submitAnswer,
} from '../src/engine.mjs'

const suggestion = 'Does Friday at ten work for you?'

function answer(session, answer, options = {}) {
  return submitAnswer(session, { itemId: currentItem(session).id, answer, ...options })
}

function diagnose(responses) {
  let session = newSession('Научиться переносить рабочие встречи', 'session-a')
  for (const response of responses) session = continueLesson(answer(session, response))
  return session
}

test('diagnosis uses three formats and preserves the open item until the learner continues', () => {
  let session = newSession('  Переносить встречи  ', 'diagnosis')
  assert.equal(session.goal, 'Переносить встречи')
  assert.equal(session.phase, 'diagnosis')
  assert.deepEqual(session.plan, [])
  const item = currentItem(session)
  assert.equal(item.type, 'qna')
  assert.equal('answers' in item, false)
  assert.equal(submitAnswer(session, { itemId: 'stale', answer: 'Thursday at 3 pm' }), session)
  assert.equal(answer(session, '  '), session)
  session = answer(session, 'Thursday at 3:00 p.m.', { mode: 'voice' })
  assert.equal(session.feedback.correct, true)
  assert.equal(session.attempts[0].mode, 'voice')
  assert.equal(currentItem(session).id, item.id)
  assert.equal(answer(session, 'Thursday at 3 pm'), session)
  session = continueLesson(session)
  assert.equal(currentItem(session).type, 'grammar')
  session = continueLesson(answer(session, 'to'))
  assert.equal(currentItem(session).type, 'quiz')
  assert.equal(continueLesson(answer(session, suggestion)).phase, 'plan')
})

test('two gaps on the same goal open different first checkpoints', () => {
  const comprehension = diagnose(['Tuesday at 3 pm', 'to', suggestion])
  const grammar = diagnose(['Thursday at 3 pm', 'by', suggestion])
  assert.equal(comprehension.plan[0].type, 'qna')
  assert.equal(grammar.plan[0].type, 'grammar')
  assert.notEqual(comprehension.diagnosisSummary, grammar.diagnosisSummary)
  assert.equal(comprehension.plan.some(step => step.type === 'grammar'), false)
  assert.equal(grammar.plan.some(step => step.type === 'qna'), false)
})

test('any available foundation checkpoint can be selected, with prerequisites enforced', () => {
  const session = diagnose(['Tuesday at 3 pm', 'by', suggestion])
  const [first, second, ...later] = session.plan
  assert.equal(first.status, 'available')
  assert.equal(second.status, 'available')
  assert.equal(later[0].status, 'locked')
  assert.equal(startLesson(session, later[0].id), session)
  assert.equal(currentItem(startLesson(session, second.id)).type, second.type)
})

test('a correct assisted attempt and a repeated prompt do not replace two distinct independent answers', () => {
  let session = diagnose(['Thursday at 3 pm', 'by', suggestion])
  const step = session.plan.find(step => step.type === 'grammar')
  session = startLesson(session, step.id)
  const first = currentItem(session)
  assert.equal(first.options.includes('to'), true)
  session = continueLesson(answer(session, 'to', { assisted: true }))
  assert.equal(session.plan.find(item => item.id === step.id).status, 'available')
  const second = currentItem(session)
  assert.notEqual(second.id, first.id)
  session = continueLesson(answer(session, 'to'))
  assert.equal(session.phase, 'lesson')
  assert.notEqual(currentItem(session).id, second.id)
  session = continueLesson(answer(session, 'to'))
  assert.equal(session.phase, 'plan')
  assert.equal(session.plan.find(item => item.id === step.id).status, 'completed')
  assert.equal(session.plan.find(item => item.type === 'shadowing').status, 'available')
})

test('a confirmed recurring misconception creates one review card and can be hidden', () => {
  let session = diagnose(['Thursday at 3 pm', 'by', suggestion])
  assert.equal(session.reviews.length, 1)
  const { id } = session.reviews[0]
  session = startLesson(session, session.plan[0].id)
  session = continueLesson(answer(session, 'by'))
  assert.equal(session.reviews.length, 1)
  assert.equal(session.reviews[0].id, id)
  session = reviewCard(session, id, 'known')
  assert.equal(session.reviews[0].status, 'known')
  session = reviewCard(session, id, 'again')
  assert.equal(session.reviews[0].status, 'due')
  assert.equal(reviewCard(session, id, 'hide').reviews[0].status, 'hidden')
})

test('unmatched free-form answers and repeats from a model do not generate misconception cards', () => {
  let session = newSession('Переносить встречи', 'uncertain')
  session = answer(session, 'The participant wants another slot')
  assert.equal(session.feedback.uncertain, true)
  assert.deepEqual(session.reviews, [])

  session = diagnose(['Thursday at 3 pm', 'to', suggestion])
  session = startLesson(session, session.plan.find(step => step.type === 'shadowing').id)
  assert.equal(currentItem(session).sample.length > 0, true)
  session = answer(session, currentItem(session).sample, { mode: 'voice' })
  assert.equal(session.attempts.at(-1).assisted, true)
  assert.match(session.feedback.text, /произношени/i)
  assert.deepEqual(session.reviews, [])
})

test('the basic route restores an open lesson and reaches the final quiz through all remaining steps', () => {
  let session = diagnose(['Thursday at 3 pm', 'to', suggestion])
  session = startLesson(session)
  session = continueLesson(answer(session, currentItem(session).sample))
  assert.equal(session.phase, 'plan')
  session = startLesson(session)
  assert.equal(currentItem(session).type, 'role_play')
  session = continueLesson(answer(session, 'Does Friday at eleven work for you?'))
  const restored = JSON.parse(JSON.stringify(session))
  assert.equal(currentItem(restored).id, currentItem(session).id)
  session = continueLesson(answer(restored, 'Monday at two works for me.'))
  assert.equal(session.phase, 'plan')
  session = startLesson(session)
  assert.equal(currentItem(session).type, 'quiz')
  session = continueLesson(answer(session, 'Could we move the demo to Tuesday?'))
  session = continueLesson(answer(session, 'Thursday at 11 am'))
  assert.equal(session.phase, 'done')
  assert.equal(currentItem(session), null)
  assert.equal(session.plan.every(step => step.status === 'completed'), true)
})

test('a goal outside the demo catalog keeps the original wording and limits the result claim', () => {
  const session = newSession('Научиться обсуждать условия аренды', 'uncatalogued')
  assert.equal(session.goal, 'Научиться обсуждать условия аренды')
  assert.equal(session.goalSupported, false)
  assert.equal(newSession('Хочу перенести встречу', 'supported').goalSupported, true)
})
