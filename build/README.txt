软件图标目录
============

请将正式图标放入本目录：

1. icon.jpg、icon.png、image.jpg 或 image.png（源图，推荐 256x256 或更大正方形）
   - 构建时会由 scripts/convert-icon-to-ico.js 自动生成 icon.ico。
   - 执行 npm run electron:build 前只需放一张上述文件之一即可（推荐 icon.png）。

2. icon.ico（可选，若已存在则不会用 jpg/png 覆盖）
   - 若你已有 .ico 文件，可直接放入本目录，构建会优先使用。
   - 否则由脚本从 icon.jpg/icon.png 生成（含 256/48/32/16 多尺寸）。

3. icon.png 若存在，还会被 copy-icon-to-public.js 复制到 public/，用于激活页等界面。

4. 安装器品牌图（暗黑主题）
   - npm run generate-nsis-branding 会生成 installerSidebar.bmp（164×314）、installerHeader.bmp（150×57）。
   - electron:build 会自动执行；颜色与官网 #051A24 一致。

当前配置（package.json）已指向 build/icon.ico 作为 Windows 图标。

npm run convert-icon -- --force
