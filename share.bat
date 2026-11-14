@echo off
chcp 65001 >nul
rem ExoVision: публичная ссылка через Cloudflare Tunnel (backend должен быть запущен на :8001)
set CF="C:\Program Files (x86)\cloudflared\cloudflared.exe"
if not exist %CF% set CF=cloudflared
echo [ExoVision] Поднимаю туннель. Ссылка появится ниже в рамке (https://...trycloudflare.com).
echo [ExoVision] Окно не закрывать: закроется — ссылка умрёт.
%CF% tunnel --no-autoupdate --url http://127.0.0.1:8001
