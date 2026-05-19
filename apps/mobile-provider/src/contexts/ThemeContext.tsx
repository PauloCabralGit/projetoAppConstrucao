import { createContext, useContext, useState, useEffect } from 'react';
import * as SecureStore from 'expo-secure-store';

export interface ThemeColors {
  primary: string;
  darkNavy: string;
  background: string;
  cardWhite: string;
  successGreen: string;
  dangerRed: string;
  warningAmber: string;
  textPrimary: string;
  textSecondary: string;
  border: string;
}

const LIGHT: ThemeColors = {
  primary: '#FF6B35',
  darkNavy: '#1E2A38',
  background: '#F7F8FA',
  cardWhite: '#FFFFFF',
  successGreen: '#12B76A',
  dangerRed: '#EF4444',
  warningAmber: '#F59E0B',
  textPrimary: '#101828',
  textSecondary: '#6B7280',
  border: '#E5E7EB',
};

const DARK: ThemeColors = {
  primary: '#FF6B35',
  darkNavy: '#2D3748',
  background: '#0F1218',
  cardWhite: '#1A2234',
  successGreen: '#12B76A',
  dangerRed: '#EF4444',
  warningAmber: '#F59E0B',
  textPrimary: '#F9FAFB',
  textSecondary: '#9CA3AF',
  border: '#374151',
};

interface ThemeContextType {
  isDark: boolean;
  colors: ThemeColors;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType>({
  isDark: false,
  colors: LIGHT,
  toggleTheme: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

const THEME_KEY = 'provider_app_theme';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    SecureStore.getItemAsync(THEME_KEY).then((val) => {
      if (val === 'dark') setIsDark(true);
    }).catch(() => {});
  }, []);

  function toggleTheme() {
    setIsDark((prev) => {
      const next = !prev;
      SecureStore.setItemAsync(THEME_KEY, next ? 'dark' : 'light').catch(() => {});
      return next;
    });
  }

  return (
    <ThemeContext.Provider value={{ isDark, colors: isDark ? DARK : LIGHT, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
