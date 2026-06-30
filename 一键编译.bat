@echo off
chcp 65001 >nul
cd /d "D:\小说工坊\小说工坊\.obsidian\plugins\novel-writer-ai"
echo ========================================
echo   小说工坊 - 一键编译
echo ========================================
echo.
echo 正在编译 main.js ...
node -e "require('esbuild').build({entryPoints:['main.ts'],bundle:true,external:['obsidian'],format:'cjs',platform:'node',outfile:'main.js'}).then(function(r){var kb=Math.round(r.outputFiles[0].text.length/1024);console.log('✅ 编译成功! main.js = '+kb+'KB');}).catch(function(e){console.error('❌ 编译失败:',String(e));pause})"
echo.
pause
