// Простая двуязычность (RU/EN) без словарей: строку переводишь по месту t("рус", "eng").
// Язык хранится в localStorage и переживает перезагрузку.
import { createContext, useContext, useState, useCallback } from "react";

const LangCtx = createContext({ lang: "ru", setLang: () => {} });

export const LangProvider = ({ children }) => {
  const [lang, setLangState] = useState(
    () => (typeof localStorage !== "undefined" && localStorage.getItem("exovision_lang")) || "ru"
  );
  const setLang = useCallback((l) => {
    setLangState(l);
    try {
      localStorage.setItem("exovision_lang", l);
      document.documentElement.lang = l;
    } catch {
      /* приватный режим — не критично */
    }
  }, []);
  return <LangCtx.Provider value={{ lang, setLang }}>{children}</LangCtx.Provider>;
};

export const useLang = () => useContext(LangCtx);

/** Хук перевода: t("Поиск", "Search") вернёт строку на текущем языке.
 *  Если английского нет — покажет русский (безопасный фолбэк). */
export const useT = () => {
  const { lang } = useContext(LangCtx);
  return useCallback((ru, en) => (lang === "en" && en != null ? en : ru), [lang]);
};

/** Кнопка-переключатель RU ⇄ EN для навбара. */
export const LangToggle = ({ className = "" }) => {
  const { lang, setLang } = useLang();
  return (
    <button
      type="button"
      onClick={() => setLang(lang === "ru" ? "en" : "ru")}
      title={lang === "ru" ? "Switch to English" : "Переключить на русский"}
      data-testid="lang-toggle"
      className={`tag tag-link font-semibold ${className}`}
    >
      {lang === "ru" ? "EN" : "RU"}
    </button>
  );
};
