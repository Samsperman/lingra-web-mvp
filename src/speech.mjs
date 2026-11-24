const recognitionErrors = {
  'not-allowed': 'Нет доступа к микрофону. Проверьте разрешение браузера или введите ответ.',
  'service-not-allowed': 'Распознавание отключено в браузере. Введите ответ с клавиатуры.',
  'audio-capture': 'Микрофон недоступен. Введите ответ с клавиатуры.',
  'no-speech': 'Речь не распознана. Попробуйте ещё раз или введите ответ.',
  network: 'Сервис распознавания недоступен. Введите ответ с клавиатуры.'
};

export function connectRecognition(button, status, { busy, transcript }) {
  const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
  let recognition = null;
  let state = 'idle';

  function setState(next) {
    state = next;
    const listening = next === 'listening';
    button.setAttribute('aria-pressed', String(listening));
    const labels = {
      idle: 'Сказать ответ',
      requesting: 'Подключаем микрофон…',
      listening: 'Остановить запись',
      stopping: 'Обработка…'
    };
    button.textContent = labels[next];
    button.disabled = next === 'requesting' || next === 'stopping';
    busy(next !== 'idle');
  }

  function record() {
    if (state === 'listening') {
      setState('stopping');
      status.textContent = 'Распознаём запись…';
      try {
        recognition.stop();
      } catch {
        recognition.abort();
      }
      return;
    }
    if (state !== 'idle') return;

    const current = new Recognition();
    let finished = false;
    recognition = current;
    current.lang = 'en-US';
    current.interimResults = false;
    current.continuous = false;
    current.onstart = () => {
      if (current !== recognition) return;
      setState('listening');
      status.textContent = 'Микрофон включён. Говорите по-английски.';
    };
    current.onresult = (event) => {
      if (current !== recognition) return;
      const text = Array.from(event.results, (item) => item[0]?.transcript ?? '').join(' ').trim();
      if (!text) return;
      finished = true;
      transcript(text);
      status.textContent = 'Проверьте расшифровку перед отправкой.';
    };
    current.onerror = (event) => {
      if (current !== recognition) return;
      finished = true;
      status.textContent = recognitionErrors[event.error] ?? 'Не удалось распознать речь. Попробуйте ещё раз или введите ответ.';
    };
    current.onend = () => {
      if (current !== recognition) return;
      if (!finished) {
        status.textContent = 'Ответ не распознан. Попробуйте ещё раз или введите его.';
      }
      recognition = null;
      setState('idle');
    };

    setState('requesting');
    status.textContent = 'Запрашиваем доступ к микрофону…';
    try {
      current.start();
    } catch {
      recognition = null;
      setState('idle');
      status.textContent = 'Микрофон недоступен. Введите ответ с клавиатуры.';
    }
  }

  button.addEventListener('click', record);
  return () => {
    button.removeEventListener('click', record);
    const current = recognition;
    recognition = null;
    current?.abort();
  };
}

export function connectSample(button, status, details, text) {
  let pending;

  function failed() {
    pending = null;
    details.open = true;
    status.textContent = 'Озвучка недоступна. Можно прочитать текст образца.';
  }

  function play() {
    if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) {
      failed();
      return;
    }
    if (pending) {
      pending = null;
      window.speechSynthesis.cancel();
      status.textContent = 'Озвучка остановлена.';
      button.textContent = 'Послушать образец';
      return;
    }

    const utterance = new window.SpeechSynthesisUtterance(text);
    pending = utterance;
    utterance.lang = 'en-US';
    utterance.rate = 0.88;
    utterance.onend = () => {
      if (pending !== utterance) return;
      pending = null;
      button.textContent = 'Послушать образец';
      status.textContent = '';
    };
    utterance.onerror = () => {
      if (pending !== utterance) return;
      button.textContent = 'Послушать образец';
      failed();
    };
    button.textContent = 'Остановить озвучку';
    status.textContent = 'Воспроизводится образец.';
    try {
      window.speechSynthesis.speak(utterance);
    } catch {
      button.textContent = 'Послушать образец';
      failed();
    }
  }

  button.addEventListener('click', play);
  return () => {
    button.removeEventListener('click', play);
    if (pending) {
      pending = null;
      window.speechSynthesis.cancel();
    }
  };
}
