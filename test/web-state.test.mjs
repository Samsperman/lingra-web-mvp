import assert from 'node:assert/strict';
import test from 'node:test';
import { blankWorkspace, restoreWorkspace, saveWorkspace, storeSession, selectSession, removeSession, STORAGE_KEY } from '../src/state.mjs';

function memoryStorage() {
  const entries = new Map();
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value)
  };
}

function session(id, phase = 'diagnosis') {
  return {
    id, phase, goal: 'Перенести встречу', plan: [], attempts: [], reviews: [], feedback: null
  };
}

test('restores the open exercise and accepted feedback after a reload', () => {
  const storage = memoryStorage();
  const open = { ...session('meeting', 'lesson'), stepId: 'conversation', feedback: { correct: true, text: 'Верно' } };

  assert.equal(saveWorkspace(storage, storeSession(blankWorkspace(), open)), true);
  assert.deepEqual(restoreWorkspace(storage), { sessions: [open], activeId: 'meeting' });
});

test('a new goal keeps previous sessions and changing goals only changes the active session', () => {
  const original = storeSession(blankWorkspace(), session('first'));
  const withNewGoal = storeSession(original, session('second'));

  assert.equal(withNewGoal.activeId, 'second');
  assert.deepEqual(selectSession(withNewGoal, 'first').sessions, [session('second'), session('first')]);
  assert.equal(selectSession(withNewGoal, 'missing'), withNewGoal);
});

test('accepting an attempt replaces the matching session without creating a duplicate', () => {
  const original = storeSession(blankWorkspace(), session('meeting'));
  const updated = { ...session('meeting'), attempts: [{ itemId: 'destination', correct: true }] };

  assert.deepEqual(storeSession(original, updated).sessions, [updated]);
});

test('deleting the active session selects the most recent saved goal', () => {
  const workspace = storeSession(storeSession(blankWorkspace(), session('first')), session('second'));

  assert.deepEqual(removeSession(workspace, 'second'), { sessions: [session('first')], activeId: 'first' });
});

test('invalid or disabled storage does not block the lesson', () => {
  const storage = memoryStorage();
  storage.setItem(STORAGE_KEY, '{oops');
  assert.deepEqual(restoreWorkspace(storage), blankWorkspace());

  const deniedStorage = {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); }
  };
  assert.deepEqual(restoreWorkspace(deniedStorage), blankWorkspace());
  assert.equal(saveWorkspace(deniedStorage, blankWorkspace()), false);
});
