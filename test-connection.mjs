/**
 * 云端链路测试 - 调用 FC run-task 验证 BLTCY 连通性
 * 运行: node test-connection.mjs
 */
import 'dotenv/config';
import { callFCChat } from './src/main/ai-provider.js';

async function main() {
  try {
    console.log('[测试] 发送消息: 测试云端链路');
    const { content, balance } = await callFCChat({
      messages: [{ role: 'user', content: '测试云端链路' }],
    });
    console.log('[成功] 回复内容:', content);
    console.log('[成功] 扣费后余额:', balance);
  } catch (err) {
    console.error('[失败] 错误详情:');
    console.error('  消息:', err?.message);
    if (err?.response) {
      console.error('  状态码:', err.response?.status);
      console.error('  响应体:', JSON.stringify(err.response?.data, null, 2));
    }
    if (err?.stack) console.error('  堆栈:', err.stack);
    process.exit(1);
  }
}

main();
