/**
 * 短剧快节奏时长估算自检。
 * 运行：npx tsx src/shared/directorDomain/shotDurationFastPace.selftest.ts
 */
import { DRAMA_FAST_PACE_DURATION_CONFIG as CFG, estimateDramaFastPaceSegment, estimateDramaFastPaceSegments, packDramaFastPaceScene, packDramaFastPaceByDurationTiers, resetDramaFastPaceCalibration, snapDramaFastPaceTierSec, snapDramaDurationSplitTierSec, splitDramaEstSecIntoTiers, isDramaDurationSplitSpeechUnfinished, } from './shotDurationFastPace.js';
function assert(cond, msg, errors) {
    if (!cond)
        errors.push(msg);
}
function inRange(n, lo, hi) {
    return n >= lo && n <= hi;
}
/** 旧算法对照：对白 n÷4、动作 n÷8 */
function oldEstimate(text, kind) {
    const n = String(text || '').replace(/\s+/g, '').length;
    return Math.max(2, Math.round((Math.max(n, 1) / (kind === 'talk' ? 4 : 8)) * 10) / 10);
}
export function runDramaFastPaceDurationSelfTest() {
    const errors = [];
    resetDramaFastPaceCalibration();
    // 1) 对白密集段：不应明显超过念白时长（字÷4.5 量级），且 clamp 内
    const dialogueDense = [
        { type: 'dialogue', text: '家人们，这把打完就下播了啊。明天冲峡谷之巅第一，目前差三百分。' },
        { type: 'dialogue', text: '我操——', parenthetical: '震惊' },
        { type: 'dialogue', text: '你谁啊。' },
        { type: 'dialogue', text: '江澈，你来了。' },
    ];
    const dEst = estimateDramaFastPaceSegments(dialogueDense);
    for (const e of dEst) {
        assert(inRange(e.estSec, CFG.segmentMinSec, CFG.segmentMaxSec), `对白段越界 ${e.estSec}`, errors);
    }
    const longLine = dEst[0].estSec;
    const chars = (dialogueDense[0].text.match(/[\u4e00-\u9fff]/g) || []).length;
    const speakCeil = chars / 4.0 + 1.2; // 略宽于 4.5 字/秒，验收：不超过偏慢念白
    assert(longLine <= speakCeil, `对白密集偏慢: ${longLine} > ${speakCeil}`, errors);
    // 2) 大段打斗：按节拍，明显短于旧 n÷8
    const fightText = '他扑上去一脚踢飞对方。刀光闪过，斩向咽喉。对方侧身闪避，他追上去连刺三刀。石壁爆裂，碎石飞溅，两人撞在一起。';
    const fight = estimateDramaFastPaceSegment({ type: 'action', text: fightText });
    const fightOld = oldEstimate(fightText, 'action');
    assert(inRange(fight.estSec, CFG.segmentMinSec, CFG.segmentMaxSec), `打斗越界 ${fight.estSec}`, errors);
    assert(fight.estSec < fightOld * 0.85, `打斗应短于旧算法: 新=${fight.estSec} 旧=${fightOld}`, errors);
    // 3) 特效段：不低于 3 秒
    const fxSeg = estimateDramaFastPaceSegment({
        type: 'action',
        text: '利爪刺穿喉咙。【特效：Q·品尝恐惧】【特效：被动·孤立无援】',
        fx: ['Q·品尝恐惧', '被动·孤立无援'],
    });
    assert(fxSeg.estSec >= 3, `特效段应≥3s，得 ${fxSeg.estSec}`, errors);
    assert(fxSeg.estSec <= CFG.segmentMaxSec, `特效段越界 ${fxSeg.estSec}`, errors);
    // 4) 空镜段 ≤1.5
    const empty = estimateDramaFastPaceSegment({
        type: 'visual',
        text: '远山连绵。云雾缭绕。月光洒落山谷。',
    });
    assert(empty.estSec <= CFG.emptyEnvCapSec, `空镜应≤${CFG.emptyEnvCapSec}，得 ${empty.estSec}`, errors);
    assert(empty.estSec >= CFG.segmentMinSec, `空镜应≥min，得 ${empty.estSec}`, errors);
    // 5) 转场：硬切 / 淡入淡出
    const hard = estimateDramaFastPaceSegment({ type: 'transition', text: '切至：' });
    const fade = estimateDramaFastPaceSegment({ type: 'transition', text: '画面淡出。' });
    assert(hard.estSec === CFG.cutHardSec || Math.abs(hard.estSec - CFG.cutHardSec) < 0.05, `硬切应为 ${CFG.cutHardSec}，得 ${hard.estSec}`, errors);
    assert(fade.estSec === CFG.cutFadeSec || Math.abs(fade.estSec - CFG.cutFadeSec) < 0.05, `淡出应为 ${CFG.cutFadeSec}，得 ${fade.estSec}`, errors);
    // 6) 落档与场景打包
    assert(snapDramaFastPaceTierSec(4) === 6, '落档≤6→6', errors);
    assert(snapDramaFastPaceTierSec(8) === 10, '落档≤10→10', errors);
    assert(snapDramaFastPaceTierSec(12) === 15, '落档>10→15', errors);
    assert(snapDramaFastPaceTierSec(18) === 15, '落档不再有20', errors);
    assert(snapDramaDurationSplitTierSec(5.2) === 6, '拆镜 5.2→6', errors);
    assert(snapDramaDurationSplitTierSec(8.5) === 10, '拆镜 8.5→10', errors);
    assert(snapDramaDurationSplitTierSec(12) === 10, '拆镜 12 更近 10', errors);
    assert(snapDramaDurationSplitTierSec(13) === 15, '拆镜 13 更近 15', errors);
    assert(snapDramaDurationSplitTierSec(18) === 15, '拆镜 18→15', errors);
    assert(snapDramaDurationSplitTierSec(19) === 15, '拆镜 19→15', errors);
    assert(snapDramaDurationSplitTierSec(20) === 15, '拆镜 20→15', errors);
    assert(snapDramaDurationSplitTierSec(20.25) === 15, '拆镜 20.25 恰为 15×1.35，仍落 15', errors);
    assert(splitDramaEstSecIntoTiers(15).join(',') === '15', '15s 一镜 15', errors);
    assert(splitDramaEstSecIntoTiers(18).join(',') === '15', '18s 仍一镜 15', errors);
    assert(splitDramaEstSecIntoTiers(20).join(',') === '15', '20s 仍一镜 15', errors);
    assert(splitDramaEstSecIntoTiers(20.25).join(',') === '15', '20.25s 仍一镜 15', errors);
    assert(splitDramaEstSecIntoTiers(22).join(',') === '15,6', '22→15+6', errors);
    assert(splitDramaEstSecIntoTiers(29.3).join(',') === '15,15', '29.3→15+15', errors);
    assert(splitDramaEstSecIntoTiers(35).join(',') === '15,15', '35→15+15', errors);
    assert(splitDramaEstSecIntoTiers(40).join(',') === '15,15,10', '40→15+15+10', errors);
    const talkLine = '这句话稍微长一点用来撑时长，再来一句继续堆秒数。';
    const withinTolSegs = [];
    for (let i = 0; i < 20; i += 1) {
        withinTolSegs.push({ type: 'dialogue', text: talkLine });
        const packed20 = packDramaFastPaceByDurationTiers(withinTolSegs);
        if (packed20.totalSec >= 18 && packed20.totalSec <= 20.25) {
            assert(packed20.packs.length === 1 && packed20.packs[0]?.tierSec === 15, `估时 ${packed20.totalSec}s 未超 15×1.35，应一镜 15 档，实际 ${packed20.packs.map((p) => `${p.totalSec}@${p.tierSec}`).join(',')}`, errors);
            break;
        }
        if (packed20.totalSec > 20.25)
            break;
    }
    const oneTalk = estimateDramaFastPaceSegment({ type: 'dialogue', text: talkLine }).estSec;
    const nFor35 = Math.max(8, Math.ceil(35 / Math.max(0.5, oneTalk)));
    const overPacked = packDramaFastPaceByDurationTiers(Array.from({ length: nFor35 }, () => ({ type: 'dialogue', text: talkLine })));
    assert(overPacked.packs.every((p) => p.totalSec <= 20.3), `单包估时不得超过15×1.35: ${overPacked.packs.map((p) => p.totalSec).join(',')}`, errors);
    if (overPacked.totalSec > 20.3) {
        assert(overPacked.packs.length >= 2, `超过15×1.35才拆镜，实际 ${overPacked.packs.length} 包 / ${overPacked.totalSec}s`, errors);
    }
    const tierPacked = packDramaFastPaceByDurationTiers([
        { type: 'dialogue', text: '这句话稍微长一点用来撑时长，再来一句继续堆秒数。' },
        ...Array.from({ length: 14 }, () => ({
            type: 'dialogue',
            text: '这句话稍微长一点用来撑时长，再来一句继续堆秒数。',
        })),
    ]);
    const packSum = Math.round(tierPacked.packs.reduce((n, p) => n + p.totalSec, 0) * 10) / 10;
    assert(Math.abs(packSum - tierPacked.totalSec) < 0.2, `拆开后各镜估时应加总还原: ${packSum} vs ${tierPacked.totalSec}`, errors);
    assert(tierPacked.packs.every((p) => [6, 10, 15].includes(p.tierSec)), `拆镜档位应为 6/10/15: ${tierPacked.packs.map((p) => p.tierSec).join(',')}`, errors);
    if (tierPacked.totalSec > 20.3) {
        assert(tierPacked.split && tierPacked.packs.length >= 2, '超过 15×1.35 应按档拆开', errors);
    }
    assert(isDramaDurationSplitSpeechUnfinished('我告诉你啊——'), '破折号应收为未说完', errors);
    assert(isDramaDurationSplitSpeechUnfinished('你听我说……'), '省略号应收为未说完', errors);
    assert(isDramaDurationSplitSpeechUnfinished('他冷冷道：'), '冒号应收为未说完', errors);
    assert(isDramaDurationSplitSpeechUnfinished('听好了:'), '半角冒号应收为未说完', errors);
    assert(!isDramaDurationSplitSpeechUnfinished('我回来了。'), '句号应视为说完', errors);
    const sameSpeakerPacked = packDramaFastPaceByDurationTiers(Array.from({ length: nFor35 }, () => ({
        type: 'dialogue',
        text: talkLine,
        speakerKey: '角色甲',
        speechCarry: true,
    })));
    assert(sameSpeakerPacked.packs.length === 1, `同一人物连续对白不拆: ${sameSpeakerPacked.packs.length} 包 / ${sameSpeakerPacked.totalSec}s`, errors);
    const twoSpeakerPacked = packDramaFastPaceByDurationTiers([
        ...Array.from({ length: Math.ceil(nFor35 / 2) }, () => ({
            type: 'dialogue',
            text: talkLine,
            speakerKey: '角色甲',
            speechCarry: true,
        })),
        ...Array.from({ length: Math.ceil(nFor35 / 2) }, () => ({
            type: 'dialogue',
            text: talkLine,
            speakerKey: '角色乙',
            speechCarry: true,
        })),
    ]);
    if (twoSpeakerPacked.totalSec > 27.05) {
        assert(twoSpeakerPacked.packs.length >= 2, `不同人物超档应能拆: ${twoSpeakerPacked.packs.length} 包 / ${twoSpeakerPacked.totalSec}s`, errors);
    }
    const unfinishedPacked = packDramaFastPaceByDurationTiers([
        ...Array.from({ length: Math.max(5, Math.ceil(16 / Math.max(0.5, oneTalk))) }, () => ({
            type: 'dialogue',
            text: talkLine,
            speakerKey: '角色甲',
            speechCarry: true,
        })),
        { type: 'dialogue', text: '我告诉你啊——', speakerKey: '角色甲', speechCarry: true },
        { type: 'action', text: '他深吸一口气，又停了停，抬眼看向对面那人。' },
        ...Array.from({ length: Math.max(5, Math.ceil(16 / Math.max(0.5, oneTalk))) }, () => ({
            type: 'dialogue',
            text: talkLine,
            speakerKey: '角色甲',
            speechCarry: true,
        })),
    ]);
    assert(unfinishedPacked.packs.length === 1, `没说完中间夹动作也不拆: ${unfinishedPacked.packs.length} 包 / ${unfinishedPacked.totalSec}s`, errors);
    const colonLead = '他冷冷道：';
    const nFor20 = Math.max(5, Math.ceil(20 / Math.max(0.5, oneTalk)));
    const colonSegs = [
        ...Array.from({ length: nFor20 }, () => ({ type: 'dialogue', text: talkLine })),
        { type: 'action', text: colonLead },
        ...Array.from({ length: nFor20 }, () => ({
            type: 'dialogue',
            text: talkLine,
            speakerKey: '角色乙',
            speechCarry: true,
        })),
    ];
    const colonPacked = packDramaFastPaceByDurationTiers(colonSegs);
    const splitAfterColon = colonPacked.packs.some((p, i) => {
        if (i + 1 >= colonPacked.packs.length)
            return false;
        return colonSegs[p.end - 1]?.text === colonLead;
    });
    assert(!splitAfterColon, '冒号结尾应与后文留在同一镜', errors);
    const shortTailSegs = [
        ...Array.from({ length: nFor35 }, () => ({ type: 'dialogue', text: talkLine })),
        { type: 'dialogue', text: '好。' },
    ];
    const shortTailPacked = packDramaFastPaceByDurationTiers(shortTailSegs);
    assert(shortTailPacked.packs.every((p) => {
        const chars = shortTailSegs
            .slice(p.start, p.end)
            .reduce((n, s) => n + String(s.text || '').replace(/\s+/g, '').length, 0);
        return chars >= 25 || shortTailPacked.packs.length === 1;
    }), `不足25字应并回上一镜: ${shortTailPacked.packs.map((p) => shortTailSegs.slice(p.start, p.end).map((s) => s.text).join('/')).join(' || ')}`, errors);
    const scene = packDramaFastPaceScene([
        { type: 'action', text: '夜色压城。', isSceneStart: true },
        ...Array.from({ length: 12 }, () => ({
            type: 'dialogue',
            text: '这句话稍微长一点用来撑时长，再来一句继续堆秒数。',
        })),
    ]);
    assert(scene.segments.every((s) => inRange(s.estSec, CFG.segmentMinSec, CFG.segmentMaxSec)), '场景内段应 clamp', errors);
    if (scene.totalSec > CFG.packCapSec) {
        assert(scene.split === true && scene.packs.length >= 2, '超20应拆场次续', errors);
    }
    // 开场压缩（需足够长，避免被 min clamp 抹平）
    const openText = '他冲进大门一脚踢飞守卫。刀光闪过斩向咽喉，对方侧身闪避他追上去连刺。石壁爆裂碎石飞溅两人撞在一起。';
    const startA = estimateDramaFastPaceSegment({ type: 'action', text: openText, isSceneStart: true });
    const startB = estimateDramaFastPaceSegment({ type: 'action', text: openText, isSceneStart: false });
    assert(startA.estSec < startB.estSec, `开场应×0.7 更短: ${startA.estSec} vs ${startB.estSec}`, errors);
    return errors;
}
if (typeof process !== 'undefined' && process.argv?.[1]?.includes('shotDurationFastPace.selftest')) {
    const errs = runDramaFastPaceDurationSelfTest();
    if (errs.length) {
        console.error('FAIL shotDurationFastPace\n' + errs.map((e) => ` - ${e}`).join('\n'));
        process.exitCode = 1;
    }
    else {
        console.log('PASS shotDurationFastPace');
    }
}
