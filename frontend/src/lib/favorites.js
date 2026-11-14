// Избранные планеты — localStorage, живут между сессиями.
// Слушать изменения: window.addEventListener("exovision-favs", cb)

const KEY = "exovision_favorites";
const MAX = 24;

export const getFavorites = () => {
  try {
    const list = JSON.parse(localStorage.getItem(KEY));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
};

export const isFavorite = (name) => getFavorites().some((f) => f.name === name);

/** p: { name, radius, teq, mass, habitability } — минимум для чипа/карточки */
export const toggleFavorite = (p) => {
  if (!p?.name) return false;
  const list = getFavorites();
  const i = list.findIndex((f) => f.name === p.name);
  if (i >= 0) list.splice(i, 1);
  else list.unshift({ ...p, ts: Date.now() });
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    /* квота — не критично */
  }
  window.dispatchEvent(new Event("exovision-favs"));
  return i < 0; // true = добавили
};
