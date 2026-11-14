"""Планетные системы по позиции на небе: связка с Muninn (небо SPHEREx).

Muninn знает о звезде только координаты (до 0,01°) и имя, поэтому звезду ищем
по ближайшему хосту каталога pscomppars в заданном радиусе. Здесь нет сети и
глобального состояния: функции получают строки каталога и возвращают данные.
"""

import math
import re
from typing import Any, Dict, List, Optional, Tuple

STAR_FIELDS = {
    "st_teff": "temperature",
    "st_rad": "radius",
    "st_mass": "mass",
    "st_lum": "luminosity_log",
    "st_spectype": "spectral_type",
    "sy_dist": "distance_pc",
    "sy_snum": "star_count",
}


def _num(v) -> Optional[float]:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(f) or math.isinf(f) else f


def _norm(s: Optional[str]) -> str:
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def angular_sep_arcsec(ra1: float, dec1: float, ra2: float, dec2: float) -> float:
    """Угловое расстояние по формуле гаверсинусов (устойчива на малых углах)."""
    r1, d1, r2, d2 = map(math.radians, (ra1, dec1, ra2, dec2))
    h = math.sin((d2 - d1) / 2) ** 2 + math.cos(d1) * math.cos(d2) * math.sin((r2 - r1) / 2) ** 2
    return math.degrees(2 * math.asin(min(1.0, math.sqrt(h)))) * 3600


def build_host_index(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Звёзды с планетами: одна запись на хост, планеты сгруппированы."""
    hosts: Dict[str, Dict[str, Any]] = {}
    for r in rows:
        ra, dec = _num(r.get("ra")), _num(r.get("dec"))
        name = r.get("hostname")
        if not name or ra is None or dec is None:
            continue
        host = hosts.setdefault(name, {"hostname": name, "ra": ra, "dec": dec,
                                       "key": _norm(name), "planets": []})
        host["planets"].append(r)
    return list(hosts.values())


def nearest_host(hosts: List[Dict[str, Any]], ra: float, dec: float,
                 radius_arcsec: float) -> Optional[Tuple[Dict[str, Any], float]]:
    best, best_sep = None, radius_arcsec
    for h in hosts:
        if abs(h["dec"] - dec) * 3600 > best_sep:
            continue
        sep = angular_sep_arcsec(ra, dec, h["ra"], h["dec"])
        if sep <= best_sep:
            best, best_sep = h, sep
    return (best, best_sep) if best else None


def find_host_by_name(hosts: List[Dict[str, Any]], name: str) -> Optional[Dict[str, Any]]:
    key = _norm(name)
    return next((h for h in hosts if h["key"] == key), None) if key else None


def orbit_axis_au(a: Optional[float], period_days: Optional[float],
                  star_mass: Optional[float]) -> Tuple[Optional[float], bool]:
    """Большая полуось; если в каталоге её нет, то по третьему закону Кеплера."""
    if a is not None and a > 0:
        return a, False
    if period_days and period_days > 0 and star_mass and star_mass > 0:
        return (star_mass * (period_days / 365.25) ** 2) ** (1 / 3), True
    return None, False


def _first(rows: List[Dict[str, Any]], key: str):
    return next((r[key] for r in rows if r.get(key) not in (None, "")), None)


def system_payload(host: Dict[str, Any], hz: Optional[dict],
                   match_arcsec: Optional[float] = None) -> Dict[str, Any]:
    rows = host["planets"]
    star = {"name": host["hostname"], "ra": host["ra"], "dec": host["dec"]}
    for src, dst in STAR_FIELDS.items():
        v = _first(rows, src)
        star[dst] = v if src == "st_spectype" else _num(v)
    planets = []
    for r in rows:
        a, estimated = orbit_axis_au(_num(r.get("pl_orbsmax")), _num(r.get("pl_orbper")),
                                     star["mass"])
        planets.append({
            "name": r.get("pl_name"),
            "a_au": round(a, 5) if a else None,
            "a_estimated": estimated,
            "period_days": _num(r.get("pl_orbper")),
            "eccentricity": _num(r.get("pl_orbeccen")),
            "radius_earth": _num(r.get("pl_rade")),
            "mass_earth": _num(r.get("pl_bmasse")),
            "teq_k": _num(r.get("pl_eqt")),
            "habitability": r.get("_hab"),
            "disc_year": r.get("disc_year"),
            "method": r.get("discoverymethod"),
        })
    planets.sort(key=lambda p: p["a_au"] if p["a_au"] is not None else math.inf)
    return {"star": star, "planets": planets, "habitable_zone": hz,
            "match_arcsec": match_arcsec}


def hosts_compact(hosts: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Минимальный список хостов: Muninn по нему решает, показывать ли кнопку."""
    return [{"h": h["hostname"], "ra": round(h["ra"], 5), "dec": round(h["dec"], 5),
             "n": len(h["planets"])} for h in hosts]
