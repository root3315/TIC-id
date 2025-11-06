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
git clone https://github.com/root3315/TIC-ID.git
cd TIC-ID
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

[MIT License](MIT License

Copyright (c) [2025] [Stepan Ionichev]

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.)

---

## Автор

**Stepan Ionichev**  
GitHub: [@root3315](https://github.com/root3315)  
Telegram: [@Pumpkin2008](https://t.me/@Pumpkin2008)

---

> **ExoVision** — не просто каталог. Это инструмент для будущих колонизаторов и исследователей космоса.
