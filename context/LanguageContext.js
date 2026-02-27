// context/LanguageContext.js
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import translationsDefault, { translations as translationsNamed } from "../translations";

const translations = translationsNamed || translationsDefault || {};
const DEFAULT_LANG = "en";
const STORAGE_KEY = "regorixa_lang";

// rtl languages
const RTL_LANGS = new Set(["fa", "ar", "ur"]);

function getByPath(obj, path) {
  if (!obj || !path) return undefined;
  const parts = String(path).split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in cur) cur = cur[p];
    else return undefined;
  }
  return cur;
}

function deepMerge(base, over) {
  if (!base || typeof base !== "object") return over;
  if (!over || typeof over !== "object") return base;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const k of Object.keys(over)) {
    const bv = base[k];
    const ov = over[k];
    out[k] = typeof bv === "object" && typeof ov === "object" ? deepMerge(bv, ov) : ov;
  }
  return out;
}

const LanguageContext = createContext(null);

export function LanguageProvider({ children }) {
  const [lang, setLang] = useState(DEFAULT_LANG);

  useEffect(() => {
    // load stored language
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setLang(saved);
    } catch {}
  }, []);

  useEffect(() => {
    // persist + set dir on html
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {}
    const dir = RTL_LANGS.has(lang) ? "rtl" : "ltr";
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("dir", dir);
      document.documentElement.setAttribute("lang", lang);
    }
  }, [lang]);

  const dir = RTL_LANGS.has(lang) ? "rtl" : "ltr";

  // merged dictionary: en fallback + current override
  const dict = useMemo(() => {
    const base = translations[DEFAULT_LANG] || {};
    const cur = translations[lang] || base;
    return deepMerge(base, cur);
  }, [lang]);

  // t: string translation
  const t = useMemo(() => {
    return (key, fallback) => {
      const v = getByPath(dict, key);
      if (typeof v === "string" || typeof v === "number") return String(v);
      if (typeof fallback === "string") return fallback;

      // اگر ترجمه نبود و fallback هم ندادی، به جای key، رشته خالی نده،
      // ولی برای دیباگ بهتره key رو برگردونیم؟ تو میخوای UI تمیز باشه:
      return "";
    };
  }, [dict]);

  // tv: non-string translation (arrays/objects)
  const tv = useMemo(() => {
    return (key, fallback) => {
      const v = getByPath(dict, key);
      return v === undefined ? fallback : v;
    };
  }, [dict]);

  const changeLang = (next) => {
    const code = String(next || "").trim();
    if (!code) return;
    setLang(code);
  };

  const value = useMemo(
    () => ({
      lang,
      dir,
      setLang: changeLang, // برای اینکه کدهای قدیمی‌ات نشکنه
      changeLang,
      t,
      tv,
      dict,
      available: Object.keys(translations || {}),
    }),
    [lang, dir, t, tv]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

// ✅ دو تا هوک برای سازگاری با فایل‌های مختلف پروژه
export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage must be used within LanguageProvider");
  return ctx;
}

export function useLang() {
  return useLanguage();
}
