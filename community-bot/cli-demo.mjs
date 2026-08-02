#!/usr/bin/env node
/** 不连 Discord，本地演练欢迎 / 分流 / 知识库（可走 LLM，无 Key 则模板） */
import {
  handleCommunityEvent,
  getMember,
  listMembersByIntent,
  getStorePath,
} from './core.mjs';

async function show(title, result) {
  console.log(`\n=== ${title} ===`);
  console.log('kind:', result.kind, result.intent || '', result.llm ? '(llm)' : '(template)');
  for (const m of result.messages) console.log('\n' + m);
}

await show(
  '新人进群',
  await handleCommunityEvent({
    userId: 'u_demo_1',
    displayName: '小明',
    isNewJoin: true,
  }),
);

await show(
  '小明选 1 小白学习',
  await handleCommunityEvent({
    userId: 'u_demo_1',
    displayName: '小明',
    text: '1',
  }),
);

await show(
  '创作者进群并选 2',
  await handleCommunityEvent({
    userId: 'u_demo_2',
    displayName: '阿创',
    isNewJoin: true,
  }),
);
await show(
  '阿创选接单',
  await handleCommunityEvent({ userId: 'u_demo_2', displayName: '阿创', text: '我想接单' }),
);

await show(
  '派活方选 3',
  await handleCommunityEvent({
    userId: 'u_demo_3',
    displayName: '老板',
    text: '3',
  }),
);

await show(
  '小明再问下载',
  await handleCommunityEvent({ userId: 'u_demo_1', text: '怎么下载安装？' }),
);

console.log('\n=== 知识库快照 ===');
console.log('store:', getStorePath());
console.log('beginner:', listMembersByIntent('beginner').map((m) => m.displayName));
console.log('creator:', listMembersByIntent('creator').map((m) => m.displayName));
console.log('dispatcher:', listMembersByIntent('dispatcher').map((m) => m.displayName));
console.log('小明档案:', getMember('u_demo_1'));
