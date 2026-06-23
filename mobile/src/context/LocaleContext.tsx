// App locale — English / 简体中文. Persisted via secureStorage (Keychain on device).

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  type Locale,
  type Translation,
  translations,
} from "@/i18n/locales";
import { readSecureItem, writeSecureItem } from "@/lib/secureStorage";

const LOCALE_KEY = "albert.locale";

type LocaleApi = {
  locale: Locale;
  setLocale: (next: Locale) => void;
  t: Translation;
  ready: boolean;
};

const LocaleContext = createContext<LocaleApi | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void readSecureItem(LOCALE_KEY).then((raw) => {
      if (raw === "en" || raw === "zh") setLocaleState(raw);
      setReady(true);
    });
  }, []);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    void writeSecureItem(LOCALE_KEY, next);
  }, []);

  const t = useMemo(() => translations[locale], [locale]);

  const api = useMemo(
    () => ({ locale, setLocale, t, ready }),
    [locale, setLocale, t, ready],
  );

  return (
    <LocaleContext.Provider value={api}>{children}</LocaleContext.Provider>
  );
}

export function useLocale(): LocaleApi {
  const ctx = useContext(LocaleContext);
  if (!ctx) {
    throw new Error("useLocale must be used within <LocaleProvider>");
  }
  return ctx;
}
