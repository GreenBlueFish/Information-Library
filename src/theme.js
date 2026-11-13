// src/theme.js
//
// The light/dark switch. The theme is the `data-theme` attribute on <html>
// ("light" or "dark"); tokens.css holds a palette for each. An inline script
// in index.html sets it before first paint: the reader's saved choice, else
// the system setting. This module wires the header button: a click flips the
// theme and saves the choice. Until the reader chooses, the page follows the
// system setting live (e.g. when the OS switches to dark at sunset).

export const STORAGE_KEY = "alexandria-theme";

/** @returns {"light"|"dark"|null} The saved choice, if any. */
export function savedTheme(storage = globalThis.localStorage) {
  try {
    const t = storage ? storage.getItem(STORAGE_KEY) : null;
    return t === "light" || t === "dark" ? t : null;
  } catch {
    return null;
  }
}

/** @returns {"light"|"dark"} The system's preference. */
export function systemTheme(win = globalThis.window) {
  return win && typeof win.matchMedia === "function" &&
    win.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * Put `theme` on the root element and update the button: its label names the
 * theme a click switches to, and aria-pressed says whether dark is on.
 * @param {"light"|"dark"} theme
 * @param {HTMLElement|null} button
 * @param {HTMLElement} root
 */
export function applyTheme(theme, button, root = document.documentElement) {
  root.setAttribute("data-theme", theme);
  if (button) {
    const dark = theme === "dark";
    button.textContent = dark ? "☀ Light mode" : "☾ Dark mode";
    button.setAttribute("aria-pressed", dark ? "true" : "false");
    button.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
  }
}

/**
 * Wire the toggle. Returns a function that removes the system listener.
 * @param {HTMLElement|null} button
 * @returns {() => void}
 */
export function installThemeToggle(button, win = globalThis.window, storage = globalThis.localStorage) {
  const root = document.documentElement;
  const current = () => (root.getAttribute("data-theme") === "dark" ? "dark" : "light");
  applyTheme(savedTheme(storage) ?? systemTheme(win), button, root);
  if (button) {
    button.hidden = false;
    button.addEventListener("click", () => {
      const next = current() === "dark" ? "light" : "dark";
      try {
        storage.setItem(STORAGE_KEY, next);
      } catch {
        // Private mode may refuse storage; the switch still works for this visit.
      }
      applyTheme(next, button, root);
    });
  }
  const mq = win && typeof win.matchMedia === "function" ? win.matchMedia("(prefers-color-scheme: dark)") : null;
  const onSystem = () => {
    if (!savedTheme(storage)) applyTheme(systemTheme(win), button, root);
  };
  if (mq && typeof mq.addEventListener === "function") {
    mq.addEventListener("change", onSystem);
    return () => mq.removeEventListener("change", onSystem);
  }
  return () => {};
}

if (typeof document !== "undefined" && document.getElementById) {
  installThemeToggle(document.getElementById("theme-toggle"));
}
