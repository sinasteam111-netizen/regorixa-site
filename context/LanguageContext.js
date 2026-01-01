import { createContext, useContext, useState } from "react";
import translations from "../translations";

const LanguageContext = createContext(null);

export function LanguageProvider({ children }) {
  const [lang, setLang] = useState("en");

  const t = translations?.[lang] || translations?.en;
  const rtlLangs = ["ar", "fa", "ur"];
  const dir = rtlLangs.includes(lang) ? "rtl" : "ltr";

  return (
    <LanguageContext.Provider value={{ lang, setLang, t, dir }}>

      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  return ctx;
}
