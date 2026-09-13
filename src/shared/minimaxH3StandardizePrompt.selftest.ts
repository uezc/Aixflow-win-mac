/**
 * MiniMax-H3 提示词标准化自检。
 * 运行：npx tsx src/shared/minimaxH3StandardizePrompt.selftest.ts
 */

import { standardizeMinimaxH3VideoPrompt } from './minimaxH3StandardizePrompt.js';
import {
  collectDramaShotSpokenLinesForH3,
  finalizeMinimaxH3SkillPrompt,
} from './minimaxH3OptimizePrompt.js';

const FIXTURE = `Spoken lines use only <d>[Chinese] … </d>. Place speaker ID, action, and delivery outside <d>. On-screen banners, signs, labels, or neon use English double quotation marks only when they must appear in the frame; do not place dialogue inside quotation marks as visible text.

Keep Picture 1 colors and rendering as they appear in the image; do not regrade; do not restyle into 3D CGI. Do not speak this line.
Negative: unrealistic color shift, over-saturation, style drift, CGI remake, warm golden hour, purple haze, cold blue mood, orange sunlight, watermark, logo.
subject_definitions:
<Picture 1> is the first frame and visual anchor for the esports room.
<Subject 1> is Jiang Che in <Picture 1>.
<Audio 1> is a reference for the target video's nonverbal sound timing and close indoor sound texture; no vocal or music signal is copied.
summary:
A hard cut and rapid push-in capture his locked posture.
detailed_description:
[Shot 1] The shot begins from <Picture 1> at 00:00.
000 in a fixed frontal medium composition.
[Shot 2] At 00:03.
600, a hard cut returns to the same fixed frontal medium framing.
<Subject 1> pauses his inputs, opens his mouth in a silent yawn.
No one speaks.
[Shot 3] At 00:07.
900, a hard cut starts a rapid forward push toward <Subject 1>.
His eyes widen toward the display; he does not speak or move.
[Shot 4] At 00:12.
600, a hard cut lands on a stationary close composition.
The frame becomes fully black and remains unchanged through 00:20.
000.
Jiang Che does not speak.
No voices, narration, or music are present.
overall_soundscape:
<Audio 1> is referenced for the timing and texture of the nonverbal audio.
No dialogue or narration.
non_diegetic_music:
N/A`;

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

const out = standardizeMinimaxH3VideoPrompt(FIXTURE);
assert(!/No one speaks/i.test(out), 'should drop No one speaks');
assert(!/Jiang Che does not speak/i.test(out), 'should drop Jiang Che does not speak');
assert(!/No voices, narration, or music are present/i.test(out), 'should drop no-voices line');
assert(!/No dialogue or narration/i.test(out), 'should drop No dialogue or narration');
assert(!/silent yawn/i.test(out), 'should drop silent yawn');
assert(/opens his mouth in a yawn/i.test(out), 'silent yawn should become yawn');
assert(/he does not move/i.test(out), 'should keep freeze, drop speak');
assert(/At 00:03\.600/.test(out), 'should join 00:03.600');
assert(/At 00:07\.900/.test(out), 'should join 00:07.900');
assert(/At 00:12\.600/.test(out), 'should join 00:12.600');
assert(/through 00:20\.000/.test(out), 'should join 00:20.000');
assert(!/00:03\.\s*\n\s*600/.test(out), 'timestamp must not stay split');
assert(/Do not speak this line/.test(out), 'keep Picture-1 lock');
assert(/Spoken lines use only <d>/.test(out), 'keep official speech channel');
assert(!/\[NO_SUBTITLE|burned-in subtitles|Zero letters/i.test(out), 'no subtitle-priming banner');
assert(
  /When a visible character Subject speaks that character's own <d> lines, generate accurate lip-sync/.test(out),
  'inject scoped lip-sync rule',
);
assert(
  !/When Subject 1 speaks, generate accurate lip-sync matching his spoken dialogue/.test(out),
  'must not inject old all-speech lip-sync',
);
assert(/deformed hands, extra fingers/.test(out), 'extend Negative');
assert(/\[cut\].*hard cut returns/i.test(out), 'mark hard cut');
assert(!/nonverbal sound timing/i.test(out), 'rewrite Audio 1 nonverbal');

const again = standardizeMinimaxH3VideoPrompt(out);
assert(again === out, 'standardize must be idempotent');

const lines = collectDramaShotSpokenLinesForH3(
  {
    timeline_events: [
      {
        dialogue:
          '这局是三分局，【炸弹字幕：精神今天必须赢！】/ 全服主名不虚传！/ 给别人留点活路吧！',
        visual_action: '江澈开口',
      },
    ],
  },
  [],
);
assert(lines.includes('这局是三分局'), `missing line 1: ${JSON.stringify(lines)}`);
assert(lines.includes('全服主名不虚传！'), `missing line 2: ${JSON.stringify(lines)}`);
assert(lines.includes('给别人留点活路吧！'), `missing line 3: ${JSON.stringify(lines)}`);
assert(!lines.some((l) => l.includes('炸弹字幕')), 'bomb subtitle must not become speech');

const withDlg = finalizeMinimaxH3SkillPrompt(FIXTURE, ['这局是三分局']);
assert(/<d>\[Chinese\] 这局是三分局<\/d>/.test(withDlg), 'reinject spoken <d>');
assert(!/No one speaks/i.test(withDlg), 'still no No one speaks after finalize');
assert(!/# Example line/.test(withDlg), 'no placeholder when <d> exists');

const DRAMA_SYS = `Keep Picture 1 colors and rendering as they appear in the image; do not regrade; do not restyle into 3D CGI. Do not speak this line.
Spoken lines use only <d>[Chinese] … </d>. Place speaker ID, action, and delivery outside <d>. On-screen banners, signs, labels, or neon use English double quotation marks only when they must appear in the frame; do not place dialogue inside quotation marks as visible text. System-voice and narrator say in an off-screen voiceover; visible characters' lips remain completely closed.
When a visible character Subject speaks that character's own <d> lines, generate accurate lip-sync matching that spoken dialogue. Do not lip-sync system-voice or narrator <d> lines onto any visible face.
Never assign system-voice or narrator <d> lines to any Subject or any character Audio.

subject_definitions:
<Picture 1> is the environment referenced as the spatial and material anchor.
<Subject 1> is the character referenced by <Picture 2>.
<Audio 1> is the voice-timbre reference for <Subject 1> (S1).
<Audio 2> is the voice-timbre reference for the off-screen narrator (S2). This is non-diegetic voice-over and must NEVER be assigned to any visible character.
summary:
<Subject 1> at the gate. The sequence uses <Audio 1> as the voice-timbre reference for <Subject 1> (S1) and <Audio 2> as the voice-timbre reference for the off-screen narrator (S2).
detailed_description:
[Shot 1] The shot begins from <Picture 1>.
<Subject 1> (S1), using the voice timbre referenced from <Audio 1> says: <d>[Chinese]啥玩意儿？</d>
[Shot 2] At 00:05.161, the shot continues in the same location.
The off-screen narrator (S2), using the voice timbre referenced from <Audio 2> says in an off-screen voiceover: <d>[Chinese]叮——峡谷商城系统激活完毕。</d> while visible characters' lips remain completely closed.
overall_soundscape:
ambient plus off-screen narrator voice-over
non_diegetic_music:
N/A
Negative: watermark, logo`;

const sysOut = standardizeMinimaxH3VideoPrompt(DRAMA_SYS);
assert(
  (sysOut.match(/generate accurate lip-sync/gi) || []).length === 1,
  `must not inject a second lip-sync rule: ${sysOut}`,
);
assert(
  !/When Subject 1 speaks, generate accurate lip-sync matching his spoken dialogue/.test(sysOut),
  'must not inject old all-speech lip-sync over system-voice rules',
);
assert(
  /lips remain completely closed/.test(sysOut),
  'system mouth-closed must survive stripVocalSuppression',
);
assert(/voice timbre referenced from <Audio 2>/.test(sysOut), 'keep system Audio 2 timbre bind');
assert(/off-screen narrator \(S2\)/.test(sysOut), 'keep narrator speaker id');
assert(
  !/generate spoken lines on a dedicated vocal track/.test(sysOut) ||
    /Subject 1 spoken lines/.test(sysOut),
  'must not bind all spoken lines to Audio 1',
);
assert(
  standardizeMinimaxH3VideoPrompt(sysOut) === sysOut,
  'system-voice standardize must be idempotent',
);

console.log('minimaxH3StandardizePrompt.selftest ok');
