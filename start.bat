@echo off
rem ExoVision: запуск одной командой — backend раздаёт и API, и фронтенд на :8001
cd /d %~dp0

if not exist "frontend\build\index.html" (
    echo [ExoVision] Сборка фронтенда не найдена — собираю (займёт ~минуту)...
    pushd frontend
    call npm run build
    popd
)

start "ExoVision :8001" cmd /k "cd /d %~dp0backend && set PYTHONUTF8=1 && set PYTHONIOENCODING=utf-8 && python -m uvicorn server:app --port 8001"

echo [ExoVision] Жду запуска сервера...
timeout /t 4 /nobreak >nul
start http://localhost:8001

echo [ExoVision] Готово. Поделиться с друзьями: запустите share.bat (Cloudflare Tunnel).
