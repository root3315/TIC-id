# -*- coding: utf-8 -*-
"""Собирает несколько .md в ОДИН печатный PDF без служебных колонтитулов.

Титульная страница + разделы (каждый с новой страницы), картинки встроены,
PDF генерируется через Chrome DevTools Protocol с displayHeaderFooter=False —
поэтому НЕТ ни даты, ни пути к файлу, ни номера страницы вверху/внизу.

Использование:  python make_report_pdf.py
"""
import re, base64, json, socket, subprocess, time, os, urllib.request, tempfile
from pathlib import Path
import markdown
import websocket  # websocket-client

ROOT = Path(__file__).parent
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"

# порядок в отчёте: контекст → в чём фишка → техника
PARTS = [
    ("RESEARCH-CONTEXT.md", "Часть 1. Обзор области и существующие решения", "Coltarus"),
    ("PROJECT-HIGHLIGHTS.md", "Часть 2. Особенность ИИ, данные, валидация", "obahtiiorbekova"),
    ("TECH-REPORT.md", "Часть 3. Архитектура, обучение и метрики", "Pumpkin2008"),
]
OUT_PDF = ROOT / "ExoVision-отчёт.pdf"


def md_to_html(path):
    text = path.read_text(encoding="utf-8")
    body = markdown.markdown(text, extensions=["tables", "fenced_code", "sane_lists", "attr_list"])

    def embed(m):
        sp = m.group(1)
        if sp.startswith("data:"):
            return m.group(0)
        p = (path.parent / sp).resolve()
        if not p.exists():
            return m.group(0)
        ext = p.suffix.lower()
        mime = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
                ".svg": "image/svg+xml", ".gif": "image/gif"}.get(ext, "image/png")
        return f'src="data:{mime};base64,{base64.b64encode(p.read_bytes()).decode()}"'

    return re.sub(r'src="([^"]+)"', embed, body)


CSS = """
@page { size: A4; margin: 16mm 15mm; }
* { box-sizing: border-box; }
body { font-family:'Segoe UI','Calibri',system-ui,sans-serif; color:#1a1f36; line-height:1.55; font-size:10.5pt; margin:0; }
h1 { font-size:19pt; color:#0f1b4c; border-bottom:3px solid #4f46e5; padding-bottom:8px; margin:0 0 6px; }
h2 { font-size:14pt; color:#1e2a78; margin:20px 0 8px; padding-top:6px; border-top:1px solid #e5e7f0; }
h3 { font-size:11.5pt; color:#334; margin:15px 0 6px; }
p { margin:7px 0; } strong { color:#0f1b4c; } a { color:#4338ca; text-decoration:none; }
code { font-family:'Consolas',monospace; background:#f2f3f9; padding:1px 5px; border-radius:4px; font-size:9.3pt; }
pre { background:#0f172a; color:#e2e8f0; padding:12px 14px; border-radius:8px; overflow-x:auto; font-size:7.8pt; line-height:1.4; page-break-inside:avoid; white-space:pre-wrap; word-break:break-word; }
pre code { background:none; color:inherit; padding:0; }
table { border-collapse:collapse; width:100%; margin:10px 0; font-size:9.1pt; page-break-inside:avoid; }
th { background:#eef0fb; color:#1e2a78; text-align:left; padding:6px 9px; border:1px solid #cfd4ea; font-weight:600; }
td { padding:6px 9px; border:1px solid #dfe3f0; vertical-align:top; } tr:nth-child(even) td { background:#fafbff; }
img { max-width:100%; height:auto; display:block; margin:12px auto; border:1px solid #e5e7f0; border-radius:6px; padding:6px; background:#fff; page-break-inside:avoid; }
blockquote { border-left:3px solid #a5b4fc; margin:10px 0; padding:4px 14px; color:#555; background:#f7f8fd; font-size:9.4pt; }
ul,ol { margin:7px 0; padding-left:22px; } li { margin:3px 0; }
h1,h2,h3 { page-break-after:avoid; }
.part { page-break-before:always; }
.cover { page-break-after:always; text-align:center; padding-top:70mm; }
.cover .logo { font-size:40pt; }
.cover h1 { font-size:30pt; border:none; color:#0f1b4c; margin:14px 0 6px; }
.cover .sub { font-size:14pt; color:#4f46e5; margin-bottom:40px; }
.cover table { width:auto; margin:0 auto; font-size:11pt; }
.cover td { border:none; padding:6px 14px; }
.part-head { color:#4f46e5; font-size:11pt; font-weight:600; margin-bottom:2px; text-transform:uppercase; letter-spacing:.5px; }
"""

cover = """
<div class="cover">
  <div class="logo">🪐</div>
  <h1>ExoVision</h1>
  <div class="sub">Детектор экзопланет на основе ИИ — командный отчёт</div>
  <table>
    <tr><td><b>Обзор области и решения</b></td><td>@Coltarus</td></tr>
    <tr><td><b>Особенность ИИ, данные, валидация</b></td><td>@obahtiiorbekova</td></tr>
    <tr><td><b>Архитектура, обучение, метрики</b></td><td>@Pumpkin2008</td></tr>
  </table>
</div>
"""

sections = [cover]
for fname, title, author in PARTS:
    p = ROOT / fname
    if not p.exists():
        print(f"пропуск (нет файла): {fname}"); continue
    head = f'<div class="part"><div class="part-head">{title} · {author}</div>'
    sections.append(head + md_to_html(p) + "</div>")

full = f'<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>ExoVision — отчёт</title><style>{CSS}</style></head><body>{"".join(sections)}</body></html>'
html_path = ROOT / "ExoVision-отчёт.html"
html_path.write_text(full, encoding="utf-8")
print(f"HTML собран: {html_path.name} ({html_path.stat().st_size//1024} КБ)")


# ---- печать через Chrome DevTools Protocol (без колонтитулов) ----
def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close(); return port

port = free_port()
prof = tempfile.mkdtemp(prefix="chrome_pdf_")
proc = subprocess.Popen([
    CHROME, "--headless=new", "--disable-gpu", "--no-first-run",
    "--remote-allow-origins=*",
    f"--remote-debugging-port={port}", f"--user-data-dir={prof}",
], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

try:
    ws_url = None
    for _ in range(40):
        try:
            targets = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list", timeout=1))
            pages = [t for t in targets if t.get("type") == "page" and t.get("webSocketDebuggerUrl")]
            if pages:
                ws_url = pages[0]["webSocketDebuggerUrl"]; break
        except Exception:
            pass
        time.sleep(0.3)
    if not ws_url:
        raise RuntimeError("Chrome CDP: страница-таргет не найдена")

    ws = websocket.create_connection(ws_url, timeout=60, max_size=None)
    mid = [0]
    def cmd(method, params=None):
        mid[0] += 1
        ws.send(json.dumps({"id": mid[0], "method": method, "params": params or {}}))
        while True:
            msg = json.loads(ws.recv())
            if msg.get("id") == mid[0]:
                return msg

    cmd("Page.enable")
    cmd("Page.navigate", {"url": html_path.as_uri()})
    time.sleep(2.5)  # дать отрисоваться картинкам
    res = cmd("Page.printToPDF", {
        "displayHeaderFooter": False,   # ← НЕТ даты/пути/номера страницы
        "printBackground": True,
        "preferCSSPageSize": True,
        "marginTop": 0.6, "marginBottom": 0.6, "marginLeft": 0.6, "marginRight": 0.6,
    })
    ws.close()
    if "result" not in res:
        raise RuntimeError(f"printToPDF error: {json.dumps(res, ensure_ascii=False)}")
    pdf_b64 = res["result"]["data"]
    OUT_PDF.write_bytes(base64.b64decode(pdf_b64))
    print(f"PDF готов: {OUT_PDF.name} ({OUT_PDF.stat().st_size//1024} КБ) — без колонтитулов")
finally:
    proc.terminate()
