#!/usr/bin/env node
/**
 * 供桌面 RPA（wechat_rpa.py）调用的薄桥：
 *   node rpa-bridge.mjs '{"userId":"...","displayName":"...","isNewJoin":true}'
 *   echo {...} | node rpa-bridge.mjs
 *
 * 标准输出一行 JSON：{ kind, messages: string[], ... }
 * （messages 可能经 LLM 口语化；无 Key 时仍为模板文案）
 */
import { handleCommunityEvent } from './core.mjs';

async function readStdin() {
  if (process.stdin.isTTY) return '';
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

/** PowerShell / cmd 传参时可能带上外层引号或把 \" 弄乱 */
function normalizeJsonRaw(raw) {
  let s = String(raw || '').trim();
  if (!s) return '{}';
  // 去掉一层包裹引号
  if (
    (s.startsWith("'") && s.endsWith("'")) ||
    (s.startsWith('"') && s.endsWith('"') && !s.startsWith('{'))
  ) {
    s = s.slice(1, -1).trim();
  }
  // PowerShell 有时把内部双引号吃掉：{userId:t} — 无法可靠修复，交给 JSON.parse 报错
  return s || '{}';
}

const fromArg = process.argv[2];
const raw = normalizeJsonRaw(fromArg || (await readStdin()) || '{}');
let input;
try {
  input = JSON.parse(raw);
} catch (e) {
  process.stderr.write(`[rpa-bridge] invalid JSON: ${e}\ninput=${JSON.stringify(raw)}\n`);
  process.exit(1);
}

const out = await handleCommunityEvent(input);
process.stdout.write(JSON.stringify(out));
