/**
 * 切段台词回填自检。
 * 运行：npx tsx src/shared/directorDomain/timelineDialogue.selftest.ts
 */
import { stripDramaSystemSpokenLabel } from './extractCastFromScript.js';
import { peelSpokenLineFromVisualAction, spokenTextFromDramaTimelineEvent, } from './timelineEvent.js';
import { dramaShotHasSpokenDialogue } from './migrateH3Compiler.js';
import { reinjectCutDialogueIntoDramaH3Final } from './dramaH3SpliceIntegrate.js';
function assert(cond, msg) {
    if (!cond)
        throw new Error(msg);
}
const a = peelSpokenLineFromVisualAction('江澈坐下打哈欠喝汽水。（慵懒）家人们，这把打完——');
assert(a.dialogue.includes('家人们'), `peel lazy line: ${a.dialogue}`);
assert(!a.visual.includes('家人们'), `visual should drop speech: ${a.visual}`);
const b = peelSpokenLineFromVisualAction('(打个汽水嗝) 播啊，怎么不播... 卧槽——');
assert(/播啊/.test(b.dialogue), `peel burp line: ${b.dialogue}`);
const ev = {
    visual_action: '江澈进门站定。（慵懒）家人们，这把打完——',
    dialogue: '',
};
assert(spokenTextFromDramaTimelineEvent(ev) === '', 'spokenText only from dialogue field');
const shot = {
    dialogue: [],
    timeline_events: [
        { start_sec: 0, end_sec: 3.6, visual_action: '江澈进门', dialogue: '' },
        {
            start_sec: 3.6,
            end_sec: 7.9,
            visual_action: '坐下打游戏',
            dialogue: '家人们，这把打完——',
        },
        {
            start_sec: 7.9,
            end_sec: 12.6,
            visual_action: '打个汽水嗝',
            dialogue: '播啊，怎么不播... 卧槽——',
        },
    ],
};
assert(dramaShotHasSpokenDialogue(shot), 'hasSpokenDialogue from visual quotes');
const dirty = `[NO_DIALOGUE] 江澈全程闭口，无人声、旁白、低语、歌唱。
【目标】结算夜
【参考】图1=江澈
【主体】江澈
【节拍】
1. [固定机位] 江澈进门站定 0-3s
2. [近景] 他打哈欠喝汽水 3-7s
3. [hard cut 急推] 雷光弹幕 7-12s
4. [特写定格] 喘息收黑 12-20s
【摄影】固定
【音频】无对白；键鼠与汽水泡
【不变】红发黑卫衣
【终态】黑场`;
const fixed = reinjectCutDialogueIntoDramaH3Final(dirty, shot);
assert(!/\[NO_DIALOGUE\]/.test(fixed), 'drop NO_DIALOGUE');
assert(!/全程闭口/.test(fixed), 'drop 全程闭口');
assert(/「[^」]*家人们/.test(fixed), `inject line1: ${fixed}`);
assert(/播啊/.test(fixed), `inject line2: ${fixed}`);
assert(!/【音频】无对白/.test(fixed), 'audio not 无对白');
assert(stripDramaSystemSpokenLabel('系统：恭喜宿主获得奖励') === '恭喜宿主获得奖励', '系统：恭喜宿主获得奖励 → 只留台词');
assert(stripDramaSystemSpokenLabel('系统，你在吗？') === '系统，你在吗？', '江澈：系统，你在吗？ → 台词里的系统必须保留');
console.log('timelineDialogue.selftest ok');
