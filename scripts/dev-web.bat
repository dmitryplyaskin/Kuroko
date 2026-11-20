@echo off
setlocal
pushd "%~dp0.." || exit /b 1
bun run dev:web
set "exit_code=%errorlevel%"
popd
exit /b %exit_code%
