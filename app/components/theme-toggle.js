'use client';
import { useEffect, useState } from 'react';
import { Icon } from './icons.js';
import { THEME_STORAGE_KEY, resolveTheme, oppositeTheme } from '../../lib/ui-state.mjs';

function readStoredTheme() {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    return null;
  }
}

function systemPrefersLight() {
  try {
    return window.matchMedia('(prefers-color-scheme: light)').matches;
  } catch {
    return false;
  }
}

export function applyTheme(theme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* private mode. The theme still applies for this visit. */
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#eef1f6' : '#090D16');
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState('dark');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setTheme(resolveTheme(readStoredTheme(), systemPrefersLight()));
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    applyTheme(theme);
  }, [theme, ready]);

  useEffect(() => {
    let media;
    try {
      media = window.matchMedia('(prefers-color-scheme: light)');
    } catch {
      return undefined;
    }
    const onChange = (event) => {
      if (readStoredTheme() == null) setTheme(event.matches ? 'light' : 'dark');
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const next = oppositeTheme(theme);
  const label = !ready ? 'Theme' : theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme';
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={() => setTheme(next)}
      aria-label={label}
      aria-pressed={ready && theme === 'light'}
      title={label}
    >
      <Icon name={theme === 'light' ? 'moon' : 'sun'} />
      <span>{!ready ? 'Theme' : theme === 'light' ? 'Dark' : 'Light'}</span>
    </button>
  );
}
