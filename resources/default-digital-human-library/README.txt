默认数字人资产库
================

构建安装包时会从本机 NEXFLOW 用户数据同步到此目录（npm run sync:digital-human-library，已并入 electron:build）。

【操作步骤】
1. 在本机 Aixflow 数字人库中添加参考视频（及可选驱动音频）。
2. 执行 npm run electron:build。
3. 新用户首次安装后，若本地数字人库为空，会自动注入 manifest 与 files/digital-human-library/ 下的媒体。

数据来源：%APPDATA%\NEXFLOW\nexflow-config.json → digitalHumanLibrary
