"""Минимальное чтение FITS-таблиц на numpy: ровно то, что нужно кривым блеска
Kepler/TESS (первичный заголовок + первая таблица BINTABLE), без astropy."""

import gzip
import re
from pathlib import Path
from typing import Any, Dict, Tuple

import numpy as np

BLOCK = 2880
CARD = 80

# Код формата TFORM → тип numpy (FITS хранит числа в big-endian)
_TFORM_DTYPES = {
    "L": "i1", "B": "u1", "I": ">i2", "J": ">i4", "K": ">i8",
    "E": ">f4", "D": ">f8", "C": ">c8", "M": ">c16",
}
_DESCRIPTOR_BYTES = {"P": 8, "Q": 16}


def _parse_value(raw: str) -> Any:
    raw = raw.strip()
    if raw.startswith("'"):
        end = raw.find("'", 1)
        while end != -1 and raw[end + 1:end + 2] == "'":  # '' внутри строки
            end = raw.find("'", end + 2)
        return raw[1:end].replace("''", "'").rstrip()
    value = raw.split("/", 1)[0].strip()
    if value in ("T", "F"):
        return value == "T"
    try:
        return int(value)
    except ValueError:
        pass
    try:
        return float(value.replace("D", "E"))
    except ValueError:
        return value


def _read_header(buf: bytes, pos: int) -> Tuple[Dict[str, Any], int]:
    header: Dict[str, Any] = {}
    while True:
        if pos + BLOCK > len(buf):
            raise ValueError("FITS: заголовок обрывается до END")
        block = buf[pos:pos + BLOCK].decode("ascii", errors="replace")
        pos += BLOCK
        for i in range(0, BLOCK, CARD):
            card = block[i:i + CARD]
            key = card[:8].strip()
            if key == "END":
                return header, pos
            if card[8:10] == "= " and key:
                header[key] = _parse_value(card[10:])


def _data_bytes(header: Dict[str, Any]) -> int:
    naxis = int(header.get("NAXIS", 0))
    if naxis == 0:
        return 0
    size = 1
    for k in range(1, naxis + 1):
        size *= int(header[f"NAXIS{k}"])
    size = abs(int(header["BITPIX"])) // 8 * int(header.get("GCOUNT", 1)) * (int(header.get("PCOUNT", 0)) + size)
    return -(-size // BLOCK) * BLOCK


def _table_dtype(header: Dict[str, Any]) -> np.dtype:
    names, formats, offsets = [], [], []
    offset = 0
    for k in range(1, int(header["TFIELDS"]) + 1):
        tform = str(header[f"TFORM{k}"]).strip()
        m = re.match(r"^(\d*)([LXBIJKAEDCMPQ])", tform)
        if not m:
            raise ValueError(f"FITS: неизвестный формат колонки {tform}")
        repeat = int(m.group(1) or 1)
        code = m.group(2)
        if code == "A":
            fmt, width = f"S{repeat}", repeat
        elif code == "X":
            nbytes = -(-repeat // 8)
            fmt, width = (np.uint8, (nbytes,)), nbytes
        elif code in _DESCRIPTOR_BYTES:
            nbytes = _DESCRIPTOR_BYTES[code]
            fmt, width = (np.uint8, (nbytes,)), nbytes
        else:
            base = np.dtype(_TFORM_DTYPES[code])
            fmt = base if repeat == 1 else (base, (repeat,))
            width = base.itemsize * repeat
        names.append(str(header.get(f"TTYPE{k}", f"COL{k}")).strip().upper())
        formats.append(fmt)
        offsets.append(offset)
        offset += width
    return np.dtype({"names": names, "formats": formats, "offsets": offsets,
                     "itemsize": int(header["NAXIS1"])})


def read_fits_table(path: Path) -> Tuple[Dict[str, Any], Dict[str, Any], Dict[str, np.ndarray]]:
    """Возвращает (первичный заголовок, заголовок таблицы, колонки как float64/int)."""
    raw = Path(path).read_bytes()
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    primary, pos = _read_header(raw, 0)
    pos += _data_bytes(primary)
    ext, pos = _read_header(raw, pos)
    if str(ext.get("XTENSION", "")).strip() != "BINTABLE":
        raise ValueError("FITS: первое расширение — не двоичная таблица")
    dtype = _table_dtype(ext)
    n_rows = int(ext["NAXIS2"])
    table = np.frombuffer(raw, dtype=dtype, count=n_rows, offset=pos)
    columns: Dict[str, np.ndarray] = {}
    for k, name in enumerate(dtype.names, start=1):
        col = table[name]
        if col.dtype.kind in "fiu" and col.ndim == 1:
            scale = ext.get(f"TSCAL{k}", 1.0)
            zero = ext.get(f"TZERO{k}", 0.0)
            if col.dtype.kind == "f" or scale != 1.0 or zero != 0.0:
                col = col.astype(np.float64) * scale + zero
            else:
                col = col.astype(col.dtype.newbyteorder("="))
            columns[name] = col
    return primary, ext, columns
