"""Поиск и скачивание кривых блеска Kepler/K2/TESS из MAST напрямую через его API,
без astroquery и lightkurve. Логика поиска — как у lightkurve.search_lightcurve;
выбор файлов строже: один файл на квартал/сектор, без дублей разных каденций."""

import json
import os
import re
import tempfile
import threading
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import httpx

MAST_INVOKE = "https://mast.stsci.edu/api/v0/invoke"
MAST_DOWNLOAD = "https://mast.stsci.edu/api/v0.1/Download/file"
PROJECTS = ["Kepler", "K2", "TESS"]
# Порядок предпочтения авторов при равном числе файлов (как раньше в server)
AUTHOR_PREF = ["Kepler", "SPOC", "TESS-SPOC", "K2", "EVEREST", "QLP"]
MAX_SEGMENTS = 6
NAME_RADIUS_DEG = 0.0001 / 3600       # lightkurve: 0.0001″ вокруг разрешённого имени
TIMEOUT = httpx.Timeout(60.0, connect=20.0)
CACHE_MAX_BYTES = 300 * 1024 * 1024    # FITS нужны только на время анализа; вердикты кэшируются отдельно
_FILE_LOCKS: Dict[str, threading.Lock] = defaultdict(threading.Lock)
_LOCKS_GUARD = threading.Lock()
GZIP_MAGIC = bytes([0x1F, 0x8B])


@dataclass
class LcFile:
    filename: str
    uri: str
    author: str
    exptime: float
    sequence: int        # квартал, кампания или сектор
    distance: float


def _invoke(client: httpx.Client, request: dict) -> dict:
    r = client.post(MAST_INVOKE, data={"request": json.dumps(request)})
    r.raise_for_status()
    return r.json()


def _exact_target_name(target: str) -> Optional[str]:
    t = target.strip().lower()
    for pattern, fmt in ((r"^(kplr|kic) ?(\d+)$", "kplr{:09d}"), (r"^(ktwo|epic) ?(\d+)$", "ktwo{:09d}"),
                         (r"^(tess|tic) ?(\d+)$", "{:d}")):
        m = re.match(pattern, t)
        if m:
            return fmt.format(int(m.group(2)))
    return None


def _observations(client: httpx.Client, target: str) -> List[dict]:
    columns = "obsid,obs_id,provenance_name,sequence_number,t_exptime,target_name"
    filters = [{"paramName": "project", "values": PROJECTS},
               {"paramName": "dataproduct_type", "values": ["timeseries"]}]
    exact = _exact_target_name(target)
    if exact:
        res = _invoke(client, {"service": "Mast.Caom.Filtered", "format": "json", "params": {
            "columns": columns, "filters": filters + [{"paramName": "target_name", "values": [exact]}]}})
        rows = res.get("data") or []
        for r in rows:
            r["distance"] = 0.0
        return rows
    lookup = _invoke(client, {"service": "Mast.Name.Lookup", "format": "json",
                              "params": {"input": target, "format": "json"}})
    resolved = lookup.get("resolvedCoordinate") or []
    if not resolved:
        return []
    ra, dec = resolved[0]["ra"], resolved[0]["decl"]
    res = _invoke(client, {"service": "Mast.Caom.Filtered.Position", "format": "json", "params": {
        "columns": columns + ",distance", "filters": filters,
        "position": f"{ra}, {dec}, {NAME_RADIUS_DEG}"}})
    return res.get("data") or []


def _exptime(filename: str, obs_exptime: Optional[float]) -> float:
    name = filename.lower()
    if name.endswith("_llc.fits") and name.startswith("kplr"):
        return 1800.0
    if name.endswith("_slc.fits"):
        return 60.0
    if "fast-lc" in name:
        return 20.0
    return float(obs_exptime or 0.0)


def search_files(target: str, client: Optional[httpx.Client] = None) -> List[LcFile]:
    """Все файлы кривых блеска цели (только *lc.fits, как в lightkurve)."""
    own = client is None
    client = client or httpx.Client(timeout=TIMEOUT, follow_redirects=True)
    try:
        obs = _observations(client, target)
        if not obs:
            return []
        by_id = {o["obsid"]: o for o in obs}
        files: List[LcFile] = []
        ids = list(by_id)
        for i in range(0, len(ids), 50):
            res = _invoke(client, {"service": "Mast.Caom.Products", "format": "json",
                                   "params": {"obsid": ",".join(str(x) for x in ids[i:i + 50])}})
            for prod in res.get("data") or []:
                fname = str(prod.get("productFilename") or "")
                if not fname.lower().endswith("lc.fits"):
                    continue
                o = by_id.get(prod.get("parent_obsid")) or by_id.get(prod.get("obsID")) or {}
                author = str(o.get("provenance_name") or prod.get("provenance_name") or "")
                seq = o.get("sequence_number")
                files.append(LcFile(
                    filename=fname, uri=str(prod.get("dataURI")), author=author,
                    exptime=_exptime(fname, o.get("t_exptime")),
                    sequence=int(seq) if seq is not None else -1,
                    distance=float(o.get("distance") or 0.0)))
        unique = {f.filename: f for f in files}
        return sorted(unique.values(), key=lambda f: (f.distance, f.filename))
    finally:
        if own:
            client.close()


def choose_files(files: List[LcFile]) -> Tuple[str, List[LcFile]]:
    """Автор с наибольшим покрытием, затем по одному файлу на сегмент.

    Kepler: только длинная каденция (30 мин, на ней обучена модель), по порядку кварталов.
    TESS: на сектор один файл, предпочтительно стандартная каденция, а не 20-секундная.
    """
    counts = Counter(f.author for f in files)
    known = [a for a in AUTHOR_PREF if counts.get(a)]
    author = (max(known, key=lambda a: (counts[a], -AUTHOR_PREF.index(a))) if known
              else files[0].author)
    mine = [f for f in files if f.author == author]
    if author == "Kepler":
        long = sorted((f for f in mine if f.exptime >= 1800), key=lambda f: f.filename)
        return author, (long or sorted(mine, key=lambda f: f.filename))[:MAX_SEGMENTS]
    per_segment: Dict[int, LcFile] = {}
    for f in mine:
        key = f.sequence if f.sequence >= 0 else hash(f.filename)
        best = per_segment.get(key)
        if best is None or (f.exptime >= 60, f.exptime) > (best.exptime >= 60, best.exptime):
            per_segment[key] = f
    chosen = sorted(per_segment.values(), key=lambda f: (f.sequence, f.filename))
    return author, chosen[:MAX_SEGMENTS]


def _lock_for(name: str) -> threading.Lock:
    with _LOCKS_GUARD:
        return _FILE_LOCKS[name]


def prune_cache(cache_dir: Path, max_bytes: int = CACHE_MAX_BYTES) -> None:
    """Держим кэш FITS в пределах max_bytes: удаляем самые старые файлы."""
    files = sorted((p for p in cache_dir.glob("*") if p.is_file()), key=lambda p: p.stat().st_mtime)
    total = sum(p.stat().st_size for p in files)
    for p in files:
        if total <= max_bytes:
            break
        total -= p.stat().st_size
        p.unlink(missing_ok=True)


def download(f: LcFile, cache_dir: Path, client: Optional[httpx.Client] = None) -> Path:
    """Скачивает файл один раз; повторные анализы читают его с диска.

    Один файл качает только один поток (блокировка на имя), запись идёт во
    временный файл с уникальным именем и попадает в кэш, только если это FITS.
    """
    from fits_lite import looks_like_fits

    cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_dir / Path(f.filename).name
    with _lock_for(path.name):
        if path.exists() and path.stat().st_size > 0:
            return path
        own = client is None
        client = client or httpx.Client(timeout=httpx.Timeout(180.0, connect=20.0), follow_redirects=True)
        fd, tmp_name = tempfile.mkstemp(dir=cache_dir, suffix=".part")
        try:
            with os.fdopen(fd, "wb") as out, client.stream("GET", MAST_DOWNLOAD, params={"uri": f.uri}) as r:
                r.raise_for_status()
                for chunk in r.iter_bytes(1 << 16):
                    out.write(chunk)
            with open(tmp_name, "rb") as check:
                head = check.read(6)
            if not looks_like_fits(head) and head[:2] != GZIP_MAGIC:
                raise ValueError(f"MAST вернул не FITS для {f.filename}")
            os.replace(tmp_name, path)
        except BaseException:
            Path(tmp_name).unlink(missing_ok=True)
            raise
        finally:
            if own:
                client.close()
    prune_cache(cache_dir)
    return path


def forget(path: Path) -> None:
    """Убрать из кэша файл, который не прочитался, чтобы следующий анализ скачал его заново."""
    Path(path).unlink(missing_ok=True)
