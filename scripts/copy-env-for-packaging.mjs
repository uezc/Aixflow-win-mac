/**
 * 将「可打进安装包」的环境文件复制到 resources/.env，供 electron-builder extraResources 带入安装目录。
 * 安装后由 envLoader 从 process.resourcesPath/.env 加载。
 *
 * 来源（按优先级，只取第一个存在的文件全文复制）：
 *   1) 项目根目录 .env
 *   2) resources/packaging.env（仅本机构建机使用，勿提交密钥；已 .gitignore）
 *
 * 校验（默认开启，避免安装包内无 FC 地址导致云端定价 / 登录异常）：
 *   - HK_FC_ENDPOINT 或 ALIYUN_FC_INIT_USER_URL 至少其一为合法 https URL（非空、非占位）
 *   - ALIYUN_FC_TOKEN 建议配置；缺失时仅警告
 *
 * 跳过校验（本地无密钥仍要出包时）：
 *   NEXFLOW_SKIP_PACKAGING_ENV_CHECK=1 npm run electron:build
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcRoot = path.join(root, '.env');
const srcPackaging = path.join(root, 'resources', 'packaging.env');
const dest = path.join(root, 'resources', '.env');

const placeholder = `# 自动生成：未找到可用的打包用环境文件。
# 请在项目根创建 .env，或创建 resources/packaging.env（仅打包机构建机），
# 至少包含 HK_FC_ENDPOINT=https://... 与 ALIYUN_FC_TOKEN=... 后重新执行 npm run electron:build。
# 本地无密钥需跳过校验时：NEXFLOW_SKIP_PACKAGING_ENV_CHECK=1 npm run electron:build
`;

function stripBom(buf) {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3);
  return buf;
}

function looksLikePlaceholderUrl(v) {
  const s = String(v || '').toLowerCase();
  return (
    !s ||
    s.includes('your-function') ||
    s.includes('example.com') ||
    s.includes('localhost') ||
    s.includes('127.0.0.1')
  );
}

function isValidFcBaseUrl(v) {
  const s = String(v || '').trim();
  if (!s.startsWith('https://')) return false;
  if (s.length < 12) return false;
  if (looksLikePlaceholderUrl(s)) return false;
  return true;
}

function validateParsedEnv(parsed, label) {
  const hk = parsed.HK_FC_ENDPOINT;
  const legacy = parsed.ALIYUN_FC_INIT_USER_URL;
  const hasFc = isValidFcBaseUrl(hk) || isValidFcBaseUrl(legacy);
  const token = String(parsed.ALIYUN_FC_TOKEN || '').trim();
  return { hasFc, tokenOk: token.length > 0, hk, legacy };
}

const skipCheck =
  process.env.NEXFLOW_SKIP_PACKAGING_ENV_CHECK === '1' ||
  /^(true|yes)$/i.test(String(process.env.NEXFLOW_SKIP_PACKAGING_ENV_CHECK || ''));

try {
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  let chosen = null;
  let label = '';
  if (fs.existsSync(srcRoot)) {
    chosen = srcRoot;
    label = '项目根 .env';
  } else if (fs.existsSync(srcPackaging)) {
    chosen = srcPackaging;
    label = 'resources/packaging.env';
  }

  if (!chosen) {
    if (skipCheck) {
      fs.writeFileSync(dest, placeholder, 'utf8');
      console.warn(
        '[pack] 未找到 .env 与 resources/packaging.env，已写入占位 resources/.env（已跳过校验；安装包无云端配置）',
      );
      process.exit(0);
    }
    if (fs.existsSync(dest)) {
      try {
        fs.unlinkSync(dest);
      } catch {
        /* ignore */
      }
    }
    console.error(
      '[pack] 中止：未找到项目根 .env 或 resources/packaging.env，无法打入有效云端配置。\n' +
        '  • 在仓库根目录配置 .env（含 HK_FC_ENDPOINT、ALIYUN_FC_TOKEN），或\n' +
        '  • 在 resources/packaging.env 写入同上内容（供打包机专用），然后重新 npm run electron:build。\n' +
        '  • 若本地刻意跳过：NEXFLOW_SKIP_PACKAGING_ENV_CHECK=1 npm run electron:build',
    );
    process.exit(1);
  }

  fs.copyFileSync(chosen, dest);
  console.log(`[pack] 已复制 ${label} → resources/.env（将打入安装包）`);

  const raw = stripBom(fs.readFileSync(dest));
  const parsed = dotenv.parse(raw);
  const { hasFc, tokenOk } = validateParsedEnv(parsed, label);

  if (skipCheck) {
    if (!hasFc) {
      console.warn('[pack] 已跳过校验：当前 resources/.env 中未检测到有效 HK_FC_ENDPOINT / ALIYUN_FC_INIT_USER_URL');
    }
    process.exit(0);
  }

  if (!hasFc) {
    try {
      fs.unlinkSync(dest);
    } catch {
      /* ignore */
    }
    console.error(
      '[pack] 中止：resources/.env 中缺少有效的 HK_FC_ENDPOINT 或 ALIYUN_FC_INIT_USER_URL（须为 https:// 且非占位符）。\n' +
        `  • 当前来源：${label}\n` +
        '  • 请修正后重新打包；跳过校验（不推荐）：NEXFLOW_SKIP_PACKAGING_ENV_CHECK=1',
    );
    process.exit(1);
  }

  if (!tokenOk) {
    console.warn('[pack] 警告：未检测到 ALIYUN_FC_TOKEN；FC 受保护接口可能 403，请确认 .env 已配置并与 FC 环境 API_SECRET_TOKEN 一致');
  }
} catch (e) {
  console.error('[pack] 写入 resources/.env 失败:', e);
  process.exit(1);
}
