```markdown
# ExoVision — AI-анализ экзопланет с реальными изображениями и оценкой обитаемости

![ExoVision](https://github.com/yourusername/exovision/raw/main/public/banner.png)

> **Поиск. Анализ. Визуализация.**  
> ExoVision — это современное веб-приложение для исследования экзопланет с использованием данных NASA, SIMBAD, Exoplanet.eu и искусственного интеллекта.

---

## Особенности

| Функция | Описание |
|--------|--------|
| **Мультиисточниковый поиск** | Данные из NASA Exoplanet Archive, SIMBAD, Exoplanet.eu |
| **Оценка обитаемости** | 0–100 баллов + шанс выживания (в %) |
| **Реальные изображения звёзд** | Встроенные снимки из **NASA SkyView (2MASS)**, Hubble, JWST |
| **Синтетические изображения** | Генерация звезды по температуре и радиусу |
| **AI-анализ (Ollama)** | Подключение локальной LLM (gemma2, llama3 и др.) |
| **Визуализации** | Орбита, масса-радиус, диаграмма обитаемости |
| **Скачивание данных** | JSON + все изображения |
| **Адаптивный UI** | React + Tailwind + Framer Motion |

---

## Технологии

### Бэкенд (FastAPI)
```text
Python 3.11+ | FastAPI | Motor (MongoDB) | httpx | PIL | matplotlib
```

### Фронтенд (React + Vite)
```text
React 18 | TypeScript | Tailwind CSS | Framer Motion | Lucide Icons | Sonner
```

### AI
```text
Ollama (локальная LLM) — gemma3
```

---

## Установка

### 1. Клонируйте репозиторий
```bash
git clone https://github.com/root3315/TIC-id.git
cd TIC-id
```

### 2. Запустите бэкенд
```bash
cd backend
pip install -r requirements.txt
uvicorn server:app --reload --port 8001
```

### 3. Запустите фронтенд
```bash
cd ../frontend
npm install
npm run dev
```

### 4. (Опционально) Запустите Ollama
```bash
ollama push gemma3
```

---

## API

| Метод | Эндпоинт | Описание |
|------|---------|--------|
| `POST` | `/api/search` | Поиск по имени или TIC ID |
| `POST` | `/api/analyze` | AI-анализ через Ollama |
| `GET` | `/api/habitability/{name}` | Только оценка обитаемости |

---

## Пример данных

```json
{
  "name": "Kepler-186 f",
  "habitability_score": {
    "total_score": 46.0,
    "survival_chance": 39.0,
    "category": "Moderate"
  },
  "visualizations": {
    "synthetic_star": "data:image/png;base64,...",
    "real_images": [
      {
        "source": "NASA SkyView (2MASS)",
        "url": "data:image/png;base64,...",
        "description": "Infrared field around Kepler-186"
      }
    ]
  }
}
```

---


## Лицензия

[MIT License](LICENSE)

---

## Автор

**Stepan Ionichev**  
GitHub: [@root3315](https://github.com/root3315)  
Telegram: [@Pumpkin2008](https://t.me/@Pumpkin2008)

---

> **ExoVision** — не просто каталог. Это инструмент для будущих колонизаторов и исследователей космоса.
