/**
 * 激活码管理（双重时限版）
 *
 * 格式：NXF-SERIAL-ENCODED_GEN-TTL-DAYS-SIGN（6 段）
 * 示例：NXF-ABC123-7T8X9M-48-30-A1B2C3D4
 *
 * - SERIAL: 6 位大写字母/数字
 * - ENCODED_GEN: 激活码生成时的 Unix 时间戳（秒）异或混淆后 Base36
 * - TTL: 核销有效期（小时），0=永久有效，1=1小时，48=48小时
 * - DAYS: 授权时长（30=30天，999=永久）
 * - SIGN: SHA256("NXF"+SERIAL+genTime+ttl+days+MASTER_SECRET) 前 8 位十六进制
 *
 * 兼容：仍支持 5 段旧码（无 TTL），按 48 小时核销期处理
 * 本地 license.json：code, expireAt, machineHash, lastRunAt
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ---------------------------------------------------------------------------
// 私有常量（请勿泄露，与生成器完全一致）
// ---------------------------------------------------------------------------
const MASTER_SECRET = 'NEXFLOW_SEC_2026_JF';

const SERIAL_LEN = 6;
const SIGN_LEN = 8;
const LICENSE_FILENAME = 'license.json';

/** 旧码（5 段）或无 TTL 时的默认核销有效期（小时） */
const DEFAULT_TTL_HOURS = 48;

/** 永久授权等效天数（约 100 年） */
const PERMANENT_DAYS = 999;

/**
 * 为 true 时跳过激活校验：不显示激活页，主进程授权相关 IPC 一律视为已授权。
 * 发布需正式激活流程时请改为 false。也可通过环境变量 NEXFLOW_SKIP_ACTIVATION=1 开启（与下方逻辑配合）。
 */
const SKIP_ACTIVATION_DEFAULT = true;
const SKIP_ACTIVATION =
  SKIP_ACTIVATION_DEFAULT ||
  process.env.NEXFLOW_SKIP_ACTIVATION === '1' ||
  /^(true|yes)$/i.test(String(process.env.NEXFLOW_SKIP_ACTIVATION ?? ''));

/** 是否已关闭激活页（产品当前默认跳过） */
export function isActivationSkipped(): boolean {
  return SKIP_ACTIVATION;
}

/** lastRunAt 容差（秒）：网络时间波动、新电脑时钟未同步等可能导致 now 略小于 lastRunAt，在此范围内不视为时间篡改 */
const LAST_RUN_TOLERANCE_SEC = 300;

/** 校验结果 */
export interface VerifyResult {
  valid: boolean;
  message?: string;
  /** 通过时的到期时间戳（秒），由 activateLicense 按 DAYS 动态计算后写入 */
  expireAt?: number;
  /** 通过时解析出的授权天数（30/999 等），供 activateLicense 计算 finalExpireAt */
  days?: number;
  /** 错误码：ERR_CODE_EXPIRED=超过 48h 核销期；ERR_TIME_ROLLBACK=系统时间回拨 */
  errorCode?: 'ERR_CODE_EXPIRED' | 'ERR_TIME_ROLLBACK';
}

/** 状态：有效 / 未激活 / 过期 / 设备不符 / 时间被篡改 */
export type LicenseStatus = 'VALID' | 'NOT_ACTIVATED' | 'EXPIRED' | 'INVALID_DEVICE' | 'TIME_TAMPERED';

export interface CheckStatusResult {
  status: LicenseStatus;
  message?: string;
  /** 仅当 status === VALID 时有意义 */
  expireAt?: number;
  activationCode?: string;
  /** 当触发智能修正（0 < rollbackSec <= 300）时为 true，调用方可知 license 已写入磁盘 */
  needsSave?: boolean;
}

/** 本地 license.json 结构 */
export interface LicenseFile {
  code: string;
  expireAt: number;
  machineHash: string;
  /** 上次运行时间（秒），首次激活可能为 0 或缺失 */
  lastRunAt: number;
}

// ---------------------------------------------------------------------------
// 时间戳混淆 / 还原（异或 + Base36）
// ---------------------------------------------------------------------------

/**
 * 混淆：timestamp ^ (MASTER_SECRET.charCodeAt(0) << 16)，再转 Base36 大写
 */
export function obfuscateTime(timestamp: number): string {
  const key = (MASTER_SECRET.charCodeAt(0) << 16) >>> 0;
  const obfuscated = (timestamp ^ key) >>> 0;
  return obfuscated.toString(36).toUpperCase();
}

/**
 * 还原：Base36 转数字，再异或得到时间戳
 */
export function deobfuscateTime(encodedStr: string): number {
  const num = parseInt(encodedStr, 36);
  if (!Number.isFinite(num)) return 0;
  const key = (MASTER_SECRET.charCodeAt(0) << 16) >>> 0;
  return (num ^ key) >>> 0;
}

// ---------------------------------------------------------------------------
// 硬件指纹
// ---------------------------------------------------------------------------

/**
 * 结合 hostname、cpus[0].model、platform 生成 machineHash
 */
export function getMachineHash(): string {
  const cpus = os.cpus();
  const model = cpus && cpus[0] ? cpus[0].model : '';
  const raw = [os.hostname(), model, os.platform()].join('|');
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// 签名校验（含时长标记，防篡改）
// ---------------------------------------------------------------------------

function computeSignature(serial: string, genTimeSeconds: number, ttlHours: number, days: number): string {
  const payload = 'NXF' + serial + String(genTimeSeconds) + String(ttlHours) + String(days) + MASTER_SECRET;
  const hash = crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
  return hash.slice(0, SIGN_LEN).toUpperCase();
}

const SERIAL_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/**
 * 生成随机 6 位序列号（A-Z0-9）
 */
function randomSerial(): string {
  let s = '';
  for (let i = 0; i < SERIAL_LEN; i++) {
    s += SERIAL_CHARS[crypto.randomInt(0, SERIAL_CHARS.length)];
  }
  return s;
}

/**
 * 管理员用：根据授权天数与核销有效期生成激活码
 * @param days 授权天数（30=30天，999=永久）
 * @param ttlHours 核销有效期（小时），0=永久有效，1=1小时，48=48小时，默认 48
 * @returns NXF-SERIAL-ENCODED_GEN-TTL-DAYS-SIGN
 */
export function generateActivationCode(days: number, ttlHours: number = DEFAULT_TTL_HOURS): string {
  const genTimeSeconds = Math.floor(Date.now() / 1000);
  const daysNum = Math.max(0, Math.min(999, Math.floor(days)));
  const ttlNum = ttlHours == null || Number.isNaN(Number(ttlHours)) ? DEFAULT_TTL_HOURS : Math.max(0, Math.min(999, Math.floor(ttlHours)));
  const serial = randomSerial();
  const encodedGen = obfuscateTime(genTimeSeconds);
  const ttlStr = String(ttlNum);
  const daysStr = String(daysNum === 0 ? 30 : daysNum);
  const sign = computeSignature(serial, genTimeSeconds, ttlNum, daysNum);
  return `NXF-${serial}-${encodedGen}-${ttlStr}-${daysStr}-${sign}`;
}

// ---------------------------------------------------------------------------
// 核心业务
// ---------------------------------------------------------------------------

/** 5 段旧码签名（不含 TTL），用于兼容 */
function computeSignatureLegacy(serial: string, genTimeSeconds: number, days: number): string {
  const payload = 'NXF' + serial + String(genTimeSeconds) + String(days) + MASTER_SECRET;
  const hash = crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
  return hash.slice(0, SIGN_LEN).toUpperCase();
}

/**
 * 验证激活码格式与签名，不写文件
 * 支持 6 段（含 TTL）与 5 段旧码；步骤 A 按码内 TTL 检查核销期，步骤 B 由 activateLicense 计算到期日
 */
export function verifyLicense(code: string): VerifyResult {
  const raw = code.trim().toUpperCase();
  const parts = raw.split('-');
  const isLegacy5 = parts.length === 5;
  const isNew6 = parts.length === 6;
  if (!isLegacy5 && !isNew6) {
    return {
      valid: false,
      message: '激活码格式错误，应为：NXF-序列号(6位)-生成时间编码-[核销小时]-时长(如30/999)-签名(8位)',
    };
  }

  const prefix = parts[0];
  const serial = parts[1];
  const encodedGen = parts[2];
  const ttlStr = isNew6 ? parts[3] : '';
  const daysStr = isNew6 ? parts[4] : parts[3];
  const sign = isNew6 ? parts[5] : parts[4];

  if (prefix !== 'NXF') {
    return { valid: false, message: '前缀错误，必须为 NXF' };
  }

  if (serial.length !== SERIAL_LEN || !/^[A-Z0-9]+$/.test(serial)) {
    return { valid: false, message: '序列号必须为 6 位大写字母或数字' };
  }

  const genTimeSeconds = deobfuscateTime(encodedGen);
  if (!genTimeSeconds || genTimeSeconds < 0) {
    return { valid: false, message: '生成时间编码无效' };
  }

  const ttlHours = isNew6 ? parseInt(ttlStr, 10) : DEFAULT_TTL_HOURS;
  if (isNew6 && (!Number.isFinite(ttlHours) || ttlHours < 0 || ttlHours > 999)) {
    return { valid: false, message: '核销有效期无效（0=永久，1=1小时，48=48小时）' };
  }

  const daysNum = parseInt(daysStr, 10);
  if (!Number.isFinite(daysNum) || daysNum < 0 || daysNum > 999) {
    return { valid: false, message: '时长标记无效（应为 0–999，999 表示永久）' };
  }

  if (sign.length !== SIGN_LEN || !/^[A-F0-9]+$/.test(sign)) {
    return { valid: false, message: '签名必须为 8 位十六进制字符' };
  }

  const expectedSign = isLegacy5
    ? computeSignatureLegacy(serial, genTimeSeconds, daysNum)
    : computeSignature(serial, genTimeSeconds, ttlHours, daysNum);
  if (sign !== expectedSign) {
    return { valid: false, message: '签名校验失败，激活码无效' };
  }

  // 步骤 A：按码内 TTL 检查核销有效期（0 = 永久有效，不限制）
  const codeMaxAgeSeconds = ttlHours === 0 ? Infinity : ttlHours * 3600;
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (nowSeconds - genTimeSeconds > codeMaxAgeSeconds) {
    const ttlDesc = ttlHours === 1 ? '1 小时' : ttlHours === 48 ? '48 小时' : `${ttlHours} 小时`;
    return {
      valid: false,
      message: `该激活码已超过 ${ttlDesc} 安全激活期，请联系管理员重新获取`,
      errorCode: 'ERR_CODE_EXPIRED',
    };
  }

  return { valid: true, days: daysNum, message: '激活码验证成功' };
}

function getLicensePath(userDataPath: string): string {
  return path.join(userDataPath, LICENSE_FILENAME);
}

/**
 * 验证通过后写入 license.json（步骤 B：动态计算到期日）
 * 防回滚：若本地已有授权且当前系统时间早于上次运行时间，拒绝激活并提示「系统时间异常」
 * userDataPath 一般为 app.getPath('userData')
 * @param nowSeconds 可选，建议传网络北京时间，与 checkLicenseStatus 保持一致，避免本地时钟快于网络时误判 TIME_TAMPERED
 */
export function activateLicense(code: string, userDataPath: string, nowSeconds?: number): VerifyResult {
  const result = verifyLicense(code);
  if (!result.valid) {
    return result;
  }

  const now = nowSeconds ?? Math.floor(Date.now() / 1000);
  const days = result.days ?? 30;

  // 防回滚校验：若已存在 license 且系统时间早于上次激活/运行时间，视为时间被回拨
  const filePath = getLicensePath(userDataPath);
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      const existing = JSON.parse(content) as LicenseFile;
      const rollbackSec = existing?.lastRunAt != null ? existing.lastRunAt - now : 0;
      if (rollbackSec > LAST_RUN_TOLERANCE_SEC) {
        return {
          valid: false,
          message: '系统时间异常，请校正后重试',
          errorCode: 'ERR_TIME_ROLLBACK',
        };
      }
    }
  } catch {
    // 文件损坏或不存在，继续激活
  }

  // 步骤 B：按时长标记动态计算授权到期日（秒）
  const finalExpireAt =
    days >= PERMANENT_DAYS
      ? now + 100 * 365 * 86400
      : now + days * 86400;

  const machineHash = getMachineHash();
  const license: LicenseFile = {
    code: code.trim().toUpperCase(),
    expireAt: finalExpireAt,
    machineHash,
    lastRunAt: now,
  };

  try {
    fs.mkdirSync(userDataPath, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(license, null, 2), 'utf8');
  } catch (e) {
    console.error('[licenseManager] 写入 license.json 失败:', e);
    return { valid: false, message: '保存授权信息失败，请检查目录权限' };
  }

  return { valid: true, expireAt: finalExpireAt, message: '激活成功' };
}

/**
 * 检查本地授权状态
 * - NOT_ACTIVATED: 无文件或文件无效
 * - INVALID_DEVICE: 机器码不符
 * - TIME_TAMPERED: 系统时间被恶意回拨（rollbackSec > 300）
 * - EXPIRED: 已过期
 * - VALID: 通过并更新 lastRunAt
 * @param nowSeconds 可选，用于授权到期判断（建议传网络北京时间，避免本地时钟不准）
 */
export function checkLicenseStatus(userDataPath: string, nowSeconds?: number): CheckStatusResult {
  if (SKIP_ACTIVATION) {
    const now = nowSeconds ?? Math.floor(Date.now() / 1000);
    return {
      status: 'VALID',
      expireAt: now + 100 * 365 * 86400,
      activationCode: '',
    };
  }

  const filePath = getLicensePath(userDataPath);

  let license: LicenseFile;
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    license = JSON.parse(content) as LicenseFile;
  } catch {
    return { status: 'NOT_ACTIVATED', message: '未激活' };
  }

  if (
    !license ||
    typeof license.code !== 'string' ||
    typeof license.expireAt !== 'number' ||
    typeof license.machineHash !== 'string'
  ) {
    return { status: 'NOT_ACTIVATED', message: '授权文件损坏' };
  }

  const currentHash = getMachineHash();
  if (license.machineHash !== currentHash) {
    return {
      status: 'INVALID_DEVICE',
      message: '授权与当前设备不符',
      activationCode: license.code,
      expireAt: license.expireAt,
    };
  }

  const now = nowSeconds ?? Math.floor(Date.now() / 1000);
  const lastRunAt = license.lastRunAt ?? 0;

  // 防御性编程：首次激活或 lastRunAt 缺失/为 0，强制设置为 now 并保存，跳过时间比较
  const isFirstRun = lastRunAt === 0 || license.lastRunAt == null || license.lastRunAt === undefined;
  if (isFirstRun) {
    console.log('[licenseManager] checkLicenseStatus: 首次运行或 lastRunAt 缺失', {
      now,
      lastRunAt: license.lastRunAt,
      rollbackSec: 'N/A（跳过）',
    });
    try {
      license.lastRunAt = now;
      fs.writeFileSync(filePath, JSON.stringify(license, null, 2), 'utf8');
    } catch (e) {
      console.error('[licenseManager] 首次写入 lastRunAt 失败:', e);
    }
    if (now > license.expireAt) {
      return {
        status: 'EXPIRED',
        message: '授权已过期',
        activationCode: license.code,
        expireAt: license.expireAt,
      };
    }
    return {
      status: 'VALID',
      expireAt: license.expireAt,
      activationCode: license.code,
    };
  }

  const rollbackSec = lastRunAt - now;
  console.log('[licenseManager] checkLicenseStatus:', { now, lastRunAt, rollbackSec });

  // rollbackSec > 300：恶意篡改，拦截
  if (rollbackSec > LAST_RUN_TOLERANCE_SEC) {
    return {
      status: 'TIME_TAMPERED',
      message: '系统时间异常，请校正后重试',
      expireAt: license.expireAt,
    };
  }

  // 0 < rollbackSec <= 300：智能修正，不报错，将 lastRunAt 修正为 now 并立即写入磁盘
  if (rollbackSec > 0 && rollbackSec <= LAST_RUN_TOLERANCE_SEC) {
    console.log('[licenseManager] checkLicenseStatus: 触发智能修正，rollbackSec=', rollbackSec);
    try {
      license.lastRunAt = now;
      fs.writeFileSync(filePath, JSON.stringify(license, null, 2), 'utf8');
    } catch (e) {
      console.error('[licenseManager] 修正 lastRunAt 写入失败:', e);
    }
    if (now > license.expireAt) {
      return {
        status: 'EXPIRED',
        message: '授权已过期',
        activationCode: license.code,
        expireAt: license.expireAt,
      };
    }
    return {
      status: 'VALID',
      expireAt: license.expireAt,
      activationCode: license.code,
      needsSave: true,
    };
  }

  // rollbackSec <= 0：正常情况，检查是否过期
  if (now > license.expireAt) {
    return {
      status: 'EXPIRED',
      message: '授权已过期',
      activationCode: license.code,
      expireAt: license.expireAt,
    };
  }

  // 通过：更新 lastRunAt
  try {
    license.lastRunAt = now;
    fs.writeFileSync(filePath, JSON.stringify(license, null, 2), 'utf8');
  } catch (e) {
    console.error('[licenseManager] 更新 lastRunAt 失败:', e);
  }

  return {
    status: 'VALID',
    expireAt: license.expireAt,
    activationCode: license.code,
  };
}
