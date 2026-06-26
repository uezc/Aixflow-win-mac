#!/usr/bin/env node
/**
 * 构建前删除 release/win-unpacked，避免 electron-builder 因 exe / app.asar 被占用报 EBUSY。
 * Windows：仅 taskkill 结束「产品安装名」对应进程（不调用 PowerShell 枚举进程，避免部分环境退出码 -1 → npm 显示 4294967295）。
 * 多次 rm；仍失败则同盘改名、cmd move、rd /s /q 或移到 %TEMP%。
 *
 * 若 IDE 索引了 release/win-unpacked 可能锁住 app.asar，可在仓库根添加 .cursorignore：`release/win-unpacked/`
 *
 * 最后手段（需管理员权限，慎用）：
 *   set NEXFLOW_FORCE_WIN_UNPACKED_TAKEOWN=1
 */
import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const unpacked = path.join(__dirname, '..', 'release', 'win-unpacked');

/** 与 package.json build.productName 一致，用于 taskkill /IM */
const WIN_APP_EXE = 'Aixflow.exe';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function tryKillRunningApp() {
  if (process.platform !== 'win32') return;
  try {
    execSync(`taskkill /F /IM "${WIN_APP_EXE}" /T`, { stdio: 'pipe' });
    console.log('[clean-release-win-unpacked] 已结束可能占用文件的进程:', WIN_APP_EXE);
  } catch {
    /* 未运行或无权结束，忽略 */
  }
}

/** 曾用 PowerShell 枚举 win-unpacked 下进程，在部分机器上导致子进程退出码 -1（npm 显示 4294967295）。现仅依赖 taskkill 产品名 + 文件删除/改名。 */
function stopProcessesLockingWinUnpacked() {
  /* noop — 保留函数名，避免各调用点大改 */
}

/** Windows：用 cmd move 挪目录（同卷），避免 PowerShell -Command 引号问题 */
function tryCmdMoveDirWin(src, dst) {
  if (process.platform !== 'win32') return false;
  try {
    execSync(`cmd /c move /Y "${src}" "${dst}"`, { stdio: 'pipe', windowsHide: true });
    return !fs.existsSync(src);
  } catch {
    return false;
  }
}

function rmUnpackedOnce() {
  const opts = { recursive: true, force: true, maxRetries: 12, retryDelay: 250 };
  try {
    fs.rmSync(unpacked, opts);
  } catch (e) {
    const code = e && typeof e === 'object' && 'code' in e ? e.code : '';
    if (code === 'ERR_INVALID_ARG_VALUE') {
      fs.rmSync(unpacked, { recursive: true, force: true });
      return;
    }
    throw e;
  }
}

/** 尝试用 cmd move 挪目录（同卷） */
function tryPowerShellMoveDir(src, dst) {
  return tryCmdMoveDirWin(src, dst);
}

function tryTakeownAndRm() {
  if (process.platform !== 'win32') return false;
  if (String(process.env.NEXFLOW_FORCE_WIN_UNPACKED_TAKEOWN || '').trim() !== '1') return false;
  try {
    console.warn('[clean-release-win-unpacked] NEXFLOW_FORCE_WIN_UNPACKED_TAKEOWN=1：尝试 takeown / icacls 后删除…');
    execSync(`takeown /f "${unpacked}" /r /d y`, { stdio: 'inherit', windowsHide: true });
    execSync(`icacls "${unpacked}" /grant Administrators:F /t`, { stdio: 'inherit', windowsHide: true });
    fs.rmSync(unpacked, { recursive: true, force: true, maxRetries: 15, retryDelay: 300 });
    return !fs.existsSync(unpacked);
  } catch {
    return false;
  }
}

/** 常规删除失败后：改名移走 / rd / 移 %TEMP% / takeown，使 release 下不再存在 win-unpacked */
async function tryRelocateOrForceRemoveUnpacked() {
  console.warn('[clean-release-win-unpacked] 常规删除未清空目录，尝试结束进程后移走 win-unpacked（便于 electron-builder 继续）…');
  tryKillRunningApp();
  stopProcessesLockingWinUnpacked();
  await sleep(2500);

  const releaseParent = path.dirname(unpacked);
  const trashSameDisk = path.join(releaseParent, `.win-unpacked-trash-${Date.now()}`);

  try {
    fs.renameSync(unpacked, trashSameDisk);
    console.log(
      '[clean-release-win-unpacked] 已将 win-unpacked 改名为:',
      trashSameDisk,
      '（release 下已无 win-unpacked；占锁定解除后可手动删该文件夹）',
    );
    return;
  } catch (re) {
    console.warn('[clean-release-win-unpacked] fs.renameSync 同盘改名失败:', re && re.message ? re.message : re);
  }

  if (tryPowerShellMoveDir(unpacked, trashSameDisk) && !fs.existsSync(unpacked)) {
    console.log('[clean-release-win-unpacked] 已通过 cmd move 移走:', trashSameDisk);
    return;
  }

  if (process.platform === 'win32') {
    try {
      execSync(`cmd /c rd /s /q "${unpacked}"`, { stdio: 'pipe', windowsHide: true });
    } catch {
      /* ignore */
    }
  }
  if (!fs.existsSync(unpacked)) {
    console.log('[clean-release-win-unpacked] 已通过 rd /s /q 清空 release/win-unpacked');
    return;
  }

  const trashTemp = path.join(os.tmpdir(), `nexflow-win-unpacked-trash-${Date.now()}`);
  try {
    fs.renameSync(unpacked, trashTemp);
    console.log('[clean-release-win-unpacked] 已移到临时目录:', trashTemp, '（release 已清空）');
    return;
  } catch (re2) {
    console.warn('[clean-release-win-unpacked] 移到临时目录失败:', re2 && re2.message ? re2.message : re2);
  }
  if (tryPowerShellMoveDir(unpacked, trashTemp) && !fs.existsSync(unpacked)) {
    console.log('[clean-release-win-unpacked] 已通过 cmd move 移到临时目录:', trashTemp);
    return;
  }

  if (tryTakeownAndRm()) {
    console.log('[clean-release-win-unpacked] takeown/icacls 后已删除 release/win-unpacked');
    return;
  }

  console.error(
    '[clean-release-win-unpacked] 仍无法移走或删除 release\\win-unpacked（常见为 app.asar 被占用）。请：① 完全退出「Aixflow-Bate」；② 关闭资源管理器中 release\\win-unpacked 或关闭「预览窗格」；③ 在仓库根添加 .cursorignore 行 release/win-unpacked/ 并重启 Cursor；④ 杀毒排除 release；⑤ 或在管理员终端 set NEXFLOW_FORCE_WIN_UNPACKED_TAKEOWN=1 后再 npm run electron:build。',
  );
  process.exit(1);
}

async function main() {
  if (!fs.existsSync(unpacked)) {
    return;
  }

  const maxRounds = 4;
  for (let round = 0; round < maxRounds; round++) {
    tryKillRunningApp();
    stopProcessesLockingWinUnpacked();
    await sleep(round === 0 ? 600 : 1200 + round * 400);
    try {
      rmUnpackedOnce();
      console.log('[clean-release-win-unpacked] 已删除 release/win-unpacked');
      return;
    } catch (e) {
      const msg = e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e);
      console.warn(`[clean-release-win-unpacked] 删除失败 (${round + 1}/${maxRounds}): ${msg}`);
    }
  }

  if (fs.existsSync(unpacked)) {
    await tryRelocateOrForceRemoveUnpacked();
  }
}

main().catch((err) => {
  console.error('[clean-release-win-unpacked] 未捕获错误:', err);
  process.exit(1);
});
