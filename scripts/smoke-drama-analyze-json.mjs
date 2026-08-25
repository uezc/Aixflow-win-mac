/**
 * 冒烟：剧本分析 JSON 解析/截断修复（与 normalizeAnalyze 策略对齐）
 * 用法：node scripts/smoke-drama-analyze-json.mjs
 */

function isObj(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function stripMarkdownFences(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  s = s.replace(/^\uFEFF/, '').replace(/[\u200B-\u200D\uFEFF]/g, '');
  const fenceRe = /```(?:json|JSON)?\s*([\s\S]*?)```/g;
  const blocks = [];
  let m;
  while ((m = fenceRe.exec(s))) {
    const body = String(m[1] || '').trim();
    if (body) blocks.push(body);
  }
  if (blocks.length) {
    const withJson = blocks.find((b) => b.includes('{'));
    return (withJson || blocks[blocks.length - 1] || s).trim();
  }
  return s.replace(/^```(?:json|JSON)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

function scanJsonStructure(s) {
  const stack = [];
  let inString = false;
  let escape = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') stack.push('{');
    else if (ch === '[') stack.push('[');
    else if (ch === '}') {
      if (stack[stack.length - 1] === '{') stack.pop();
    } else if (ch === ']') {
      if (stack[stack.length - 1] === '[') stack.pop();
    }
  }
  return { stack, inString };
}

function lastStructuralCommaIndex(s) {
  let inString = false;
  let escape = false;
  let last = -1;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === ',') last = i;
  }
  return last;
}

function closeJsonFragment(fragment) {
  let s = fragment;
  const { stack, inString } = scanJsonStructure(s);
  if (inString) s += '"';
  s = s.replace(/,\s*$/, '');
  s = s.replace(/,\s*"[^"]*"\s*:\s*$/, '');
  s = s.replace(/:\s*$/, ':null');
  s = s.replace(/,\s*$/, '');
  const rest = [...stack];
  while (rest.length) {
    const open = rest.pop();
    s += open === '{' ? '}' : ']';
  }
  return s.replace(/,\s*([}\]])/g, '$1');
}

function repairTruncatedJsonObject(text) {
  let s = stripMarkdownFences(text);
  const start = s.indexOf('{');
  if (start < 0) return null;
  s = s.slice(start);
  for (let attempt = 0; attempt < 48; attempt++) {
    try {
      const p = JSON.parse(closeJsonFragment(s));
      if (isObj(p)) return p;
    } catch {
      /* trim */
    }
    const comma = lastStructuralCommaIndex(s);
    if (comma < 0) break;
    s = s.slice(0, comma);
  }
  return null;
}

function extractJsonObject(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const candidate = stripMarkdownFences(raw);
  try {
    const p = JSON.parse(candidate);
    if (isObj(p)) return p;
  } catch {
    /* continue */
  }
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const p = JSON.parse(candidate.slice(start, end + 1));
      if (isObj(p)) return p;
    } catch {
      /* continue */
    }
  }
  return repairTruncatedJsonObject(candidate);
}

const cases = [
  {
    name: 'markdown fence',
    input: '说明如下：\n```json\n{"schemaVersion":"director-domain.v2","characters":[{"name":"晨曦"}],"scene_beats":[{"scene_no":"1"}],"shots":[]}\n```\n完',
    expectNames: ['晨曦'],
  },
  {
    name: 'trailing comma',
    input: '{"characters":[{"name":"阿强"},], "scene_beats":[{"scene_no":"1"},], "shots":[],}',
    expectNames: ['阿强'],
    soft: true,
  },
  {
    name: 'truncated mid-array',
    input:
      '{"schemaVersion":"director-domain.v2","characters":[{"name":"晨曦"},{"name":"说书人","prompt":"一位年迈',
    expectNames: ['晨曦'],
  },
  {
    name: 'truncated mid-key',
    input:
      '{"characters":[{"name":"甲"}],"scene_beats":[{"scene_no":"1"}],"sho',
    expectNames: ['甲'],
  },
];

let failed = 0;
for (const c of cases) {
  let parsed = extractJsonObject(c.input);
  // 尾逗号：本脚本未做 repairJsonCandidate，允许 soft 跳过或先手工修
  if (!parsed && c.soft) {
    const fixed = c.input.replace(/,\s*([}\]])/g, '$1');
    parsed = extractJsonObject(fixed);
  }
  const names = Array.isArray(parsed?.characters)
    ? parsed.characters.map((x) => x?.name).filter(Boolean)
    : [];
  const ok =
    !!parsed &&
    c.expectNames.every((n) => names.includes(n)) &&
    (Array.isArray(parsed.scene_beats) ? true : names.length > 0);
  if (!ok) {
    failed += 1;
    console.error(`FAIL ${c.name}`, { names, keys: parsed && Object.keys(parsed) });
  } else {
    console.log(`OK   ${c.name} → ${names.join(',')}`);
  }
}

if (failed) {
  console.error(`\n${failed} case(s) failed`);
  process.exit(1);
}
console.log('\nall smoke cases passed');
