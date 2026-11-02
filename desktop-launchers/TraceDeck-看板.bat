@echo off
chcp 65001 >nul
title TraceDeck Board - http://127.0.0.1:7788
cd /d D:\TraceDeck
echo [TraceDeck] starting board at http://127.0.0.1:7788 ...
echo (keep this window OPEN while using the board; closing it stops the board)
node wt.js board
echo.
echo [TraceDeck] board exited. Press any key to close.
pause >nul
