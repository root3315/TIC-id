// Простая двуязычность (RU/EN) без словарей: строку переводишь по месту t("рус", "eng").
// Язык выбирается так: ?lang= в адресе (запоминается) → сохранённый выбор → язык браузера.
import { createContext, useContext, useState, useCallback, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";

const STORAGE_KEY = "exovision_lang";
const SUPPORTED = ["ru", "en"];

const saveLang = (l) => {
  try {
    localStorage.setItem(STORAGE_KEY, l);
  } catch {
    /* приватный режим — не критично */
  }
};

const readSavedLang = () => {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
};

const urlLang = new URLSearchParams(window.location.search).get("lang");
const enteredWithLang = SUPPORTED.includes(urlLang);

const pickInitialLang = () => {
  if (enteredWithLang) {
    saveLang(urlLang);
    return urlLang;
  }
  const saved = readSavedLang();
  if (SUPPORTED.includes(saved)) return saved;
  return (navigator.language || "").toLowerCase().startsWith("ru") ? "ru" : "en";
};

let activeLang = pickInitialLang();
document.documentElement.lang = activeLang;

/** Текущий язык вне React (для форматтеров). */
export const currentLang = () => activeLang;

const LangCtx = createContext({ lang: activeLang, setLang: () => {} });

export const LangProvider = ({ children }) => {
  const [lang, setLangState] = useState(activeLang);
  const setLang = useCallback((l) => {
    activeLang = l;
    document.documentElement.lang = l;
    saveLang(l);
    setLangState(l);
  }, []);
  return <LangCtx.Provider value={{ lang, setLang }}>{children}</LangCtx.Provider>;
};

/** Если сайт открыли с ?lang=, держим параметр в адресе при переходах внутри приложения. */
export const LangParamKeeper = () => {
  const { lang } = useContext(LangCtx);
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    if (!enteredWithLang) return;
    const params = new URLSearchParams(location.search);
    if (params.get("lang") === lang) return;
    params.set("lang", lang);
    navigate(
      { pathname: location.pathname, search: `?${params}`, hash: location.hash },
      { replace: true, state: location.state }
    );
  }, [lang, location, navigate]);
  return null;
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
