const channel = 'signal-keyboard-demo-v1';
const bus = 'BroadcastChannel' in window ? new BroadcastChannel(channel) : null;
const send = message => {
  const packet = { ...message, at: Date.now() };
  if (bus) bus.postMessage(packet);
  localStorage.setItem(channel, JSON.stringify(packet));
};
const subscribe = handler => {
  if (bus) bus.onmessage = event => handler(event.data);
  window.addEventListener('storage', event => { if (event.key === channel && event.newValue) handler(JSON.parse(event.newValue)); });
};

const notes = [
  ['C3', 48, 'a'], ['D3', 50, 's'], ['E3', 52, 'd'], ['F3', 53, 'f'], ['G3', 55, 'g'], ['A3', 57, 'h'], ['B3', 59, 'j'],
  ['C4', 60, 'k'], ['D4', 62, 'l'], ['E4', 64, ';'], ['F4', 65, "'"], ['G4', 67, 'z'], ['A4', 69, 'x'], ['B4', 71, 'c'], ['C5', 72, 'v']
];
const blackNotes = [['C#3', 49, 'w', 1], ['D#3', 51, 'e', 2], ['F#3', 54, 't', 4], ['G#3', 56, 'y', 5], ['A#3', 58, 'u', 6], ['C#4', 61, 'i', 8], ['D#4', 63, 'o', 9], ['F#4', 66, 'p', 11], ['G#4', 68, '[', 12], ['A#4', 70, ']', 13]];
const pressed = new Set();
const keyboard = document.querySelector('#keyboard');
const makeKey = (note, midi, key, black = false, position = 0) => {
  const el = document.createElement('button'); el.className = `key${black ? ' black-key' : ''}`; el.dataset.midi = midi; el.dataset.note = note; el.setAttribute('aria-label', `Play ${note}`); el.innerHTML = `<span class="key-label">${key.toUpperCase()}</span>`;
  if (black) el.style.left = `calc(${position * 6.25}% - 3.5%)`;
  const down = event => { event.preventDefault(); if (!pressed.has(midi)) { pressed.add(midi); el.classList.add('pressed'); send({ type: 'noteon', note, midi }); } };
  const up = event => { event.preventDefault(); if (pressed.has(midi)) { pressed.delete(midi); el.classList.remove('pressed'); send({ type: 'noteoff', note, midi }); } };
  el.addEventListener('pointerdown', down); el.addEventListener('pointerup', up); el.addEventListener('pointerleave', up); el.addEventListener('pointercancel', up); keyboard.appendChild(el);
};
if (keyboard) { notes.forEach(item => makeKey(...item)); blackNotes.forEach(item => makeKey(item[0], item[1], item[2], true, item[3])); const keyMap = new Map([...notes, ...blackNotes].map(item => [item[2], item])); window.addEventListener('keydown', e => { const item = keyMap.get(e.key); if (item && !e.repeat && !pressed.has(item[1])) { pressed.add(item[1]); const el = keyboard.querySelector(`[data-midi="${item[1]}"]`); el.classList.add('pressed'); send({ type: 'noteon', note: item[0], midi: item[1] }); } }); window.addEventListener('keyup', e => { const item = keyMap.get(e.key); if (item && pressed.has(item[1])) { pressed.delete(item[1]); keyboard.querySelector(`[data-midi="${item[1]}"]`).classList.remove('pressed'); send({ type: 'noteoff', note: item[0], midi: item[1] }); } }); }

if (document.body.dataset.page === 'receiver') {
  const active = new Map(); const audioButton = document.querySelector('#audio-toggle'); const audioStatus = document.querySelector('#audio-status'); let audio;
  const startAudio = () => { if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === 'suspended') audio.resume(); audioButton.classList.add('enabled'); audioStatus.textContent = 'Audio is on'; audioButton.querySelector('small').textContent = 'Ready to receive notes'; };
  audioButton.addEventListener('click', startAudio); window.addEventListener('pointerdown', startAudio, { once: true });
  const render = () => { const list = document.querySelector('#active-notes'); list.innerHTML = active.size ? [...active.values()].map(item => `<span class="active-note">${item.note}</span>`).join('') : '<span class="empty-state">Waiting for a note from the sender…</span>'; document.querySelector('#note-display').textContent = active.size ? [...active.values()].map(item => item.note).join(' · ') : '—'; document.querySelector('#note-orbit').classList.toggle('playing', active.size > 0); };
  subscribe(message => { startAudio(); if (message.type === 'noteon') { const osc = audio.createOscillator(); const gain = audio.createGain(); osc.type = 'sine'; osc.frequency.value = 440 * Math.pow(2, (message.midi - 69) / 12); gain.gain.setValueAtTime(0.0001, audio.currentTime); gain.gain.exponentialRampToValueAtTime(0.2, audio.currentTime + 0.025); osc.connect(gain).connect(audio.destination); osc.start(); active.set(message.midi, { note: message.note, osc, gain }); } else if (message.type === 'noteoff' && active.has(message.midi)) { const voice = active.get(message.midi); voice.gain.gain.cancelScheduledValues(audio.currentTime); voice.gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.15); voice.osc.stop(audio.currentTime + 0.16); active.delete(message.midi); } render(); });
}
