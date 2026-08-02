/**
 * AIXFLOW 社群欢迎 / 需求分流 / 知识库核心逻辑（无平台依赖）
 *
 * 意图：
 * 1 beginner  小白学习 → 软件 / 课程 / 下载
 * 2 creator   创作者接单 → 介绍派活对接
 * 3 dispatcher 任务派活 → 介绍创作者对接
 *
 * 回复：优先用 LLM 读知识库改写为口语化中文；无 Key / 失败则回退模板。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  buildKbContext,
  generateSpokenReply,
  isStructuredTemplateMessage,
  loadCommunityEnv,
} from './llm-reply.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KB_PATH = path.join(__dirname, 'knowledge-base.json');
const STORE_PATH = path.join(__dirname, 'data', 'member-intents.json');

loadCommunityEnv();

/** @typedef {'beginner' | 'creator' | 'dispatcher'} IntentId */

/**
 * @typedef {object} MemberRecord
 * @property {string} userId
 * @property {string} [displayName]
 * @property {IntentId} [intent]
 * @property {string} [intentLabel]
 * @property {number} firstSeenAt
 * @property {number} updatedAt
 * @property {string} [guildId]
 * @property {string[]} [notes]
 */

function loadKb() {
  return JSON.parse(fs.readFileSync(KB_PATH, 'utf8'));
}

function ensureStore() {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(STORE_PATH, JSON.stringify({ members: {} }, null, 2), 'utf8');
  }
}

function readStore() {
  ensureStore();
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
  } catch {
    return { members: {} };
  }
}

function writeStore(store) {
  ensureStore();
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
}

function fillTemplate(text, product) {
  return String(text || '')
    .replaceAll('{downloadCn}', product.downloadCn)
    .replaceAll('{downloadAi}', product.downloadAi)
    .replaceAll('{recharge}', product.recharge)
    .replaceAll('{supportQq}', product.supportQq)
    .replaceAll('{wechat}', product.wechat)
    .replaceAll('{discord}', product.discord)
    .replaceAll('{bilibili}', product.bilibili);
}

/** @param {string} text */
export function detectIntent(text) {
  const kb = loadKb();
  const raw = String(text || '').trim();
  if (!raw) return null;

  if (/^[1１]$/.test(raw) || raw === '小白学习') return 'beginner';
  if (/^[2２]$/.test(raw) || raw === '创作者接单') return 'creator';
  if (/^[3３]$/.test(raw) || raw === '任务派活') return 'dispatcher';

  /** @type {IntentId[]} */
  const order = ['beginner', 'creator', 'dispatcher'];
  for (const id of order) {
    const keys = kb.intents[id].keywords || [];
    if (keys.some((k) => raw.includes(k))) return id;
  }
  return null;
}

/**
 * @param {string} userId
 * @param {{ displayName?: string, guildId?: string, intent?: IntentId, note?: string }} patch
 */
export function upsertMember(userId, patch = {}) {
  const store = readStore();
  const id = String(userId || '').trim();
  if (!id) throw new Error('userId required');
  const now = Date.now();
  const prev = store.members[id] || {
    userId: id,
    firstSeenAt: now,
    updatedAt: now,
    notes: [],
  };
  const kb = loadKb();
  /** @type {MemberRecord} */
  const next = {
    ...prev,
    displayName: patch.displayName ?? prev.displayName,
    guildId: patch.guildId ?? prev.guildId,
    updatedAt: now,
    notes: Array.isArray(prev.notes) ? [...prev.notes] : [],
  };
  if (patch.intent) {
    next.intent = patch.intent;
    next.intentLabel = kb.intents[patch.intent]?.label || patch.intent;
  }
  if (patch.note) next.notes.push(`${new Date(now).toISOString()} ${patch.note}`);
  store.members[id] = next;
  writeStore(store);
  return next;
}

export function getMember(userId) {
  const store = readStore();
  return store.members[String(userId || '').trim()] || null;
}

export function listMembersByIntent(intent) {
  const store = readStore();
  return Object.values(store.members || {}).filter((m) => m.intent === intent);
}

export function buildWelcomeMessage(displayName) {
  const kb = loadKb();
  return fillTemplate(kb.replies.welcome.zh, kb.product).replaceAll(
    '{displayName}',
    displayName || '新朋友',
  );
}

/** @param {IntentId} intent */
export function buildIntentReply(intent) {
  const kb = loadKb();
  const key = intent === 'beginner' ? 'beginner' : intent === 'creator' ? 'creator' : 'dispatcher';
  return fillTemplate(kb.replies[key].zh, kb.product);
}

export function buildAskAgainMessage() {
  const kb = loadKb();
  return kb.replies.askAgain.zh;
}

/**
 * 把会话类文案交给 LLM 口语化；填表模板原样保留。失败则原样返回。
 * @param {{ kind: string, intent?: string, displayName?: string, userText?: string, messages: string[] }} result
 */
async function polishMessagesWithLlm(result) {
  const messages = Array.isArray(result.messages) ? result.messages : [];
  if (!messages.length) return messages;
  if (!['welcome', 'intent', 'followup', 'ask'].includes(result.kind)) return messages;

  const conversational = [];
  const structured = [];
  for (const m of messages) {
    if (isStructuredTemplateMessage(m)) structured.push(m);
    else conversational.push(m);
  }
  if (!conversational.length) return messages;

  const kb = loadKb();
  const spoken = await generateSpokenReply({
    kind: result.kind,
    intent: result.intent,
    displayName: result.displayName,
    userText: result.userText,
    draft: conversational.join('\n\n'),
    kbContext: buildKbContext(kb, result.intent),
  });
  if (!spoken) return messages;
  return [spoken, ...structured];
}

/**
 * 进群或闲聊时的主路由：记录意图并返回回复文案（异步：可走 LLM）
 * @param {{ userId: string, displayName?: string, guildId?: string, text?: string, isNewJoin?: boolean }} input
 */
export async function handleCommunityEvent(input) {
  const userId = String(input.userId || '').trim();
  const displayName = input.displayName || '新朋友';
  const text = String(input.text || '').trim();
  const isNewJoin = !!input.isNewJoin;

  /** @type {{ kind: string, intent?: IntentId, messages: string[], member: MemberRecord|null, displayName?: string, userText?: string, llm?: boolean }} */
  let result;

  if (isNewJoin) {
    upsertMember(userId, {
      displayName,
      guildId: input.guildId,
      note: 'joined',
    });
    result = {
      kind: 'welcome',
      messages: [buildWelcomeMessage(displayName)],
      member: getMember(userId),
      displayName,
      userText: text,
    };
  } else {
    const intent = detectIntent(text);
    if (intent) {
      const member = upsertMember(userId, {
        displayName,
        guildId: input.guildId,
        intent,
        note: `intent:${intent} text:${text.slice(0, 80)}`,
      });
      const messages = [buildIntentReply(intent)];

      // 交叉介绍：创作者 ↔ 派活
      const kb = loadKb();
      if (intent === 'creator') {
        const dispatchers = listMembersByIntent('dispatcher').filter((m) => m.userId !== userId);
        if (dispatchers.length > 0) {
          messages.push(fillTemplate(kb.replies.matchDispatcherToCreator.zh, kb.product));
        }
        messages.push(fillTemplate(kb.replies.creatorIntroCard.zh, kb.product));
      }
      if (intent === 'dispatcher') {
        const creators = listMembersByIntent('creator').filter((m) => m.userId !== userId);
        if (creators.length > 0) {
          messages.push(
            fillTemplate(kb.replies.matchCreatorToDispatcher.zh, kb.product) +
              `\n当前可对接创作者约 ${creators.length} 位（已登记接单意向）。`,
          );
        }
      }

      result = { kind: 'intent', intent, messages, member, displayName, userText: text };
    } else {
      // 已有档案：相关问题走档案回复
      const existing = getMember(userId);
      if (existing?.intent && text) {
        const maybeRelated =
          detectIntent(text) ||
          /下载|教程|课程|接单|派单|派活|学习|软件/.test(text);
        if (maybeRelated) {
          result = {
            kind: 'followup',
            intent: existing.intent,
            messages: [buildIntentReply(existing.intent)],
            member: existing,
            displayName,
            userText: text,
          };
        }
      }

      if (!result && text && /你好|在吗|请问|怎么|如何|帮助|help/i.test(text)) {
        result = {
          kind: 'ask',
          messages: [buildAskAgainMessage()],
          member: existing,
          displayName,
          userText: text,
        };
      }

      if (!result) {
        return { kind: 'noop', messages: [], member: existing || getMember(userId) };
      }
    }
  }

  const before = result.messages.join('\n');
  result.messages = await polishMessagesWithLlm(result);
  result.llm = result.messages.join('\n') !== before;
  delete result.displayName;
  delete result.userText;
  return result;
}

export function getKnowledgeBase() {
  return loadKb();
}

export function getStorePath() {
  return STORE_PATH;
}
