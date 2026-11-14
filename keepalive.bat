@echo off
REM Двойной клик = поднять публичную ссылку на несколько часов.
REM %~dp0 — папка, где лежит этот файл, поэтому путь всегда правильный.
title ExoVision keep-alive
echo Поднимаю ExoVision наружу (backend + ngrok, без сна) на 6 часов...
echo Ссылка появится в backend\models\ngrok_url.txt через ~15 секунд.
echo Это окно можно свернуть, но не закрывать.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0keepalive.ps1" 6
