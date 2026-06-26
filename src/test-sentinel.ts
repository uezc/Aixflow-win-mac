import { writeOssObject } from './services/ossService.js';
import { writeOts } from './services/otsService.js';

async function runChaosTest() {
  console.log('--- 疫苗测试开始：模拟非法写入北京 ---');

  // 1. 测试 OSS 写入拦截
  try {
    console.log('尝试向北京写入 OSS...');
    await writeOssObject('be', async () => {}, { key: 'test.txt', body: 'chaos' });
    console.error('❌ 失败：Sentinel 未拦截 OSS 写入！');
  } catch (e: any) {
    console.log(`✅ 成功：捕获到 Sentinel 拦截 (OSS): ${e.message}`);
  }

  // 2. 测试 OTS 写入拦截
  try {
    console.log('尝试向北京写入 OTS...');
    await writeOts('be', async () => {});
    console.error('❌ 失败：Sentinel 未拦截 OTS 写入！');
  } catch (e: any) {
    console.log(`✅ 成功：捕获到 Sentinel 拦截 (OTS): ${e.message}`);
  }
}

runChaosTest().catch(console.error);
