import { newSession, currentItem, submitAnswer, startLesson, continueLesson, reviewCard } from './engine.mjs';
import { blankWorkspace, restoreWorkspace, saveWorkspace, storeSession, selectSession, removeSession, STORAGE_KEY } from './state.mjs';
import { connectRecognition, connectSample } from './speech.mjs';

const landing = document.querySelector('#landing');
const main = document.querySelector('#main');
const workspace = document.querySelector('#workspace');
const screen = document.querySelector('#screen');
const landingNav = document.querySelector('.landing-nav');
const appNav = document.querySelector('.app-nav');
const storageWarning = document.querySelector('#storage-warning');
const workspaceRoutes = new Set(['app', 'goal', 'plan', 'progress', 'review', 'sessions']);
const formatNames = {
  qna: 'Вопрос по смыслу',
  grammar: 'Грамматика',
  quiz: 'Проверка',
  shadowing: 'Повтор за образцом',
  role_play: 'Ролевой диалог'
};
const phaseNames = {
  diagnosis: 'Диагностика',
  plan: 'Учебный план',
  lesson: 'Занятие',
  done: 'Маршрут пройден'
};
const statusNames = { available: 'Доступен', locked: 'Закрыт', completed: 'Пройден' };
const exampleGoal = 'Научиться переносить встречу на английском';
const symbols = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const html = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => symbols[character]);

let storage;
try {
  storage = window.localStorage;
} catch {
  storage = null;
}

let saved = restoreWorkspace(storage);
let previewReviewId = null;
let cleanUpExercise = () => {};
let lastRoute;
let storageAvailable = Boolean(storage);

function session() {
  return saved.sessions.find(({ id }) => id === saved.activeId);
}

function persist(nextWorkspace) {
  saved = nextWorkspace;
  storageAvailable = saveWorkspace(storage, saved);
  storageWarning.hidden = storageAvailable;
}

function routeTo(route) {
  if (location.hash === '#' + route) {
    render(true);
  } else {
    location.hash = route;
  }
}

function refreshSession(nextSession) {
  persist(storeSession(saved, nextSession));
  render(true);
}

function header(title, description = '') {
  return `<div class="screen-header">
    <h1 tabindex="-1">${html(title)}</h1>
    ${description ? `<p>${html(description)}</p>` : ''}
  </div>`;
}

function showGoal() {
  screen.innerHTML = `${header('Что хотите уметь по-английски?')}
    <section class="panel goal-panel">
      <form id="goal-form">
        <label class="field">Ваша цель
          <textarea name="goal" required minlength="3" maxlength="180" aria-describedby="goal-scope" placeholder="Хочу уметь…"></textarea>
        </label>
        <div class="inline-actions"><button class="text-button" id="example-goal" type="button">Подставить пример</button></div>
        <p class="muted fine-text" id="goal-scope">Упражнения этой версии посвящены переносу встречи. Если у вас другая цель, её можно сохранить и попробовать учебный пример.</p>
        <div class="inline-actions"><button class="button primary" type="submit">Начать диагностику</button></div>
      </form>
    </section>`;
  const form = screen.querySelector('#goal-form');
  const goalField = form.elements.goal;
  screen.querySelector('#example-goal').addEventListener('click', () => {
    goalField.value = exampleGoal;
    goalField.setCustomValidity('');
    goalField.focus();
  });
  goalField.addEventListener('input', () => goalField.setCustomValidity(''));
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (goalField.value.trim().length < 3) {
      goalField.setCustomValidity('Напишите цель хотя бы из трёх символов.');
      goalField.reportValidity();
      return;
    }
    const id = crypto.randomUUID?.() ?? Array.from(crypto.getRandomValues(new Uint32Array(4))).join('-');
    persist(storeSession(saved, newSession(goalField.value, id)));
    routeTo('app');
  });
}

function context(active, { planLink = false } = {}) {
  return `<aside class="panel context">
    <h2>Ваша цель</h2>
    <p>${html(active.goal)}</p>
    ${active.goalSupported === false ? '<small>Для практики открыт учебный сценарий о переносе встречи.</small>' : ''}
    ${planLink ? '<a href="#plan">Посмотреть маршрут</a>' : ''}
  </aside>`;
}

function showPlan(active, overview = false) {
  if (!active.plan.length) {
    screen.innerHTML = `${header('Ваш маршрут')}
      <section class="panel goal-panel">
        <p>Маршрут появится после диагностики.</p>
        <a class="button primary empty-actions" href="#app">Продолжить диагностику</a>
      </section>`;
    return;
  }

  const done = active.phase === 'done';
  const planRows = active.plan.map((step) => `<li class="route-step">
    <h3>${html(step.title)}<span class="pill ${html(step.status)}">${html(statusNames[step.status])}</span></h3>
    <p>${html(step.description)}</p>
    ${step.explanation && step.status !== 'locked' ? `<details class="plan-detail"><summary>Короткий разбор</summary><p>${html(step.explanation)}</p></details>` : ''}
    ${!overview && step.status === 'available' ? `<button class="button primary small" type="button" data-step="${html(step.id)}" aria-label="Начать шаг «${html(step.title)}»">Начать шаг</button>` : ''}
  </li>`).join('');

  screen.innerHTML = `${header(
    done ? 'Маршрут пройден' : 'Ваш маршрут',
    done ? 'Откройте прогресс, чтобы посмотреть выполненные задания.' : active.diagnosisSummary
  )}
    <div class="workspace-grid">
      <section class="panel stack" aria-label="Шаги плана">
        <ol class="route-list">${planRows}</ol>
        ${done ? '<a class="button primary" href="#progress">Смотреть прогресс</a>' : ''}
        ${overview && !done ? '<a class="button secondary" href="#app">К текущему занятию</a>' : ''}
      </section>
      ${context(active)}
    </div>`;
  for (const button of screen.querySelectorAll('[data-step]')) {
    button.addEventListener('click', () => {
      const next = startLesson(active, button.dataset.step);
      if (next !== active) {
        persist(storeSession(saved, next));
        routeTo('app');
      }
    });
  }
}

function materialFor(item) {
  const passage = item.passage
    ? `<blockquote class="passage" lang="en">${html(item.passage)}</blockquote>`
    : '';
  if (passage && item.sourcePolicy !== 'required') {
    return `<details class="hint" data-assistance><summary>Показать текст</summary>${passage}</details>`;
  }
  return passage;
}

function answerField(item, attempt, hasFeedback) {
  if (item.options?.length) {
    return `<fieldset class="options" ${hasFeedback ? 'disabled' : ''}>
      <legend class="sr-only">Выберите один ответ</legend>
      ${item.options.map((option) => `<label class="option"><input type="radio" name="answer" value="${html(option)}" ${attempt?.answer === option ? 'checked' : ''} required><span ${/[а-я]/i.test(option) ? '' : 'lang="en"'}>${html(option)}</span></label>`).join('')}
    </fieldset>`;
  }
  return `<label class="field" for="exercise-answer">Ваш ответ
    <textarea id="exercise-answer" name="answer" lang="en" required maxlength="600" placeholder="${html(item.placeholder ?? 'Напишите по-английски')}" ${hasFeedback ? 'readonly' : ''}>${html(attempt?.answer)}</textarea>
  </label>`;
}

function showExercise(active) {
  const item = currentItem(active);
  const diagnosis = active.phase === 'diagnosis';
  if (!item) {
    screen.innerHTML = `${header('Задание недоступно')}<a class="button secondary" href="#sessions">Открыть сессии</a>`;
    return;
  }

  const feedback = active.feedback;
  const attempt = feedback ? active.attempts.at(-1) : null;
  const voiceAvailable = !item.options?.length && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
  const feedbackStatus = diagnosis || feedback?.uncertain ? '' : String(feedback?.correct ?? '');
  const feedbackHeading = diagnosis ? 'Ответ принят' : feedback?.uncertain ? 'Ответ требует уточнения' : feedback?.correct ? 'Верно' : 'Есть что уточнить';

  screen.innerHTML = `${header(diagnosis ? 'Диагностика' : 'Занятие')}
    <div class="workspace-grid">
      <article class="panel exercise">
        <p class="eyebrow">${html(formatNames[item.type])}</p>
        <h2>${html(item.title)}</h2>
        ${materialFor(item)}
        <p class="prompt">${html(item.prompt)}</p>
        ${item.sample ? `<div class="voice-controls">
          <button class="button secondary small" id="play-sample" type="button">Послушать образец</button>
          <details class="hint" id="sample-transcript"><summary>Показать текст образца</summary><p lang="en">${html(item.sample)}</p></details>
          <p class="fine-text muted speech-status" id="sample-status" role="status"></p>
        </div>` : ''}
        ${item.hint && !feedback ? `<details class="hint" data-assistance><summary>Показать подсказку</summary><p>${html(item.hint)}</p></details>` : ''}
        <form id="exercise-form" class="exercise-form">
          ${voiceAvailable && !feedback ? `<div class="voice-controls">
            <button class="button secondary small" type="button" id="record" aria-pressed="false" aria-describedby="speech-notice">Сказать ответ</button>
            <p class="fine-text muted" id="speech-notice">Речь распознаёт браузер. Аудио может передаваться его сервису. Перед отправкой можно исправить текст.</p>
            <p class="fine-text speech-status" id="speech-status" role="status"></p>
          </div>` : ''}
          ${answerField(item, attempt, Boolean(feedback))}
          ${!feedback ? '<p class="form-error fine-text" id="answer-error" role="status"></p><button class="button primary" type="submit">Проверить ответ</button>' : ''}
        </form>
        ${feedback ? `<div class="feedback" data-correct="${html(feedbackStatus)}" tabindex="-1">
          <strong>${html(feedbackHeading)}</strong><p>${html(feedback.text)}</p>
        </div><button class="button primary" id="continue" type="button">Продолжить</button>` : ''}
      </article>
      ${context(active, { planLink: !diagnosis })}
    </div>`;

  const shutdown = [];
  cleanUpExercise = () => shutdown.forEach((stop) => stop());
  if (item.sample) {
    shutdown.push(connectSample(
      screen.querySelector('#play-sample'),
      screen.querySelector('#sample-status'),
      screen.querySelector('#sample-transcript'),
      item.sample
    ));
  }
  if (feedback) {
    screen.querySelector('#continue').addEventListener('click', () => refreshSession(continueLesson(active)));
    return;
  }

  let assisted = active.helpedItem === item.id;
  let mode = 'text';
  const form = screen.querySelector('#exercise-form');
  const submit = form.querySelector('button[type="submit"]');

  for (const detail of screen.querySelectorAll('[data-assistance]')) {
    detail.addEventListener('toggle', () => {
      const stored = session();
      if (detail.isConnected && detail.open && !assisted && stored && !stored.feedback && currentItem(stored)?.id === item.id) {
        assisted = true;
        persist(storeSession(saved, { ...stored, helpedItem: item.id }));
      }
    });
  }
  if (voiceAvailable) {
    const textarea = screen.querySelector('#exercise-answer');
    shutdown.push(connectRecognition(screen.querySelector('#record'), screen.querySelector('#speech-status'), {
      busy: (busy) => { submit.disabled = busy; },
      transcript: (text) => {
        textarea.value = text.slice(0, textarea.maxLength);
        mode = 'voice';
        textarea.focus();
      }
    }));
    textarea.addEventListener('input', () => {
      if (!textarea.value) mode = 'text';
    });
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (submit.disabled) return;

    const answer = new FormData(form).get('answer');
    if (!answer?.trim()) {
      screen.querySelector('#answer-error').textContent = 'Введите или выберите ответ.';
      return;
    }
    const helpOpen = Boolean(screen.querySelector('[data-assistance][open]'));
    const next = submitAnswer(active, { itemId: item.id, answer, assisted: assisted || helpOpen, mode });
    if (next !== active) {
      refreshSession(next);
      screen.querySelector('.feedback')?.focus();
    }
  });
}

function showProgress(active) {
  const attempts = active?.attempts ?? [];
  const completed = active?.plan.filter((step) => step.status === 'completed').length ?? 0;
  const independent = attempts.filter((attempt) => attempt.correct && !attempt.assisted && attempt.phase === 'lesson').length;
  const history = attempts.slice(-8).reverse().map((attempt) => `<li>
    <p><strong>${html(formatNames[attempt.type])}</strong> · ${html(attempt.phase === 'diagnosis' ? 'Диагностика' : 'Занятие')}</p>
    <p lang="en">${html(attempt.answer)}</p>
    <p class="muted fine-text">${attempt.outcome === 'uncertain' ? 'Требует уточнения' : attempt.correct ? 'Верный ответ' : 'Ответ с ошибкой'}
      · ${attempt.mode === 'voice' ? 'Расшифровка' : 'Текст'}
      ${attempt.assisted ? ' · С помощью' : ''}
    </p>
  </li>`).join('');
  screen.innerHTML = `${header('Прогресс', active?.goal)}
    <section class="panel goal-panel stack">
      ${attempts.length ? `<div class="metric-grid">
        <p class="metric"><strong>${completed}</strong>Шагов пройдено</p>
        <p class="metric"><strong>${independent}</strong>Верных ответов в занятии без помощи</p>
      </div>
      <h2>Последние ответы</h2>
      <ul class="history-list">${history}</ul>` : '<p>Здесь появятся ваши ответы и пройденные шаги.</p>'}
      <a class="button secondary" href="#app">${active ? 'К текущему занятию' : 'Начать занятие'}</a>
    </section>`;
}

function showReview(active) {
  const due = active?.reviews.filter((card) => card.status === 'due') ?? [];
  const card = due[0];
  const revealed = card?.id === previewReviewId;
  screen.innerHTML = `${header('Повторы', active?.goal)}
    <section class="panel goal-panel stack">
      ${card ? `<p class="eyebrow">К повтору · ${due.length}</p>
        <p class="review-front">${html(card.front)}</p>
        ${revealed ? `<p class="review-back">${html(card.back)}</p>
          <div class="inline-actions">
            <button class="button primary small" type="button" data-review="known">Понятно</button>
            <button class="button secondary small" type="button" data-review="again">Ещё раз</button>
            <button class="button quiet small" type="button" data-review="hide">Скрыть</button>
          </div>` : '<div><button class="button secondary small" type="button" id="reveal-card">Показать ответ</button></div>'}`
        : `<p>Карточек к повтору пока нет. Они появятся после подтверждённых ошибок.</p>
          <a class="button secondary" href="#app">${active ? 'К текущему занятию' : 'Начать занятие'}</a>`}
    </section>`;
  screen.querySelector('#reveal-card')?.addEventListener('click', () => {
    previewReviewId = card.id;
    showReview(active);
    screen.querySelector('.review-back').tabIndex = -1;
    screen.querySelector('.review-back').focus();
  });
  for (const button of screen.querySelectorAll('[data-review]')) {
    button.addEventListener('click', () => {
      previewReviewId = null;
      refreshSession(reviewCard(active, card.id, button.dataset.review));
    });
  }
}

function showSessions() {
  const rows = saved.sessions.map((entry) => `<li>
    <span class="session-title">${html(entry.goal)}</span>
    <span class="session-status muted fine-text">${html(phaseNames[entry.phase])}</span>
    <div class="inline-actions">
      <button class="button secondary small" type="button" data-open="${html(entry.id)}">Открыть</button>
      <button class="button quiet small" type="button" data-delete="${html(entry.id)}">Удалить</button>
    </div>
  </li>`).join('');

  screen.innerHTML = `${header('Сессии', 'Цели и принятые ответы хранятся в этом браузере. Черновик ответа сохраняется до ухода с упражнения.')}
    <section class="panel goal-panel stack">
      ${rows ? `<ul class="session-list">${rows}</ul>` : '<p>У вас пока нет сохранённых занятий.</p>'}
      <div class="inline-actions">
        <a class="button primary small" href="#goal">Новая цель</a>
        ${rows ? '<button class="button quiet small" type="button" id="delete-all">Удалить все данные</button>' : ''}
      </div>
    </section>
    <dialog class="panel" id="delete-dialog" aria-labelledby="delete-title">
      <h2 id="delete-title">Удалить данные?</h2>
      <p id="delete-description"></p>
      <form method="dialog" class="inline-actions">
        <button class="button quiet small" value="cancel" autofocus>Отмена</button>
        <button class="button primary small" value="delete">Удалить</button>
      </form>
    </dialog>`;

  for (const button of screen.querySelectorAll('[data-open]')) {
    button.addEventListener('click', () => {
      persist(selectSession(saved, button.dataset.open));
      routeTo('app');
    });
  }

  const dialog = screen.querySelector('#delete-dialog');
  let nextWorkspace;
  function promptDelete(next, description) {
    nextWorkspace = next;
    dialog.returnValue = '';
    dialog.querySelector('#delete-description').textContent = description;
    dialog.showModal();
  }

  for (const button of screen.querySelectorAll('[data-delete]')) {
    button.addEventListener('click', () => promptDelete(
      removeSession(saved, button.dataset.delete), 'Цель, история ответов и карточки этой сессии будут удалены.'
    ));
  }
  screen.querySelector('#delete-all')?.addEventListener('click', () => promptDelete(
    blankWorkspace(), 'Будут удалены все сохранённые здесь цели, ответы и карточки.'
  ));
  dialog.addEventListener('close', () => {
    if (dialog.returnValue === 'delete') {
      persist(nextWorkspace);
      render(true);
    }
  });
}

function render(focus = false) {
  cleanUpExercise();
  cleanUpExercise = () => {};
  const route = location.hash.slice(1);
  const inWorkspace = workspaceRoutes.has(route);
  landing.hidden = inWorkspace;
  workspace.hidden = !inWorkspace;
  landingNav.hidden = inWorkspace;
  appNav.hidden = !inWorkspace;
  for (const link of landing.querySelectorAll('[data-start]')) {
    if (link.closest('.hero-actions')) link.textContent = session() ? 'Продолжить занятие' : 'Попробовать урок';
  }
  for (const link of appNav.querySelectorAll('a')) {
    const href = link.hash.slice(1);
    if (href === route || (href === 'app' && ['goal', 'plan'].includes(route))) {
      link.setAttribute('aria-current', 'page');
    } else {
      link.removeAttribute('aria-current');
    }
  }

  if (!inWorkspace) {
    if (route === 'how') document.querySelector('#how').scrollIntoView();
    if (route === 'home') window.scrollTo(0, 0);
    lastRoute = route;
    return;
  }

  if (route !== 'review') previewReviewId = null;
  storageWarning.hidden = storageAvailable;
  const active = session();

  if (route === 'sessions') showSessions();
  else if (route === 'progress') showProgress(active);
  else if (route === 'review') showReview(active);
  else if (route === 'goal' || !active) showGoal();
  else if (route === 'plan' || ['plan', 'done'].includes(active.phase)) showPlan(active, active.phase === 'lesson');
  else showExercise(active);

  if (focus || route !== lastRoute) {
    window.scrollTo(0, 0);
    screen.querySelector('h1')?.focus({ preventScroll: true });
  }
  lastRoute = route;
}

const previewOptions = [...document.querySelectorAll('[data-preview-answer]')];
for (const option of previewOptions) {
  option.addEventListener('click', () => {
    const correct = option.dataset.previewAnswer === 'friday';
    for (const button of previewOptions) button.setAttribute('aria-pressed', String(button === option));
    document.querySelector('#preview-feedback').textContent = correct
      ? 'Верно. Звонок перенесли на пятницу, 10:00.'
      : 'Среда — прежний день. Новое время идёт после «moved to».';
  });
}

document.querySelector('.skip-link').addEventListener('click', (event) => {
  event.preventDefault();
  main.focus();
  main.scrollIntoView();
});
window.addEventListener('hashchange', () => render());
window.addEventListener('pagehide', () => cleanUpExercise());
window.addEventListener('storage', (event) => {
  if (event.storageArea === storage && (event.key === STORAGE_KEY || event.key === null)) {
    saved = restoreWorkspace(storage);
    render();
  }
});
navigator.serviceWorker?.register('./sw.js').catch(() => {});
render();
