// src/sound.js
//
// The global sound switch. Music examples (the music-player widget) light up
// keys and frets either way; they only make sound while sound is on. The
// choice is saved in localStorage ("alexandria-sound": "on" | "off", default
// on) and a header button (#sound-toggle) flips it. Widgets read soundOn() at
// play time and can subscribe to changes to silence notes already sounding.

export const STORAGE_KEY = "alexandria-sound";
const listeners = new Set();

/** @returns {boolean} Whether music examples should make sound. */
export function soundOn(storage = globalThis.localStorage) {
  try {
    return (storage ? storage.getItem(STORAGE_KEY) : null) !== "off";
  } catch {
    return true;
  }
}

/** Turn sound on or off, save it and tell subscribers. */
export function setSound(on, storage = globalThis.localStorage) {
  try {
    storage.setItem(STORAGE_KEY, on ? "on" : "off");
  } catch {
    // Storage refused: the in-memory listeners still hear about it.
  }
  for (const fn of listeners) fn(on);
}

/** Call `fn(on)` whenever the switch changes; returns an unsubscribe function. */
export function onSoundChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function label(button, on) {
  button.textContent = on ? "♪ Sound on" : "♪ Sound off";
  button.setAttribute("aria-pressed", on ? "true" : "false");
  button.setAttribute("aria-label", on ? "Turn music sound off" : "Turn music sound on");
}

/** Wire the header button. */
export function installSoundToggle(button, storage = globalThis.localStorage) {
  if (!button) return;
  label(button, soundOn(storage));
  button.hidden = false;
  button.addEventListener("click", () => {
    const on = !soundOn(storage);
    setSound(on, storage);
    label(button, on);
  });
}

if (typeof document !== "undefined" && document.getElementById) {
  installSoundToggle(document.getElementById("sound-toggle"));
}
