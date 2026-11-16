import axios from "axios";
import { currentLang } from "@/lib/i18n";

// Пустое значение = тот же origin (фронт раздаётся самим backend — работает и через туннели)
const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "";

export const api = axios.create({
  baseURL: `${BACKEND_URL}/api`,
  timeout: 180000,
});

export const suggest = (q, limit = 10) =>
  api.get("/suggest", { params: { q, limit } }).then((r) => r.data);

export const searchPlanet = (query, searchType = "name") =>
  api.post("/search", { query, search_type: searchType }).then((r) => r.data);

export const getPlanet = (name) =>
  api.get(`/planet/${encodeURIComponent(name)}`).then((r) => r.data);

export const getPlanetImages = (name) =>
  api.get(`/planet/${encodeURIComponent(name)}/images`).then((r) => r.data);

export const getPlanetStatus = (name) =>
  api.get(`/planet/${encodeURIComponent(name)}/status`, { timeout: 6000 }).then((r) => r.data);

// Тихий префетч при наведении: к моменту клика планета уже в кэше сервера
const prefetched = new Set();
export const prefetchPlanet = (name) => {
  if (!name || prefetched.has(name)) return;
  prefetched.add(name);
  api.get(`/planet/${encodeURIComponent(name)}`).catch(() => prefetched.delete(name));
};

export const getCatalog = (params) =>
  api.get("/catalog", { params }).then((r) => r.data);

export const getScatter = (x, y, name) =>
  api.get("/catalog/scatter", { params: { x, y, name: name || undefined } }).then((r) => r.data);

export const getStats = () => api.get("/stats").then((r) => r.data);

export const getRandom = () => api.get("/random").then((r) => r.data);

export const getHistory = (limit = 12) =>
  api.get("/history", { params: { limit } }).then((r) => r.data);

export const comparePlanets = (planet1, planet2) =>
  api.get("/compare", { params: { planet1, planet2 } }).then((r) => r.data);

export const getOllamaModels = (url) =>
  api.get("/ollama/models", { params: { url } }).then((r) => r.data);

export const getAiStatus = () => api.get("/ai/status").then((r) => r.data);

export const analyzePlanet = (payload) =>
  api.post("/analyze", payload).then((r) => r.data);

export const aiChat = (payload) =>
  api.post("/ai/chat", payload, { timeout: 120000 }).then((r) => r.data);

export const getMlInfo = () => api.get("/ml/info").then((r) => r.data);

export const mlClassify = (payload) =>
  api.post("/ml/classify", payload).then((r) => r.data);

export const getMlToi = (params) =>
  api.get("/ml/toi", { params, timeout: 300000 }).then((r) => r.data);

// Анализ кривой идёт минутами: сервер сразу отвечает 202 с id задачи, а мы опрашиваем
// её статус — так запрос не упирается в таймаут прокси (Cloudflare рвёт его через ~100 с)
const LC_POLL_MS = 3000;
const LC_GIVE_UP_MS = 15 * 60 * 1000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const getLightcurve = async (target, period) => {
  let r = await api.get("/lightcurve", { params: { target, period: period || undefined }, timeout: 60000 });
  const started = Date.now();
  while (r.status === 202) {
    if (Date.now() - started > LC_GIVE_UP_MS) {
      const err = new Error("lightcurve timeout");
      err.response = { data: { detail: currentLang() === "en"
        ? "The analysis is taking over 15 minutes — open the target later, the result will be kept"
        : "Анализ идёт дольше 15 минут — откройте цель позже, результат сохранится" } };
      throw err;
    }
    await sleep(LC_POLL_MS);
    r = await api.get(`/lightcurve/jobs/${encodeURIComponent(r.data.job_id)}`, { timeout: 60000 });
  }
  return r.data;
};

// Звезда и все её планеты: по имени хоста или по позиции на небе (ссылка из Muninn)
export const getSystem = (params) => api.get("/system", { params }).then((r) => r.data);
