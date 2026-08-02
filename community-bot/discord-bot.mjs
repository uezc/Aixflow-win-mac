#!/usr/bin/env node
/**
 * AIXFLOW 社群 Discord 欢迎机器人
 *
 * 功能：
 * - 新人进服：欢迎 + 询问 1小白学习 / 2创作者接单 / 3任务派活
 * - 回复数字或关键词：写入知识库（data/member-intents.json），并按意图回复
 * - 再次提问：按已登记意图介绍（学习→下载课程；创作者↔派活互相介绍）
 *
 * 准备：
 * 1. Discord Developer Portal 创建 Bot，打开 Server Members Intent + Message Content Intent
 * 2. 邀请机器人进服（权限：Send Messages, Read Message History）
 * 3. 设置环境变量 DISCORD_BOT_TOKEN
 *
 * 运行：
 *   cd community-bot
 *   npm install
 *   set DISCORD_BOT_TOKEN=你的token
 *   npm start
 *
 * 本地试路由（不连 Discord）：
 *   node cli-demo.mjs
 */
import {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
} from 'discord.js';
import { handleCommunityEvent, getStorePath } from './core.mjs';

const token = String(process.env.DISCORD_BOT_TOKEN || '').trim();
if (!token) {
  console.error('[community-bot] 请设置环境变量 DISCORD_BOT_TOKEN');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.GuildMember],
});

function splitMessages(messages) {
  // Discord 单条上限约 2000 字
  const out = [];
  for (const m of messages || []) {
    const text = String(m || '');
    if (text.length <= 1900) {
      out.push(text);
      continue;
    }
    for (let i = 0; i < text.length; i += 1900) out.push(text.slice(i, i + 1900));
  }
  return out;
}

client.once(Events.ClientReady, (c) => {
  console.log(`[community-bot] 已登录：${c.user.tag}`);
  console.log(`[community-bot] 知识库成员档案：${getStorePath()}`);
});

client.on(Events.GuildMemberAdd, async (member) => {
  try {
    const result = await handleCommunityEvent({
      userId: member.id,
      displayName: member.displayName || member.user?.username || '新朋友',
      guildId: member.guild?.id,
      isNewJoin: true,
    });
    const channel =
      member.guild.systemChannel ||
      member.guild.channels.cache.find(
        (ch) => ch.isTextBased?.() && ch.permissionsFor(member.guild.members.me)?.has('SendMessages'),
      );
    if (!channel?.isTextBased?.()) {
      console.warn('[community-bot] 无可用欢迎频道');
      return;
    }
    for (const msg of splitMessages(result.messages)) {
      await channel.send({ content: `${member} ${msg}` });
    }
  } catch (err) {
    console.error('[community-bot] GuildMemberAdd 失败:', err?.message || err);
  }
});

client.on(Events.MessageCreate, async (message) => {
  try {
    if (!message.guild || message.author.bot) return;
    const content = String(message.content || '').trim();
    if (!content) return;

    // 仅响应：纯数字 1/2/3、含意图关键词、或 @ 机器人
    const mentioned = message.mentions.has(client.user);
    const result = await handleCommunityEvent({
      userId: message.author.id,
      displayName: message.member?.displayName || message.author.username,
      guildId: message.guild.id,
      text: content.replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '').trim(),
      isNewJoin: false,
    });

    if (result.kind === 'noop' && !mentioned) return;
    if (!result.messages?.length) {
      if (mentioned) {
        const ask = await handleCommunityEvent({
          userId: message.author.id,
          displayName: message.member?.displayName || message.author.username,
          text: '帮助',
        });
        for (const msg of splitMessages(ask.messages)) await message.reply(msg);
      }
      return;
    }

    for (const msg of splitMessages(result.messages)) {
      await message.reply(msg);
    }
  } catch (err) {
    console.error('[community-bot] MessageCreate 失败:', err?.message || err);
  }
});

client.login(token).catch((err) => {
  console.error('[community-bot] 登录失败:', err?.message || err);
  process.exit(1);
});
