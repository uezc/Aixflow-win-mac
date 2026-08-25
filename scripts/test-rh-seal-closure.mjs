/**
 * RH 封口媒体闭环自测（纯逻辑，不启动 Electron / 不访问 FC）
 * 用法：npm run test:rh-seal
 */

const seal = {
  silentAudio: 'openapi/nexflow-seal-silent.mp3',
  blankImage: 'openapi/nexflow-seal-blank.jpg',
};

const RH_SEAL_UPLOAD_LOG = '[RH seal] 封口媒体已上传';

function pickRhAudioDemoNodes(liveNodes) {
  const nodes = Array.isArray(liveNodes) ? liveNodes : [];
  const audioNodes = nodes.filter(
    (n) =>
      String(n.fieldName || '').toLowerCase() === 'audio' ||
      /参考音|参考音频|音频/i.test(String(n.description || '')) ||
      /audio/i.test(String(n.nodeName || '')),
  );
  const seen = new Set();
  const out = [];
  for (const n of audioNodes) {
    const k = `${n.nodeId}:${n.fieldName}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(n);
  }
  return out;
}

function collectRhDemoMediaValues(liveNodes) {
  const out = new Set();
  for (const n of liveNodes || []) {
    const fn = String(n.fieldName || '').toLowerCase();
    const desc = String(n.description || n.nodeName || '');
    const isMedia =
      fn === 'image' ||
      fn === 'audio' ||
      /参考图|参考音|参考音频|上传图像|image/i.test(desc) ||
      /参考音|音频|audio/i.test(desc);
    if (!isMedia) continue;
    const v = String(n.fieldValue || '').trim();
    if (v) out.add(v);
  }
  return out;
}

function assertRhNodeInfoListNoDemoLeak(list, liveNodes) {
  const demo = collectRhDemoMediaValues(liveNodes);
  if (!demo.size) return;
  for (const n of list) {
    const v = String(n.fieldValue || '').trim();
    if (!v || !demo.has(v)) continue;
    const label = n.description || `${n.nodeId}/${n.fieldName}`;
    throw new Error(
      `提交拦截：${label} 仍使用 RunningHub API 演示素材，请重试；若反复出现请清理 RH 工作流节点默认文件`,
    );
  }
}

function applyRhWorkflowMediaSeal(list, liveNodes, sealFields, userImages, userAudios) {
  const nodes = Array.isArray(liveNodes) ? liveNodes : [];
  if (!nodes.length) return;
  const imageDemoNodes = nodes.filter((n) => n.fieldName === 'image');
  const audioDemoNodes = pickRhAudioDemoNodes(nodes);
  if (!imageDemoNodes.length && !audioDemoNodes.length) return;

  const base = list.filter((n) => n.fieldName !== 'image' && n.fieldName !== 'audio');
  list.length = 0;
  list.push(...base);

  const imgs = userImages.map((u) => String(u || '').trim()).filter(Boolean);
  const auds = userAudios.map((u) => String(u || '').trim()).filter(Boolean);
  const anchorImg = imgs[0] || sealFields.blankImage;
  const anchorAud = auds[0] || sealFields.silentAudio;

  imageDemoNodes.forEach((demo, idx) => {
    list.push({
      nodeId: String(demo.nodeId),
      fieldName: 'image',
      fieldValue: imgs[idx] || anchorImg,
      description: demo.description || `image${idx + 1}`,
    });
  });

  audioDemoNodes.forEach((demo, idx) => {
    list.push({
      nodeId: String(demo.nodeId),
      fieldName: String(demo.fieldName || 'audio'),
      fieldValue: auds[idx] || anchorAud,
      description: demo.description || `参考音${idx + 1}`,
    });
  });
}

function sealFallbackImageSlots(list, imageFields, slots, sealFields) {
  const imgs = imageFields.map((u) => String(u || '').trim()).filter(Boolean);
  const anchor = imgs[0] || sealFields.blankImage;
  slots.forEach((slot, idx) => {
    list.push({
      nodeId: slot.nodeId,
      fieldName: 'image',
      fieldValue: imgs[idx] || anchor,
      description: slot.description,
    });
  });
}

function sealFallbackAudioSlots(list, audioFields, slots, sealFields) {
  const auds = audioFields.map((u) => String(u || '').trim()).filter(Boolean);
  const anchor = auds[0] || sealFields.silentAudio;
  slots.forEach((slot, idx) => {
    list.push({
      nodeId: slot.nodeId,
      fieldName: 'audio',
      fieldValue: auds[idx] || anchor,
      description: slot.description,
    });
  });
}

function buildMinimaxH3MultiNodeInfoListFallback(imageFields, audioFields, sealFields) {
  const list = [
    { nodeId: '25', fieldName: 'value', fieldValue: 'prompt', description: '提示词' },
    { nodeId: '28', fieldName: 'value', fieldValue: '6', description: '时长' },
  ];
  const IMAGE_SLOTS = [
    { nodeId: '18', description: 'image1' },
    { nodeId: '23', description: 'image2' },
    { nodeId: '22', description: 'image3' },
    { nodeId: '24', description: 'image4' },
    { nodeId: '32', description: 'image5' },
    { nodeId: '33', description: 'image6' },
    { nodeId: '34', description: 'image7' },
    { nodeId: '35', description: 'image8' },
    { nodeId: '76', description: 'image9' },
  ];
  sealFallbackImageSlots(list, imageFields, IMAGE_SLOTS, sealFields);
  const audios = (Array.isArray(audioFields) ? audioFields : audioFields ? [audioFields] : [])
    .map((u) => String(u || '').trim())
    .filter(Boolean)
    .slice(0, 3);
  const AUDIO_FALLBACK = [
    { nodeId: '38', description: '参考音1' },
    { nodeId: '67', description: '参考音2' },
    { nodeId: '68', description: '参考音3' },
  ];
  sealFallbackAudioSlots(list, audios, AUDIO_FALLBACK, sealFields);
  return list;
}

/** 模拟 rhSealMedia 会话缓存（与主进程逻辑一致） */
function createRhSealMediaMock() {
  let cached = null;
  let inflight = null;
  let uploadRounds = 0;
  let binaryUploadCount = 0;
  let logPrinted = false;
  const logs = [];

  async function getBundle() {
    if (cached) return cached;
    if (inflight) return inflight;
    inflight = (async () => {
      uploadRounds += 1;
      binaryUploadCount += 2;
      cached = {
        silentAudio: 'openapi/nexflow-mock-seal-silent.mp3',
        blankImage: 'openapi/nexflow-mock-seal-blank.jpg',
      };
      if (!logPrinted) {
        logs.push(RH_SEAL_UPLOAD_LOG);
        logPrinted = true;
      }
      return cached;
    })();
    try {
      return await inflight;
    } finally {
      inflight = null;
    }
  }

  return {
    getBundle,
    getMonitor: () => ({
      cached: cached !== null,
      uploadInFlight: inflight !== null,
      uploadRounds,
      binaryUploadCount,
      logPrinted,
    }),
    getLogs: () => [...logs],
    reset: () => {
      cached = null;
      inflight = null;
      uploadRounds = 0;
      binaryUploadCount = 0;
      logPrinted = false;
      logs.length = 0;
    },
  };
}

const demoLiveNodes = [
  { nodeId: '137', fieldName: 'image', fieldValue: 'openapi/xxxxdemo.jpg', description: 'image1' },
  { nodeId: '182', fieldName: 'image', fieldValue: 'openapi/yyyydemo.jpg', description: 'image2' },
  { nodeId: '171', fieldName: 'audio', fieldValue: 'openapi/aaaademo.mp3', description: '参考音' },
];

const multiAudioDemoNodes = [
  { nodeId: '38', fieldName: 'audio', fieldValue: 'openapi/demo-a1.mp3', description: '参考音1' },
  { nodeId: '67', fieldName: 'audio', fieldValue: 'openapi/demo-a2.mp3', description: '参考音2' },
  { nodeId: '68', fieldName: 'audio', fieldValue: 'openapi/demo-a3.mp3', description: '参考音3' },
];

let passed = 0;
let failed = 0;

function ok(name, cond, detail = '') {
  if (cond) {
    console.log(`  ✓ ${name}`);
    passed += 1;
  } else {
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
    failed += 1;
  }
}

function expectThrow(name, fn, includes) {
  try {
    fn();
    ok(name, false, '应抛出但未抛出');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    ok(name, includes ? msg.includes(includes) : true, msg);
  }
}

console.log('=== RH 封口闭环测试（纯逻辑）===\n');

console.log('【测试 1】空白槽位 → 灰图 + 静音');
{
  const list = [{ nodeId: '138', fieldName: 'value', fieldValue: 'prompt', description: '提示词' }];
  applyRhWorkflowMediaSeal(list, demoLiveNodes, seal, [], []);
  const images = list.filter((n) => n.fieldName === 'image');
  const audios = list.filter((n) => n.fieldName === 'audio');
  ok('image 槽全部写入', images.length === 2);
  ok('audio 槽写入', audios.length === 1);
  ok('空图槽为灰图', images.every((n) => n.fieldValue === seal.blankImage));
  ok('空音槽为静音', audios.every((n) => n.fieldValue === seal.silentAudio));
  ok('不含 RH 演示 path', !list.some((n) => /demo\.(jpg|mp3)/i.test(n.fieldValue)));
  try {
    assertRhNodeInfoListNoDemoLeak(list, demoLiveNodes);
    ok('提交前断言通过', true);
  } catch (e) {
    ok('提交前断言通过', false, String(e));
  }
}

console.log('\n【测试 2】演示 path 拦截');
{
  const bad = [
    { nodeId: '137', fieldName: 'image', fieldValue: 'openapi/xxxxdemo.jpg', description: 'image1' },
  ];
  expectThrow('含 demo path 被拦截', () => assertRhNodeInfoListNoDemoLeak(bad, demoLiveNodes), '提交拦截');
  const good = [
    { nodeId: '137', fieldName: 'image', fieldValue: seal.blankImage, description: 'image1' },
  ];
  try {
    assertRhNodeInfoListNoDemoLeak(good, demoLiveNodes);
    ok('封口 path 可提交', true);
  } catch (e) {
    ok('封口 path 可提交', false, String(e));
  }
}

console.log('\n【测试 3】H3 Multi 无对白 → 3 路静音');
{
  const fb = buildMinimaxH3MultiNodeInfoListFallback([], [], seal);
  const audios = fb.filter((n) => n.fieldName === 'audio');
  const images = fb.filter((n) => n.fieldName === 'image');
  ok('3 路 audio', audios.length === 3);
  ok('全部为静音', audios.every((n) => n.fieldValue === seal.silentAudio));
  ok('9 路 image 灰图封口', images.length === 9 && images.every((n) => n.fieldValue === seal.blankImage));

  const list = [
    { nodeId: '25', fieldName: 'value', fieldValue: 'p', description: '提示词' },
  ];
  applyRhWorkflowMediaSeal(list, multiAudioDemoNodes, seal, [], []);
  const liveAudios = list.filter((n) => n.fieldName === 'audio');
  ok('liveNodes 3 路静音', liveAudios.length === 3 && liveAudios.every((n) => n.fieldValue === seal.silentAudio));
}

console.log('\n【测试 4】RH 状态监控 / 单次上传');
{
  const mock = createRhSealMediaMock();
  const b1 = await mock.getBundle();
  const b2 = await mock.getBundle();
  const mon = mock.getMonitor();
  ok('两次调用返回同一 bundle', b1.silentAudio === b2.silentAudio);
  ok('uploadRounds === 1', mon.uploadRounds === 1, `实际 ${mon.uploadRounds}`);
  ok('binaryUploadCount === 2', mon.binaryUploadCount === 2, `实际 ${mon.binaryUploadCount}`);
  ok('cached === true', mon.cached === true);
  ok('logPrinted === true', mon.logPrinted === true);
  ok('控制台仅 1 条封口日志', mock.getLogs().length === 1, `实际 ${mock.getLogs().length} 条`);
}

console.log(`\n=== 结果：${passed} 通过，${failed} 失败 ===\n`);

if (failed > 0) process.exit(1);

console.log('--- 真机 E2E（npm run electron:dev）---');
console.log('主进程终端 / DevTools Console 搜索：');
console.log(`  • ${RH_SEAL_UPLOAD_LOG}  → 仅首次 H3 任务出现 1 次`);
console.log('  • [MiniMax-H3 *] 提交 nodeInfoList=  → 确认 image/audio 为 openapi/… 非 demo');
console.log('  • 提交拦截  → 若 fieldValue 仍为演示 path 会报错不提交');
console.log('');
console.log('调试计数（主进程 DevTools 执行，需先完成一次 H3）：');
console.log('  import { getRhSealMediaMonitor } from "./utils/rhSealMedia.js"');
console.log('  getRhSealMediaMonitor()  → uploadRounds:1, binaryUploadCount:2, logPrinted:true\n');
