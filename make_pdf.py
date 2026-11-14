# -*- coding: utf-8 -*-
"""MD → аккуратный печатный HTML (картинки встроены) → PDF через Chrome headless.

Использование:  python make_pdf.py TECH-REPORT.md
Результат:      TECH-REPORT.html и TECH-REPORT.pdf рядом с исходником.
"""
import sys, re, base64, subprocess, os
from pathlib import Path
import markdown

ROOT = Path(__file__).parent
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"

src = Path(sys.argv[1] if len(sys.argv) > 1 else "TECH-REPORT.md")
if not src.is_absolute():
    src = ROOT / src
text = src.read_text(encoding="utf-8")

# убрать строки-цитаты «> …» в самом верху (служебные пометки) — необязательно, оставляем
html_body = markdown.markdown(
    text, extensions=["tables", "fenced_code", "sane_lists", "attr_list"]
)


def embed_image(m):
    """src="docs/x.png" → src="data:...base64", чтобы картинка попала в PDF/HTML."""
    src_path = m.group(1)
    if src_path.startswith("data:"):
        return m.group(0)
    p = (src.parent / src_path).resolve()
    if not p.exists():
        return m.group(0)
    data = p.read_bytes()
    ext = p.suffix.lower()
    mime = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
            ".svg": "image/svg+xml", ".gif": "image/gif"}.get(ext, "image/png")
    b64 = base64.b64encode(data).decode()
    return f'src="data:{mime};base64,{b64}"'


html_body = re.sub(r'src="([^"]+)"', embed_image, html_body)

title = src.stem
CSS = """
@page { size: A4; margin: 18mm 16mm; }
* { box-sizing: border-box; }
body {
  font-family: 'Segoe UI', 'Calibri', system-ui, sans-serif;
  color: #1a1f36; line-height: 1.55; font-size: 10.5pt;
  max-width: 100%; margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
h1 { font-size: 20pt; color: #0f1b4c; border-bottom: 3px solid #4f46e5; padding-bottom: 8px; margin: 0 0 6px; }
h2 { font-size: 14.5pt; color: #1e2a78; margin: 22px 0 8px; padding-top: 6px; border-top: 1px solid #e5e7f0; }
h3 { font-size: 12pt; color: #334; margin: 16px 0 6px; }
p { margin: 7px 0; }
strong { color: #0f1b4c; }
a { color: #4338ca; text-decoration: none; }
code { font-family: 'Consolas', monospace; background: #f2f3f9; padding: 1px 5px; border-radius: 4px; font-size: 9.5pt; }
pre { background: #0f172a; color: #e2e8f0; padding: 12px 14px; border-radius: 8px; overflow-x: auto;
      font-size: 7.8pt; line-height: 1.4; page-break-inside: avoid; white-space: pre-wrap; word-break: break-word; }
pre code { background: none; color: inherit; padding: 0; }
table { border-collapse: collapse; width: 100%; margin: 10px 0; font-size: 9.3pt; page-break-inside: avoid; }
th { background: #eef0fb; color: #1e2a78; text-align: left; padding: 6px 9px; border: 1px solid #cfd4ea; font-weight: 600; }
td { padding: 6px 9px; border: 1px solid #dfe3f0; vertical-align: top; }
tr:nth-child(even) td { background: #fafbff; }
img { max-width: 100%; height: auto; display: block; margin: 12px auto; border: 1px solid #e5e7f0;
      border-radius: 6px; padding: 6px; background: #fff; page-break-inside: avoid; }
blockquote { border-left: 3px solid #a5b4fc; margin: 10px 0; padding: 4px 14px; color: #555; background: #f7f8fd; font-size: 9.5pt; }
ul, ol { margin: 7px 0; padding-left: 22px; }
li { margin: 3px 0; }
h2, h3 { page-break-after: avoid; }
"""

full = f"""<!doctype html><html lang="ru"><head><meta charset="utf-8">
<title>{title}</title><style>{CSS}</style></head><body>{html_body}</body></html>"""

html_path = src.with_suffix(".html")
html_path.write_text(full, encoding="utf-8")
pdf_path = src.with_suffix(".pdf")

# печать через Chrome DevTools Protocol — без служебных колонтитулов (дата/путь/номер)
import json, socket, time, urllib.request, tempfile
import websocket

def _free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p

port = _free_port()
prof = tempfile.mkdtemp(prefix="chrome_pdf_")
proc = subprocess.Popen([
    CHROME, "--headless=new", "--disable-gpu", "--no-first-run",
    "--remote-allow-origins=*", f"--remote-debugging-port={port}", f"--user-data-dir={prof}",
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
    ws = websocket.create_connection(ws_url, timeout=60, max_size=None)
    mid = [0]
    def cmd(method, params=None):
        mid[0] += 1
        ws.send(json.dumps({"id": mid[0], "method": method, "params": params or {}}))
        while True:
            m = json.loads(ws.recv())
            if m.get("id") == mid[0]:
                return m
    cmd("Page.enable")
    cmd("Page.navigate", {"url": html_path.as_uri()})
    time.sleep(2.0)
    res = cmd("Page.printToPDF", {"displayHeaderFooter": False, "printBackground": True,
                                  "preferCSSPageSize": True,
                                  "marginTop": 0.6, "marginBottom": 0.6, "marginLeft": 0.6, "marginRight": 0.6})
    ws.close()
    pdf_path.write_bytes(base64.b64decode(res["result"]["data"]))
finally:
    proc.terminate()

print(f"HTML: {html_path.name}")
print(f"PDF:  {pdf_path.name}  ({pdf_path.stat().st_size // 1024} КБ)" if pdf_path.exists() else "PDF не создан")
