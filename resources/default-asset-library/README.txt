默认资产库（角色 / 场景 / 3D 模型）
====================================

构建安装包时会自动从本机 NEXFLOW 用户数据同步到此目录（npm run sync:asset-library）。

【操作步骤】
1. 在本机 NEXFLOW 中准备好资产库：角色、场景、模型（图片转 3D 入库条目）。
2. 执行 npm run electron:build（构建链会自动运行 sync:asset-library）。
3. 新用户首次安装后，若本地资产库为空，会自动注入 manifest.json 与 files/ 下的资源。

【数据来源】
- Windows: %APPDATA%\NEXFLOW\nexflow-config.json 中的 characters、sceneLibrary
- 磁盘文件: character-views、character-voices、character-3d、scene-library、avatars、assets

若 manifest 中角色与场景均为空，安装包不会附带默认资产。
