"""ExoVision backend — агрегатор данных об экзопланетах.

Источники: NASA Exoplanet Archive (pscomppars — композитные "лучшие" параметры),
SIMBAD TAP, NASA alias lookup, Wikipedia, CDS hips2fits (реальные снимки неба).
Локальный in-memory каталог всех подтверждённых планет даёт мгновенный поиск,
автодополнение, фильтры и статистику без обращения к внешним API.
"""

from fastapi import FastAPI, APIRouter, HTTPException, Query
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from starlette.responses import JSONResponse
import os
import re
import logging
import random
import time
from pathlib import Path
from contextlib import asynccontextmanager
from collections import deque
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional, Dict, Any
import uuid
from datetime import datetime, timezone
import httpx
import asyncio
from concurrent.futures import ProcessPoolExecutor
import json
import math
from io import BytesIO
import base64
from urllib.parse import quote
from PIL import Image, ImageDraw, ImageFilter
import numpy as np

import lc_pipeline
import mast_lite
import systems

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger("exovision")

# ---------- MongoDB (необязателен: без него работает всё, кроме постоянной истории) ----------
db = None
_mongo_client = None
try:
    from motor.motor_asyncio import AsyncIOMotorClient
    mongo_url = os.environ.get('MONGO_URL')
    if mongo_url:
        _mongo_client = AsyncIOMotorClient(mongo_url, serverSelectionTimeoutMS=1500)
        db = _mongo_client[os.environ.get('DB_NAME', 'exovision')]
except Exception as e:  # noqa: BLE001
    logger.warning(f"MongoDB недоступен, история хранится в памяти: {e}")

# ---------- Кэши ----------
CATALOG: List[Dict[str, Any]] = []          # облегчённые записи всех планет
CATALOG_LOADED_AT: float = 0.0
HOSTS: List[Dict[str, Any]] = []            # звёзды с планетами (для /system)
CATALOG_TTL = 24 * 3600
CATALOG_LOCK = asyncio.Lock()

DETAIL_CACHE: Dict[str, Dict[str, Any]] = {}      # полные данные по планете
DETAIL_CACHE_TS: Dict[str, float] = {}
DETAIL_TTL = 6 * 3600
LIGHT_CACHE: Dict[str, Dict[str, Any]] = {}       # без изображений (для сравнения)
LIGHT_CACHE_TS: Dict[str, float] = {}

RECENT_SEARCHES: deque = deque(maxlen=30)          # fallback-история без Mongo

# ---------- Дисковый кэш (переживает перезапуски) ----------
DISK_CACHE_DIR = ROOT_DIR / "models" / "cache"


def disk_cache_read(sub: str, key: str, ttl: float) -> Optional[Dict[str, Any]]:
    p = DISK_CACHE_DIR / sub / f"{key}.json"
    try:
        if p.exists() and time.time() - p.stat().st_mtime < ttl:
            return json.loads(p.read_text(encoding="utf-8"))
    except Exception as e:  # noqa: BLE001
        logger.debug(f"disk cache read {sub}/{key}: {e}")
    return None


def disk_cache_write(sub: str, key: str, data: Dict[str, Any]) -> None:
    try:
        d = DISK_CACHE_DIR / sub
        d.mkdir(parents=True, exist_ok=True)
        (d / f"{key}.json").write_text(json.dumps(data, ensure_ascii=False),
                                       encoding="utf-8")
    except Exception as e:  # noqa: BLE001
        logger.debug(f"disk cache write {sub}/{key}: {e}")

NASA_TAP = "https://exoplanetarchive.ipac.caltech.edu/TAP/sync"
SIMBAD_TAP = "https://simbad.cds.unistra.fr/simbad/sim-tap/sync"
HIPS2FITS = "https://alasky.cds.unistra.fr/hips-image-services/hips2fits"

CATALOG_COLUMNS = (
    "pl_name,hostname,tic_id,disc_year,discoverymethod,disc_facility,"
    "sy_dist,pl_rade,pl_bmasse,pl_eqt,pl_orbper,pl_orbsmax,pl_orbeccen,"
    "pl_insol,pl_dens,st_spectype,st_teff,st_rad,st_mass,st_lum,sy_snum,sy_pnum,ra,dec"
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    asyncio.create_task(ensure_catalog())

    async def warm_toi():
        await asyncio.sleep(5)
        try:
            await ensure_toi()
        except Exception as e:  # noqa: BLE001
            logger.warning(f"TOI warmup failed: {e}")
    asyncio.create_task(warm_toi())

    async def warm_planets():
        """Прогрев знаменитых планет: после него они открываются мгновенно."""
        await asyncio.sleep(10)
        if not await ensure_catalog():
            return
        warmed = 0
        for name in NOTABLE_PLANETS:
            key = norm_name(name)
            if key in DETAIL_CACHE or disk_cache_read("planets", key, DETAIL_TTL):
                continue
            exact, res = search_catalog(name, "name")
            target = exact or (res[0] if res else None)
            if not target:
                continue
            try:
                await get_detail_cached(target['pl_name'], target.get('hostname'))
                warmed += 1
            except Exception:  # noqa: BLE001
                pass
            await asyncio.sleep(1.0)
        if warmed:
            logger.info(f"Прогрето планет: {warmed}")
    asyncio.create_task(warm_planets())
    yield
    if _mongo_client:
        _mongo_client.close()


app = FastAPI(title="ExoVision API", version="3.0", lifespan=lifespan)
api_router = APIRouter(prefix="/api")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ========== МОДЕЛИ ==========

class ExoplanetSearchRequest(BaseModel):
    query: str
    search_type: str = "name"  # "name" | "tic"


class AIAnalysisRequest(BaseModel):
    exoplanet_data: Dict[str, Any]
    ollama_url: str = "http://localhost:11434"
    model: Optional[str] = None
    question: Optional[str] = None
    force: bool = False   # пересоздать анализ, игнорируя кэш


class AIChatRequest(BaseModel):
    exoplanet_data: Dict[str, Any]
    messages: List[Dict[str, str]] = Field(default_factory=list)


class HabitabilityScore(BaseModel):
    model_config = ConfigDict(extra="ignore")
    total_score: float
    survival_chance: float
    esi: Optional[float] = None
    factors: Dict[str, Any]
    category: str
    category_ru: str
    recommendations: List[str]
    risks: List[str]


# ========== УТИЛИТЫ ==========

def norm_name(s: Optional[str]) -> str:
    """Нормализация для поиска: нижний регистр, только буквы и цифры."""
    if not s:
        return ""
    return re.sub(r'[^a-z0-9]', '', s.lower())


def adql_escape(s: str) -> str:
    return s.replace("'", "''")


def fnum(v) -> Optional[float]:
    try:
        if v is None or (isinstance(v, str) and not v.strip()):
            return None
        f = float(v)
        if math.isnan(f) or math.isinf(f):
            return None
        return f
    except (TypeError, ValueError):
        return None


def img_to_data_url(img: Image.Image, fmt: str = "PNG", quality: int = 88) -> str:
    buf = BytesIO()
    if fmt.upper() == "JPEG":
        img.save(buf, format="JPEG", quality=quality)
        mime = "image/jpeg"
    else:
        img.save(buf, format="PNG", optimize=True)
        mime = "image/png"
    return f"data:{mime};base64,{base64.b64encode(buf.getvalue()).decode()}"


async def tap_query(adql: str, timeout: float = 45.0) -> Optional[List[Dict[str, Any]]]:
    """Запрос к NASA Exoplanet Archive TAP, результат — список словарей."""
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.get(NASA_TAP, params={"query": adql, "format": "json"})
            r.raise_for_status()
            data = r.json()
            return data if isinstance(data, list) else None
    except Exception as e:  # noqa: BLE001
        logger.error(f"NASA TAP error: {e}")
        return None


# ========== ЛОКАЛЬНЫЙ КАТАЛОГ ==========

CATALOG_DISK_CACHE = ROOT_DIR / "models" / "catalog_cache.json"


async def ensure_catalog(force: bool = False) -> bool:
    """Загружает облегчённый каталог всех подтверждённых планет (кэш 24 ч).
    Тёплый старт: свежий каталог читается с диска мгновенно — NASA TAP бывает
    медленным, и рестарт сервера не должен его ждать."""
    global CATALOG, CATALOG_LOADED_AT, HOSTS
    if CATALOG and not force and (time.time() - CATALOG_LOADED_AT) < CATALOG_TTL:
        return True
    async with CATALOG_LOCK:
        if CATALOG and not force and (time.time() - CATALOG_LOADED_AT) < CATALOG_TTL:
            return True
        rows = None
        if not force and CATALOG_DISK_CACHE.exists():
            try:
                disk = json.loads(CATALOG_DISK_CACHE.read_text(encoding="utf-8"))
                if time.time() - disk.get("ts", 0) < CATALOG_TTL and disk.get("rows"):
                    rows = disk["rows"]
                    logger.info(f"Каталог загружен с диска: {len(rows)} планет")
            except Exception as e:  # noqa: BLE001
                logger.warning(f"Дисковый кэш каталога нечитаем: {e}")
        if rows is None:
            logger.info("Загрузка каталога планет из NASA Exoplanet Archive...")
            rows = await tap_query(f"SELECT {CATALOG_COLUMNS} FROM pscomppars", timeout=180.0)
            if not rows:
                logger.error("Каталог не загрузился")
                return False
            try:
                CATALOG_DISK_CACHE.parent.mkdir(exist_ok=True)
                CATALOG_DISK_CACHE.write_text(
                    json.dumps({"ts": time.time(), "rows": rows}), encoding="utf-8")
            except Exception as e:  # noqa: BLE001
                logger.warning(f"Не записался дисковый кэш каталога: {e}")
        for row in rows:
            row['_nplanet'] = norm_name(row.get('pl_name'))
            row['_nhost'] = norm_name(row.get('hostname'))
            tic = row.get('tic_id') or ''
            row['_tic'] = re.sub(r'\D', '', str(tic))
        # приближённый индекс обитаемости для всего каталога (для фильтра/сортировки)
        t_score = time.time()
        for row in rows:
            try:
                # тот же набор входов, что и на полной странице планеты, —
                # иначе оценка в каталоге не совпадёт с оценкой при открытии
                phys = {"mass": fnum(row.get('pl_bmasse')), "radius": fnum(row.get('pl_rade')),
                        "equilibrium_temp": fnum(row.get('pl_eqt')),
                        "insolation": fnum(row.get('pl_insol')),
                        "density": fnum(row.get('pl_dens'))}
                orb = {"semi_major_axis": fnum(row.get('pl_orbsmax')),
                       "eccentricity": fnum(row.get('pl_orbeccen')),
                       "period": fnum(row.get('pl_orbper'))}
                star = {"temperature": fnum(row.get('st_teff')),
                        "radius": fnum(row.get('st_rad')),
                        "mass": fnum(row.get('st_mass')),
                        "luminosity_log": fnum(row.get('st_lum')),
                        "spectral_type": row.get('st_spectype')}
                der = compute_derived(phys, orb, star)
                hab = calculate_habitability_score(phys, orb, star, der)
                row['_hab'] = hab.total_score
                row['_esi'] = hab.esi
            except Exception:  # noqa: BLE001
                row['_hab'] = None
                row['_esi'] = None
        logger.info(f"Индекс обитаемости каталога: {time.time() - t_score:.1f} с")
        rows.sort(key=lambda r: (r.get('pl_name') or '').lower())
        CATALOG = rows
        HOSTS = systems.build_host_index(rows)
        CATALOG_LOADED_AT = time.time()
        logger.info(f"Каталог загружен: {len(CATALOG)} планет")
        return True


def catalog_entry_public(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "pl_name": row.get("pl_name"),
        "hostname": row.get("hostname"),
        "tic_id": row.get("tic_id"),
        "disc_year": row.get("disc_year"),
        "discoverymethod": row.get("discoverymethod"),
        "disc_facility": row.get("disc_facility"),
        "sy_dist": fnum(row.get("sy_dist")),
        "pl_rade": fnum(row.get("pl_rade")),
        "pl_bmasse": fnum(row.get("pl_bmasse")),
        "pl_eqt": fnum(row.get("pl_eqt")),
        "pl_orbper": fnum(row.get("pl_orbper")),
        "pl_orbsmax": fnum(row.get("pl_orbsmax")),
        "pl_insol": fnum(row.get("pl_insol")),
        "st_spectype": row.get("st_spectype"),
        "st_teff": fnum(row.get("st_teff")),
        "sy_pnum": row.get("sy_pnum"),
        "habitability": row.get("_hab"),
        "esi": row.get("_esi"),
    }


def find_similar_planets(target_row: Dict[str, Any], limit: int = 6) -> List[Dict[str, Any]]:
    """Ближайшие соседи каталога по радиусу, температуре, инсоляции и периоду
    (лог-пространство — «в 2 раза больше» и «в 2 раза меньше» равноудалены)."""
    r0 = fnum(target_row.get('pl_rade'))
    t0 = fnum(target_row.get('pl_eqt'))
    i0 = fnum(target_row.get('pl_insol'))
    p0 = fnum(target_row.get('pl_orbper'))
    name0 = target_row.get('pl_name')
    if not r0 or r0 <= 0:
        return []
    scored = []
    for r in CATALOG:
        if r.get('pl_name') == name0:
            continue
        rr = fnum(r.get('pl_rade'))
        if not rr or rr <= 0:
            continue
        d = 3.0 * (math.log10(rr / r0)) ** 2
        tt = fnum(r.get('pl_eqt'))
        if t0 and tt:
            d += ((tt - t0) / 400.0) ** 2
        else:
            d += 0.35  # температура неизвестна — лёгкий штраф за неопределённость
        ii = fnum(r.get('pl_insol'))
        if i0 and ii and i0 > 0 and ii > 0:
            d += 0.5 * (math.log10(ii / i0)) ** 2
        pp = fnum(r.get('pl_orbper'))
        if p0 and pp and p0 > 0 and pp > 0:
            d += 0.2 * (math.log10(pp / p0)) ** 2
        scored.append((d, r))
    scored.sort(key=lambda t: t[0])
    return [catalog_entry_public(row) for _, row in scored[:limit]]


def search_catalog(query: str, search_type: str = "name", limit: int = 60):
    """Ранжированный поиск по каталогу. Возвращает (точное совпадение, список)."""
    q = norm_name(query)
    if not q:
        return None, []
    if search_type == "tic":
        digits = re.sub(r'\D', '', query)
        matches = [r for r in CATALOG if r['_tic'] == digits] if digits else []
        exact = matches[0] if len(matches) >= 1 else None
        return exact, matches[:limit]

    scored = []
    exact_row = None
    for r in CATALOG:
        npl, nh = r['_nplanet'], r['_nhost']
        score = 0
        if npl == q:
            exact_row = exact_row or r
            score = 100
        elif nh == q:
            score = 90
        elif npl.startswith(q):
            score = 80
        elif nh.startswith(q):
            score = 70
        elif q in npl:
            score = 60
        elif q in nh:
            score = 50
        elif r['_tic'] and q.isdigit() and q in r['_tic']:
            score = 40
        if score:
            richness = sum(1 for k in ('pl_rade', 'pl_bmasse', 'pl_eqt', 'sy_dist') if r.get(k) is not None)
            scored.append((score, -richness, len(npl), r))
    scored.sort(key=lambda t: (-t[0], t[1], t[2], t[3].get('pl_name') or ''))
    results = [t[3] for t in scored[:limit]]
    return exact_row, results


# ========== ВНЕШНИЕ ИСТОЧНИКИ ==========

async def fetch_nasa_full_row(pl_name: str) -> Optional[Dict[str, Any]]:
    """Полная композитная строка pscomppars (все ~300 колонок) по точному имени."""
    rows = await tap_query(
        f"SELECT * FROM pscomppars WHERE pl_name = '{adql_escape(pl_name)}'"
    )
    if rows:
        return rows[0]
    return None


async def fetch_system_planets(hostname: str) -> List[Dict[str, Any]]:
    rows = await tap_query(
        "SELECT pl_name,pl_orbper,pl_orbsmax,pl_rade,pl_bmasse,pl_eqt,pl_orbeccen,"
        "discoverymethod,disc_year FROM pscomppars "
        f"WHERE hostname = '{adql_escape(hostname)}' ORDER BY pl_orbsmax"
    )
    return rows or []


async def fetch_simbad_data(object_name: str) -> Optional[Dict[str, Any]]:
    """Данные SIMBAD через TAP (главный идентификатор, тип, координаты, скорости)."""
    try:
        adql = (
            "SELECT b.main_id, b.ra, b.dec, b.otype, b.sp_type, b.plx_value, "
            "b.pmra, b.pmdec, b.rvz_radvel, ids.ids "
            "FROM basic AS b JOIN ident ON ident.oidref = b.oid "
            "LEFT JOIN ids ON ids.oidref = b.oid "
            f"WHERE ident.id = '{adql_escape(object_name)}'"
        )
        async with httpx.AsyncClient(timeout=20.0) as client:
            r = await client.get(SIMBAD_TAP, params={
                "request": "doQuery", "lang": "adql", "format": "json", "query": adql,
            })
            if r.status_code != 200:
                return None
            payload = r.json()
            meta = [c.get("name") for c in payload.get("metadata", [])]
            data = payload.get("data") or []
            if not data:
                return None
            row = dict(zip(meta, data[0]))
            ids = [s.strip() for s in (row.get("ids") or "").split("|") if s.strip()]
            return {
                "main_id": row.get("main_id"),
                "otype": row.get("otype"),
                "otype_ru": SIMBAD_OTYPES_RU.get(row.get("otype"), row.get("otype")),
                "sp_type": row.get("sp_type"),
                "coordinates": {"ra": fnum(row.get("ra")), "dec": fnum(row.get("dec"))},
                "parallax_mas": fnum(row.get("plx_value")),
                "pm_ra": fnum(row.get("pmra")),
                "pm_dec": fnum(row.get("pmdec")),
                "radial_velocity_kms": fnum(row.get("rvz_radvel")),
                "identifiers": ids,
            }
    except Exception as e:  # noqa: BLE001
        logger.warning(f"SIMBAD TAP failed: {e}")
        return None


SIMBAD_OTYPES_RU = {
    "*": "Звезда", "PM*": "Звезда с большим собственным движением",
    "BY*": "Переменная типа BY Дракона", "Er*": "Вспыхивающая звезда",
    "Ro*": "Быстровращающаяся звезда", "V*": "Переменная звезда",
    "EB*": "Затменная двойная", "SB*": "Спектральная двойная",
    "**": "Двойная система", "Pl": "Планета", "LM*": "Маломассивная звезда",
    "BD*": "Коричневый карлик", "WD*": "Белый карлик", "RG*": "Красный гигант",
    "MS*": "Звезда главной последовательности", "TT*": "Звезда типа T Тельца",
}


async def fetch_aliases(hostname: str) -> Optional[Dict[str, Any]]:
    """Все известные имена системы из сервиса aliaslookup NASA."""
    try:
        url = ("https://exoplanetarchive.ipac.caltech.edu/cgi-bin/Lookup/"
               f"nph-aliaslookup.py?objname={quote(hostname)}")
        async with httpx.AsyncClient(timeout=20.0) as client:
            r = await client.get(url)
            if r.status_code != 200:
                return None
            data = r.json()
        system = data.get("system") or {}
        objects = system.get("objects") or {}
        star_aliases, planet_aliases = [], {}
        stellar = (objects.get("stellar_set") or {}).get("stars") or {}
        for star_name, info in stellar.items():
            if isinstance(info, dict):
                star_aliases.extend(info.get("alias_set", {}).get("aliases", []) or [])
        planets = (objects.get("planet_set") or {}).get("planets") or {}
        for planet_name, info in planets.items():
            if isinstance(info, dict):
                als = info.get("alias_set", {}).get("aliases", []) or []
                if als:
                    planet_aliases[planet_name] = sorted(set(als))
        return {
            "star_aliases": sorted(set(a for a in star_aliases if a)),
            "planet_aliases": planet_aliases,
        }
    except Exception as e:  # noqa: BLE001
        logger.warning(f"Alias lookup failed: {e}")
        return None


async def fetch_wikipedia(planet_name: str) -> Optional[Dict[str, Any]]:
    """Статья Википедии о планете: сначала русская, затем английская."""
    variants = [planet_name, planet_name.replace(" ", "")]
    # "Kepler-186 f" в Википедии обычно "Kepler-186f"
    compact = re.sub(r'\s+([a-h])$', r'\1', planet_name)
    if compact not in variants:
        variants.insert(0, compact)
    headers = {"User-Agent": "ExoVision/3.0 (educational exoplanet explorer)"}
    async with httpx.AsyncClient(timeout=12.0, follow_redirects=True, headers=headers) as client:
        for lang in ("ru", "en"):
            for title in variants:
                try:
                    url = (f"https://{lang}.wikipedia.org/api/rest_v1/page/summary/"
                           f"{quote(title.replace(' ', '_'))}")
                    r = await client.get(url)
                    if r.status_code != 200:
                        continue
                    js = r.json()
                    if js.get("type") == "disambiguation" or not js.get("extract"):
                        continue
                    return {
                        "lang": lang,
                        "title": js.get("title"),
                        "extract": js.get("extract"),
                        "url": (js.get("content_urls") or {}).get("desktop", {}).get("page"),
                        "thumbnail": (js.get("thumbnail") or {}).get("source"),
                    }
                except Exception:  # noqa: BLE001
                    continue
    return None


SKY_SURVEYS = [
    ("CDS/P/DSS2/color", "DSS2 (оптический диапазон)",
     "Оцифрованный обзор неба Digitized Sky Survey — видимый свет"),
    ("CDS/P/2MASS/color", "2MASS (ближний ИК)",
     "Инфракрасный обзор всего неба 2MASS (J/H/K)"),
    ("CDS/P/allWISE/color", "AllWISE (средний ИК)",
     "Космический телескоп WISE — тепловое излучение"),
]


async def fetch_sky_cutouts(ra: float, dec: float, star_name: str) -> List[Dict[str, Any]]:
    """Реальные снимки поля звезды через CDS hips2fits (несколько обзоров неба)."""
    async def one(hips: str, label: str, description: str):
        try:
            params = {
                "hips": hips, "width": 600, "height": 600, "fov": 0.25,
                "projection": "TAN", "coordsys": "icrs",
                "ra": ra, "dec": dec, "format": "jpg",
            }
            async with httpx.AsyncClient(timeout=30.0) as client:
                r = await client.get(HIPS2FITS, params=params)
                if r.status_code != 200 or not r.content:
                    return None
                img = Image.open(BytesIO(r.content)).convert("RGB")
                draw = ImageDraw.Draw(img, "RGBA")
                cx, cy = img.width // 2, img.height // 2
                gap, ln, col = 14, 26, (34, 211, 238, 210)
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    draw.line([(cx + dx * gap, cy + dy * gap),
                               (cx + dx * (gap + ln), cy + dy * (gap + ln))], fill=col, width=2)
                draw.ellipse([cx - 5, cy - 5, cx + 5, cy + 5], outline=col, width=1)
                return {
                    "source": label,
                    "survey": hips,
                    "url": img_to_data_url(img, "JPEG"),
                    "description": f"{description}. Поле 0.25°, звезда {star_name} в перекрестии.",
                }
        except Exception as e:  # noqa: BLE001
            logger.warning(f"hips2fits {hips} failed: {e}")
            return None

    results = await asyncio.gather(*(one(*s) for s in SKY_SURVEYS))
    return [r for r in results if r]


# ========== ИЗВЛЕЧЕНИЕ И ПРОИЗВОДНЫЕ ВЕЛИЧИНЫ ==========

def get_err(row: dict, col: str):
    e1, e2 = fnum(row.get(f"{col}err1")), fnum(row.get(f"{col}err2"))
    if e1 is None and e2 is None:
        return None
    return [e1, e2]


def extract_physical_params(row: dict) -> dict:
    return {
        "mass": fnum(row.get('pl_bmasse')),
        "mass_err": get_err(row, 'pl_bmasse'),
        "mass_jupiter": fnum(row.get('pl_bmassj')),
        "mass_provenance": row.get('pl_bmassprov'),
        "radius": fnum(row.get('pl_rade')),
        "radius_err": get_err(row, 'pl_rade'),
        "radius_jupiter": fnum(row.get('pl_radj')),
        "density": fnum(row.get('pl_dens')),
        "density_err": get_err(row, 'pl_dens'),
        "equilibrium_temp": fnum(row.get('pl_eqt')),
        "equilibrium_temp_err": get_err(row, 'pl_eqt'),
        "insolation": fnum(row.get('pl_insol')),
        "insolation_err": get_err(row, 'pl_insol'),
    }


def extract_orbital_params(row: dict) -> dict:
    return {
        "period": fnum(row.get('pl_orbper')),
        "period_err": get_err(row, 'pl_orbper'),
        "semi_major_axis": fnum(row.get('pl_orbsmax')),
        "semi_major_axis_err": get_err(row, 'pl_orbsmax'),
        "eccentricity": fnum(row.get('pl_orbeccen')),
        "inclination": fnum(row.get('pl_orbincl')),
        "arg_periastron": fnum(row.get('pl_orblper')),
        "time_periastron": fnum(row.get('pl_orbtper')),
        "transit_midpoint": fnum(row.get('pl_tranmid')),
        "transit_depth": fnum(row.get('pl_trandep')),
        "transit_duration": fnum(row.get('pl_trandur')),
        "impact_parameter": fnum(row.get('pl_imppar')),
        "a_over_rstar": fnum(row.get('pl_ratdor')),
        "rp_over_rstar": fnum(row.get('pl_ratror')),
        "rv_amplitude": fnum(row.get('pl_rvamp')),
    }


def extract_host_star(row: dict, simbad: Optional[dict]) -> dict:
    mags = {}
    for col, label in [
        ("sy_bmag", "B"), ("sy_vmag", "V"), ("sy_gmag", "g"), ("sy_rmag", "r"),
        ("sy_imag", "i"), ("sy_zmag", "z"), ("sy_jmag", "J"), ("sy_hmag", "H"),
        ("sy_kmag", "K"), ("sy_w1mag", "W1"), ("sy_w2mag", "W2"),
        ("sy_gaiamag", "Gaia G"), ("sy_tmag", "TESS"), ("sy_kepmag", "Kepler"),
    ]:
        v = fnum(row.get(col))
        if v is not None:
            mags[label] = v
    star = {
        "name": row.get('hostname'),
        "spectral_type": row.get('st_spectype') or (simbad or {}).get("sp_type"),
        "temperature": fnum(row.get('st_teff')),
        "temperature_err": get_err(row, 'st_teff'),
        "radius": fnum(row.get('st_rad')),
        "radius_err": get_err(row, 'st_rad'),
        "mass": fnum(row.get('st_mass')),
        "mass_err": get_err(row, 'st_mass'),
        "metallicity": fnum(row.get('st_met')),
        "metallicity_ratio": row.get('st_metratio'),
        "luminosity_log": fnum(row.get('st_lum')),
        "gravity_log": fnum(row.get('st_logg')),
        "age": fnum(row.get('st_age')),
        "age_err": get_err(row, 'st_age'),
        "density": fnum(row.get('st_dens')),
        "vsini": fnum(row.get('st_vsin')),
        "rotation_period": fnum(row.get('st_rotp')),
        "radial_velocity": fnum(row.get('st_radv')),
        "distance": fnum(row.get('sy_dist')),
        "distance_err": get_err(row, 'sy_dist'),
        "parallax_mas": fnum(row.get('sy_plx')),
        "proper_motion": fnum(row.get('sy_pm')),
        "pm_ra": fnum(row.get('sy_pmra')),
        "pm_dec": fnum(row.get('sy_pmdec')),
        "coordinates": {
            "ra": fnum(row.get('ra')),
            "dec": fnum(row.get('dec')),
            "ra_str": row.get('rastr'),
            "dec_str": row.get('decstr'),
            "gal_lat": fnum(row.get('glat')),
            "gal_lon": fnum(row.get('glon')),
        },
        "magnitudes": mags,
    }
    if simbad:
        star["simbad_type"] = simbad.get("otype")
        star["simbad_type_ru"] = simbad.get("otype_ru")
        if star["coordinates"]["ra"] is None:
            star["coordinates"]["ra"] = simbad.get("coordinates", {}).get("ra")
            star["coordinates"]["dec"] = simbad.get("coordinates", {}).get("dec")
    return star


def extract_discovery(row: dict) -> dict:
    ref_html = row.get('disc_refname') or ''
    m = re.search(r'href=([^\s>]+)[^>]*>\s*([^<]+)<', ref_html)
    return {
        "discovery_method": row.get('discoverymethod'),
        "discovery_year": row.get('disc_year'),
        "discovery_facility": row.get('disc_facility'),
        "discovery_telescope": row.get('disc_telescope'),
        "discovery_instrument": row.get('disc_instrument'),
        "discovery_locale": row.get('disc_locale'),
        "reference_url": (m.group(1).strip('"\'') if m else None),
        "reference_name": (m.group(2).strip() if m else None),
        "controversial": bool(row.get('pl_controv_flag')),
        "publication_date": row.get('disc_pubdate') or row.get('pl_pubdate'),
        "last_update": row.get('rowupdate') or row.get('releasedate'),
    }


# --- Зона обитаемости (Kopparapu et al. 2013, ApJ 765, 131; коэффициенты по исправлению
# ApJ 770, 82 — таблица 3). Формула верна для Teff 2600–7200 K: за краями Teff прижимаем
# к границе и говорим об этом в ответе.
_KOPPARAPU = {
    # Seff_sun, a, b, c, d
    "recent_venus":      (1.7753, 1.4316e-4, 2.9875e-9, -7.5702e-12, -1.1635e-15),
    "runaway_greenhouse": (1.0512, 1.3242e-4, 1.5418e-8, -7.9895e-12, -1.8328e-15),
    "max_greenhouse":    (0.3438, 5.8942e-5, 1.6558e-9, -3.0045e-12, -5.2983e-16),
    "early_mars":        (0.3179, 5.4513e-5, 1.5313e-9, -2.7786e-12, -4.8997e-16),
}
HZ_TEFF_RANGE = (2600.0, 7200.0)


def kopparapu_hz(st_teff: Optional[float], luminosity: Optional[float]) -> Optional[dict]:
    if not st_teff or not luminosity or luminosity <= 0:
        return None
    teff_used = max(HZ_TEFF_RANGE[0], min(HZ_TEFF_RANGE[1], st_teff))
    t = teff_used - 5780.0
    bounds = {}
    for key, (s0, a, b, c, d) in _KOPPARAPU.items():
        seff = s0 + a * t + b * t**2 + c * t**3 + d * t**4
        if seff <= 0:
            return None
        bounds[key] = math.sqrt(luminosity / seff)
    return {
        "inner_optimistic": round(bounds["recent_venus"], 4),
        "inner_conservative": round(bounds["runaway_greenhouse"], 4),
        "outer_conservative": round(bounds["max_greenhouse"], 4),
        "outer_optimistic": round(bounds["early_mars"], 4),
        # Teff вне диапазона формулы: границы посчитаны для ближайшего края
        "teff_clamped": teff_used != st_teff,
        "teff_used": teff_used,
    }


def star_luminosity(star: dict) -> Optional[float]:
    """Светимость в L☉ из st_lum (log10) либо из R и Teff."""
    lg = star.get("luminosity_log")
    if lg is not None:
        return 10 ** lg
    r, t = star.get("radius"), star.get("temperature")
    if r and t:
        return (r ** 2) * ((t / 5772.0) ** 4)
    return None


def compute_derived(phys: dict, orb: dict, star: dict) -> dict:
    d: Dict[str, Any] = {}
    mass, radius = phys.get("mass"), phys.get("radius")
    a = orb.get("semi_major_axis")
    lum = star_luminosity(star)
    if lum:
        d["star_luminosity"] = round(lum, 5)

    # Плотность (если архив не дал)
    density = phys.get("density")
    mass_reliable = True
    if density is None and mass and radius:
        density = 5.513 * mass / (radius ** 3)
        if density > 25:
            # плотнее осмия не бывает: масса из архива — верхний предел, а не измерение
            mass_reliable = False
            d["mass_unreliable"] = True
            density = None
        else:
            d["density_calculated"] = True
    if density:
        d["density"] = round(density, 3)

    if mass and radius and mass_reliable:
        g_rel = mass / (radius ** 2)
        d["surface_gravity_g"] = round(g_rel, 3)
        d["surface_gravity_ms2"] = round(9.807 * g_rel, 2)
        v_rel = math.sqrt(mass / radius)
        d["escape_velocity_rel"] = round(v_rel, 3)
        d["escape_velocity_kms"] = round(11.186 * v_rel, 2)

    # Инсоляция и равновесная температура (fallback-расчёт)
    insol = phys.get("insolation")
    if insol is None and lum and a and a > 0:
        insol = lum / (a ** 2)
        d["insolation_calculated"] = True
    if insol:
        d["insolation"] = round(insol, 4)
    teq = phys.get("equilibrium_temp")
    if teq is None and insol:
        teq = 278.6 * ((1 - 0.3) ** 0.25) * (insol ** 0.25)
        d["teq_calculated"] = True
    if teq:
        d["equilibrium_temp"] = round(teq, 1)
        d["surface_temp_estimate"] = round(teq + 33, 1)  # парниковая поправка как у Земли

    # Зона обитаемости
    hz = kopparapu_hz(star.get("temperature"), lum)
    if hz:
        d["habitable_zone"] = hz
        if a:
            if hz["inner_conservative"] <= a <= hz["outer_conservative"]:
                d["hz_position"] = "conservative"
            elif hz["inner_optimistic"] <= a <= hz["outer_optimistic"]:
                d["hz_position"] = "optimistic"
            elif a < hz["inner_optimistic"]:
                d["hz_position"] = "inner"
            else:
                d["hz_position"] = "outer"

    # Орбитальная скорость и длина года
    period, st_mass = orb.get("period"), star.get("mass")
    if a and period:
        d["orbital_velocity_kms"] = round(2 * math.pi * a * 1.496e8 / (period * 86400), 2)
    if period:
        d["year_length_days"] = round(period, 3)
        d["year_length_years"] = round(period / 365.25, 4)

    # Приливный захват (грубая эвристика)
    if a is not None and st_mass:
        if a < 0.06 or (st_mass < 0.6 and a < 0.2):
            d["tidal_locking"] = "likely"
        elif a < 0.5 and st_mass < 0.8:
            d["tidal_locking"] = "possible"
        else:
            d["tidal_locking"] = "unlikely"

    # Расстояние и время в пути
    dist_pc = star.get("distance")
    if dist_pc:
        ly = dist_pc * 3.26156
        d["distance_ly"] = round(ly, 2)
        d["travel_time_voyager_years"] = int(ly * 17673)   # ~17 км/с
        d["travel_time_light_years"] = round(ly, 2)
        d["travel_time_20c_years"] = round(ly / 0.2, 1)

    # ESI — индекс подобия Земле
    esi = compute_esi(radius, density, d.get("escape_velocity_rel"),
                      d.get("surface_temp_estimate") or teq)
    if esi is not None:
        d["esi"] = esi
    return d


def compute_esi(radius, density, v_esc_rel, t_surf) -> Optional[float]:
    """Earth Similarity Index (Schulze-Makuch et al. 2011)."""
    comps = []
    refs = [(radius, 1.0, 0.57), (density and density / 5.513, 1.0, 1.07),
            (v_esc_rel, 1.0, 0.70), (t_surf, 288.0, 5.58)]
    for value, ref, weight in refs:
        if value is None or value <= 0:
            continue
        comps.append((1 - abs((value - ref) / (value + ref))) ** (weight / 4))
    if len(comps) < 2:
        return None
    prod = 1.0
    for c in comps:
        prod *= c
    # нормируем на фактическое число компонент
    return round(prod ** (4 / len(comps)) if len(comps) < 4 else prod, 3)


# ========== ОЦЕНКА ОБИТАЕМОСТИ v2 ==========

CATEGORY_RU = {
    "Earth-like": "Высокий потенциал", "Promising": "Перспективная",
    "Moderate": "Умеренная", "Challenging": "Сложная", "Hostile": "Враждебная",
}


def classify_composition(radius, mass, density):
    """Класс планеты по радиусу, массе и плотности.

    Ключевая тонкость: в диапазоне 1.8–2.7 R⊕ судьбу решает плотность —
    ρ ≥ 4 г/см³ означает каменистую суперземлю, низкая ρ — мини-нептун
    с протяжённой газовой оболочкой без твёрдой поверхности.
    """
    if radius is None:
        if mass is None:
            return None, "Неизвестен"
        if mass < 2:
            return "rocky", "Каменистая"
        if mass < 10:
            return "super_earth", "Суперземля"
        if mass < 50:
            return "neptune", "Нептуноподобная"
        return "giant", "Газовый гигант"
    if radius >= 6:
        return "giant", "Газовый гигант"
    if radius >= 2.7:
        return "neptune", "Нептуноподобная"
    if radius >= 1.8:
        if density is not None:
            if density >= 4:
                return "super_earth", "Плотная суперземля"
            return "mini_neptune", "Мини-нептун"
        return ("super_earth", "Суперземля") if radius < 2.2 else ("mini_neptune", "Мини-нептун")
    if radius >= 1.25:
        return "super_earth", "Суперземля"
    return "rocky", "Каменистая"


def calculate_habitability_score(phys: dict, orb: dict, star: dict, derived: dict) -> HabitabilityScore:
    factors: Dict[str, Any] = {}
    risks: List[str] = []
    recs: List[str] = []

    def add(key, label, score, maxs, value_text, status):
        factors[key] = {"label": label, "score": round(score, 1), "max": maxs,
                        "value": value_text, "status": status}
        return score

    total = 0.0

    # классификация нужна нескольким факторам — считаем заранее
    radius, mass = phys.get("radius"), phys.get("mass")
    density = derived.get("density")
    comp_kind, comp_label = classify_composition(radius, mass, density)
    gaseous = comp_kind in ("mini_neptune", "neptune", "giant")

    # 1. Температура (20)
    teq = derived.get("equilibrium_temp") or phys.get("equilibrium_temp")
    if teq:
        if 240 <= teq <= 320:
            s, st = 20, "Оптимальная — возможна жидкая вода"
        elif 200 <= teq <= 370:
            s, st = 13, "Выживаемо в скафандрах и куполах"
            risks.append(f"Температура {teq:.0f} K требует терморегуляции среды обитания")
        elif 150 <= teq <= 450:
            s, st = 6, "Экстремальная"
            risks.append(f"Экстремальная температура {teq:.0f} K — высокий риск")
        else:
            s, st = 0, "Смертельная"
            risks.append(f"Смертельная температура {teq:.0f} K")
        total += add("temperature", "Температура", s, 20, f"{teq:.0f} K ({teq - 273.15:+.0f} °C)", st)
    else:
        total += add("temperature", "Температура", 8, 20, "нет данных", "Неизвестна")

    # 2. Инсоляция / зона обитаемости (20)
    hz_pos = derived.get("hz_position")
    insol = derived.get("insolation") or phys.get("insolation")
    if hz_pos in ("conservative", "optimistic") and insol is not None and not 0.22 <= insol <= 2.2:
        # орбита формально в зоне, но измеренный поток противоречит (вытянутая орбита и т.п.)
        s, st = 7, f"Орбита в зоне, но поток {insol:.1f}× земного — данные противоречивы"
    elif hz_pos == "conservative":
        s, st = 20, "В консервативной зоне обитаемости"
        if not gaseous:
            recs.append("Планета в зоне обитаемости — приоритетная цель для поиска биосигнатур")
    elif hz_pos == "optimistic":
        s, st = 15, "В оптимистичной зоне обитаемости"
    elif insol is not None:
        if 0.25 <= insol <= 2.0:
            s, st = 9, "Близко к зоне обитаемости"
        elif insol > 2:
            s, st = 2, f"Перегрев: {insol:.1f}× земной инсоляции"
            risks.append(f"Поток излучения {insol:.1f}× земного — испарение воды")
        else:
            s, st = 3, f"Дефицит энергии: {insol:.2f}× земной"
            risks.append("Недостаток звёздной энергии — потребуется обогрев")
    elif hz_pos == "inner":
        s, st = 3, "Ближе внутренней границы зоны обитаемости"
    elif hz_pos == "outer":
        s, st = 4, "Дальше внешней границы зоны обитаемости"
    else:
        s, st = 8, "Неизвестна"
    if gaseous and s > 8:
        # у газового мира зона обитаемости — шанс лишь для его спутников
        s, st = 8, st + " — но без поверхности это шанс лишь для её лун"
    ins_txt = f"{insol:.2f} S⊕" if insol is not None else "нет данных"
    total += add("insolation", "Зона обитаемости", s, 20, ins_txt, st)

    # 3. Гравитация (15)
    g = derived.get("surface_gravity_g")
    if g:
        if 0.6 <= g <= 1.6:
            s, st = 15, "Комфортная для человека"
        elif 0.35 <= g <= 2.5:
            s, st = 9, "Требуется адаптация"
            recs.append("Программа адаптации к гравитации для экипажа")
        elif g > 2.5:
            s, st = 2, "Разрушительно высокая"
            risks.append(f"Гравитация {g:.1f} g — экстремальная нагрузка на организм")
        else:
            s, st = 5, "Слишком низкая"
            risks.append("Низкая гравитация — деградация костей и мышц")
        total += add("gravity", "Гравитация", s, 15, f"{g:.2f} g", st)
    else:
        total += add("gravity", "Гравитация", 6, 15, "нет данных", "Неизвестна")

    # 4. Тип планеты (15) — с учётом плотности
    if comp_kind == "rocky":
        if density and density >= 3.5:
            s, st = 15, "Каменистая планета с твёрдой поверхностью"
        else:
            s, st = 13, "Вероятно каменистая"
    elif comp_kind == "super_earth":
        if density and density >= 4:
            s, st = 12, "Плотная — твёрдая поверхность вероятна"
        else:
            s, st = 10, "Состав не подтверждён"
            recs.append("Уточнить состав: возможна плотная водородная атмосфера")
    elif comp_kind == "mini_neptune":
        s, st = 4, "Газовая оболочка — твёрдой поверхности скорее всего нет"
        risks.append("Низкая плотность указывает на мини-нептун без твёрдой поверхности")
    elif comp_kind == "neptune":
        s, st = 3, "Нет твёрдой поверхности"
        risks.append("Ледяной гигант — посадка невозможна")
    elif comp_kind == "giant":
        s, st = 0, "Газовый гигант без поверхности"
        risks.append("Газовый гигант — колонизация только орбитальная")
    else:
        s, st = 6, "Недостаточно данных"
    total += add("composition", "Тип планеты", s, 15, comp_label, st)

    # 5. Стабильность орбиты (10)
    ecc = orb.get("eccentricity")
    if ecc is not None:
        if ecc < 0.1:
            s, st = 10, "Почти круговая — стабильный климат"
        elif ecc < 0.25:
            s, st = 7, "Умеренные сезонные колебания"
        elif ecc < 0.45:
            s, st = 4, "Сильные перепады температуры за год"
            risks.append(f"Эксцентриситет {ecc:.2f} — жёсткие сезонные контрасты")
        else:
            s, st = 1, "Экстремально вытянутая орбита"
            risks.append(f"Эксцентриситет {ecc:.2f} — климатические катастрофы каждый оборот")
        total += add("orbit", "Орбита", s, 10, f"e = {ecc:.3f}", st)
    else:
        total += add("orbit", "Орбита", 5, 10, "нет данных", "Неизвестна")

    # 6. Звезда (15)
    teff = star.get("temperature")
    if teff:
        if 5300 <= teff <= 6000:
            s, st = 15, "Солнцеподобная звезда класса G — идеальна"
        elif 4400 <= teff < 5300:
            s, st = 13, "Спокойный оранжевый карлик класса K — долгожитель"
        elif 6000 < teff <= 6600:
            s, st = 10, "Класс F — ярче Солнца, короче жизнь"
        elif 2200 <= teff < 4400:
            s, st = 7, "Красный карлик класса M — вспышки и приливный захват"
            risks.append("Вспышки красного карлика могут срывать атмосферу")
        elif teff > 6600:
            s, st = 3, "Горячая звезда — короткая жизнь системы"
            risks.append("Горячая звезда: жёсткий УФ и малое время на развитие жизни")
        else:
            s, st = 4, "Холодный объект"
        total += add("star", "Звезда", s, 15, f"{teff:.0f} K", st)
    else:
        total += add("star", "Звезда", 6, 15, "нет данных", "Неизвестна")

    # 7. Приливный захват (5)
    lock = derived.get("tidal_locking")
    if lock == "unlikely":
        total += add("tidal", "Вращение", 5, 5, "свободное", "Смена дня и ночи вероятна")
    elif lock == "possible":
        total += add("tidal", "Вращение", 2.5, 5, "возможен захват", "Возможен приливный захват")
    elif lock == "likely":
        total += add("tidal", "Вращение", 0, 5, "приливный захват", "Вечный день / вечная ночь")
        risks.append("Приливный захват: жизнь возможна лишь в зоне терминатора")
    else:
        total += add("tidal", "Вращение", 2.5, 5, "нет данных", "Неизвестно")

    # Без твёрдой поверхности высокой пригодности быть не может
    if comp_kind == "mini_neptune":
        total = min(total, 48.0)
    elif comp_kind == "neptune":
        total = min(total, 34.0)
    elif comp_kind == "giant":
        total = min(total, 26.0)
        risks.append("Жить можно только на орбитальных станциях или спутниках планеты")

    total = round(total, 1)
    if total >= 70:
        category, surv = "Earth-like", 88 + (total - 70) / 30 * 11
        recs.append("Отличный кандидат на колонизацию!")
    elif total >= 55:
        category, surv = "Promising", 65 + (total - 55) / 15 * 23
        recs.append("Пригодна при стандартном оборудовании миссии")
    elif total >= 40:
        category, surv = "Moderate", 40 + (total - 40) / 15 * 25
        recs.append("Необходимы продвинутые системы жизнеобеспечения")
    elif total >= 25:
        category, surv = "Challenging", 12 + (total - 25) / 15 * 28
        recs.append("Экстремальные условия — только подготовленная экспедиция")
    else:
        category, surv = "Hostile", max(1.0, total / 25 * 12)
        risks.append("Крайне враждебная среда — колонизация не рекомендуется")

    if phys.get("density") is None and derived.get("density") is None:
        risks.append("Состав и атмосфера планеты не определены")

    return HabitabilityScore(
        total_score=total,
        survival_chance=round(surv, 1),
        esi=derived.get("esi"),
        factors=factors,
        category=category,
        category_ru=CATEGORY_RU[category],
        recommendations=recs,
        risks=risks,
    )


# ========== ГЕНЕРАЦИЯ ИЗОБРАЖЕНИЙ (PIL / numpy) ==========

def kelvin_to_rgb(temp: float) -> tuple:
    """Приближённый цвет чёрного тела."""
    temp = max(1000.0, min(40000.0, temp)) / 100.0
    if temp <= 66:
        r = 255.0
        g = max(0.0, min(255.0, 99.47 * math.log(temp) - 161.12))
        b = 0.0 if temp <= 19 else max(0.0, min(255.0, 138.52 * math.log(temp - 10) - 305.04))
    else:
        r = max(0.0, min(255.0, 329.70 * ((temp - 60) ** -0.1332)))
        g = max(0.0, min(255.0, 288.12 * ((temp - 60) ** -0.0755)))
        b = 255.0
    return int(r), int(g), int(b)


def _star_seed(name: str) -> int:
    return sum(ord(c) for c in (name or "star")) % (2 ** 31)


def generate_enhanced_star_image(star: dict, planet_name: str = "") -> Optional[str]:
    """Синтетический портрет звезды: лимбовое потемнение, корона, дифракционные лучи."""
    try:
        size = 640
        temp = star.get('temperature') or 5778
        base = np.array(kelvin_to_rgb(temp), dtype=float)
        rng = np.random.default_rng(_star_seed(star.get('name') or planet_name))

        yy, xx = np.mgrid[0:size, 0:size].astype(float)
        cx = cy = size / 2
        st_radius = star.get('radius') or 1.0
        r_px = 70 + 60 * min(2.5, max(0.2, st_radius))
        dist = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)

        img = np.zeros((size, size, 3), dtype=float)
        img += 3.0  # глубокий космос

        # звёздный фон
        n_stars = 260
        sx = rng.integers(0, size, n_stars)
        sy = rng.integers(0, size, n_stars)
        sb = rng.uniform(40, 220, n_stars)
        for x, y, b in zip(sx, sy, sb):
            img[int(y), int(x)] = [b, b, min(255, b * 1.1)]

        # корона (мягкое свечение)
        glow = np.clip(1.0 - (dist - r_px) / (r_px * 2.6), 0, 1) ** 3
        glow[dist <= r_px] = 1.0
        for c in range(3):
            img[..., c] += glow * base[c] * 0.55

        # диск с лимбовым потемнением
        disk = dist <= r_px
        mu = np.sqrt(np.clip(1 - (dist / r_px) ** 2, 0, 1))
        limb = 0.35 + 0.65 * mu  # closer to edge -> darker
        for c in range(3):
            img[..., c] = np.where(disk, base[c] * limb * 1.25, img[..., c])

        # грануляция поверхности
        noise = rng.normal(0, 1, (size, size))
        noise_img = Image.fromarray(((noise - noise.min()) / (np.ptp(noise) + 1e-9) * 255).astype(np.uint8))
        noise_img = noise_img.filter(ImageFilter.GaussianBlur(2))
        noise_arr = np.asarray(noise_img, dtype=float) / 255.0 - 0.5
        for c in range(3):
            img[..., c] = np.where(disk, img[..., c] * (1 + noise_arr * 0.16), img[..., c])

        img = np.clip(img, 0, 255).astype(np.uint8)
        pil = Image.fromarray(img)

        # дифракционные лучи
        overlay = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        od = ImageDraw.Draw(overlay)
        ray_col = tuple(int(min(255, c * 1.2)) for c in base) + (60,)
        L = r_px * 3.2
        for ang in (0, 90, 45, 135):
            rad = math.radians(ang)
            dx, dy = math.cos(rad) * L, math.sin(rad) * L
            od.line([(cx - dx, cy - dy), (cx + dx, cy + dy)], fill=ray_col,
                    width=3 if ang in (0, 90) else 2)
        overlay = overlay.filter(ImageFilter.GaussianBlur(3))
        pil = Image.alpha_composite(pil.convert("RGBA"), overlay).convert("RGB")
        pil = pil.filter(ImageFilter.GaussianBlur(0.6))
        return img_to_data_url(pil, "JPEG", quality=90)
    except Exception as e:  # noqa: BLE001
        logger.error(f"Star image generation failed: {e}")
        return None


def generate_planet_portrait(phys: dict, derived: dict, planet_name: str) -> Optional[str]:
    """Художественный портрет планеты по её классу и температуре."""
    try:
        size = 640
        radius = phys.get("radius") or (11.2 * phys["mass_jupiter"] if phys.get("mass_jupiter") else None)
        teq = derived.get("equilibrium_temp") or phys.get("equilibrium_temp") or 500
        rng = np.random.default_rng(_star_seed(planet_name))

        r_px = 190
        yy, xx = np.mgrid[0:size, 0:size].astype(float)
        cx = cy = size / 2
        dx, dy = (xx - cx) / r_px, (yy - cy) / r_px
        rr = np.sqrt(dx ** 2 + dy ** 2)
        sphere = rr <= 1.0
        zz = np.sqrt(np.clip(1 - rr ** 2, 0, 1))
        # освещение слева-сверху
        light = np.clip(dx * -0.55 + dy * -0.35 + zz * 0.85, 0.02, 1)

        kind, _ = classify_composition(radius, phys.get("mass"),
                                       derived.get("density") or phys.get("density"))
        is_giant = kind == "giant"
        is_neptune = kind in ("neptune", "mini_neptune")

        def smooth_noise(scale, blur):
            n = rng.normal(0, 1, (size, size))
            ni = Image.fromarray(((n - n.min()) / (np.ptp(n) + 1e-9) * 255).astype(np.uint8))
            ni = ni.filter(ImageFilter.GaussianBlur(blur))
            return (np.asarray(ni, dtype=float) / 255.0 - 0.5) * scale

        if is_giant or is_neptune:
            if teq > 1000:
                palette = [(96, 60, 38), (168, 110, 60), (222, 168, 100), (255, 214, 150)]
            elif teq > 350:
                palette = [(140, 110, 80), (200, 170, 130), (235, 210, 170), (180, 140, 100)]
            elif is_neptune:
                palette = [(30, 62, 130), (48, 100, 180), (90, 150, 220), (140, 190, 240)]
            else:
                palette = [(190, 170, 140), (222, 200, 165), (170, 150, 130), (240, 228, 200)]
            lat = dy / np.maximum(zz, 0.05)
            bands = np.sin(lat * (7 if is_giant else 4) + smooth_noise(4, 24)) * 0.5 + 0.5
            col = np.zeros((size, size, 3))
            idx = np.clip((bands * (len(palette) - 1)), 0, len(palette) - 1)
            low = np.floor(idx).astype(int)
            frac = idx - low
            high = np.clip(low + 1, 0, len(palette) - 1)
            pal = np.array(palette, dtype=float)
            for c in range(3):
                col[..., c] = pal[low, c] * (1 - frac) + pal[high, c] * frac
        else:
            col = np.zeros((size, size, 3))
            n1 = smooth_noise(1.4, 10)
            if teq > 800:  # лавовый мир
                base = np.array([48, 30, 26], dtype=float)
                for c in range(3):
                    col[..., c] = base[c] * (1 + smooth_noise(0.9, 6))
                cracks = smooth_noise(1, 4)
                hot = np.clip((cracks - 0.18) * 6, 0, 1)
                col[..., 0] += hot * 235
                col[..., 1] += hot * 96
            elif 240 <= teq <= 330:  # умеренный мир — океаны и континенты
                ocean = np.array([22, 74, 138], dtype=float)
                land = np.array([70, 120, 60], dtype=float)
                mask = np.clip((n1 - 0.08) * 5, 0, 1)
                for c in range(3):
                    col[..., c] = ocean[c] * (1 - mask) + land[c] * mask
                clouds = np.clip((smooth_noise(1.2, 14) - 0.12) * 5, 0, 1)
                for c in range(3):
                    col[..., c] = col[..., c] * (1 - clouds * 0.75) + 245 * clouds * 0.75
                polar = np.clip((np.abs(dy / np.maximum(zz, 0.05)) - 0.72) * 4, 0, 1)
                for c in range(3):
                    col[..., c] = col[..., c] * (1 - polar) + 240 * polar
            elif teq < 240:  # ледяной мир
                base = np.array([176, 200, 224], dtype=float)
                for c in range(3):
                    col[..., c] = base[c] * (1 + n1 * 0.35)
            else:  # горячая пустыня
                base = np.array([168, 126, 88], dtype=float)
                for c in range(3):
                    col[..., c] = base[c] * (1 + n1 * 0.5)

        img = np.zeros((size, size, 3), dtype=float) + 4
        # фоновые звёзды
        for _ in range(210):
            x, y = rng.integers(0, size, 2)
            b = rng.uniform(30, 190)
            img[y, x] = [b, b, min(255, b * 1.08)]
        for c in range(3):
            img[..., c] = np.where(sphere, col[..., c] * light, img[..., c])

        pil = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))

        # атмосферный ореол для потенциально «атмосферных» миров
        if not is_giant and radius is not None and radius < 2.7 and 150 < teq < 420:
            halo = Image.new("RGBA", (size, size), (0, 0, 0, 0))
            hd = ImageDraw.Draw(halo)
            for i in range(10, 0, -1):
                alpha = int(5 * i)
                hd.ellipse([cx - r_px - i * 2.2, cy - r_px - i * 2.2,
                            cx + r_px + i * 2.2, cy + r_px + i * 2.2],
                           outline=(120, 190, 255, alpha), width=3)
            halo = halo.filter(ImageFilter.GaussianBlur(4))
            pil = Image.alpha_composite(pil.convert("RGBA"), halo).convert("RGB")

        # кольца для крупных гигантов (детерминированно по имени)
        if is_giant and rng.random() > 0.45:
            rings = Image.new("RGBA", (size, size), (0, 0, 0, 0))
            rd = ImageDraw.Draw(rings)
            for k, (rw, alpha) in enumerate([(1.35, 90), (1.55, 70), (1.8, 45)]):
                rx, ry = r_px * rw, r_px * rw * 0.28
                rd.ellipse([cx - rx, cy - ry, cx + rx, cy + ry],
                           outline=(210, 200, 180, alpha), width=int(9 - k * 2))
            rings = rings.filter(ImageFilter.GaussianBlur(2))
            # верхняя половина колец скрыта за планетой
            arr = np.asarray(rings).copy()
            hide = (yy < cy) & sphere
            arr[hide] = 0
            pil = Image.alpha_composite(pil.convert("RGBA"), Image.fromarray(arr)).convert("RGB")

        pil = pil.filter(ImageFilter.GaussianBlur(0.5))
        return img_to_data_url(pil, "JPEG", quality=90)
    except Exception as e:  # noqa: BLE001
        logger.error(f"Planet portrait failed: {e}")
        return None


# ========== СБОРКА ПОЛНЫХ ДАННЫХ ==========

SPECTRAL_RU = {"O": "голубой звезды", "B": "голубовато-белой звезды", "A": "белой звезды",
               "F": "жёлто-белой звезды", "G": "жёлтого карлика", "K": "оранжевого карлика",
               "M": "красного карлика"}

METHOD_RU = {
    "Transit": "транзита", "Radial Velocity": "лучевых скоростей",
    "Microlensing": "микролинзирования", "Imaging": "прямого наблюдения",
    "Transit Timing Variations": "тайминга транзитов",
    "Eclipse Timing Variations": "тайминга затмений",
    "Orbital Brightness Modulation": "модуляции блеска",
    "Pulsar Timing": "тайминга пульсара",
    "Pulsation Timing Variations": "тайминга пульсаций",
    "Astrometry": "астрометрии", "Disk Kinematics": "кинематики диска",
}


def build_summary(name: str, phys: dict, orb: dict, star: dict, derived: dict, disc: dict) -> str:
    """Короткое человекочитаемое описание планеты из имеющихся данных."""
    _, comp_label = classify_composition(phys.get("radius"), phys.get("mass"),
                                         derived.get("density"))
    parts = []
    head = comp_label if comp_label and comp_label != "Неизвестен" else "Экзопланета"
    if phys.get("radius"):
        head += f" радиусом {phys['radius']:.2g} R⊕"
    elif phys.get("mass"):
        head += f" массой {phys['mass']:.2g} M⊕"
    spec = (star.get("spectral_type") or "")[:1].upper()
    star_word = SPECTRAL_RU.get(spec, "звезды")
    host = star.get("name") or "—"
    if derived.get("distance_ly"):
        head += f" у {star_word} {host} в {derived['distance_ly']:,.0f} св. годах от нас".replace(",", " ")
    else:
        head += f" у {star_word} {host}"
    parts.append(head + ".")
    if orb.get("period"):
        sent = f"Год длится {orb['period']:.3g} сут"
        insol = derived.get("insolation")
        if insol:
            sent += f"; планета получает {insol:.2g}× земной инсоляции"
        hz = derived.get("hz_position")
        hz_note = {"conservative": " — в самом центре зоны обитаемости",
                   "optimistic": " — в оптимистичной зоне обитаемости",
                   "inner": " — чуть ближе внутренней границы зоны обитаемости",
                   "outer": " — за внешней границей зоны обитаемости"}.get(hz)
        if hz_note:
            sent += hz_note
        parts.append(sent + ".")
    if disc.get("discovery_year"):
        method = disc.get("discovery_method")
        method_txt = f" методом {METHOD_RU[method]}" if method in METHOD_RU else (
            f" методом «{method}»" if method else "")
        fac = disc.get("discovery_facility")
        parts.append(f"Открыта в {disc['discovery_year']} г.{method_txt}"
                     + (f" ({fac})." if fac else "."))
    return " ".join(parts)


async def _within(coro, seconds: float, default=None):
    """Необязательный источник: не успел за отведённое время — идём дальше без него."""
    try:
        return await asyncio.wait_for(coro, timeout=seconds)
    except Exception:  # noqa: BLE001
        return default


# Реальный прогресс сборки страницы планеты — его опрашивает экран загрузки
DETAIL_PROGRESS: Dict[str, Dict[str, Any]] = {}


def _mark_progress(key: str, stage: Optional[str] = None, source: Optional[str] = None):
    if len(DETAIL_PROGRESS) > 600:   # страховка от разрастания за долгую жизнь процесса
        DETAIL_PROGRESS.clear()
    p = DETAIL_PROGRESS.setdefault(key, {"stage": "sources", "sources_done": []})
    if stage:
        p["stage"] = stage
    if source and source not in p["sources_done"]:
        p["sources_done"].append(source)


async def build_planet_detail(pl_name: str, include_heavy: bool = True,
                              hostname_hint: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Собирает ядро данных о планете. Изображения — отдельным эндпоинтом.

    Если имя звезды известно заранее (из каталога), все внешние источники
    опрашиваются параллельно с основным запросом NASA — это в разы быстрее.
    Второстепенные источники ограничены таймаутами и не тормозят ответ.
    """
    key = norm_name(pl_name)
    _mark_progress(key, stage="sources")

    async def _nasa():
        r = await fetch_nasa_full_row(pl_name)
        _mark_progress(key, source="nasa")
        return r

    async def _t(coro, seconds, source, default=None):
        res = await _within(coro, seconds, default)
        _mark_progress(key, source=source)
        return res

    if include_heavy and hostname_hint:
        row, simbad, aliases, wiki, system_planets = await asyncio.gather(
            _nasa(),
            _t(fetch_simbad_data(hostname_hint), 6.0, "simbad"),
            _t(fetch_aliases(hostname_hint), 6.0, "aliases"),
            _t(fetch_wikipedia(pl_name), 5.0, "wiki"),
            _t(fetch_system_planets(hostname_hint), 9.0, "system", []),
        )
        if not row:
            DETAIL_PROGRESS.pop(key, None)
            return None
        hostname = row.get('hostname') or hostname_hint
    else:
        row = await _nasa()
        if not row:
            DETAIL_PROGRESS.pop(key, None)
            return None
        hostname = row.get('hostname') or pl_name
        if include_heavy:
            simbad, aliases, wiki, system_planets = await asyncio.gather(
                _t(fetch_simbad_data(hostname), 6.0, "simbad"),
                _t(fetch_aliases(hostname), 6.0, "aliases"),
                _t(fetch_wikipedia(pl_name), 5.0, "wiki"),
                _t(fetch_system_planets(hostname), 9.0, "system", []),
            )
        else:
            simbad = aliases = wiki = None
            system_planets = []
    system_planets = system_planets or []
    _mark_progress(key, stage="compute")

    phys = extract_physical_params(row)
    orb = extract_orbital_params(row)
    star = extract_host_star(row, simbad)
    derived = compute_derived(phys, orb, star)
    hab = calculate_habitability_score(phys, orb, star, derived)

    data: Dict[str, Any] = {
        "id": str(uuid.uuid4()),
        "name": row.get('pl_name') or pl_name,
        "tic_id": row.get('tic_id'),
        "identifiers": {
            "tic": row.get('tic_id'), "gaia": row.get('gaia_id'),
            "hd": row.get('hd_name'), "hip": row.get('hip_name'),
            "letter": row.get('pl_letter'),
        },
        "physical_params": phys,
        "orbital_params": orb,
        "host_star": star,
        "derived": derived,
        "discovery_info": extract_discovery(row),
        "system": {
            "star_count": row.get('sy_snum'),
            "planet_count": row.get('sy_pnum'),
            "moon_count": row.get('sy_mnum'),
            "planets": system_planets,
        },
        "habitability_score": hab.model_dump(),
        "summary": build_summary(row.get('pl_name') or pl_name, phys, orb, star,
                                 derived, extract_discovery(row)),
        "wikipedia": wiki,
        "aliases": aliases,
        "simbad_data": simbad,
        "nasa_data": {k: v for k, v in row.items() if v is not None and not k.startswith('_')},
        "sources_used": ["NASA Exoplanet Archive (pscomppars)"],
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }
    if simbad:
        data["sources_used"].append("SIMBAD")
    if wiki:
        data["sources_used"].append(f"Wikipedia ({wiki['lang']})")
    if aliases:
        data["sources_used"].append("NASA Alias Lookup")

    ra = star["coordinates"].get("ra")
    dec = star["coordinates"].get("dec")
    name_url = quote(data["name"])
    data["external_links"] = {
        "nasa_archive": f"https://exoplanetarchive.ipac.caltech.edu/overview/{name_url}",
        "nasa_eyes": "https://eyes.nasa.gov/apps/exo/#/planet/" + data["name"].replace(' ', '_'),
        "simbad": f"https://simbad.cds.unistra.fr/simbad/sim-id?Ident={quote(hostname)}",
        "aladin": (f"https://aladin.cds.unistra.fr/AladinLite/?target={ra}%20{dec}&fov=0.5"
                   if ra is not None and dec is not None else None),
        "wikipedia": (wiki or {}).get("url"),
    }

    _mark_progress(key, stage="done")
    return data


_DETAIL_INFLIGHT: Dict[str, "asyncio.Task"] = {}


async def get_detail_cached(pl_name: str, hostname_hint: Optional[str] = None) -> Optional[Dict[str, Any]]:
    key = norm_name(pl_name)
    now = time.time()
    if key in DETAIL_CACHE and now - DETAIL_CACHE_TS.get(key, 0) < DETAIL_TTL:
        return DETAIL_CACHE[key]
    disk = disk_cache_read("planets", key, DETAIL_TTL)
    if disk:
        DETAIL_CACHE[key] = disk
        DETAIL_CACHE_TS[key] = now
        return disk
    # одновременные запросы одной планеты ждут один общий TAP-запрос
    if key in _DETAIL_INFLIGHT:
        return await asyncio.shield(_DETAIL_INFLIGHT[key])

    async def _build():
        try:
            data = await build_planet_detail(pl_name, include_heavy=True,
                                             hostname_hint=hostname_hint)
            if data:
                DETAIL_CACHE[key] = data
                DETAIL_CACHE_TS[key] = time.time()
                disk_cache_write("planets", key, data)
            return data
        finally:
            _DETAIL_INFLIGHT.pop(key, None)

    task = asyncio.create_task(_build())
    _DETAIL_INFLIGHT[key] = task
    return await asyncio.shield(task)


IMAGES_CACHE: Dict[str, Any] = {}
IMAGES_CACHE_TS: Dict[str, float] = {}


async def build_planet_images(core: Dict[str, Any]) -> Dict[str, Any]:
    """Тяжёлые изображения (реальные снимки + генерация) — грузятся отдельно."""
    star = core.get('host_star') or {}
    coords = star.get('coordinates') or {}
    ra, dec = coords.get('ra'), coords.get('dec')
    real_images: List[Dict[str, Any]] = []
    loop = asyncio.get_running_loop()
    tasks = [
        loop.run_in_executor(None, generate_enhanced_star_image, star, core['name']),
        loop.run_in_executor(None, generate_planet_portrait,
                             core.get('physical_params') or {},
                             core.get('derived') or {}, core['name']),
    ]
    if ra is not None and dec is not None:
        sky_task = fetch_sky_cutouts(ra, dec, star.get('name') or core['name'])
        synthetic_star, portrait, real_images = await asyncio.gather(*tasks, sky_task)
    else:
        synthetic_star, portrait = await asyncio.gather(*tasks)
    return {
        "synthetic_star": synthetic_star,
        "planet_portrait": portrait,
        "real_images": real_images or [],
        "aladin": {"ra": ra, "dec": dec} if ra is not None else None,
    }


async def get_light_cached(pl_name: str) -> Optional[Dict[str, Any]]:
    key = norm_name(pl_name)
    now = time.time()
    if key in LIGHT_CACHE and now - LIGHT_CACHE_TS.get(key, 0) < DETAIL_TTL:
        return LIGHT_CACHE[key]
    full = DETAIL_CACHE.get(key)
    if full and now - DETAIL_CACHE_TS.get(key, 0) < DETAIL_TTL:
        data = {k: full[k] for k in
                ('name', 'physical_params', 'orbital_params', 'host_star',
                 'derived', 'habitability_score', 'discovery_info') if k in full}
    else:
        data = await build_planet_detail(pl_name, include_heavy=False)
        if data:
            data = {k: data[k] for k in
                    ('name', 'physical_params', 'orbital_params', 'host_star',
                     'derived', 'habitability_score', 'discovery_info') if k in data}
    if data:
        LIGHT_CACHE[key] = data
        LIGHT_CACHE_TS[key] = now
    return data


def remember_search(name: str, data: Dict[str, Any]):
    entry = {
        "name": name,
        "category": (data.get("habitability_score") or {}).get("category_ru"),
        "score": (data.get("habitability_score") or {}).get("total_score"),
        "hostname": (data.get("host_star") or {}).get("name"),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    RECENT_SEARCHES.appendleft(entry)
    if db is not None:
        async def _save():
            try:
                await db.exoplanet_searches.insert_one(dict(entry))
            except Exception as e:  # noqa: BLE001
                logger.debug(f"Mongo save skipped: {e}")
        asyncio.create_task(_save())


# ========== AI-АНАЛИЗ (Groq — облако; Ollama — локальный фолбэк) ==========

GROQ_API_KEY = (os.environ.get("GROQ_API_KEY") or "").strip()
# На слабом железе (ТВ-бокс) локальную модель не трогаем вовсе: OLLAMA_ENABLED=0
OLLAMA_ENABLED = os.environ.get("OLLAMA_ENABLED", "1").strip().lower() not in ("0", "false", "no", "off")
OLLAMA_OFF = {"analysis": None, "ollama_available": False,
              "error": "Локальная модель на этом сервере отключена, а Groq сейчас не ответил"}
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
# Каскад: сначала умные модели, при лимитах/сбоях — быстрые запасные
GROQ_MODELS = [m.strip() for m in (os.environ.get(
    "GROQ_MODELS",
    "openai/gpt-oss-120b,llama-3.3-70b-versatile,openai/gpt-oss-20b,llama-3.1-8b-instant",
)).split(",") if m.strip()]
GROQ_NICE = {
    "openai/gpt-oss-120b": "GPT-OSS 120B",
    "llama-3.3-70b-versatile": "Llama 3.3 70B",
    "openai/gpt-oss-20b": "GPT-OSS 20B",
    "llama-3.1-8b-instant": "Llama 3.1 8B (запасная)",
}
AI_SYSTEM = (
    "Ты — астрофизик и астробиолог, встроенный в приложение ExoVision. Отвечай по-русски, "
    "научно, но понятно неспециалисту. Опирайся ТОЛЬКО на переданные данные планеты и "
    "общеизвестную астрономию; null означает «неизвестно» — честно говори об этом и "
    "никогда не выдумывай числа. Формулы и расчёты пиши обычным текстом (например: "
    "«1.7×10^16 км / 20 км/с ≈ 27 млн лет»), НЕ используй LaTeX и знаки \\[ \\]. "
    "Из разметки допустимы только **жирный**, списки и заголовки ##."
)


async def groq_chat(messages: List[Dict[str, str]], temperature: float = 0.5,
                    max_tokens: int = 1600) -> Dict[str, Any]:
    """Запрос к Groq с каскадом моделей: лимит/сбой → следующая модель."""
    if not GROQ_API_KEY:
        return {"error": "GROQ_API_KEY не задан"}
    last_err = "все модели Groq недоступны"
    async with httpx.AsyncClient(timeout=90.0) as client:
        for gm in GROQ_MODELS:
            payload: Dict[str, Any] = {"model": gm, "messages": messages,
                                       "temperature": temperature, "max_tokens": max_tokens}
            if gm.startswith("openai/gpt-oss"):
                payload["reasoning_effort"] = "low"
            try:
                r = await client.post(GROQ_URL, json=payload, headers={
                    "Authorization": f"Bearer {GROQ_API_KEY}"})
                if r.status_code == 200:
                    text = ((r.json().get("choices") or [{}])[0]
                            .get("message", {}).get("content") or "").strip()
                    if text:
                        return {"text": text, "model": gm,
                                "model_nice": GROQ_NICE.get(gm, gm)}
                    last_err = f"{gm}: пустой ответ"
                elif r.status_code in (401, 403):
                    return {"error": "ключ Groq не принят — проверьте GROQ_API_KEY в backend/.env"}
                else:
                    # 429 (лимит токенов), 5xx, 400/404 (модель отключили) → следующая в каскаде
                    last_err = f"{gm}: HTTP {r.status_code}"
                    logger.info(f"Groq {gm} → {r.status_code}, перехожу к следующей модели")
            except Exception as e:  # noqa: BLE001
                last_err = f"{gm}: {e}"
    return {"error": last_err}


def planet_ai_context(data: dict) -> str:
    """Компактная сводка данных планеты — общий контекст для анализа и чата."""
    hab = data.get('habitability_score') or {}
    slim = {
        "физические параметры": data.get('physical_params'),
        "орбита": data.get('orbital_params'),
        "звезда": {k: v for k, v in (data.get('host_star') or {}).items()
                   if k not in ('magnitudes', 'coordinates')},
        "производные величины": data.get('derived'),
        "открытие": data.get('discovery_info'),
    }
    return f"""Экзопланета {data.get('name')}.
ОЦЕНКА ОБИТАЕМОСТИ: {hab.get('total_score')}/100 ({hab.get('category_ru')}), шанс выживания {hab.get('survival_chance')}%, ESI {hab.get('esi')}.
Факторы: {json.dumps({k: v.get('status') for k, v in (hab.get('factors') or {}).items()}, ensure_ascii=False)}
Риски: {json.dumps(hab.get('risks', []), ensure_ascii=False)}

ДАННЫЕ (null = неизвестно):
{json.dumps(slim, ensure_ascii=False, indent=1, default=str)}"""


ANALYSIS_TASK = """Дай структурированный анализ по разделам (используй Markdown-заголовки ##):
1. Классификация планеты и сравнение с Солнечной системой
2. Условия на поверхности (температура, гравитация, излучение)
3. Потенциал обитаемости и вероятность жидкой воды
4. Сценарий колонизации: оборудование, вызовы, долгосрочные перспективы
5. Научная значимость и что стоит исследовать дальше

Используй конкретные числа из данных."""


async def analyze_with_ollama(data: dict, ollama_url: str, model: Optional[str],
                              question: Optional[str]) -> dict:
    if not OLLAMA_ENABLED:
        return OLLAMA_OFF
    try:
        async with httpx.AsyncClient(timeout=6.0) as client:
            tags = await client.get(f"{ollama_url}/api/tags")
            if tags.status_code != 200:
                return {"analysis": None, "ollama_available": False,
                        "error": "Ollama не отвечает"}
            models = [m.get("name") for m in tags.json().get("models", [])]
    except Exception:  # noqa: BLE001
        return {"analysis": None, "ollama_available": False,
                "error": "Ollama недоступна (проверьте, что она запущена)"}

    if not models:
        return {"analysis": None, "ollama_available": False,
                "error": "В Ollama нет установленных моделей (ollama pull gemma3)"}
    use_model = model if model in models else models[0]

    prompt = AI_SYSTEM + "\n\n" + planet_ai_context(data) + "\n"
    if question:
        prompt += f"\nВОПРОС ПОЛЬЗОВАТЕЛЯ (ответь на него в первую очередь): {question}\n"
    prompt += "\n" + ANALYSIS_TASK

    try:
        async with httpx.AsyncClient(timeout=300.0) as client:
            r = await client.post(f"{ollama_url}/api/generate", json={
                "model": use_model, "prompt": prompt, "stream": False,
                "options": {"temperature": 0.7, "top_p": 0.9},
            })
            if r.status_code == 200:
                return {"analysis": r.json().get('response', ''), "provider": "ollama",
                        "ollama_available": True, "model": use_model, "error": None}
            return {"analysis": None, "ollama_available": False,
                    "error": f"Ollama вернула статус {r.status_code}"}
    except Exception as e:  # noqa: BLE001
        return {"analysis": None, "ollama_available": False, "error": str(e)}


# ========== ЭНДПОИНТЫ ==========

@api_router.get("/")
async def root():
    return {
        "message": "ExoVision API", "version": "3.0",
        "catalog_size": len(CATALOG),
        "features": [
            "Композитные данные NASA pscomppars (лучшие опубликованные значения)",
            "Мгновенный поиск и автодополнение по локальному каталогу",
            "SIMBAD, Wikipedia, NASA Alias Lookup",
            "Реальные снимки неба (DSS2, 2MASS, AllWISE)",
            "Расширенная оценка обитаемости + ESI + зона обитаемости Коппарапу",
            "Сравнение планет, каталог с фильтрами, AI-анализ и чат (Groq LLM, фолбэк Ollama)",
        ],
    }


@api_router.get("/suggest")
async def suggest(q: str = Query(..., min_length=1), limit: int = Query(10, le=25)):
    """Мгновенное автодополнение по каталогу."""
    await ensure_catalog()
    _, results = search_catalog(q, "name", limit=limit)
    return {"query": q, "suggestions": [catalog_entry_public(r) for r in results]}


@api_router.post("/search")
async def search_exoplanet(request: ExoplanetSearchRequest):
    query = (request.query or "").strip()
    if not query:
        raise HTTPException(status_code=400, detail="Пустой запрос")
    if not await ensure_catalog():
        raise HTTPException(status_code=503, detail="Каталог NASA временно недоступен")

    exact, results = search_catalog(query, request.search_type)
    if exact is None and len(results) == 1:
        exact = results[0]

    if exact is not None:
        data = await get_detail_cached(exact['pl_name'], exact.get('hostname'))
        if not data:
            raise HTTPException(status_code=502, detail="NASA Exoplanet Archive не ответил")
        data["similar_planets"] = find_similar_planets(exact)
        remember_search(data['name'], data)
        return {"type": "detail", "data": data}

    if results:
        return {"type": "list", "count": len(results),
                "results": [catalog_entry_public(r) for r in results]}

    # ничего не нашли — предложим похожие
    import difflib
    names = [r['pl_name'] for r in CATALOG if r.get('pl_name')]
    close = difflib.get_close_matches(query, names, n=5, cutoff=0.55)
    raise HTTPException(status_code=404, detail={
        "message": "Планета не найдена в архиве подтверждённых экзопланет",
        "did_you_mean": close,
    })


@api_router.get("/planet/{planet_name}/status")
async def planet_status(planet_name: str):
    """Реальный прогресс сборки страницы планеты — для честного экрана загрузки."""
    p = DETAIL_PROGRESS.get(norm_name(planet_name))
    return p or {"stage": "pending", "sources_done": []}


@api_router.get("/planet/{planet_name}")
async def planet_detail(planet_name: str):
    """Полные данные по точному имени планеты (для прямых ссылок)."""
    await ensure_catalog()
    exact, results = search_catalog(planet_name, "name")
    target = exact or (results[0] if results else None)
    if not target:
        raise HTTPException(status_code=404, detail="Планета не найдена")
    # если запрошенное имя отличается от каталожного — прогресс виден под обоими ключами
    req_key, real_key = norm_name(planet_name), norm_name(target['pl_name'])
    if req_key != real_key:
        DETAIL_PROGRESS[req_key] = DETAIL_PROGRESS.setdefault(
            real_key, {"stage": "sources", "sources_done": []})
    data = await get_detail_cached(target['pl_name'], target.get('hostname'))
    if not data:
        raise HTTPException(status_code=502, detail="NASA Exoplanet Archive не ответил")
    data["similar_planets"] = find_similar_planets(target)
    remember_search(data['name'], data)
    return data


@api_router.get("/planet/{planet_name}/images")
async def planet_images(planet_name: str):
    """Тяжёлые изображения планеты — фронтенд подгружает их фоном."""
    await ensure_catalog()
    exact, results = search_catalog(planet_name, "name")
    target = exact or (results[0] if results else None)
    if not target:
        raise HTTPException(status_code=404, detail="Планета не найдена")
    key = norm_name(target['pl_name'])
    now = time.time()
    if key in IMAGES_CACHE and now - IMAGES_CACHE_TS.get(key, 0) < DETAIL_TTL:
        return IMAGES_CACHE[key]
    disk = disk_cache_read("images", key, DETAIL_TTL)
    if disk:
        IMAGES_CACHE[key] = disk
        IMAGES_CACHE_TS[key] = now
        return disk
    core = await get_detail_cached(target['pl_name'], target.get('hostname'))
    if not core:
        raise HTTPException(status_code=502, detail="NASA Exoplanet Archive не ответил")
    payload = await build_planet_images(core)
    IMAGES_CACHE[key] = payload
    IMAGES_CACHE_TS[key] = now
    disk_cache_write("images", key, payload)
    return payload


@api_router.get("/catalog")
async def catalog(
    q: Optional[str] = None,
    method: Optional[str] = None,
    year_min: Optional[int] = None,
    year_max: Optional[int] = None,
    dist_max: Optional[float] = None,
    min_hab: Optional[float] = None,    # минимальный индекс обитаемости
    size_class: Optional[str] = None,   # earth | super | neptune | giant
    temp_zone: Optional[str] = None,    # cold | temperate | hot
    sort: str = "name",                 # name | year | dist | radius | mass | temp | hab | esi
    order: str = "asc",
    page: int = Query(1, ge=1),
    per_page: int = Query(24, ge=1, le=100),
):
    """Каталог всех подтверждённых планет с фильтрами (работает из памяти)."""
    if not await ensure_catalog():
        raise HTTPException(status_code=503, detail="Каталог NASA временно недоступен")
    rows = CATALOG
    if q:
        nq = norm_name(q)
        rows = [r for r in rows if nq in r['_nplanet'] or nq in r['_nhost']]
    if method:
        rows = [r for r in rows if (r.get('discoverymethod') or '') == method]
    if year_min is not None:
        rows = [r for r in rows if r.get('disc_year') and r['disc_year'] >= year_min]
    if year_max is not None:
        rows = [r for r in rows if r.get('disc_year') and r['disc_year'] <= year_max]
    if dist_max is not None:
        rows = [r for r in rows if fnum(r.get('sy_dist')) is not None and r['sy_dist'] <= dist_max]
    if min_hab is not None:
        rows = [r for r in rows if (r.get('_hab') or 0) >= min_hab]
    if size_class:
        def size_ok(r):
            rad = fnum(r.get('pl_rade'))
            if rad is None:
                return False
            return {
                "earth": rad < 1.8, "super": 1.8 <= rad < 2.7,
                "neptune": 2.7 <= rad < 6, "giant": rad >= 6,
            }.get(size_class, True)
        rows = [r for r in rows if size_ok(r)]
    if temp_zone:
        def temp_ok(r):
            t = fnum(r.get('pl_eqt'))
            if t is None:
                return False
            return {"cold": t < 240, "temperate": 240 <= t <= 330,
                    "hot": t > 330}.get(temp_zone, True)
        rows = [r for r in rows if temp_ok(r)]

    keymap = {
        "name": lambda r: (r.get('pl_name') or '').lower(),
        "year": lambda r: r.get('disc_year') or 0,
        "dist": lambda r: fnum(r.get('sy_dist')) if fnum(r.get('sy_dist')) is not None else 1e12,
        "radius": lambda r: fnum(r.get('pl_rade')) if fnum(r.get('pl_rade')) is not None else 1e12,
        "mass": lambda r: fnum(r.get('pl_bmasse')) if fnum(r.get('pl_bmasse')) is not None else 1e12,
        "temp": lambda r: fnum(r.get('pl_eqt')) if fnum(r.get('pl_eqt')) is not None else 1e12,
        "hab": lambda r: r.get('_hab') if r.get('_hab') is not None else -1,
        "esi": lambda r: r.get('_esi') if r.get('_esi') is not None else -1,
    }
    rows = sorted(rows, key=keymap.get(sort, keymap["name"]),
                  reverse=(order == "desc"))
    total = len(rows)
    start = (page - 1) * per_page
    return {
        "total": total,
        "page": page,
        "pages": max(1, math.ceil(total / per_page)),
        "results": [catalog_entry_public(r) for r in rows[start:start + per_page]],
    }


@api_router.get("/system")
async def planet_system(
    ra: Optional[float] = Query(None, ge=0, lt=360),
    dec: Optional[float] = Query(None, ge=-90, le=90),
    host: Optional[str] = Query(None, max_length=80),
    radius: float = Query(90.0, gt=0, le=600, description="радиус поиска, угл. секунды"),
):
    """Звезда и все её планеты: по имени хоста или по позиции на небе (ссылка из Muninn)."""
    if not await ensure_catalog():
        raise HTTPException(status_code=503, detail="Каталог NASA временно недоступен")
    match = None
    if host:
        found = systems.find_host_by_name(HOSTS, host)
        if found:
            match = (found, None)
    if match is None and ra is not None and dec is not None:
        match = systems.nearest_host(HOSTS, ra, dec, radius)
    if match is None:
        if ra is None and not host:
            raise HTTPException(status_code=422, detail="Нужны ra и dec или host")
        raise HTTPException(status_code=404, detail="Рядом с этой точкой нет звёзд с известными планетами")
    found, sep = match
    payload = systems.system_payload(found, hz=None,
                                     match_arcsec=round(sep, 1) if sep is not None else None)
    star = payload["star"]
    payload["habitable_zone"] = kopparapu_hz(star.get("temperature"), star_luminosity(star))
    return payload


@api_router.get("/hosts")
async def planet_hosts():
    """Компактный список звёзд с планетами: Muninn решает по нему, показывать ли кнопку."""
    if not await ensure_catalog():
        raise HTTPException(status_code=503, detail="Каталог NASA временно недоступен")
    return JSONResponse(systems.hosts_compact(HOSTS),
                        headers={"Cache-Control": "public, max-age=86400"})


@api_router.get("/stats")
async def stats():
    """Статистика архива для главной страницы."""
    if not await ensure_catalog():
        raise HTTPException(status_code=503, detail="Каталог NASA временно недоступен")
    methods: Dict[str, int] = {}
    years: Dict[int, int] = {}
    nearest = None
    for r in CATALOG:
        m = r.get('discoverymethod') or 'Другое'
        methods[m] = methods.get(m, 0) + 1
        y = r.get('disc_year')
        if y:
            years[y] = years.get(y, 0) + 1
        dst = fnum(r.get('sy_dist'))
        if dst and (nearest is None or dst < fnum(nearest.get('sy_dist'))):
            nearest = r
    hosts = len({r.get('hostname') for r in CATALOG if r.get('hostname')})
    top_methods = sorted(methods.items(), key=lambda kv: -kv[1])[:6]
    return {
        "total_planets": len(CATALOG),
        "total_hosts": hosts,
        "methods": [{"method": m, "count": c} for m, c in top_methods],
        "years": [{"year": y, "count": c} for y, c in sorted(years.items())],
        "year_range": [min(years) if years else None, max(years) if years else None],
        "nearest": catalog_entry_public(nearest) if nearest else None,
        "updated_at": datetime.fromtimestamp(CATALOG_LOADED_AT, tz=timezone.utc).isoformat(),
    }


NOTABLE_PLANETS = [
    "Kepler-186 f", "TRAPPIST-1 e", "TRAPPIST-1 d", "Proxima Cen b", "Kepler-452 b",
    "TOI-700 d", "K2-18 b", "GJ 1002 b", "LHS 1140 b", "Kepler-62 f", "Kepler-442 b",
    "GJ 667 C c", "HD 209458 b", "51 Peg b", "WASP-12 b", "KELT-9 b", "55 Cnc e",
    "GJ 1214 b", "HD 189733 b", "Kepler-16 b",
]


@api_router.get("/random")
async def random_planet(interesting: bool = True):
    """Случайная планета: либо знаменитая, либо любая с полными данными."""
    await ensure_catalog()
    if interesting and random.random() < 0.6:
        known = [n for n in NOTABLE_PLANETS
                 if any(r['_nplanet'] == norm_name(n) for r in CATALOG)]
        if known:
            return {"name": random.choice(known)}
    rich = [r for r in CATALOG
            if r.get('pl_rade') and r.get('pl_bmasse') and r.get('pl_eqt') and r.get('sy_dist')]
    pick = random.choice(rich or CATALOG)
    return {"name": pick['pl_name']}


@api_router.get("/history")
async def history(limit: int = Query(12, le=50)):
    if db is not None:
        try:
            cursor = db.exoplanet_searches.find({}, {"_id": 0}).sort("timestamp", -1).limit(limit)
            items = await cursor.to_list(length=limit)
            if items:
                return {"items": items, "source": "mongodb"}
        except Exception as e:  # noqa: BLE001
            logger.debug(f"Mongo history skipped: {e}")
    return {"items": list(RECENT_SEARCHES)[:limit], "source": "memory"}


@api_router.get("/compare")
async def compare_planets(planet1: str = Query(...), planet2: str = Query(...)):
    await ensure_catalog()
    async def resolve(name):
        exact, results = search_catalog(name, "name")
        target = exact or (results[0] if results else None)
        return await get_light_cached(target['pl_name']) if target else None

    data1, data2 = await asyncio.gather(resolve(planet1), resolve(planet2))
    if not data1 or not data2:
        missing = planet1 if not data1 else planet2
        raise HTTPException(status_code=404, detail=f"Планета не найдена: {missing}")

    h1 = data1.get('habitability_score') or {}
    h2 = data2.get('habitability_score') or {}
    return {
        "planet1": data1,
        "planet2": data2,
        "comparison": {
            "better_habitability": data1['name'] if (h1.get('total_score') or 0) >= (h2.get('total_score') or 0) else data2['name'],
            "score_difference": round(abs((h1.get('total_score') or 0) - (h2.get('total_score') or 0)), 1),
            "survival_difference": round(abs((h1.get('survival_chance') or 0) - (h2.get('survival_chance') or 0)), 1),
        },
    }


SCATTER_FIELDS = {
    "pl_rade": "Радиус, R⊕", "pl_bmasse": "Масса, M⊕", "pl_orbper": "Период, сут",
    "pl_eqt": "Температура, K", "pl_insol": "Инсоляция, S⊕", "sy_dist": "Расстояние, пк",
    "disc_year": "Год открытия", "st_teff": "T звезды, K", "st_lum": "Светимость звезды, L☉",
    "pl_dens": "Плотность, г/см³", "hab": "Индекс обитаемости", "esi": "ESI",
}


@api_router.get("/catalog/scatter")
async def catalog_scatter(x: str = Query("pl_rade"), y: str = Query("pl_bmasse"),
                          limit: int = Query(1500, le=4000), name: Optional[str] = None):
    """Точки каталога для диаграмм рассеяния по любой паре осей из белого списка.
    name= — планета, которую надо вернуть отдельно как target (для подсветки)."""
    if x not in SCATTER_FIELDS or y not in SCATTER_FIELDS:
        raise HTTPException(status_code=400,
                            detail=f"Допустимые оси: {', '.join(SCATTER_FIELDS)}")
    await ensure_catalog()

    def val(r, k):
        if k == "hab":
            return r.get("_hab")
        if k == "esi":
            return r.get("_esi")
        if k == "st_lum":  # в pscomppars лежит log10(L/L☉) — отдаём линейную
            lg = fnum(r.get("st_lum"))
            if lg is not None:
                return 10 ** lg
            rr, tt = fnum(r.get("st_rad")), fnum(r.get("st_teff"))
            return (rr ** 2) * ((tt / 5772.0) ** 4) if rr and tt else None
        return fnum(r.get(k))

    def rnd(v):
        return round(v, 5 if abs(v) < 10 else 3)

    pts, target = [], None
    nkey = norm_name(name) if name else None
    for r in CATALOG:
        vx, vy = val(r, x), val(r, y)
        if vx is None or vy is None:
            continue
        p = {"n": r.get("pl_name"), "x": rnd(vx), "y": rnd(vy)}
        if nkey and r.get("_nplanet") == nkey:
            target = p
            continue
        pts.append(p)
    stride = max(1, len(pts) // limit)
    sampled = pts[::stride][:limit]
    return {"x": x, "y": y, "labels": {"x": SCATTER_FIELDS[x], "y": SCATTER_FIELDS[y]},
            "points": sampled, "target": target,
            "total": len(pts) + (1 if target else 0)}


@api_router.get("/ollama/models")
async def ollama_models(url: str = Query("http://localhost:11434")):
    if not OLLAMA_ENABLED:
        return {"available": False, "models": []}
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(f"{url}/api/tags")
            if r.status_code == 200:
                models = [m.get("name") for m in r.json().get("models", [])]
                return {"available": True, "models": models}
    except Exception:  # noqa: BLE001
        pass
    return {"available": False, "models": []}


@api_router.post("/analyze")
async def analyze_exoplanet(request: AIAnalysisRequest):
    """AI-заключение: Groq (каскад облачных моделей) → локальная Ollama как фолбэк."""
    data = request.exoplanet_data
    name_key = norm_name(str(data.get("name") or ""))
    # готовый полный анализ (без вопроса) храним на диске — бережём лимиты Groq
    if GROQ_API_KEY and name_key and not request.question and not request.force:
        cached = disk_cache_read("ai", name_key, 7 * 24 * 3600)
        if cached and cached.get("analysis"):
            return {**cached, "cached": True}
    if GROQ_API_KEY:
        task = (f"ВОПРОС ПОЛЬЗОВАТЕЛЯ (ответь именно на него, по делу): {request.question}"
                if request.question else ANALYSIS_TASK)
        res = await groq_chat([
            {"role": "system", "content": AI_SYSTEM},
            {"role": "user", "content": planet_ai_context(data) + "\n\n" + task},
        ], temperature=0.5, max_tokens=1800)
        if res.get("text"):
            out = {"analysis": res["text"], "ollama_available": True, "provider": "groq",
                   "model": res["model_nice"], "error": None}
            if not request.question and name_key:
                disk_cache_write("ai", name_key, out)
            return out
        logger.warning(f"Groq не ответил ({res.get('error')}), пробую Ollama")
    try:
        return await analyze_with_ollama(data, request.ollama_url,
                                         request.model, request.question)
    except Exception as e:  # noqa: BLE001
        logger.error(f"Analysis error: {e}")
        return {"analysis": None, "ollama_available": False, "error": str(e)}


@api_router.post("/ai/chat")
async def ai_chat(req: AIChatRequest):
    """Диалог о конкретной планете: модель видит все её данные."""
    history = [
        {"role": m.get("role"), "content": str(m.get("content") or "")[:4000]}
        for m in req.messages[-12:] if m.get("role") in ("user", "assistant")
    ]
    if not history or history[-1]["role"] != "user":
        raise HTTPException(status_code=400, detail="Нет вопроса")
    sys_msg = (AI_SYSTEM + " Отвечай кратко: 2–6 предложений, без воды. Markdown допустим. "
               "Вот данные планеты, о которой идёт разговор:\n\n"
               + planet_ai_context(req.exoplanet_data))
    if GROQ_API_KEY:
        res = await groq_chat([{"role": "system", "content": sys_msg}] + history,
                              temperature=0.6, max_tokens=900)
        if res.get("text"):
            return {"reply": res["text"], "model": res["model_nice"], "provider": "groq"}
        logger.warning(f"Groq чат не ответил: {res.get('error')}")
    if not OLLAMA_ENABLED:
        return {"reply": None, "error": OLLAMA_OFF["error"]}
    # фолбэк — локальная Ollama одним промптом
    dialog = "\n".join(f"{'Пользователь' if m['role'] == 'user' else 'Ассистент'}: {m['content']}"
                       for m in history)
    try:
        async with httpx.AsyncClient(timeout=180.0) as client:
            tags = await client.get("http://localhost:11434/api/tags")
            models = ([m.get("name") for m in tags.json().get("models", [])]
                      if tags.status_code == 200 else [])
            if models:
                r = await client.post("http://localhost:11434/api/generate", json={
                    "model": models[0], "prompt": sys_msg + "\n\n" + dialog + "\nАссистент:",
                    "stream": False, "options": {"temperature": 0.6}})
                if r.status_code == 200 and r.json().get('response'):
                    return {"reply": r.json()['response'].strip(),
                            "model": models[0], "provider": "ollama"}
    except Exception:  # noqa: BLE001
        pass
    return {"reply": None,
            "error": "ИИ недоступен: лимиты Groq исчерпаны, а локальная Ollama не запущена"}


@api_router.get("/ai/status")
async def ai_status():
    """Какой AI-провайдер активен — для бейджа на вкладке AI-анализа."""
    if GROQ_API_KEY:
        return {"provider": "groq", "available": True,
                "primary": GROQ_NICE.get(GROQ_MODELS[0], GROQ_MODELS[0]),
                "cascade": [GROQ_NICE.get(m, m) for m in GROQ_MODELS]}
    if not OLLAMA_ENABLED:
        return {"provider": "none", "available": False}
    try:
        async with httpx.AsyncClient(timeout=2.5) as client:
            r = await client.get("http://localhost:11434/api/tags")
            if r.status_code == 200:
                models = [m.get("name") for m in r.json().get("models", [])]
                return {"provider": "ollama", "available": bool(models), "models": models}
    except Exception:  # noqa: BLE001
        pass
    return {"provider": "none", "available": False}


@api_router.get("/habitability/{planet_name}")
async def get_habitability_only(planet_name: str):
    data = await get_light_cached(planet_name)
    if not data:
        raise HTTPException(status_code=404, detail="Планета не найдена")
    return data.get('habitability_score')


# ========== ML: ДЕТЕКТОР ЭКЗОПЛАНЕТ ==========

from lc_common import (bin_folded, center_on_minimum, dual_features,  # noqa: E402
                       global_metrics, local_features, local_view)

MODELS_DIR = ROOT_DIR / "models"
_ml_model = None
_ml_lite = None      # переносимая модель (12 признаков) для TOI и ручного ввода
_ml_meta: Optional[Dict[str, Any]] = None
_lc_model = None
_lc_meta: Optional[Dict[str, Any]] = None
TOI_CACHE: Dict[str, Any] = {"rows": None, "ts": 0.0}
LC_CACHE: Dict[str, Any] = {}
# Анализ кривой — минуты численной работы на numpy: в отдельном процессе он не держит
# GIL основного сервера. Одинаковые запросы, пока анализ идёт, ждут тот же результат.
LC_POOL = ProcessPoolExecutor(max_workers=1)
LC_INFLIGHT: Dict[str, "asyncio.Future"] = {}

# поле запроса -> колонка KOI, на которой обучалась модель
REQ2COL = {
    "period": "koi_period", "duration": "koi_duration", "depth": "koi_depth",
    "prad": "koi_prad", "teq": "koi_teq", "insol": "koi_insol",
    "snr": "koi_model_snr", "impact": "koi_impact", "steff": "koi_steff",
    "slogg": "koi_slogg", "srad": "koi_srad", "mag": "koi_kepmag",
}


class ClassifyRequest(BaseModel):
    period: Optional[float] = None
    duration: Optional[float] = None
    depth: Optional[float] = None
    prad: Optional[float] = None
    teq: Optional[float] = None
    insol: Optional[float] = None
    snr: Optional[float] = None
    impact: Optional[float] = None
    steff: Optional[float] = None
    slogg: Optional[float] = None
    srad: Optional[float] = None
    mag: Optional[float] = None


class OnnxClassifier:
    """Модель sklearn, экспортированная в ONNX (export_onnx.py): тот же predict_proba,
    но без scikit-learn на сервере — только onnxruntime."""

    def __init__(self, path: Path):
        import onnxruntime as ort
        self._sess = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
        self._input = self._sess.get_inputs()[0].name

    def predict_proba(self, x) -> np.ndarray:
        x = np.asarray(x, dtype=np.float32)
        return np.asarray(self._sess.run(None, {self._input: x})[1], dtype=float)


def load_ml():
    global _ml_model, _ml_meta, _ml_lite
    if _ml_model is None and (MODELS_DIR / "exoplanet_clf.onnx").exists():
        _ml_model = OnnxClassifier(MODELS_DIR / "exoplanet_clf.onnx")
        _ml_meta = json.loads((MODELS_DIR / "model_meta.json").read_text(encoding="utf-8"))
        logger.info("ML-классификатор KOI загружен")
        lite_path = MODELS_DIR / "exoplanet_clf_lite.onnx"
        if lite_path.exists() and _ml_meta.get("lite"):
            _ml_lite = OnnxClassifier(lite_path)
            logger.info("Переносимая lite-модель (TOI/ручной ввод) загружена")
        else:
            logger.warning("Lite-модель не найдена — TOI/ручной ввод пойдут через полную "
                           "(вероятности будут занижены; запустите train_model.py и export_onnx.py)")
    return _ml_model


def _tabular_infer(values_by_col: Dict[str, Optional[float]]):
    """Вероятность «планета» для внешних данных (TOI, ручная форма):
    lite-модель по переносимым признакам; фолбэк — полная."""
    if _ml_lite is not None:
        cols = [f["col"] for f in _ml_meta["lite"]["features"]]
        model = _ml_lite
    else:
        cols = [f["col"] for f in _ml_meta["features"]]
        model = _ml_model
    x = np.array([[values_by_col.get(c, np.nan) if values_by_col.get(c) is not None
                   else np.nan for c in cols]], dtype=float)
    return float(model.predict_proba(x)[0, 1])


def load_lc_model():
    global _lc_model, _lc_meta
    if _lc_model is None and (MODELS_DIR / "lc_mlp.onnx").exists():
        _lc_model = OnnxClassifier(MODELS_DIR / "lc_mlp.onnx")
        if _lc_meta is None:
            _lc_meta = json.loads((MODELS_DIR / "lc_meta.json").read_text(encoding="utf-8"))
        logger.info("Нейросеть кривых блеска (MLP) загружена")
    return _lc_model


_lc_cnn_sess = None


def load_lc_cnn():
    """Двухветочная CNN в ONNX — приоритетная модель формы транзита."""
    global _lc_cnn_sess, _lc_meta
    if _lc_cnn_sess is None and (MODELS_DIR / "lc_cnn.onnx").exists():
        try:
            import onnxruntime as ort
            _lc_cnn_sess = ort.InferenceSession(
                str(MODELS_DIR / "lc_cnn.onnx"), providers=["CPUExecutionProvider"])
            _lc_meta = json.loads((MODELS_DIR / "lc_meta.json").read_text(encoding="utf-8"))
            logger.info("Нейросеть кривых блеска (CNN/ONNX) загружена")
        except Exception as e:  # noqa: BLE001
            logger.warning(f"ONNX CNN недоступна: {e}")
    return _lc_cnn_sess


def lc_predict_probs(binned_global: np.ndarray, local_binned: np.ndarray,
                     mlp_feats: np.ndarray) -> Optional[np.ndarray]:
    """Вероятности [планета, двойная, ничего]: CNN если есть, иначе MLP."""
    sess = load_lc_cnn()
    if sess is not None:
        g, l, s = dual_features(binned_global, local_binned)
        logits = sess.run(None, {
            "global": g[None, None, :], "local": l[None, None, :],
            "scalars": s[None, :],
        })[0][0]
        e = np.exp(logits - logits.max())
        return e / e.sum()
    if load_lc_model() is not None:
        return _lc_model.predict_proba([mlp_feats])[0]
    return None


def _feature_row(values_by_col: Dict[str, Optional[float]]) -> "np.ndarray":
    cols = [f["col"] for f in _ml_meta["features"]]
    return np.array([[values_by_col.get(c, np.nan) if values_by_col.get(c) is not None
                      else np.nan for c in cols]], dtype=float)


@api_router.get("/ml/info")
async def ml_info():
    load_ml()
    load_lc_cnn()
    load_lc_model()
    return {
        "tabular_available": _ml_model is not None,
        "lightcurve_available": _lc_cnn_sess is not None or _lc_model is not None,
        "tabular": _ml_meta,
        "lightcurve": _lc_meta,
    }


@api_router.post("/ml/classify")
async def ml_classify(req: ClassifyRequest):
    if load_ml() is None:
        raise HTTPException(status_code=503, detail="Модель не обучена: запустите python train_model.py")
    values = {REQ2COL[k]: v for k, v in req.model_dump().items() if k in REQ2COL}
    provided = {k: v for k, v in values.items() if v is not None}
    if len(provided) < 3:
        raise HTTPException(status_code=400, detail="Укажите хотя бы 3 параметра")
    prob = _tabular_infer(values)
    medians = _ml_meta.get("class_medians", {})
    explanation = []
    feats_for_explain = (_ml_meta.get("lite") or {}).get("features") or _ml_meta["features"]
    for f in feats_for_explain:
        col = f["col"]
        if values.get(col) is None:
            continue
        med = medians.get(col, {})
        explanation.append({
            "label": f["label"], "unit": f["unit"], "value": values[col],
            "planet_median": med.get("planet"),
            "false_positive_median": med.get("false_positive"),
        })
    return {
        "probability": round(prob, 4),
        "verdict": ("Скорее всего планета" if prob >= 0.7 else
                    "Похоже на планету" if prob >= 0.5 else
                    "Сомнительный кандидат" if prob >= 0.3 else
                    "Скорее всего ложноположительный"),
        "explanation": explanation,
        "n_features_used": len(provided),
    }


TOI_COLS = ("toi,tid,tfopwg_disp,pl_orbper,pl_trandurh,pl_trandep,pl_rade,"
            "pl_eqt,pl_insol,pl_tranmid,st_teff,st_logg,st_rad,st_tmag,ra,dec")


TOI_DISK_CACHE = MODELS_DIR / "toi_cache.json"


async def ensure_toi() -> bool:
    if TOI_CACHE["rows"] is not None and time.time() - TOI_CACHE["ts"] < CATALOG_TTL:
        return True
    # свежий дисковый кэш переживает перезапуски
    if TOI_CACHE["rows"] is None and TOI_DISK_CACHE.exists():
        try:
            disk = json.loads(TOI_DISK_CACHE.read_text(encoding="utf-8"))
            if time.time() - disk.get("ts", 0) < CATALOG_TTL:
                TOI_CACHE["rows"] = disk["rows"]
                TOI_CACHE["ts"] = disk["ts"]
                logger.info(f"TOI-каталог загружен с диска: {len(disk['rows'])}")
                return True
        except Exception as e:  # noqa: BLE001
            logger.warning(f"TOI disk cache unreadable: {e}")
    rows = await tap_query(f"SELECT {TOI_COLS} FROM toi", timeout=240.0)
    if not rows:
        return TOI_CACHE["rows"] is not None
    TOI_CACHE["rows"] = rows
    TOI_CACHE["ts"] = time.time()
    try:
        MODELS_DIR.mkdir(exist_ok=True)
        TOI_DISK_CACHE.write_text(json.dumps({"ts": TOI_CACHE["ts"], "rows": rows}),
                                  encoding="utf-8")
    except Exception as e:  # noqa: BLE001
        logger.warning(f"TOI disk cache write failed: {e}")
    logger.info(f"TOI-каталог загружен: {len(rows)} кандидатов")
    return True


def _toi_features(row: dict) -> Dict[str, Optional[float]]:
    return {
        "koi_period": fnum(row.get("pl_orbper")),
        "koi_duration": fnum(row.get("pl_trandurh")),
        "koi_depth": fnum(row.get("pl_trandep")),
        "koi_prad": fnum(row.get("pl_rade")),
        "koi_teq": fnum(row.get("pl_eqt")),
        "koi_insol": fnum(row.get("pl_insol")),
        "koi_model_snr": None,
        "koi_impact": None,
        "koi_steff": fnum(row.get("st_teff")),
        "koi_slogg": fnum(row.get("st_logg")),
        "koi_srad": fnum(row.get("st_rad")),
        "koi_kepmag": fnum(row.get("st_tmag")),
    }


TOI_DISP_RU = {"PC": "кандидат", "APC": "неоднозначный кандидат", "CP": "подтверждена",
               "KP": "известная планета", "FP": "ложноположительный", "FA": "ложная тревога"}


@api_router.get("/ml/toi")
async def ml_toi(disp: str = Query("PC,APC"), limit: int = Query(60, le=200),
                 q: Optional[str] = None):
    """Живые кандидаты TESS (TOI), ранжированные вероятностью модели."""
    if load_ml() is None:
        raise HTTPException(status_code=503, detail="Модель не обучена: запустите python train_model.py")
    if not await ensure_toi():
        raise HTTPException(status_code=503, detail="Каталог TOI временно недоступен")
    wanted = {d.strip().upper() for d in disp.split(",") if d.strip()}
    rows = [r for r in TOI_CACHE["rows"]
            if (r.get("tfopwg_disp") or "").upper() in wanted]
    if q:
        qn = q.strip().lower()
        rows = [r for r in rows if qn in str(r.get("toi", "")).lower()
                or qn in str(r.get("tid", "")).lower()]
    if not rows:
        return {"total": 0, "results": []}
    # переносимая lite-модель: у TOI нет диагностики пайплайна Kepler
    if _ml_lite is not None:
        cols = [f["col"] for f in _ml_meta["lite"]["features"]]
        model = _ml_lite
    else:
        cols = [f["col"] for f in _ml_meta["features"]]
        model = _ml_model
    feats = [_toi_features(r) for r in rows]
    X = np.array([[v.get(c) if v.get(c) is not None else np.nan for c in cols]
                  for v in feats], dtype=float)
    probs = model.predict_proba(X)[:, 1]
    order = np.argsort(-probs)
    results = []
    for i in order[:limit]:
        r = rows[int(i)]
        results.append({
            "toi": r.get("toi"),
            "tid": r.get("tid"),
            "disposition": (r.get("tfopwg_disp") or "").upper(),
            "disposition_ru": TOI_DISP_RU.get((r.get("tfopwg_disp") or "").upper(), "—"),
            "probability": round(float(probs[i]), 4),
            "period": fnum(r.get("pl_orbper")),
            "duration_h": fnum(r.get("pl_trandurh")),
            "depth_ppm": fnum(r.get("pl_trandep")),
            "radius": fnum(r.get("pl_rade")),
            "teq": fnum(r.get("pl_eqt")),
            "tmag": fnum(r.get("st_tmag")),
            "epoch": fnum(r.get("pl_tranmid")),
            "exofop": f"https://exofop.ipac.caltech.edu/tess/target.php?id={r.get('tid')}",
        })
    used_lite = _ml_lite is not None
    return {"total": int(len(rows)), "results": results,
            "model_variant": "lite (переносимые признаки)" if used_lite else "полная",
            "metrics": ((_ml_meta or {}).get("lite") or {}).get("metrics") if used_lite
            else (_ml_meta or {}).get("metrics")}


# ---------- Анализ реальных кривых блеска ----------

def run_bls(time_v: np.ndarray, flux_v: np.ndarray) -> Optional[Dict[str, Any]]:
    """Поиск периода транзита алгоритмом Box Least Squares (порт astropy на numpy)."""
    try:
        # биннинг: BLS по ~10 тыс. точек считается за секунды
        span = float(time_v[-1] - time_v[0])
        if span < 2.0:
            return None
        bin_days = (30.0 if span > 60 else 10.0) / 1440.0
        t, f = lc_pipeline.bin_time_series(time_v, flux_v, bin_days)

        max_period = min(span / 2.5, 30.0)
        min_period = 0.3
        if max_period <= min_period * 1.2:
            return None
        durations = np.array([0.02, 0.05, 0.09, 0.15, 0.25])
        durations = durations[durations < min_period * 0.95]
        # проход 1: логарифмическая сетка по всему диапазону
        periods = np.geomspace(min_period, max_period, 12000)
        pg = lc_pipeline.bls_power(t, f, periods, durations)
        power = np.asarray(pg.power, dtype=float)
        best = int(np.nanargmax(power))
        # проход 2: уточнение узкой линейной сеткой вокруг пика
        p_lo, p_hi = periods[best] * 0.99, periods[best] * 1.01
        fine = np.linspace(p_lo, p_hi, 2000)
        pg_fine = lc_pipeline.bls_power(t, f, fine, durations)
        best_fine = int(np.nanargmax(pg_fine.power))
        # подменяем найденный пик уточнённым значением
        periods = np.asarray(periods, dtype=float)
        periods[best] = float(fine[best_fine])
        power[best] = float(pg_fine.power[best_fine])
        pg_depth = np.asarray(pg.depth, dtype=float)
        pg_dur = np.asarray(pg.duration, dtype=float)
        pg_t0 = np.asarray(pg.transit_time, dtype=float)
        pg_depth[best] = float(pg_fine.depth[best_fine])
        pg_dur[best] = float(pg_fine.duration[best_fine])
        pg_t0[best] = float(pg_fine.transit_time[best_fine])
        med = float(np.nanmedian(power))
        mad = float(np.nanmedian(np.abs(power - med))) * 1.4826 + 1e-12
        sde = (float(power[best]) - med) / mad

        # топ-3 независимых пика (не гармоники выбранного в пределах 3%)
        peaks = []
        order = np.argsort(-power)
        for i in order:
            p = float(periods[i])
            if any(abs(p - q["period"]) / q["period"] < 0.03
                   or abs(p / q["period"] - round(p / q["period"])) < 0.02
                   or abs(q["period"] / p - round(q["period"] / p)) < 0.02
                   for q in peaks):
                continue
            peaks.append({"period": round(p, 5),
                          "sde": round((float(power[i]) - med) / mad, 1)})
            if len(peaks) >= 3:
                break

        stride = max(1, len(periods) // 500)
        keep = sorted(set(range(0, len(periods), stride)) | {best})  # пик не теряем
        z = (power - med) / mad  # периодограмма в единицах значимости (σ)
        return {
            "best_period": round(float(periods[best]), 6),
            "t0": float(pg_t0[best]),
            "duration_h": round(float(pg_dur[best]) * 24, 2),
            "depth_ppm": round(float(pg_depth[best]) * 1e6, 1),
            "sde": round(sde, 1),
            "peaks": peaks,
            "periodogram": [{"P": round(float(periods[i]), 4), "power": round(float(z[i]), 2)}
                            for i in keep],
        }
    except Exception as e:  # noqa: BLE001
        logger.warning(f"BLS failed: {e}")
        return None


FITS_CACHE_DIR = DISK_CACHE_DIR / "fits"


def analyze_lightcurve_sync(target: str, period: Optional[float]) -> Dict[str, Any]:
    files = mast_lite.search_files(target)
    if not files:
        return {"error": f"Кривая блеска для «{target}» не найдена в архивах MAST"}
    chosen, picked = mast_lite.choose_files(files)

    lcs, unsupported = [], 0
    for f in picked:
        path = None
        try:
            path = mast_lite.download(f, FITS_CACHE_DIR)
            lcs.append(lc_pipeline.read_lightcurve(path, chosen))
        except lc_pipeline.UnsupportedLightCurve as e:
            unsupported += 1
            logger.warning(f"unsupported light curve ({f.filename}): {e}")
        except Exception as e:  # noqa: BLE001
            logger.warning(f"MAST download/read failed ({f.filename}): {e}")
            if path is not None:
                mast_lite.forget(path)      # битый файл не должен жить в кэше
    lcs = [lc for lc in lcs if len(lc)]
    if not lcs:
        if unsupported == len(picked):
            return {"error": f"У «{target}» есть только кривые в неподдерживаемом формате ({chosen}). "
                             "Поддерживаются Kepler, K2, TESS SPOC, TESS-SPOC и QLP"}
        return {"error": "Не удалось скачать кривую блеска (MAST перегружен?)"}

    mission = str(lcs[0].meta.get("MISSION") or lcs[0].meta.get("TELESCOP") or "")
    who = mission if mission.lower() == chosen.lower() else f"{mission} · {chosen}"
    if len(lcs) > 1:
        source_label = f"{who} · сегментов данных: {len(lcs)}"
    else:
        seg = lcs[0].meta.get("SECTOR") or lcs[0].meta.get("QUARTER") or lcs[0].meta.get("CAMPAIGN")
        source_label = f"{who}{f' · сектор {seg}' if seg else ''}"

    lc = lc_pipeline.prepare(lcs)
    time_v = lc.time
    if len(time_v) < 100:
        return {"error": "Слишком мало точек в кривой блеска"}
    cad_days = float(np.median(np.diff(time_v)))
    wl = max(51, int(round(0.75 / max(cad_days, 1e-5))))
    wl += (wl + 1) % 2
    try:
        flat = lc_pipeline.flatten(lc, window_length=min(wl, (len(lc) // 2) * 2 - 1))
    except Exception:  # noqa: BLE001
        flat = lc
    time_v, flux_v = flat.time, flat.flux
    ok = np.isfinite(time_v) & np.isfinite(flux_v)
    time_v, flux_v = time_v[ok], flux_v[ok]

    stride = max(1, len(time_v) // 2400)
    t0 = float(time_v[0])
    raw_points = [{"t": round(float(t) - t0, 4), "f": round(float(f), 6)}
                  for t, f in zip(time_v[::stride], flux_v[::stride])]

    out: Dict[str, Any] = {
        "target": target,
        "source": source_label,
        "n_points": int(len(time_v)),
        "cadence_min": round(cad_days * 1440, 1),
        "days_span": round(float(time_v[-1] - time_v[0]), 1),
        "raw": raw_points,
    }

    # период не задан — ищем его алгоритмом BLS
    if not period:
        bls = run_bls(time_v, flux_v)
        if bls:
            out["bls"] = bls
            period = bls["best_period"]

    if period and period > 0:
        phase = ((time_v - time_v[0]) / period + 0.5) % 1.0 - 0.5
        binned = bin_folded(phase, flux_v)
        binned, shift = center_on_minimum(binned)
        n_bins = len(binned)
        shift_phase = shift / n_bins

        ph_shifted = ((phase + shift_phase + 0.5) % 1.0) - 0.5
        fstride = max(1, len(ph_shifted) // 3000)
        folded_scatter = [{"p": round(float(p), 4), "f": round(float(f), 6)}
                          for p, f in zip(ph_shifted[::fstride], flux_v[::fstride])]
        bin_centers = np.linspace(-0.5, 0.5, n_bins, endpoint=False) + 0.5 / n_bins
        folded_bins = [{"p": round(float(p), 4), "f": round(float(f), 6)}
                       for p, f in zip(bin_centers, binned)]

        # глобальный вид: глубина, суммарная значимость, вторичное затмение
        gm, _, depth, noise, dur_frac = global_metrics(binned, period)

        # локальный вид: крупный план транзита (как в AstroNet)
        local_binned, win = local_view(ph_shifted, flux_v, max(dur_frac, 2.0 / n_bins))
        feats, linfo = local_features(local_binned)
        local_centers = np.linspace(-win, win, len(local_binned), endpoint=False) + win / len(local_binned)
        local_bins = [{"p": round(float(p) * period * 24, 3), "f": round(float(f), 6)}
                      for p, f in zip(local_centers, local_binned)]  # ось — часы от центра

        checks = {
            "depth_ppm": gm["depth_ppm"],
            "noise_ppm": gm["noise_ppm"],
            "snr": gm["snr"],
            "duration_hours": gm.get("duration_hours"),
            "flat_bottom_ratio": linfo["flat_bottom_ratio"],
            "v_shaped": linfo["v_shaped"],
            "secondary_depth_ppm": gm["secondary_depth_ppm"],
            "secondary_significant": gm["secondary_significant"],
        }

        # нечёт/чёт: фолдим на 2P — транзиты должны быть одинаковой глубины
        phase2 = ((time_v - time_v[0]) / (2 * period) + 0.5) % 1.0 - 0.5
        b2 = bin_folded(phase2, flux_v, 256)
        rel2 = b2 / np.median(b2) - 1.0
        noise2 = float(np.median(np.abs(rel2 - np.median(rel2))) * 1.4826) + 1e-9
        m1 = int(np.argmin(rel2))
        m2 = (m1 + 128) % 256
        w = 8
        d1 = -min(rel2[[(m1 + k) % 256 for k in range(-w, w + 1)]].min(), 0)
        d2 = -min(rel2[[(m2 + k) % 256 for k in range(-w, w + 1)]].min(), 0)
        odd_even = {
            "depth1_ppm": round(float(d1) * 1e6, 1),
            "depth2_ppm": round(float(d2) * 1e6, 1),
            "diff_pct": round(abs(d1 - d2) / max(d1, d2, 1e-12) * 100, 1),
            # тревога только если обе глубины уверенно видны и разница больше 3σ
            "suspicious": bool(min(d1, d2) > 4 * noise2
                               and abs(d1 - d2) > 3 * noise2
                               and abs(d1 - d2) / max(d1, d2) > 0.3),
        }

        verdict = None
        probs = {}
        p = lc_predict_probs(binned, local_binned, feats)
        if p is not None:
            probs = {"planet": round(float(p[0]), 4), "eclipsing_binary": round(float(p[1]), 4),
                     "no_transit": round(float(p[2]), 4)}
            best = int(np.argmax(p))
            verdict = ["Форма сигнала соответствует планетному транзиту",
                       "Форма сигнала похожа на затменную двойную звезду",
                       "Явного транзита в сложенной кривой не видно"][best]

        notes = []
        if checks["snr"] < 7:
            notes.append("Сигнал слабый — вывод ненадёжен")
        if checks["v_shaped"]:
            notes.append("V-образная форма без плоского дна — признак затменной двойной")
        if checks["secondary_significant"]:
            notes.append("Глубокое вторичное затмение на фазе 0.5 — вероятна затменная двойная")
        if odd_even["suspicious"]:
            notes.append("Чётные и нечётные транзиты разной глубины — вероятна двойная с половинным периодом")
        if not notes and checks["snr"] >= 7:
            notes.append("Классические проверки не нашли признаков ложноположительного")

        out["folded"] = {
            "period_days": period,
            "scatter": folded_scatter,
            "bins": folded_bins,
            "local_bins": local_bins,
            "checks": checks,
            "odd_even": odd_even,
            "nn_probs": probs,
            "nn_verdict": verdict,
            "notes": notes,
        }
    return out


@api_router.get("/lightcurve")
async def lightcurve(target: str = Query(..., min_length=2),
                     period: Optional[float] = Query(None, gt=0)):
    """Скачивает реальную кривую блеска (TESS/Kepler) и анализирует транзит."""
    key = f"{norm_name(target)}|{round(period, 6) if period else ''}"
    dkey = re.sub(r'[^0-9a-zа-яё_.-]', '_', key)   # безопасное имя файла для Windows
    now = time.time()
    if key in LC_CACHE and now - LC_CACHE[key][0] < 6 * 3600:
        return LC_CACHE[key][1]
    disk = disk_cache_read("lightcurve", dkey, 7 * 24 * 3600)
    if disk:
        LC_CACHE[key] = (now, disk)
        return disk
    def _store_late(f):
        """Даже если клиент отвалился по таймауту — доложим результат в кэши."""
        LC_INFLIGHT.pop(key, None)
        try:
            res = f.result()
            if isinstance(res, dict) and "error" not in res:
                LC_CACHE[key] = (time.time(), res)
                disk_cache_write("lightcurve", dkey, res)
        except Exception:  # noqa: BLE001
            pass

    fut = LC_INFLIGHT.get(key)
    if fut is None:
        fut = asyncio.get_running_loop().run_in_executor(LC_POOL, analyze_lightcurve_sync, target, period)
        LC_INFLIGHT[key] = fut
        fut.add_done_callback(_store_late)
    try:
        result = await asyncio.wait_for(asyncio.shield(fut), timeout=420.0)
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail=(
            "Архив MAST отдаёт данные дольше 7 минут (тяжёлая цель или перегрузка). "
            "Скачивание продолжается в фоне — повторите запрос чуть позже, ответ будет мгновенным"))
    except Exception as e:  # noqa: BLE001
        logger.error(f"lightcurve error: {e}")
        raise HTTPException(status_code=502, detail=f"Ошибка анализа кривой: {e}")
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    return result


app.include_router(api_router)


# ---------- Раздача фронтенда (один порт = один туннель для ngrok) ----------
BUILD_DIR = ROOT_DIR.parent / "frontend" / "build"
if BUILD_DIR.exists():
    from fastapi.staticfiles import StaticFiles
    from fastapi.responses import FileResponse

    app.mount("/static", StaticFiles(directory=str(BUILD_DIR / "static")), name="spa-static")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa(full_path: str):
        candidate = (BUILD_DIR / full_path).resolve()
        if full_path and candidate.is_file() and str(candidate).startswith(str(BUILD_DIR.resolve())):
            return FileResponse(candidate)
        return FileResponse(BUILD_DIR / "index.html")

    logger.info("Раздаю фронтенд из frontend/build на этом же порту")
