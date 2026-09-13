@echo off
REM NEXFLOW Queue pipeline cron (every minute)
cd /d D:\NEXFLOW\demo\aliyun-fc-init-user
if not exist logs mkdir logs
where node >nul 2>&1
if errorlevel 1 (
  "C:\Program Files\nodejs\node.exe" scripts\cron-queue-pipeline.mjs >> logs\cron-queue-pipeline.log 2>&1
) else (
  node scripts\cron-queue-pipeline.mjs >> logs\cron-queue-pipeline.log 2>&1
)
