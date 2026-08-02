/**
 * 构建完成后：上传 Windows / Mac 更新元数据与安装包到 OSS（与 electron-updater generic 源一致）
 *
 * Release 双区域发布（阶段 1）：
 *   - 香港 OSS：主发布源（失败则整个发版失败）
 *   - 北京 OSS：Release 副本（仅安装包 + latest.yml；失败告警并重试，不阻塞香港发布）
 *   - 不同步 aixflow-temp-media/ 及任何用户素材
 *
 * 使用方式：
 *   1. 先 npm run electron:build（在 Windows 上只会产出 Windows NSIS 安装包；Mac zip/yml 须在 macOS 上构建）
 *   2. 再 npm run upload:release（会先要求输入版本号，须与 package.json 的 version 一致）
 *   3. 由 npm run release 调用时会附带 --no-confirm，跳过版本与线路交互（默认双线）
 *   4. 线路 CLI：--hk-only / --skip-cn-release（仅香港）、--cn-only（仅北京补传）、--both（双线）
 *   5. 环境变量 OSS_RELEASE_UPLOAD_MODE=hk|cn|both（CI 无交互时）
 *   6. 仅上传 package.json 当前版本的产物；release/ 内旧版 exe/7z/zip 会被跳过（不会覆盖 OSS 上的历史对象，除非同名误传）
 *
 * OSS 主源（香港）：
 *   - Windows 与 package.json publish.url 一致：aixflow uploads/
 *   - Mac 单独目录（与控制台一致）：Aixflow uploads Mac/
 *
 * OSS Release 副本（北京，env 可覆盖）：
 *   - OSS_RELEASE_CN_REGION / OSS_RELEASE_CN_BUCKET（默认 oss-cn-beijing / nexflow-temp-images-bj）
 *   - 前缀与香港相同；设 OSS_RELEASE_CN_DISABLED=1 可禁用
 *
 * 上传内容（存在则传）：
 *   - Windows：
 *     - nsis-web：electron-builder 24+ 常将产物放在 release/nsis-web/（含 latest.yml、stub .exe、.nsis.7z）。
 *       stub .exe 通常仅数 MB（引导器），真正安装负载在 *.nsis.7z（可达数 GB）；显示名 Aixflow 与 7z 前缀 nexflow 可并存。
 *       脚本会在 release/ 与 release/nsis-web/ 两处查找 latest.yml 与上述文件，并上传 yml 及关联 .exe / .nsis.7z、.blockmap。
 *     - 单文件 NSIS（build.win.target = nsis）：产物为 release/Aixflow-Bate-Windows-Setup-${version}.exe（完整安装包），上传时优先生效，避免残留 nsis-web 目录误走分片上传。
 *     - 若仅在 release/ 根目录有 *.nsis.7z（旧布局）：行为与此前一致。
 *   - Mac：latest-mac.yml、yml 中引用的 .zip/.dmg，以及同名的 .zip.blockmap（若本地存在）
 *
 * 若只在 Windows 构建，则无 latest-mac.yml，脚本仅上传 Windows；仅在 Mac 构建则无 exe，仅上传 Mac。
 */

import OSS from 'ali-oss';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const releaseDir = path.join(__dirname, '..', 'release');

function formatUploadSize(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(2)} KB`;
  return `${n} B`;
}

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer?.trim() || '');
    });
  });
}

function uploadArgsNoConfirm() {
  return process.argv.slice(2).includes('--no-confirm');
}

function uploadArgsSkipCnRelease() {
  return process.argv.slice(2).includes('--skip-cn-release');
}

function uploadArgsCnOnly() {
  return process.argv.slice(2).includes('--cn-only');
}

function uploadArgsHkOnly() {
  return (
    uploadArgsSkipCnRelease() ||
    process.argv.slice(2).includes('--hk-only')
  );
}

/** @returns {'hk'|'cn'|'both'|null} */
function parseUploadModeFromArgs() {
  if (uploadArgsCnOnly()) return 'cn';
  if (uploadArgsHkOnly()) return 'hk';
  const args = process.argv.slice(2);
  if (args.includes('--both') || args.includes('--dual')) return 'both';
  const env = String(process.env.OSS_RELEASE_UPLOAD_MODE || '').trim().toLowerCase();
  if (env === 'hk' || env === 'cn' || env === 'both') return env;
  return null;
}

/** 交互或 CI 默认：hk | cn | both */
async function resolveReleaseUploadMode(cnAvailable) {
  const fromArgs = parseUploadModeFromArgs();
  if (fromArgs) return fromArgs;

  if (uploadArgsNoConfirm()) {
    return 'both';
  }

  const cnLine = cnAvailable
    ? '  3 - 仅北京 Release 副本（补传，不上传香港）\n'
    : '  （北京 Release 未配置，无法选 3）\n';

  const choice = await prompt(
    `发布线路（仅 Release 安装包/更新元数据，不含用户素材）：\n` +
      `  1 - 双线：香港主源 + 北京 Release 副本（推荐）\n` +
      `  2 - 仅香港主源\n` +
      cnLine +
      `请输入 1 / 2 / 3 [默认 1]: `,
  );

  if (choice === '2') return 'hk';
  if (choice === '3') {
    if (!cnAvailable) {
      console.error('[upload-release] 北京 Release 未配置（OSS_RELEASE_CN_DISABLED=1 等），无法仅传北京。');
      process.exit(1);
    }
    return 'cn';
  }
  return 'both';
}

/** 北京 Release 副本 OSS（与主源同 AK，仅 bucket/region 不同） */
function loadReleaseCnOssConfig(primaryCredentials) {
  const env = process.env;
  if (String(env.OSS_RELEASE_CN_DISABLED || '').trim() === '1') {
    return null;
  }
  const region = String(env.OSS_RELEASE_CN_REGION || env.OSS_CN_REGION || 'oss-cn-beijing').trim();
  const bucket = String(env.OSS_RELEASE_CN_BUCKET || env.OSS_CN_BUCKET || 'nexflow-temp-images-bj').trim();
  if (!region || !bucket) return null;
  return {
    region,
    bucket,
    accessKeyId: primaryCredentials.accessKeyId,
    accessKeySecret: primaryCredentials.accessKeySecret,
  };
}

const RELEASE_CN_MAX_RETRIES = Math.max(1, Number(process.env.OSS_RELEASE_CN_RETRIES) || 3);

/** 上传 manifest 到指定 OSS（香港主源或北京 Release 副本） */
async function uploadReleaseManifest(manifest, ossConfig, tag, { failHard = false } = {}) {
  if (!manifest.length) {
    return { ok: true, uploaded: 0, failed: [] };
  }

  const client = new OSS({
    region: ossConfig.region,
    accessKeyId: ossConfig.accessKeyId,
    accessKeySecret: ossConfig.accessKeySecret,
    bucket: ossConfig.bucket,
    timeout: 3600000,
  });

  console.log(
    `[upload-release][${tag}] 开始上传 → ${ossConfig.bucket} @ ${ossConfig.region}（${manifest.length} 个对象）`,
  );

  const failed = [];
  let uploaded = 0;

  for (const item of manifest) {
    let done = false;
    let lastErr = null;
    for (let attempt = 1; attempt <= RELEASE_CN_MAX_RETRIES; attempt += 1) {
      try {
        const st = fs.statSync(item.localPath);
        await client.put(item.remoteKey, item.localPath, { headers: item.headers || {} });
        console.log(
          `[upload-release][${tag}] 已上传: ${item.remoteKey} (${formatUploadSize(st.size)})` +
            (attempt > 1 ? ` [重试 ${attempt}/${RELEASE_CN_MAX_RETRIES}]` : ''),
        );
        uploaded += 1;
        done = true;
        break;
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(
          `[upload-release][${tag}] 上传失败 (${attempt}/${RELEASE_CN_MAX_RETRIES}): ${item.remoteKey} — ${msg}`,
        );
        if (attempt < RELEASE_CN_MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, 2000 * attempt));
        }
      }
    }
    if (!done) {
      failed.push({ ...item, error: lastErr instanceof Error ? lastErr.message : String(lastErr) });
    }
  }

  const result = { ok: failed.length === 0, uploaded, failed };
  if (failHard && failed.length > 0) {
    const keys = failed.map((f) => f.remoteKey).join(', ');
    throw new Error(`[upload-release][${tag}] ${failed.length} 个对象上传失败: ${keys}`);
  }
  return result;
}

function decodeBase64Utf8(v) {
  try {
    return Buffer.from(String(v || ''), 'base64').toString('utf8');
  } catch {
    return '';
  }
}

function loadUploadOssConfig() {
  const env = process.env;
  // 与 src/main/config/ossConfig.ts 保持同源默认值，避免上传脚本依赖 Electron 主进程模块链
  const builtInAccessKeyId = decodeBase64Utf8('TFRBSTV0N3BKRFo1clpqVEJ5RHJVc0tX');
  const builtInAccessKeySecret = decodeBase64Utf8('eDBOcG80dWx1TnltN3ZkZGJtYXVaamtRemg4NUNF');
  const region = String(env.OSS_REGION || env.OSS_REGION_ID || 'oss-cn-hongkong').trim();
  const bucket = String(env.OSS_BUCKET || 'nexflow-temp-images').trim();
  const accessKeyId = String(env.OSS_ACCESS_KEY_ID || builtInAccessKeyId).trim();
  const accessKeySecret = String(env.OSS_ACCESS_KEY_SECRET || builtInAccessKeySecret).trim();
  const installerPrefix = String(env.OSS_INSTALLER_OBJECT_PREFIX || 'aixflow uploads/').trim();
  const macInstallerPrefix = String(env.OSS_MAC_INSTALLER_OBJECT_PREFIX || 'Aixflow uploads Mac/').trim();
  if (!accessKeyId || !accessKeySecret || !region || !bucket) {
    throw new Error('OSS 上传配置不完整：请检查 OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET / OSS_REGION / OSS_BUCKET');
  }
  return {
    config: { accessKeyId, accessKeySecret, region, bucket },
    installerPrefix,
    macInstallerPrefix,
  };
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 是否为当前 package.json 版本的 Release 产物（避免 release/ 残留旧版被一并上传） */
function isReleaseArtifactForVersion(fileName, version) {
  if (!fileName || !version) return false;
  const v = escapeRegExp(version);
  if (/^latest(-mac)?\.yml$/i.test(fileName)) return true;
  if (new RegExp(`Aixflow-Windows-Setup-${v}\\.exe`, 'i').test(fileName)) return true;
  if (new RegExp(`Aixflow-Bate-Windows-Setup-${v}\\.exe`, 'i').test(fileName)) return true;
  if (new RegExp(`Aixflow-Windows-Offline-${v}\\.zip`, 'i').test(fileName)) return true;
  if (new RegExp(`^nexflow-${v}-`, 'i').test(fileName)) return true;
  if (new RegExp(`Aixflow-Bate-${v}-`, 'i').test(fileName)) return true;
  const base = fileName.replace(/\.blockmap$/i, '');
  if (base !== fileName && isReleaseArtifactForVersion(base, version)) return true;
  return false;
}

/** 扫描 release/ 与 release/nsis-web/ 中将被跳过的旧版本本地文件 */
function listStaleLocalReleaseArtifacts(version) {
  const nsisWebDir = path.join(releaseDir, 'nsis-web');
  const stale = [];
  for (const dir of [releaseDir, nsisWebDir]) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (/^latest(-mac)?\.yml$/i.test(name)) continue;
      if (!/\.(exe|7z|zip|blockmap|yml)$/i.test(name)) continue;
      if (isReleaseArtifactForVersion(name, version)) continue;
      stale.push(path.relative(releaseDir, path.join(dir, name)));
    }
  }
  return stale;
}

function sha512Base64OfFile(filePath) {
  const hash = crypto.createHash('sha512');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('base64');
}

function buildLatestYmlContent(version, setupExeName, setupExePath) {
  const sha512 = sha512Base64OfFile(setupExePath);
  const size = fs.statSync(setupExePath).size;
  const releaseDate = new Date().toISOString();
  return (
    `version: ${version}\n` +
    `files:\n` +
    `  - url: ${setupExeName}\n` +
    `    sha512: ${sha512}\n` +
    `    size: ${size}\n` +
    `path: ${setupExeName}\n` +
    `sha512: ${sha512}\n` +
    `releaseDate: '${releaseDate}'\n`
  );
}

/** 从 latest.yml（Windows）收集需上传的安装包文件名（nsis-web：stub exe + .nsis.7z + 可选 .blockmap） */
function collectWindowsArtifactNamesFromYml(text) {
  const names = new Set();
  for (const line of text.split(/\n/)) {
    const m = line.match(/^\s*(?:-\s*)?url:\s*(.+)\s*$/);
    if (!m) continue;
    let name = m[1].trim().replace(/^["']|["']$/g, '');
    if (/^https?:\/\//i.test(name)) {
      try {
        const u = new URL(name);
        name = path.basename(u.pathname);
      } catch {
        continue;
      }
    }
    if (/\.(exe|nsis\.7z|blockmap)$/i.test(name)) names.add(name);
  }
  /** nsis-web packages.x64.path / file */
  for (const line of text.split(/\n/)) {
    const m = line.match(/^\s+(?:path|file):\s*(.+)\s*$/);
    if (!m) continue;
    let name = m[1].trim().replace(/^["']|["']$/g, '');
    if (/\.nsis\.7z$/i.test(name)) names.add(name);
  }
  const pathm = text.match(/^path:\s*(.+)$/m);
  if (pathm) {
    let name = pathm[1].trim().replace(/^["']|["']$/g, '');
    if (/\.exe$/i.test(name)) names.add(name);
  }
  return [...names];
}

/** 从 latest-mac.yml 收集需上传的安装包文件名（zip/dmg） */
function collectMacArtifactNamesFromYml(text) {
  const names = new Set();
  for (const line of text.split(/\n/)) {
    const m = line.match(/^\s*(?:-\s*)?url:\s*(.+)\s*$/);
    if (!m) continue;
    let name = m[1].trim().replace(/^["']|["']$/g, '');
    if (/\.(zip|dmg)$/i.test(name)) names.add(name);
  }
  const pathm = text.match(/^path:\s*(.+)$/m);
  if (pathm) {
    let name = pathm[1].trim().replace(/^["']|["']$/g, '');
    if (/\.(zip|dmg)$/i.test(name)) names.add(name);
  }
  return [...names];
}

async function uploadRelease() {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
  const version = pkg.version;

  if (!uploadArgsNoConfirm()) {
    const typed = await prompt(
      `[upload-release] 将按 package.json 上传版本 ${version}（须已有构建产物：nsis-web 为 release/nsis-web/ 下 latest.yml、stub exe、*.nsis.7z；离线包为 release/Aixflow-Windows-Offline-${version}.zip）。\n` +
        `请输入版本号以确认（须与上述完全一致；留空取消）: `,
    );
    if (!typed) {
      console.error('[upload-release] 已取消：未输入版本号。');
      process.exit(1);
    }
    if (typed !== version) {
      console.error(
        `[upload-release] 输入「${typed}」与 package.json 的「${version}」不一致。请先修改版本或重新构建。`,
      );
      process.exit(1);
    }
  }

  const uploadOss = loadUploadOssConfig();
  const config = uploadOss.config;
  const cnConfig = loadReleaseCnOssConfig(config);
  const uploadMode = await resolveReleaseUploadMode(Boolean(cnConfig));

  const staleLocal = listStaleLocalReleaseArtifacts(version);
  if (staleLocal.length > 0) {
    console.warn(
      `[upload-release] 本地 release/ 存在 ${staleLocal.length} 个旧版本文件，将不会上传：`,
      staleLocal.join(', '),
    );
  }

  console.log(`[upload-release] 仅上传 package.json 版本 ${version} 的 Release 产物`);

  const modeLabel =
    uploadMode === 'both' ? '双线（香港 + 北京）' : uploadMode === 'hk' ? '仅香港' : '仅北京';
  console.log(`[upload-release] 发布线路: ${modeLabel}`);

  const remoteFolderRaw = uploadOss.installerPrefix || 'aixflow uploads/';
  const remoteFolder = remoteFolderRaw.endsWith('/') ? remoteFolderRaw : `${remoteFolderRaw}/`;
  const macFolderRaw = uploadOss.macInstallerPrefix || 'Aixflow uploads Mac/';
  const macFolder = macFolderRaw.endsWith('/') ? macFolderRaw : `${macFolderRaw}/`;

  const publicBase =
    `https://${config.bucket}.${config.region}.aliyuncs.com/` + remoteFolder.replace(/ /g, '%20');
  const macPublicBase =
    `https://${config.bucket}.${config.region}.aliyuncs.com/` + macFolder.replace(/ /g, '%20');

  /** @type {Array<{ localPath: string; remoteKey: string; headers: Record<string, string> }>} */
  const releaseUploadManifest = [];

  function pushManifest(localPath, remoteKey, headers) {
    if (!localPath || !fs.existsSync(localPath)) return;
    releaseUploadManifest.push({
      localPath,
      remoteKey,
      headers: headers || {},
    });
  }

  const setupExe = `Aixflow-Windows-Setup-${version}.exe`;
  const offlineZip = `Aixflow-Windows-Offline-${version}.zip`;
  const nsisWebDir = path.join(releaseDir, 'nsis-web');

  /** electron-builder 24+ nsis-web 把 latest.yml 放在 release/nsis-web/；根目录可能残留旧版 latest.yml，须优先子目录并校验 version 行 */
  function parseYmlVersionLine(text) {
    const m = text.match(/^version:\s*(.+)$/m);
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
  }

  function findLatestYmlPath() {
    const nsisYml = path.join(nsisWebDir, 'latest.yml');
    const rootYml = path.join(releaseDir, 'latest.yml');
    /** 先 nsis-web（当前构建），再根目录（旧布局或单文件 NSIS 自写） */
    for (const p of [nsisYml, rootYml]) {
      if (!fs.existsSync(p)) continue;
      try {
        const text = fs.readFileSync(p, 'utf8');
        const yv = parseYmlVersionLine(text);
        if (yv && yv !== version) {
          console.warn(`[upload-release] 跳过与 package.json（${version}）不一致的 latest.yml（文件内 version: ${yv}）: ${p}`);
          continue;
        }
        return p;
      } catch {
        continue;
      }
    }
    return null;
  }

  /** 在 release/ 与 release/nsis-web/ 下查找当前版本的 .nsis.7z */
  function collectNsis7zEntries() {
    const expected = `nexflow-${version}-x64.nsis.7z`;
    const out = [];
    for (const dir of [releaseDir, nsisWebDir]) {
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir)) {
        if (!/\.nsis\.7z$/i.test(f)) continue;
        if (!isReleaseArtifactForVersion(f, version)) {
          console.warn(`[upload-release] 跳过旧版本 .nsis.7z（非 ${version}）: ${path.join(dir, f)}`);
          continue;
        }
        out.push({ name: f, dir });
      }
    }
    if (out.length === 0) {
      const fallback = path.join(nsisWebDir, expected);
      if (fs.existsSync(fallback)) out.push({ name: expected, dir: nsisWebDir });
    }
    return out;
  }

  /** 解析 yml 中引用的文件名在磁盘上的路径（根目录或 nsis-web 子目录） */
  function resolveWindowsArtifactLocalPath(fileName) {
    const a = path.join(releaseDir, fileName);
    if (fs.existsSync(a)) return a;
    const b = path.join(nsisWebDir, fileName);
    if (fs.existsSync(b)) return b;
    return null;
  }

  const setupExePathRoot = path.join(releaseDir, setupExe);
  const setupExePathNsisWeb = path.join(nsisWebDir, setupExe);
  const setupExePath = fs.existsSync(setupExePathRoot)
    ? setupExePathRoot
    : fs.existsSync(setupExePathNsisWeb)
      ? setupExePathNsisWeb
      : setupExePathRoot;

  const latestYmlPath = findLatestYmlPath();
  const hasLatestYml = Boolean(latestYmlPath);
  const nsis7zEntries = collectNsis7zEntries();
  let ymlSuggestsNsisWeb = false;
  if (hasLatestYml && latestYmlPath) {
    try {
      ymlSuggestsNsisWeb = /\.nsis\.7z/i.test(fs.readFileSync(latestYmlPath, 'utf8'));
    } catch {
      /* ignore */
    }
  }
  /** nsis-web：任一目录内有 7z 包，或 latest.yml 中引用了 .nsis.7z */
  const isNsisWeb = nsis7zEntries.length > 0 || ymlSuggestsNsisWeb;

  /** nsis-web 的 stub 仅数 MB；release 根目录下大于此阈值的同名 exe 视为「单文件 NSIS 完整安装包」 */
  const STUB_MAX_BYTES = 4 * 1024 * 1024;
  const hasMonolithicInstaller =
    fs.existsSync(setupExePathRoot) && fs.statSync(setupExePathRoot).size > STUB_MAX_BYTES;

  /** 收集 nsis-web 等 Windows Release 对象到 manifest（不上传） */
  function collectWindowsNsisWebManifest() {
    if (!latestYmlPath) return;
    const ymlText = fs.readFileSync(latestYmlPath, 'utf8');
    const artifacts = collectWindowsArtifactNamesFromYml(ymlText);
    console.log(
      '[upload-release] Windows nsis-web 待传:',
      artifacts.join(', ') || '(解析为空，仍将包含 yml 与目录内 .nsis.7z)',
    );

    pushManifest(latestYmlPath, `${remoteFolder}latest.yml`, {
      'Content-Type': 'text/yaml; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    });

    const collectedNames = new Set();
    for (const name of artifacts) {
      if (!isReleaseArtifactForVersion(name, version)) {
        console.warn(`[upload-release] latest.yml 引用但版本不匹配 ${version}，跳过:`, name);
        continue;
      }
      const local = resolveWindowsArtifactLocalPath(name);
      if (!local) {
        console.warn('[upload-release] latest.yml 引用但本地未找到:', name);
        continue;
      }
      const isStubExe = /\.exe$/i.test(name) && !/\.nsis\.7z$/i.test(name);
      pushManifest(local, `${remoteFolder}${name}`, {
        'Content-Type': 'application/octet-stream',
        ...(isStubExe
          ? { 'Cache-Control': 'no-cache, no-store, must-revalidate' }
          : {}),
      });
      collectedNames.add(name);
    }

    for (const name of [...artifacts]) {
      if (!/\.exe$/i.test(name) || /\.nsis\.7z$/i.test(name)) continue;
      const bm = `${name}.blockmap`;
      if (collectedNames.has(bm)) continue;
      const localBm = resolveWindowsArtifactLocalPath(bm);
      if (!localBm) continue;
      pushManifest(localBm, `${remoteFolder}${bm}`, { 'Content-Type': 'application/octet-stream' });
      collectedNames.add(bm);
    }

    for (const { name: z, dir: zdir } of nsis7zEntries) {
      if (!isReleaseArtifactForVersion(z, version)) continue;
      if (!collectedNames.has(z)) {
        const local = path.join(zdir, z);
        if (fs.existsSync(local)) {
          pushManifest(local, `${remoteFolder}${z}`, { 'Content-Type': 'application/octet-stream' });
          collectedNames.add(z);
        }
      }
      const blockmapName = `${z}.blockmap`;
      const localBm = path.join(zdir, blockmapName);
      if (fs.existsSync(localBm)) {
        pushManifest(localBm, `${remoteFolder}${blockmapName}`, {
          'Content-Type': 'application/octet-stream',
        });
      }
    }

    const setupResolved = resolveWindowsArtifactLocalPath(setupExe);
    if (!collectedNames.has(setupExe) && setupResolved) {
      pushManifest(setupResolved, `${remoteFolder}${setupExe}`, {
        'Content-Type': 'application/octet-stream',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      });
    }

    const stub = [...collectedNames].find((n) => /\.exe$/i.test(n) && !/\.nsis\.7z$/i.test(n));
    const pack7 = [...collectedNames].find((n) => /\.nsis\.7z$/i.test(n));
    if (stub && pack7) {
      const sp = resolveWindowsArtifactLocalPath(stub);
      const zp = resolveWindowsArtifactLocalPath(pack7);
      if (sp && zp) {
        const ss = fs.statSync(sp).size;
        const zs = fs.statSync(zp).size;
        console.log(
          '[upload-release] Windows nsis-web 说明：',
          `${stub}（约 ${(ss / 1024 / 1024).toFixed(2)} MB）为在线安装引导器；`,
          `${pack7}（约 ${(zs / 1024 / 1024).toFixed(0)} MB）为实际安装负载。`,
        );
      }
    }

    const offlineZipPath = path.join(releaseDir, offlineZip);
    if (fs.existsSync(offlineZipPath)) {
      pushManifest(offlineZipPath, `${remoteFolder}${offlineZip}`, {
        'Content-Type': 'application/zip',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      });
    } else {
      console.warn('[upload-release] 未找到离线 zip，跳过:', offlineZipPath);
    }
  }

  if (!hasMonolithicInstaller && nsis7zEntries.length > 0 && !hasLatestYml) {
    console.error(
      '[upload-release] 已发现 *.nsis.7z 但缺少 latest.yml（应在 release/ 或 release/nsis-web/）。请先在本机完整执行 npm run electron:build。',
    );
    process.exit(1);
  }

  if (hasMonolithicInstaller) {
    const ymlOutPath = path.join(releaseDir, 'latest.yml');
    const ymlContent = buildLatestYmlContent(version, setupExe, setupExePathRoot);
    fs.writeFileSync(ymlOutPath, ymlContent, 'utf8');
    console.log('[upload-release] Windows 单文件 NSIS（完整安装包）：已根据 exe 同步生成:', ymlOutPath);

    pushManifest(ymlOutPath, `${remoteFolder}latest.yml`, {
      'Content-Type': 'text/yaml; charset=utf-8',
    });
    pushManifest(setupExePathRoot, `${remoteFolder}${setupExe}`, {
      'Content-Type': 'application/octet-stream',
    });
  } else if (isNsisWeb && hasLatestYml) {
    collectWindowsNsisWebManifest();
  } else if (fs.existsSync(setupExePath)) {
    const ymlOutPath = path.join(releaseDir, 'latest.yml');
    const ymlContent = buildLatestYmlContent(version, setupExe, setupExePath);
    fs.writeFileSync(ymlOutPath, ymlContent, 'utf8');
    console.log('[upload-release] Windows 单文件 NSIS：已根据 exe 同步生成:', ymlOutPath);

    pushManifest(ymlOutPath, `${remoteFolder}latest.yml`, {
      'Content-Type': 'text/yaml; charset=utf-8',
    });
    pushManifest(setupExePath, `${remoteFolder}${setupExe}`, {
      'Content-Type': 'application/octet-stream',
    });
  } else {
    console.warn(
      '[upload-release] 未找到',
      setupExe,
      '（已查 release/ 与 release/nsis-web/），且无法按 nsis-web 收集（需要 latest.yml 且 yml 或目录中含 .nsis.7z）。跳过 Windows。',
    );
  }

  const latestMacPath = path.join(releaseDir, 'latest-mac.yml');
  if (fs.existsSync(latestMacPath)) {
    const macYmlText = fs.readFileSync(latestMacPath, 'utf8');
    const macYmlVersion = parseYmlVersionLine(macYmlText);
    if (macYmlVersion && macYmlVersion !== version) {
      console.warn(
        `[upload-release] 跳过 Mac：latest-mac.yml 版本 ${macYmlVersion} 与 package.json ${version} 不一致`,
      );
    } else {
    const artifacts = collectMacArtifactNamesFromYml(macYmlText).filter((name) => {
      if (isReleaseArtifactForVersion(name, version)) return true;
      console.warn(`[upload-release] latest-mac.yml 引用但版本不匹配 ${version}，跳过:`, name);
      return false;
    });
    pushManifest(latestMacPath, `${macFolder}latest-mac.yml`, {
      'Content-Type': 'text/yaml; charset=utf-8',
    });
    for (const name of artifacts) {
      const local = path.join(releaseDir, name);
      if (fs.existsSync(local)) {
        const isDmg = /\.dmg$/i.test(name);
        pushManifest(local, `${macFolder}${name}`, {
          'Content-Type': isDmg ? 'application/x-apple-diskimage' : 'application/zip',
        });
      } else {
        console.warn('[upload-release] latest-mac.yml 引用但本地未找到:', name);
      }
      const blockmapName = `${name}.blockmap`;
      const localBm = path.join(releaseDir, blockmapName);
      if (fs.existsSync(localBm)) {
        pushManifest(localBm, `${macFolder}${blockmapName}`, {
          'Content-Type': 'application/octet-stream',
        });
      }
    }
    console.log('[upload-release] Mac 待传:', artifacts.join(', ') || '(无)');
    }
  } else {
    console.warn(
      '[upload-release] 未找到 latest-mac.yml，跳过 Mac（Windows 仅构建 Windows 包；Mac 请在 macOS 上 electron:build 后再上传）',
    );
  }

  if (releaseUploadManifest.length === 0) {
    console.error('[upload-release] 没有可上传的 Release 文件。请至少构建 Windows 或 Mac 其一并放入 release/');
    process.exit(1);
  }

  console.log(`[upload-release] 共 ${releaseUploadManifest.length} 个 Release 对象`);

  let cnReleaseOk = true;

  if (uploadMode === 'cn' && !cnConfig) {
    console.error('[upload-release] 已选仅北京，但北京 Release OSS 未配置。');
    process.exit(1);
  }

  if (uploadMode === 'hk' || uploadMode === 'both') {
    try {
      await uploadReleaseManifest(releaseUploadManifest, config, 'HK', { failHard: true });
      console.log(
        '[upload-release][HK] 香港主发布完成。Windows:',
        `${publicBase}latest.yml`,
        ' Mac:',
        `${macPublicBase}latest-mac.yml`,
      );
    } catch (err) {
      console.error('[upload-release][HK] 香港主发布失败，发版中止:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  }

  if (uploadMode === 'cn' || uploadMode === 'both') {
    if (!cnConfig) {
      console.warn('[upload-release][CN] 北京 Release 未配置，已跳过（OSS_RELEASE_CN_DISABLED=1 等）');
    } else {
      const cnWinBase =
        `https://${cnConfig.bucket}.${cnConfig.region}.aliyuncs.com/` + remoteFolder.replace(/ /g, '%20');
      const cnMacBase =
        `https://${cnConfig.bucket}.${cnConfig.region}.aliyuncs.com/` + macFolder.replace(/ /g, '%20');

      const cnResult = await uploadReleaseManifest(releaseUploadManifest, cnConfig, 'CN', {
        failHard: uploadMode === 'cn',
      });

      if (cnResult.ok) {
        console.log(
          `[upload-release][CN] 北京 Release 副本完成（${cnResult.uploaded}/${releaseUploadManifest.length}）。Windows:`,
          `${cnWinBase}latest.yml`,
          ' Mac:',
          `${cnMacBase}latest-mac.yml`,
        );
      } else {
        cnReleaseOk = false;
        console.error(
          `[upload-release][CN] 警告：北京 Release 副本未完全成功（${cnResult.uploaded}/${releaseUploadManifest.length}）` +
            (uploadMode === 'both' ? '，香港主发布已成功，海外用户不受影响。' : ''),
        );
        for (const f of cnResult.failed) {
          console.error(`  - ${f.remoteKey}: ${f.error || 'unknown'}`);
        }
        if (uploadMode === 'cn') {
          process.exit(1);
        }
      }
    }
  }

  if (uploadMode === 'both' && !cnReleaseOk) {
    console.warn('[upload-release] 发版结束：香港 OK，北京 Release 副本部分失败（exit 0，请人工跟进 CN）');
  } else {
    console.log(`[upload-release] 发版完成（${modeLabel}）`);
  }
}

uploadRelease().catch((err) => {
  console.error('[upload-release] 失败:', err);
  process.exit(1);
});
