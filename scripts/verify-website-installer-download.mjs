#!/usr/bin/env node
/**
 * 模拟 aixflow.com.cn 落地页下载链路：fetch latest.yml → HEAD 离线 zip / stub exe。
 */
const WIN_BASE = 'https://nexflow-temp-images.oss-cn-hongkong.aliyuncs.com/aixflow%20uploads/';
const LATEST_YML = `${WIN_BASE}latest.yml`;
const ORIGIN = 'https://aixflow.com.cn';

function stripYamlQuotes(v) {
  let s = String(v || '').trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

function parseVersion(text) {
  const m = text.match(/^version:\s*(.+)$/m);
  return m?.[1] ? stripYamlQuotes(m[1]) : '';
}

function parseExeName(text) {
  const pathMatch = text.match(/^path:\s*(.+)$/m);
  let name = pathMatch?.[1] ? stripYamlQuotes(pathMatch[1]) : '';
  if (name && /\.exe$/i.test(name)) return name;
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*(?:-\s*)?url:\s*(.+)\s*$/);
    if (!m) continue;
    const candidate = stripYamlQuotes(m[1]);
    if (/\.exe$/i.test(candidate) && !/\.nsis\.7z$/i.test(candidate)) return candidate;
  }
  return '';
}

async function headOk(url) {
  const res = await fetch(url, {
    method: 'HEAD',
    headers: { Origin: ORIGIN },
    cache: 'no-store',
  });
  return { ok: res.ok, status: res.status, acao: res.headers.get('access-control-allow-origin') };
}

async function main() {
  const ymlRes = await fetch(`${LATEST_YML}?t=${Date.now()}`, {
    headers: { Origin: ORIGIN },
    cache: 'no-store',
  });
  const acaoYml = ymlRes.headers.get('access-control-allow-origin');
  if (!ymlRes.ok) {
    console.error('[verify-website-download] latest.yml HTTP', ymlRes.status);
    process.exit(1);
  }
  const text = await ymlRes.text();
  const version = parseVersion(text);
  console.log('[verify-website-download] latest.yml version:', version, '| CORS:', acaoYml || '(none)');

  const glassName = version ? `Aixflow-Installer-${version}.exe` : '';
  if (glassName) {
    const glassUrl = WIN_BASE + encodeURIComponent(glassName);
    const glass = await headOk(glassUrl);
    if (glass.ok) {
      console.log(
        '[verify-website-download] 官网将下载玻璃安装器:',
        glassName,
        '| CORS:',
        glass.acao || '(none)',
      );
      return;
    }
  }

  const exe = parseExeName(text);
  if (exe) {
    const stubUrl = WIN_BASE + encodeURIComponent(exe);
    const stub = await headOk(stubUrl);
    if (stub.ok) {
      console.log('[verify-website-download] 官网将下载在线 stub（后备）:', exe, '| CORS:', stub.acao || '(none)');
      return;
    }
  }

  const offlineZip = `Aixflow-Windows-Offline-${version}.zip`;
  const offlineUrl = WIN_BASE + encodeURIComponent(offlineZip);
  const offline = await headOk(offlineUrl);
  if (offline.ok) {
    console.log('[verify-website-download] 官网将下载离线包（备用）:', offlineZip, '| CORS:', offline.acao || '(none)');
    return;
  }

  console.error('[verify-website-download] stub exe 与离线 zip 均不可用');
  process.exit(1);
}

main().catch((e) => {
  console.error('[verify-website-download] 失败:', e?.message || e);
  process.exit(1);
});
