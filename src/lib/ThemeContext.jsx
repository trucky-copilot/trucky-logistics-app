import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

// Mismo almacenamiento que lee el script de index.html antes del primer render,
// así el tema no parpadea al cargar.
const STORAGE_KEY = 'trucky-theme';

const ThemeContext = createContext({ theme: 'dark', setTheme: () => {} });

function readStoredTheme() {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark';
  } catch (_) {
    return 'dark';
  }
}

function applyTheme(theme) {
  const root = document.documentElement;
  const isLight = theme === 'light';
  root.classList.toggle('light', isLight);
  root.classList.toggle('dark', !isLight);
  root.style.colorScheme = isLight ? 'light' : 'dark';

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', isLight ? '#F6F5FA' : '#0E0A19');
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(readStoredTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setTheme = useCallback((next) => {
    const value = next === 'light' ? 'light' : 'dark';
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch (_) {
      // Navegador sin almacenamiento: el tema vale solo para esta sesión.
    }
    setThemeState(value);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}