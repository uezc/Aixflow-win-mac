/**
 * 社群回复口语化：用 LLM 读知识库片段，把模板草稿改写成自然中文。
 * 无 Key / 调用失败时返回 null，由 core 回退模板。
 *
 * 支持（OpenAI 兼容 Chat Completions）：
 * - Ollama：OLLAMA_BASE_URL / LLM_BASE_URL（默认 http://127.0.0.1:11434/v1）
 * - OpenAI：OPENAI_API_KEY + 可选 OPENAI_BASE_URL
 * - 阿里云 DashScope 兼容模式：DASHSCOPE_API_KEY
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let envLoaded = false;

/** 轻量加载 community-bot/.env（不覆盖已有 process.env） */
export function loadCommunityEnv() {
  if (envLoaded) return;
  envLoaded = true;
  const p = path.join(__dirname, '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = val;
  }
}

/**
 * 仅在显式配置时启用，避免无 Key 时误连本机 Ollama 拖慢 RPA。
 * 启用方式任选：DASHSCOPE_API_KEY / OPENAI_API_KEY / LLM_PROVIDER=ollama /
 * OLLAMA_BASE_URL / COMMUNITY_LLM_ENABLED=1
 *
 * @returns {{ baseUrl: string, apiKey: string, model: string, provider: string } | null}
 */
export function resolveLlmConfig() {
  loadCommunityEnv();
  if (/^(0|false|off|no)$/i.test(String(process.env.COMMUNITY_LLM_ENABLED || '').trim())) {
    return null;
  }

  const dashKey = String(process.env.DASHSCOPE_API_KEY || '').trim();
  const openKey = String(process.env.OPENAI_API_KEY || process.env.LLM_API_KEY || '').trim();
  const ollamaUrl = String(process.env.OLLAMA_BASE_URL || '').trim();
  const llmBase = String(process.env.LLM_BASE_URL || '').trim();
  const explicitProvider = String(process.env.LLM_PROVIDER || '').trim().toLowerCase();
  const forceOn = /^(1|true|on|yes)$/i.test(
    String(process.env.COMMUNITY_LLM_ENABLED || '').trim(),
  );

  const wantOllama =
    explicitProvider === 'ollama' ||
    !!ollamaUrl ||
    (forceOn && !dashKey && !openKey && explicitProvider !== 'openai' && explicitProvider !== 'dashscope');

  if (wantOllama) {
    const base = (ollamaUrl || llmBase || 'http://127.0.0.1:11434/v1').replace(/\/$/, '');
    return {
      provider: 'ollama',
      baseUrl: base,
      apiKey: String(process.env.OLLAMA_API_KEY || 'ollama').trim() || 'ollama',
      model: String(process.env.OLLAMA_MODEL || process.env.LLM_MODEL || 'qwen2.5:7b').trim(),
    };
  }

  if (explicitProvider === 'dashscope' || (dashKey && explicitProvider !== 'openai')) {
    if (!dashKey) return null;
    return {
      provider: 'dashscope',
      baseUrl: String(
        process.env.DASHSCOPE_BASE_URL ||
          'https://dashscope.aliyuncs.com/compatible-mode/v1',
      )
        .trim()
        .replace(/\/$/, ''),
      apiKey: dashKey,
      model: String(process.env.DASHSCOPE_MODEL || process.env.LLM_MODEL || 'qwen-plus').trim(),
    };
  }

  if (openKey || explicitProvider === 'openai') {
    if (!openKey) return null;
    return {
      provider: 'openai',
      baseUrl: String(process.env.OPENAI_BASE_URL || llmBase || 'https://api.openai.com/v1')
        .trim()
        .replace(/\/$/, ''),
      apiKey: openKey,
      model: String(process.env.OPENAI_MODEL || process.env.LLM_MODEL || 'gpt-4o-mini').trim(),
    };
  }

  return null;
}

export function isLlmConfigured() {
  return !!resolveLlmConfig();
}

/**
 * 从 KB 抽出给模型的上下文（不破坏原有字段）
 * @param {object} kb
 * @param {string} [intent]
 */
export function buildKbContext(kb, intent) {
  const product = kb?.product || {};
  const lines = [];
  lines.push(`产品：${product.name || 'AIXFLOW'} — ${product.tagline || ''}`);
  lines.push(`国内下载：${product.downloadCn || ''}`);
  lines.push(`海外下载：${product.downloadAi || ''}`);
  lines.push(`充值：${product.recharge || ''}`);
  lines.push(`QQ客服：${product.supportQq || ''}；微信：${product.wechat || ''}`);
  lines.push(`Discord：${product.discord || ''}；B站：${product.bilibili || ''}`);

  const docs = Array.isArray(kb?.docs) ? kb.docs : [];
  for (const d of docs) {
    if (!d) continue;
    const title = d.title || d.id || '';
    const text = d.text || d.content || '';
    if (title || text) lines.push(`【文档】${title}\n${text}`);
  }

  const faqs = Array.isArray(kb?.faqs) ? kb.faqs : [];
  for (const f of faqs) {
    if (!f?.q) continue;
    lines.push(`【FAQ】Q: ${f.q}\nA: ${f.a || ''}`);
  }

  if (intent && kb?.intents?.[intent]) {
    const it = kb.intents[intent];
    lines.push(`当前用户意图：${it.label || intent}（${it.roleHint || ''}）`);
    const replyKey = intent;
    const tip = kb.replies?.[replyKey]?.zh;
    if (tip) lines.push(`【该意图要点参考】\n${tip}`);
  }

  return lines.join('\n\n').slice(0, 6000);
}

const SYSTEM_PROMPT = `你是 AIXFLOW 社群的真人客服助手，在微信群里说话。

硬性要求：
1. 用正常口语化中文回复，简洁自然，像真人客服，不要机械罗列、不要像说明书粘贴。
2. 不要用「1. 2. 3.」大段条目堆砌；最多两三段，每段一两句。
3. 可按用户意图挑重点（下载/课程/接单对接/派活模板等），别把无关信息全倒出来。
4. 链接、QQ、微信号等关键信息必须保留准确，可自然嵌入句子里。
5. 不要用 Markdown 加粗/标题（微信群不友好）；可用换行。
6. 只输出要发给用户的正文，不要前言、不要「好的我来帮你改写」之类元话语。
7. 控制在 280 字以内（欢迎语可稍长到 350 字）。`;

/**
 * @param {{
 *   kind: string,
 *   intent?: string,
 *   displayName?: string,
 *   userText?: string,
 *   draft: string,
 *   kbContext: string,
 * }} opts
 * @returns {Promise<string|null>}
 */
export async function generateSpokenReply(opts) {
  const cfg = resolveLlmConfig();
  if (!cfg) return null;

  const kindHint =
    opts.kind === 'welcome'
      ? '场景：新人进群欢迎，引导回复 1/2/3 选需求。'
      : opts.kind === 'intent'
        ? `场景：用户刚选定意图「${opts.intent || ''}」。`
        : opts.kind === 'followup'
          ? `场景：已有档案用户追问，意图「${opts.intent || ''}」。`
          : opts.kind === 'ask'
            ? '场景：用户在问怎么帮忙，引导选 1/2/3。'
            : `场景：${opts.kind}`;

  const userPrompt = [
    kindHint,
    opts.displayName ? `对方昵称：${opts.displayName}` : '',
    opts.userText ? `用户刚说：${opts.userText}` : '',
    '',
    '—— 知识库摘录 ——',
    opts.kbContext || '（无）',
    '',
    '—— 模板草稿（可改写，勿照抄条目结构）——',
    opts.draft || '',
  ]
    .filter(Boolean)
    .join('\n');

  const url = `${cfg.baseUrl}/chat/completions`;
  const controller = new AbortController();
  const timeoutMs = Number(process.env.COMMUNITY_LLM_TIMEOUT_MS || 12000);
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0.7,
        max_tokens: 500,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.warn(`[llm-reply] ${cfg.provider} HTTP ${res.status}: ${errText.slice(0, 200)}`);
      return null;
    }
    const data = await res.json();
    const text = String(data?.choices?.[0]?.message?.content || '').trim();
    if (!text || text.length < 8) return null;
    // 去掉偶发的包裹引号
    return text.replace(/^["「]|["」]$/g, '').trim();
  } catch (e) {
    console.warn(`[llm-reply] ${cfg.provider} 失败:`, e?.message || e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 结构化填表类文案不口语化，原样保留 */
export function isStructuredTemplateMessage(text) {
  const s = String(text || '');
  return (
    s.includes('【创作者简介模板】') ||
    s.includes('【派活】') ||
    /^【.+模板】/.test(s.trim())
  );
}
