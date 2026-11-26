@echo off
setlocal
pushd "%~dp0.." || exit /b 1
bun run start --open
set "exit_code=%errorlevel%"
popd
exit /b %exit_code%
