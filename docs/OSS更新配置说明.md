# NEXFLOW 应用更新 - OSS 配置说明

## 无需额外注册

你已有的阿里云 OSS（`nexflow-temp-images`）可直接用作更新服务器，无需新服务或域名。

## 一、OSS 权限设置

在阿里云 OSS 控制台中，确保 `nexflow-updates/` 目录可被公网读取：

1. 打开 [OSS 控制台](https://oss.console.aliyun.com/)
2. 选择 bucket：`nexflow-temp-images`
3. 任选其一：
   - **方式 A**：Bucket 为「公共读」→ 无需额外配置
   - **方式 B**：Bucket 为私有 → 在「权限管理」→「Bucket 授权策略」中，为 `nexflow-updates/*` 添加「读」权限

## 二、发布新版本流程

```bash
# 1. 构建安装包
npm run electron:build

# 2. 上传到 OSS（使用项目内置 OSS 凭证）
npm run upload:release
```

脚本会把 `release/latest.yml` 和 `release/NEXFLOW Setup x.x.x.exe` 上传到 `nexflow-updates/`。

## 三、更新地址

当前配置的更新地址为：

```
https://nexflow-temp-images.oss-cn-hongkong.aliyuncs.com/nexflow-updates/
```

应用启动后会向该地址请求 `latest.yml` 检查是否有新版本。

## 四、使用其他 OSS

若使用其他 bucket 或路径，修改 `package.json` 中的 `build.publish.url`：

```json
"publish": {
  "provider": "generic",
  "url": "https://你的bucket.oss-cn-xxx.aliyuncs.com/你的目录/"
}
```

并调整 `scripts/upload-release-to-oss.js` 中的 OSS 配置或路径。
