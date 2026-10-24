import { useState } from "react";
const key = "kahroba-lobby-preferences-v1";
type Preferences = { sound: boolean; motion: boolean };
const defaults: Preferences = { sound: false, motion: true };
function load(): Preferences {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    if (
      value &&
      typeof value === "object" &&
      "sound" in value &&
      typeof value.sound === "boolean" &&
      "motion" in value &&
      typeof value.motion === "boolean"
    )
      return { sound: value.sound, motion: value.motion };
  } catch {
    /* Preferences are optional when storage is unavailable. */
  }
  return defaults;
}
export function usePalacePreferences() {
  const [preferences, setPreferences] = useState(load);
  function toggle(name: keyof Preferences) {
    setPreferences((previous) => {
      const next = { ...previous, [name]: !previous[name] };
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* In-memory settings still work. */
      }
      return next;
    });
  }
  function sound(event: React.MouseEvent<HTMLElement>) {
    if (
      !preferences.sound ||
      !(event.target instanceof Element) ||
      !event.target.closest("button:not(:disabled)")
    )
      return;
    try {
      const context = new AudioContext(),
        oscillator = context.createOscillator(),
        gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = 620;
      gain.gain.setValueAtTime(0.025, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.1);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.12);
      oscillator.onended = () => {
        void context.close();
      };
    } catch {
      /* Browsers without audio keep all actions available. */
    }
  }
  return { preferences, toggle, sound };
}
