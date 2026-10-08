"use client";

import { useSyncExternalStore } from "react";
import { THEME_STORAGE_KEY } from "@/lib/theme";

type Theme = "system" | "light" | "dark";

const options: { value: Theme; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const CHANGE_EVENT = "impactlia-theme-change";

function readTheme(): Theme {
  const stored = document.documentElement.dataset.theme;
  return stored === "light" || stored === "dark" ? stored : "system";
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => window.removeEventListener(CHANGE_EVENT, onChange);
}

function applyTheme(theme: Theme) {
  if (theme === "system") {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = theme;
  }
  try {
    if (theme === "system") {
      localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    }
  } catch {
    // Storage can be blocked; the theme still applies for this page view.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function ThemeControl() {
  // The server can't know the stored choice, so it renders "system" and the
  // real value is read from the root element on hydration.
  const theme = useSyncExternalStore<Theme>(subscribe, readTheme, () => "system");

  return (
    <fieldset>
      <legend className="mb-1.5 text-xs text-muted">Theme</legend>
      <div className="grid grid-cols-3 rounded-md border border-line p-0.5">
        {options.map((option) => (
          <label
            key={option.value}
            className="cursor-pointer rounded px-2 py-1 text-center text-xs text-muted has-checked:bg-canvas has-checked:font-medium has-checked:text-ink has-focus-visible:outline-2 has-focus-visible:outline-accent"
          >
            <input
              type="radio"
              name="theme"
              value={option.value}
              checked={theme === option.value}
              onChange={() => applyTheme(option.value)}
              className="sr-only"
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
