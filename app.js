const CHANNEL_NAME = 'signal-keyboard-demo-v1';
const pageRole = document.body.dataset.page || 'unknown';
const log = (...args) => console.log(`[Signal Keyboard / ${pageRole}]`, ...args);
const warn = (...args) => console.warn(`[Signal Keyboard / ${pageRole}]`, ...args);
const error = (...args) => console.error(`[Signal Keyboard / ${pageRole}]`, ...args);
const seenMessages = new Set();

log('Initializing page', { url: window.location.href, channel: CHANNEL_NAME });

let bus = null;
try {
  if ('BroadcastChannel' in window) {
    bus = new BroadcastChannel(CHANNEL_NAME);
    log('BroadcastChannel created successfully');
  } else {
    warn('BroadcastChannel is not supported; using localStorage fallback only');
  }
} catch (cause) {
  error('Could not create BroadcastChannel; using localStorage fallback', cause);
}

const send = message => {
  const packet = { ...message, at: Date.now(), from: pageRole, id: `${pageRole}-${Date.now()}-${Math.random().toString(36).slice(2)}` };
  log('Sending message', packet);
  if (bus) {
    try {
      bus.postMessage(packet);
      log('BroadcastChannel postMessage completed');
    } catch (cause) {
      error('BroadcastChannel postMessage failed', cause);
    }
  }
  try {
    localStorage.setItem(CHANNEL_NAME, JSON.stringify(packet));
    log('localStorage fallback message written');
  } catch (cause) {
    error('localStorage fallback failed', cause);
  }
};

const parseMessage = raw => {
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (cause) {
    error('Received malformed message', { raw, cause });
    return null;
  }
};

const subscribe = handler => {
  const deliver = (raw, transport) => {
    const message = parseMessage(raw);
    if (!message) return;
    if (message.id && seenMessages.has(message.id)) {
      log('Ignored duplicate delivery of the same message', { id: message.id, transport });
      return;
    }
    if (message.id) seenMessages.add(message.id);
    log(`Received ${transport} message`, message);
    handler(message, transport);
  };
  if (bus) {
    bus.onmessage = event => deliver(event.data, 'BroadcastChannel');
    log('Listening on BroadcastChannel');
  }
  window.addEventListener('storage', event => {
    if (event.key !== CHANNEL_NAME || !event.newValue) return;
    deliver(event.newValue, 'localStorage');
  });
  log('Listening for localStorage fallback messages');
};

const notes = [
  ['C3', 48, 'a'], ['D3', 50, 's'], ['E3', 52, 'd'], ['F3', 53, 'f'], ['G3', 55, 'g'], ['A3', 57, 'h'], ['B3', 59, 'j'],
  ['C4', 60, 'k'], ['D4', 62, 'l'], ['E4', 64, ';'], ['F4', 65, "'"], ['G4', 67, 'z'], ['A4', 69, 'x'], ['B4', 71, 'c'], ['C5', 72, 'v']
];
const blackNotes = [['C#3', 49, 'w', 1], ['D#3', 51, 'e', 2], ['F#3', 54, 't', 4], ['G#3', 56, 'y', 5], ['A#3', 58, 'u', 6], ['C#4', 61, 'i', 8], ['D#4', 63, 'o', 9], ['F#4', 66, 'p', 11], ['G#4', 68, '[', 12], ['A#4', 70, ']', 13]];
const pressed = new Set();
const keyboard = document.querySelector('#keyboard');

const makeKey = (note, midi, key, black = false, position = 0) => {
  const el = document.createElement('button');
  el.className = `key${black ? ' black-key' : ''}`;
  el.dataset.midi = midi;
  el.dataset.note = note;
  el.setAttribute('aria-label', `Play ${note}`);
  el.innerHTML = `<span class="key-label">${key.toUpperCase()}</span>`;
  if (black) el.style.left = `calc(${position * 6.25}% - 3.5%)`;
  const down = event => {
    event.preventDefault();
    if (pressed.has(midi)) return;
    pressed.add(midi);
    el.classList.add('pressed');
    log('Pointer note on', { note, midi });
    send({ type: 'noteon', note, midi });
  };
  const up = event => {
    event.preventDefault();
    if (!pressed.has(midi)) return;
    pressed.delete(midi);
    el.classList.remove('pressed');
    log('Pointer note off', { note, midi });
    send({ type: 'noteoff', note, midi });
  };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointerleave', up);
  el.addEventListener('pointercancel', up);
  keyboard.appendChild(el);
};

if (keyboard) {
  notes.forEach(item => makeKey(...item));
  blackNotes.forEach(item => makeKey(item[0], item[1], item[2], true, item[3]));
  const keyMap = new Map([...notes, ...blackNotes].map(item => [item[2], item]));
  log('Keyboard ready', { whiteKeys: notes.length, blackKeys: blackNotes.length, computerKeyCount: keyMap.size });
  window.addEventListener('keydown', event => {
    const item = keyMap.get(event.key);
    if (!item || event.repeat || pressed.has(item[1])) return;
    pressed.add(item[1]);
    keyboard.querySelector(`[data-midi="${item[1]}"]`).classList.add('pressed');
    log('Computer-key note on', { key: event.key, note: item[0], midi: item[1] });
    send({ type: 'noteon', note: item[0], midi: item[1] });
  });
  window.addEventListener('keyup', event => {
    const item = keyMap.get(event.key);
    if (!item || !pressed.has(item[1])) return;
    pressed.delete(item[1]);
    keyboard.querySelector(`[data-midi="${item[1]}"]`).classList.remove('pressed');
    log('Computer-key note off', { key: event.key, note: item[0], midi: item[1] });
    send({ type: 'noteoff', note: item[0], midi: item[1] });
  });
  subscribe(message => {
    if (message.type === 'receiver-ready') log('Receiver is connected and listening', message);
  });
}

if (pageRole === 'receiver') {
  const active = new Map();
  const audioButton = document.querySelector('#audio-toggle');
  const audioStatus = document.querySelector('#audio-status');
  let audio;
  const startAudio = () => {
    try {
      if (!audio) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) throw new Error('Web Audio API is unavailable in this browser');
        audio = new AudioContextClass();
        log('AudioContext created', { state: audio.state, sampleRate: audio.sampleRate });
      }
      if (audio.state === 'suspended') {
        log('AudioContext is suspended; requesting resume');
        audio.resume().then(() => log('AudioContext resumed', { state: audio.state })).catch(cause => error('AudioContext resume failed', cause));
      }
      audioButton.classList.add('enabled');
      audioStatus.textContent = 'Audio is on';
      audioButton.querySelector('small').textContent = 'Ready to receive notes';
    } catch (cause) {
      error('Could not start audio', cause);
      audioStatus.textContent = 'Audio unavailable';
      audioButton.querySelector('small').textContent = 'Check browser permissions';
    }
  };
  const render = () => {
    const list = document.querySelector('#active-notes');
    list.innerHTML = active.size ? [...active.values()].map(item => `<span class="active-note">${item.note}</span>`).join('') : '<span class="empty-state">Waiting for a note from the sender…</span>';
    document.querySelector('#note-display').textContent = active.size ? [...active.values()].map(item => item.note).join(' · ') : '—';
    document.querySelector('#note-orbit').classList.toggle('playing', active.size > 0);
    log('Receiver display updated', { activeNotes: [...active.keys()] });
  };
  audioButton.addEventListener('click', () => { log('Audio enable button clicked'); startAudio(); });
  window.addEventListener('pointerdown', startAudio, { once: true });
  log('Receiver ready; click the page once to satisfy browser audio permissions');
  send({ type: 'receiver-ready' });
  subscribe((message, transport) => {
    if (message.type === 'receiver-ready') return;
    if (!['noteon', 'noteoff'].includes(message.type) || typeof message.midi !== 'number') {
      warn('Ignoring unsupported message', message);
      return;
    }
    log('Processing note message', { ...message, transport });
    startAudio();
    if (!audio || audio.state === 'closed') {
      error('Cannot play note because AudioContext is unavailable or closed');
      return;
    }
    if (message.type === 'noteon') {
      if (active.has(message.midi)) { warn('Ignoring duplicate note-on', message); return; }
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = 'sine';
      osc.frequency.value = 440 * Math.pow(2, (message.midi - 69) / 12);
      gain.gain.setValueAtTime(0.0001, audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.2, audio.currentTime + 0.025);
      osc.connect(gain).connect(audio.destination);
      osc.start();
      active.set(message.midi, { note: message.note, osc, gain });
      log('Started oscillator', { note: message.note, midi: message.midi, frequency: osc.frequency.value });
    } else if (active.has(message.midi)) {
      const voice = active.get(message.midi);
      voice.gain.gain.cancelScheduledValues(audio.currentTime);
      voice.gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.15);
      voice.osc.stop(audio.currentTime + 0.16);
      active.delete(message.midi);
      log('Stopped oscillator', { note: message.note, midi: message.midi });
    } else {
      warn('Received note-off for a note that is not active', message);
    }
    render();
  });
}
