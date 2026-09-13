/**
 * 原文保真分析自检（《峡谷之巅》节选）。
 * 运行：npx tsx src/shared/directorDomain/originalScript.selftest.ts
 */
import { analyzeDramaEpisodeOriginal, shotSuggestionsFromDurationSplit } from './originalScript.js';
import { parseDramaH3CraftTag } from './prompts/h3VideoCraftHandbook.js';
import { extractCharacterNamesFromScriptText, isDramaNonCastLabel, isDramaSpeechAttributionLead, } from './extractCastFromScript.js';
import { applyDramaScriptDesign } from './scriptDesign.js';
import { collectSeriesCharacterAppearanceOrder, sortDramaCharactersByAppearanceOrder, } from './ensureAppearingCharacters.js';
import { createEmptyDramaEpisodeBible } from './episodeBible.js';
import { createEmptyDramaCharacter, createEmptyDramaSceneAsset, createEmptyDramaSession, createEmptyDramaVoice, } from './factories.js';
const CANYON_EP1 = `## 1. 内景 电竞直播间 - 夜

江澈掏出手机看了一眼。

江澈
（慵懒）
家人们，这把打完就下播了啊。明天冲峡谷之巅第一，目前差三百分。

【弹幕浮字：澈神今天又杀疯了！／全能王名不虚传！／给别人留点活路吧！】

【系统提示音（机械女声，脑海中响起）】
叮——峡谷商城系统激活完毕。

江澈
我操——

切至：

## 2. 外景 云霄峰山门外 - 晨

江澈走向云霄峰。

江澈走两步回头。

江澈
对了老爷子，这地方哪里能充电？

赵铁柱
小子你谁啊。

苏挽月
江澈，你来了。

长老
开门。

执事长老
山门已开。

【快速蒙太奇：每一次都是从草丛跃出，Q技能利爪刺穿喉咙，一击必杀，拖走尸体。】
`;
function char(id, name, voiceId) {
    return createEmptyDramaCharacter({
        character_id: id,
        name,
        voice_id: voiceId || '',
        imageUrl: name.includes('江澈') ? 'character_001.png' : '',
    });
}
function scene(id, name) {
    return createEmptyDramaSceneAsset({
        scene_id: id,
        name,
        location: name,
        imageUrl: 'scene.png',
    });
}
function voice(id, characterId, label) {
    return createEmptyDramaVoice({
        voice_id: id,
        character_id: characterId,
        timbre: label,
        voiceStyle: label,
        sample_text: label,
    });
}
export function runOriginalScriptSelfTest() {
    const errors = [];
    const result = analyzeDramaEpisodeOriginal({
        source: CANYON_EP1,
        episodeId: 'ep1',
        characters: [
            char('char_001', '江澈_男主', 'voice_003'),
            char('char_002', '苏挽月', 'voice_005'),
            char('char_003', '执事长老'),
            char('char_004', '长老甲'),
            char('char_005', '长老乙'),
        ],
        scenes: [scene('scene_001', '电竞直播间'), scene('scene_002', '云霄峰山门外')],
        voices: [
            voice('voice_003', 'char_001', '男声-年轻-慵懒'),
            voice('voice_005', 'char_002', '女声'),
            voice('voice_system_001', '', '机械女声 系统提示音'),
        ],
    });
    const texts = result.original_segments.map((s) => s.original_text).join('\n');
    const byType = (t) => result.original_segments.filter((s) => s.type === t);
    if (result.original_scenes.length !== 2)
        errors.push(`场景数应为 2，实际 ${result.original_scenes.length}`);
    if (result.original_scenes[0]?.location !== '电竞直播间')
        errors.push('S01 location 应为 电竞直播间');
    if (result.original_scenes[0]?.time !== '夜')
        errors.push('S01 time 应为 夜');
    if (result.original_scenes[1]?.location !== '云霄峰山门外')
        errors.push('S02 location 应为 云霄峰山门外');
    if (!texts.includes('我操——'))
        errors.push('对白丢失：我操——');
    if (texts.includes('我操——') && !byType('dialogue').some((s) => s.original_text.includes('我操——'))) {
        errors.push('我操—— 未进入 dialogue 片段');
    }
    if (!texts.includes('江澈掏出手机看了一眼。'))
        errors.push('动作丢失：掏出手机');
    if (!byType('action').some((s) => s.original_text.includes('江澈走两步回头。'))) {
        errors.push('动作与对白未分开：走两步回头');
    }
    if (!byType('dialogue').some((s) => s.original_text.includes('对了老爷子，这地方哪里能充电？'))) {
        errors.push('对白丢失：哪里能充电');
    }
    const montage = byType('montage')[0];
    if (!montage?.original_text.includes('【快速蒙太奇：每一次都是从草丛跃出')) {
        errors.push('蒙太奇未完整保存');
    }
    const system = byType('system')[0];
    if (!system?.original_text.includes('【系统提示音（机械女声，脑海中响起）】')) {
        errors.push('系统提示音原文丢失');
    }
    if (!system?.original_text.includes('叮——峡谷商城系统激活完毕。')) {
        errors.push('系统提示音正文丢失');
    }
    if (!byType('screen_text').some((s) => s.original_text.includes('【弹幕浮字：'))) {
        errors.push('弹幕未保留');
    }
    if (!byType('transition').some((s) => s.original_text.includes('切至'))) {
        errors.push('转场未保留');
    }
    if (!result.original_segments.some((s) => String(s.performance || '').includes('慵懒') ||
        String(s.original_text || '').includes('慵懒'))) {
        errors.push('表演提示（慵懒）丢失');
    }
    const names = result.character_bindings.map((b) => b.original_name);
    if (!names.includes('江澈'))
        errors.push('未识别人物：江澈');
    for (const n of ['苏挽月', '赵铁柱', '执事长老', '长老']) {
        if (names.includes(n))
            errors.push(`只出现一次的配角不应进素材：${n}`);
    }
    const jiang = result.character_bindings.find((b) => b.original_name === '江澈');
    if (jiang?.status !== 'MATCHED' || jiang.character_id !== 'char_001') {
        errors.push(`江澈 应 MATCHED char_001，实际 ${jiang?.status} ${jiang?.character_id}`);
    }
    if (jiang?.asset_name === '江澈')
        errors.push('绑定不得把原文名改成资产名；原文应保持 江澈');
    if (result.character_bindings.some((b) => b.original_name === '赵铁柱' || b.original_name === '长老')) {
        errors.push('一次过场的赵铁柱/长老不应进入人物绑定');
    }
    const sysVoice = result.voice_bindings.find((b) => b.original_name.includes('系统'));
    if (sysVoice?.status !== 'MATCHED' || sysVoice.voice_id !== 'voice_system_001') {
        errors.push(`系统声音应 MATCHED voice_system_001，实际 ${sysVoice?.status} ${sysVoice?.voice_id}`);
    }
    const live = result.scene_bindings.find((b) => b.original_location === '电竞直播间');
    if (live?.status !== 'MATCHED')
        errors.push(`电竞直播间 应 MATCHED，实际 ${live?.status}`);
    for (const ev of result.visual_events) {
        if (!ev.source_segment_ids?.length)
            errors.push(`VE ${ev.event_id} 缺少 source_segment_ids`);
        if (ev.see && ev.see.endsWith('…') && ev.original_text && ev.see !== ev.original_text) {
            errors.push(`VE ${ev.event_id} 仍在截断 see`);
        }
    }
    if (!result.integrity.ok) {
        errors.push(`完整性校验失败：${result.integrity.notes.join('；')} 样例=${result.integrity.missing_samples.join('/')}`);
    }
    if (!result.shot_suggestions.length) {
        errors.push('分镜表不应为空');
    }
    if (!result.shot_suggestions.some((s) => String(s.action || '').includes('我操——'))) {
        errors.push('原文未写入分镜表：我操——');
    }
    if (!result.shot_suggestions.some((s) => String(s.action || '').includes('江澈走两步回头。'))) {
        errors.push('原文未写入分镜表：走两步回头');
    }
    if (!result.shot_suggestions.some((s) => /家人们|我操/.test(String(s.dialogue || '')))) {
        errors.push('分镜表应对白列写入台词');
    }
    if (result.shot_suggestions.some((s) => s.size || s.move)) {
        errors.push('分析写入的分镜不应填写景别/运镜');
    }
    if (!result.shot_suggestions.some((s) => s.scene.includes('电竞直播间'))) {
        errors.push('分镜场次应带「电竞直播间」标题');
    }
    if (!result.shot_suggestions.some((s) => s.scene.includes('云霄峰山门外'))) {
        errors.push('分镜场次应带「云霄峰山门外」标题');
    }
    // 分析阶段落 H3 档（6/10/15），duration_why 可含「→ N秒档」
    if (result.shot_suggestions.some((s) => !(Number(s.duration_sec) > 0))) {
        errors.push('分镜时长应为正秒数');
    }
    if (result.shot_suggestions.some((s) => ![6, 10, 15].includes(Number(s.duration_sec)))) {
        errors.push(`分析分镜时长应落 6/10/15，实际 ${result.shot_suggestions.map((s) => s.duration_sec).join(',')}`);
    }
    const designed = applyDramaScriptDesign(createEmptyDramaSession({
        active_episode_id: 'ep1',
        bible: {
            characters: [
                char('char_001', '江澈', 'voice_003'),
                char('char_002', '苏挽月', 'voice_005'),
            ],
            scenes: [scene('scene_001', '电竞直播间'), scene('scene_002', '云霄峰山门外')],
            voices: [
                voice('voice_003', 'char_001', '男声-年轻-慵懒'),
                voice('voice_005', 'char_002', '女声'),
            ],
            projectVisualBible: {
                stylePrompt: 'cinematic film look, low saturation, strong contrast',
                selected_at: 1,
            },
        },
        episode_bibles: {
            ep1: {
                shot_suggestions: result.shot_suggestions,
                original_scenes: result.original_scenes,
            },
        },
    }), result.shot_suggestions);
    const liveShot = designed.find((s) => String(s.scene || '').includes('电竞直播间'));
    if (!liveShot) {
        errors.push('脚本设计应保留直播间场次');
    }
    else {
        if (!String(liveShot.asset_match || '').includes('【参考】')) {
            errors.push('脚本设计应写出【参考】素材绑定');
        }
        if (!String(liveShot.asset_match || '').includes('江澈角色卡')) {
            errors.push('脚本设计素材绑定应为图N=江澈角色卡');
        }
        if (!String(liveShot.asset_match || '').includes('电竞直播间')) {
            errors.push('脚本设计素材绑定应含场景电竞直播间');
        }
        if (/未匹配/.test(String(liveShot.asset_match || ''))) {
            errors.push('脚本设计素材绑定不应写未匹配');
        }
        if (!String(liveShot.visual_style || '').includes('cinematic film look')) {
            errors.push('脚本设计应挂上已选视觉风格提示词');
        }
        if (!String(liveShot.action || '').includes('我操——')) {
            errors.push('脚本设计不得改写小说原文');
        }
        if (liveShot.size || liveShot.move) {
            errors.push('脚本设计不应填写景别/运镜');
        }
        if (!String(liveShot.dialogue || '').trim()) {
            errors.push('脚本设计不得清空对白列');
        }
    }
    // 人物绑定应按对白出现顺序，且不含地名标题
    const bindOrder = result.character_bindings
        .filter((b) => b.speaker_type !== 'system')
        .map((b) => b.original_name);
    const expectOrder = ['江澈'];
    for (const n of expectOrder) {
        if (!bindOrder.includes(n))
            errors.push(`人物绑定缺主要/次要说话人：${n}`);
    }
    const orderIdx = expectOrder.map((n) => bindOrder.indexOf(n)).filter((i) => i >= 0);
    for (let i = 1; i < orderIdx.length; i += 1) {
        if (orderIdx[i] < orderIdx[i - 1]) {
            errors.push(`人物绑定未按出现顺序：${bindOrder.join(',')}`);
            break;
        }
    }
    if (bindOrder.some((n) => /峡谷|云霄|山门|直播|弹幕/.test(n))) {
        errors.push(`人物绑定混入非人名：${bindOrder.join(',')}`);
    }
    const sceneOrder = result.scene_bindings.map((b) => b.original_location);
    if (sceneOrder[0] !== '电竞直播间' || !sceneOrder.includes('云霄峰山门外')) {
        errors.push(`场景绑定顺序异常：${sceneOrder.join(',')}`);
    }
    const dup = analyzeDramaEpisodeOriginal({
        source: `## 1. 外景 问道大典会场 - 日

众人站定。

## 2. 外景 问道大典会场 - 日（片刻后）

江澈抬手。

## 4. 外景 问道大典会场角落 - 日

角落有人低语。

## 4. 外景 问道大典会场角落 - 日

江澈回头。

## 6. 外景 天空 - 日

裂口张开。
`,
        episodeId: 'ep-dup',
        characters: [char('char_001', '江澈')],
        scenes: [],
        voices: [],
    });
    if (dup.original_scenes.length !== 5) {
        errors.push(`重复场号应拆成 5 场，实际 ${dup.original_scenes.length}`);
    }
    const ids = new Set(dup.original_scenes.map((s) => s.scene_id));
    if (ids.size !== dup.original_scenes.length)
        errors.push('重复场号的 scene_id 冲突');
    // 分析：每场可因叙事硬切拆成多镜；无硬切时一场一镜
    if (dup.shot_suggestions.length < 5) {
        errors.push(`分析至少应有 5 场对应分镜，实际 ${dup.shot_suggestions.length}`);
    }
    const mergedBlob = dup.shot_suggestions.map((s) => s.action).join('\n');
    if (!mergedBlob.includes('众人站定') || !mergedBlob.includes('裂口张开')) {
        errors.push('分镜表丢失原文内容');
    }
    if (dup.shot_suggestions.some((s) => !(Number(s.duration_sec) > 0))) {
        errors.push('每场时长应为精确正秒数');
    }
    if (dup.shot_suggestions.some((s) => ![6, 10, 15].includes(Number(s.duration_sec)))) {
        errors.push(`分析分镜时长应落 6/10/15，实际 ${dup.shot_suggestions.map((s) => s.duration_sec).join(',')}`);
    }
    const pairLines = Array.from({ length: 8 }, (_, i) => `角色甲\n这句话稍微长一点用来撑时长再来一句继续堆秒数第${i + 1}句甲。\n\n角色乙\n这句话稍微长一点用来撑时长再来一句继续堆秒数第${i + 1}句乙。\n`).join('\n');
    const longSrc = `## 1. 内景 客厅 - 夜\n\n${pairLines}`;
    const long = analyzeDramaEpisodeOriginal({
        source: longSrc,
        episodeId: 'ep-dur',
        characters: [char('char_jia', '角色甲'), char('char_yi', '角色乙')],
        scenes: [],
        voices: [],
    });
    // 无叙事硬切：仅当估时超过 H3 上限才软拆
    const longRaw = Number(long.shot_suggestions[0]?.duration_ai || long.shot_suggestions[0]?.duration_sec || 0);
    if (longRaw <= 20.3 && long.shot_suggestions.length !== 1) {
        errors.push(`短于 H3 上限且无硬切时应一镜，实际 ${long.shot_suggestions.length}`);
    }
    if (longRaw > 20.3 && long.shot_suggestions.length < 2) {
        errors.push(`超 H3 上限应软拆 ≥2 镜，实际 ${long.shot_suggestions.length}`);
    }
    const split = shotSuggestionsFromDurationSplit({
        original_scenes: long.original_scenes,
        original_segments: long.original_segments,
        visual_events: long.visual_events,
        source: longSrc,
    });
    if (split.length < 2) {
        errors.push(`时长拆镜应对长场拆出 ≥2 镜，实际 ${split.length}（估 ${long.shot_suggestions[0]?.duration_sec}s）`);
    }
    if (split.some((s) => ![6, 10, 15].includes(Number(s.duration_sec)))) {
        errors.push(`时长拆镜每镜应为 6/10/15，实际 ${split.map((s) => s.duration_sec).join(',')}`);
    }
    const rawSum = Math.round(split.reduce((n, s) => n + Number(s.duration_ai || 0), 0) * 10) / 10;
    const sceneEst = Number(long.shot_suggestions.reduce((n, s) => n + Number(s.duration_ai || s.duration_sec || 0), 0));
    // 叙事拆镜 vs 纯时长拆镜打包路径不同，允许更大偏差；禁止拆丢大半时长
    if (sceneEst > 0 && rawSum > 0 && rawSum < sceneEst * 0.45) {
        errors.push(`拆开后各镜估时之和应接近原场: ${rawSum} vs 原场 ${sceneEst}`);
    }
    if (split.length >= 2 && split.every((s) => Number(s.duration_sec) === Number(long.shot_suggestions[0]?.duration_sec))) {
        errors.push('拆开后各镜时长不应仍是整场时长');
    }
    if (split.some((s) => s.size || s.move)) {
        errors.push('时长拆镜不应填写景别/运镜');
    }
    if (split.length >= 2 && split.some((s) => Number(s.duration_ai || 0) > 20.3)) {
        errors.push(`时长拆镜单镜估时不得超过15×1.35秒: ${split.map((s) => s.duration_ai).join(',')}`);
    }
    const splitBlob = split.map((s) => s.action).join('\n');
    if (!splitBlob.includes('第1句甲') || !splitBlob.includes('第8句乙')) {
        errors.push('时长拆镜后原文对白丢失');
    }
    if (!split.some((s) => String(s.dialogue || '').trim())) {
        errors.push('时长拆镜应对白列写入台词');
    }
    const sameSpeakerLines = Array.from({ length: 16 }, (_, i) => `角色甲\n这句话稍微长一点用来撑时长再来一句继续堆秒数第${i + 1}句。\n`).join('\n');
    const sameSrc = `## 1. 内景 客厅 - 夜\n\n${sameSpeakerLines}`;
    const same = analyzeDramaEpisodeOriginal({
        source: sameSrc,
        episodeId: 'ep-same',
        characters: [char('char_jia', '角色甲')],
        scenes: [],
        voices: [],
    });
    const sameSplit = shotSuggestionsFromDurationSplit({
        original_scenes: same.original_scenes,
        original_segments: same.original_segments,
        visual_events: same.visual_events,
        source: sameSrc,
    });
    if (sameSplit.length !== 1) {
        errors.push(`同一人物连续对白不应中途拆开，实际 ${sameSplit.length} 镜`);
    }
    const shortTailSrc = `## 1. 内景 客厅 - 夜\n\n${pairLines}\n角色丙\n好。\n`;
    const shortTail = analyzeDramaEpisodeOriginal({
        source: shortTailSrc,
        episodeId: 'ep-tail',
        characters: [char('char_jia', '角色甲'), char('char_yi', '角色乙'), char('char_bing', '角色丙')],
        scenes: [],
        voices: [],
    });
    const shortSplit = shotSuggestionsFromDurationSplit({
        original_scenes: shortTail.original_scenes,
        original_segments: shortTail.original_segments,
        visual_events: shortTail.visual_events,
        source: shortTailSrc,
    });
    const lastAction = String(shortSplit[shortSplit.length - 1]?.action || '');
    if (shortSplit.length >= 2 && lastAction.replace(/\s+/g, '').length < 25 && lastAction.includes('好。') && !lastAction.includes('第')) {
        errors.push('切出来不足 25 字不应单独成镜');
    }
    const colonSrc = `## 1. 内景 客厅 - 夜

他冷冷道：

「你给我听好。」

江澈：
把门关上。

Anna:
Keep walking now.
`;
    const colon = analyzeDramaEpisodeOriginal({
        source: colonSrc,
        episodeId: 'ep-colon',
        characters: [char('char_jia', '江澈'), char('char_anna', 'Anna')],
        scenes: [],
        voices: [],
    });
    const colonOnly = colon.original_segments.filter((s) => {
        const t = String(s.original_text || '').replace(/\s+/g, '');
        return t === '他冷冷道：' || t === '江澈：' || t === 'Anna:';
    });
    if (colonOnly.length) {
        errors.push(`剧本拆分冒号结尾不应单独成段: ${colonOnly.map((s) => JSON.stringify(s.original_text)).join('|')}`);
    }
    if (!colon.original_segments.some((s) => s.original_text.includes('他冷冷道：') && s.original_text.includes('你给我听好'))) {
        errors.push('中文冒号应与后文同段');
    }
    if (!colon.original_segments.some((s) => s.original_text.includes('江澈：') && s.original_text.includes('把门关上'))) {
        errors.push('说话人中文冒号应与后文同段');
    }
    if (!colon.original_segments.some((s) => /Anna\s*:/.test(s.original_text) && s.original_text.includes('Keep walking'))) {
        errors.push('英文冒号应与后文同段');
    }
    if (colon.shot_suggestions.length !== 1) {
        errors.push(`冒号场剧本拆分应仍为一镜，实际 ${colon.shot_suggestions.length}`);
    }
    const recSrc = `## 1. 内景 客厅 - 夜

角色甲
甲的第一句用来确认他还要再说。
角色乙
乙的第一句用来确认他还要再说。
角色甲
甲的第二句证明他不是龙套。
角色乙
乙的第二句证明他不是龙套。
路人丙
我只出现这一次。
`;
    const rec = analyzeDramaEpisodeOriginal({
        source: recSrc,
        episodeId: 'ep-rec',
        characters: [char('char_jia', '角色甲'), char('char_yi', '角色乙'), char('char_bing', '路人丙')],
        scenes: [],
        voices: [],
    });
    const recNames = rec.character_bindings
        .filter((b) => b.speaker_type !== 'system')
        .map((b) => b.original_name);
    if (!recNames.includes('角色甲') || !recNames.includes('角色乙')) {
        errors.push(`开口两次的次要角色应保留: ${recNames.join(',')}`);
    }
    if (recNames.includes('路人丙')) {
        errors.push('只出现一次的路人丙不应进素材');
    }
    if (!isDramaSpeechAttributionLead('冷冷道') || !isDramaSpeechAttributionLead('问道')) {
        errors.push('冷冷道/问道 应判为叙述引导，不是人物');
    }
    if (!isDramaNonCastLabel('注意') || !isDramaNonCastLabel('地点')) {
        errors.push('注意/地点 应判为结构标签，不是人物');
    }
    if (isDramaNonCastLabel('江澈') || isDramaNonCastLabel('长老')) {
        errors.push('江澈/长老 不应被当成非人物标签');
    }
    const extractedNoise = extractCharacterNamesFromScriptText('注意：后面有埋伏。\n冷冷道：你给我听好。\n地点：客厅\n江澈：把门关上。\n');
    if (extractedNoise.some((n) => ['注意', '冷冷道', '地点'].includes(n))) {
        errors.push(`启发式提取混入非人物: ${extractedNoise.join(',')}`);
    }
    if (!extractedNoise.includes('江澈')) {
        errors.push('启发式提取应仍识别 江澈');
    }
    const noiseCast = colon.character_bindings.map((b) => b.original_name);
    if (noiseCast.some((n) => isDramaNonCastLabel(n))) {
        errors.push(`素材人物绑定混入非人物: ${noiseCast.join(',')}`);
    }
    const seriesEp1 = analyzeDramaEpisodeOriginal({
        source: `## 1. 内景 房 - 夜\n\n角色甲\n甲先开口第一句。\n角色甲\n甲再开口第二句。\n`,
        episodeId: 'ep-s1',
        characters: [char('char_jia', '角色甲')],
        scenes: [],
        voices: [],
    });
    const seriesEp2 = analyzeDramaEpisodeOriginal({
        source: `## 1. 内景 街 - 夜\n\n角色乙\n乙先开口第一句。\n角色乙\n乙再开口第二句。\n`,
        episodeId: 'ep-s2',
        characters: [char('char_yi', '角色乙')],
        scenes: [],
        voices: [],
    });
    const seriesSession = createEmptyDramaSession({
        episodes: [
            { episode_id: 'ep-s2', episode_no: 2, title: '第2集', text: '', analyzed: true, updated_at: 1 },
            { episode_id: 'ep-s1', episode_no: 1, title: '第1集', text: '', analyzed: true, updated_at: 1 },
        ],
        episode_bibles: {
            'ep-s2': createEmptyDramaEpisodeBible({
                episode_id: 'ep-s2',
                episode_no: 2,
                original_segments: seriesEp2.original_segments,
            }),
            'ep-s1': createEmptyDramaEpisodeBible({
                episode_id: 'ep-s1',
                episode_no: 1,
                original_segments: seriesEp1.original_segments,
            }),
        },
        bible: {
            characters: [char('c-yi', '角色乙'), char('c-jia', '角色甲')],
        },
    });
    const seriesOrder = collectSeriesCharacterAppearanceOrder(seriesSession);
    if (seriesOrder.indexOf('角色甲') < 0 || seriesOrder.indexOf('角色乙') < 0) {
        errors.push(`跨集出场序应含甲乙: ${seriesOrder.join(',')}`);
    }
    else if (seriesOrder.indexOf('角色甲') > seriesOrder.indexOf('角色乙')) {
        errors.push(`跨集出场序应先第1集再第2集: ${seriesOrder.join(',')}`);
    }
    const seriesSorted = sortDramaCharactersByAppearanceOrder(seriesSession.bible.characters, seriesOrder);
    if (seriesSorted[0]?.name !== '角色甲' || seriesSorted[1]?.name !== '角色乙') {
        errors.push(`角色卡应按剧集出场排序: ${seriesSorted.map((c) => c.name).join(',')}`);
    }
    const tagged = analyzeDramaEpisodeOriginal({
        source: `【元】
【参考】图1=江澈角色卡；图2=电竞直播间
【风格】电影质感，低饱和

【场】内景 电竞直播间 - 夜

【画】昏暗电竞房间，江澈靠在电竞椅上，正在说话嘴唇微动。

【台】江澈（慵懒）：家人们，这把打完就下播了啊。

【画】窗外雷声由远及近，屏幕炸开蓝光。

【台】江澈（震惊）：我操——

【转】黑屏，切至
`,
        episodeId: 'ep-craft',
        characters: [char('c-jiang', '江澈')],
        scenes: [scene('sc-room', '电竞直播间')],
        voices: [voice('v-jiang', 'c-jiang', '男声')],
    });
    if (tagged.original_scenes[0]?.location !== '电竞直播间') {
        errors.push(`【场】地点应为电竞直播间，实际 ${tagged.original_scenes[0]?.location}`);
    }
    if (tagged.original_scenes[0]?.time !== '夜') {
        errors.push(`【场】时间应为夜，实际 ${tagged.original_scenes[0]?.time}`);
    }
    const taggedDlg = tagged.original_segments.filter((s) => s.type === 'dialogue');
    const taggedAct = tagged.original_segments.filter((s) => s.type === 'action');
    const taggedTr = tagged.original_segments.filter((s) => s.type === 'transition');
    if (taggedDlg.length < 2)
        errors.push(`【台】应对出至少 2 条对白，实际 ${taggedDlg.length}`);
    if (!taggedDlg.some((s) => /家人们/.test(s.original_text) && s.character_name === '江澈')) {
        errors.push('【台】未拆出江澈第一句');
    }
    if (taggedDlg.some((s) => /电竞椅/.test(s.original_text))) {
        errors.push('【台】里不应混入【画】的画面');
    }
    if (taggedAct.length < 2)
        errors.push(`【画】应对出至少 2 条画面，实际 ${taggedAct.length}`);
    if (taggedAct.some((s) => /家人们/.test(s.original_text))) {
        errors.push('【画】里不应混入台词');
    }
    if (!taggedTr.some((s) => /黑屏/.test(s.original_text))) {
        errors.push('【转】未识别黑屏');
    }
    if (!tagged.visual_events.some((e) => e.kind === 'establish')) {
        errors.push('带标签剧本首条画面应为 establish');
    }
    if (tagged.visual_events.some((e) => parseDramaH3CraftTag(e.see || '')?.tag === '元')) {
        errors.push('【元】不应进入 visual_events');
    }
    return errors;
}
const isMain = process.argv[1] && /originalScript\.selftest/.test(process.argv[1].replace(/\\/g, '/'));
if (isMain) {
    const errors = runOriginalScriptSelfTest();
    if (errors.length) {
        console.error('FAIL');
        for (const e of errors)
            console.error(' -', e);
        process.exit(1);
    }
    console.log('PASS original script fidelity');
}
