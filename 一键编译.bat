@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ========================================
echo   小说工坊 - 一键编译
echo ========================================
echo.
echo 正在通过 npm run build 编译（含样式、模板资源、worker 内联）...
call npm run build
if errorlevel 1 (
  echo.
  echo 编译失败。
  pause
  exit /b 1
)
echo.
echo 已编译：main.js / styles.css
echo 若需在开发 vault 里查看，再执行：
echo   node scripts/dev-vault.mjs sync --vault=D:\nw-dev-vault
echo.
pause
