片头默认资源（开场动画 / LOGO / 音乐）
========================================

【重要】安装后要看到片头动画、LOGO 和音乐，必须在打包前把以下文件放进本目录：

1. LOGO（必放其一）：logo.png（与登录页 public/aixflow-login-logo.png 同步）、logo.svg、logo.jpg 或 logo.webp，显示在片头视频中央叠层
2. 背景音乐（必放其一）：bgm.mp3 或 music.mp3，或任意一个 .mp3 文件
3. 视频（可选）：.mp4 / .webm / .mov / .avi / .mkv，可放多个，会按「文件名自然排序」依次播放再循环；无视频时显示纯色背景 + LOGO
   （开发时读仓库本目录；安装版优先读用户数据目录里已同步的片头，若其中多放了视频或与仓库文件名不一致，顺序/条数会与开发环境不同。）

操作步骤：
- 将 logo 命名为 logo.svg（推荐矢量）或 logo.png 放入本目录
- 将背景音乐命名为 bgm.mp3（或 music.mp3）放入本目录
- 若有片头视频，也放入本目录
- 然后执行 npm run electron:build 打包

若本目录只有本 README、没有上述媒体文件，打出来的安装包安装后片头会是黑屏且无音乐。
用户仍可在安装后通过片头页或设置中「打开片头文件夹」自行放入资源。

【升级后仍看到旧片头？】
安装版会把片头缓存在「用户数据目录」下的 splash-videos（Windows 固定为 %APPDATA%\\NEXFLOW\\splash-videos，与显示名 Aixflow 无关）。
若你替换了本仓库 splash-videos/ 后重新打包，请提高 package.json 里的 version 再构建，启动后会自动用新安装包内的资源覆盖。
npm run electron:build 会在同步 resources 后自动清除「打包机本机」的 NEXFLOW\\splash-videos 缓存，便于本机验证新片头。
或手动删除用户数据中的 splash-videos 文件夹后再启动。
