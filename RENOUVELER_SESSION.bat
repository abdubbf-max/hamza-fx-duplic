@echo off
title HAMZA FX - Renouveler la session Telegram
color 0A
cd /d "%~dp0"
echo.
echo  ==========================================
echo    HAMZA FX - Renouvellement automatique
echo  ==========================================
echo.
echo  Ce programme va :
echo  1. Te demander ton numero Telegram
echo  2. T'envoyer un code sur Telegram
echo  3. Mettre a jour Railway automatiquement
echo  4. Relancer le bot tout seul
echo.
echo  ==========================================
echo.
node renew.js
echo.
pause
