/**
 * 导演 QA：编译前程序化硬校验。失败则回写 Structured Decision，禁止只改文案。
 */

import {
  cameraLanguageConflicts,
  cameraSignature,
  formatLockedCameraLine,
  shotBlockBodyAfterCameraLine,
  stripConflictingCameraLanguage,
  type DramaLockedCamera,
} from './directorCameraSchema.js';
import { hasEmotionLabel, hasSilentSpeechVerb, qaActionEndStateConflicts } from './visiblePerformance.js';
import type { DramaDirectingBeat, DramaShot } from './types.js';

export type DirectorQaSeverity = 'fail' | 'warn';

export type DirectorQaIssue = {
  code: string;
  severity: DirectorQaSeverity;
  message: string;
};

export type DirectorQaReport = {
  ok: boolean;
  issues: DirectorQaIssue[];
};

function fail(code: string, message: string): DirectorQaIssue {
  return { code, severity: 'fail', message };
}


const OR_RE = /或/;
const RANGE_LENS_RE = /\d+\s*[–\-]\s*\d+\s*mm/i;

export function lockedCameraOfBeat(beat: DramaDirectingBeat): DramaLockedCamera | null {
  const cam = beat.lockedCamera;
  if (cam?.shotSize && cam.cameraMovement && cam.lensMm) return cam;
  return null;
}

export function qaDramaDirectingBeats(
  shot: Pick<DramaShot, 'duration_sec' | 'shot_id'>,
  beats: DramaDirectingBeat[],
): DirectorQaReport {
  const issues: DirectorQaIssue[] = [];
  const dur = Math.max(0.5, Number(shot.duration_sec) || 10);
  if (!beats.length) {
    return { ok: false, issues: [fail('no_beats', '没有戏剧节拍')] };
  }

  let prevEnd = 0;
  const sigs: string[] = [];
  for (let i = 0; i < beats.length; i += 1) {
    const b = beats[i];
    if (Math.abs(b.audioStart - prevEnd) > 0.15) {
      issues.push(fail('timeline_gap', `节拍${i + 1}与上一拍之间有空洞或重叠`));
    }
    if (b.audioEnd <= b.audioStart) {
      issues.push(fail('timeline_invalid', `节拍${i + 1}起止非法`));
    }
    prevEnd = b.audioEnd;

    const cam = lockedCameraOfBeat(b);
    if (!cam) {
      issues.push(fail('camera_missing', `节拍${i + 1}缺少单值镜头参数`));
    } else {
      const line = formatLockedCameraLine(cam);
      if (OR_RE.test(line) || OR_RE.test(b.movement || '') || OR_RE.test(b.camera || '')) {
        issues.push(fail('camera_or', `节拍${i + 1}镜头含「或」`));
      }
      if (RANGE_LENS_RE.test(b.lens || '') || RANGE_LENS_RE.test(b.camera || '')) {
        issues.push(fail('lens_range', `节拍${i + 1}焦段是范围值`));
      }
      if (
        cameraLanguageConflicts(b.visiblePerformance || '', cam.cameraMovement) ||
        cameraLanguageConflicts(b.action || '', cam.cameraMovement)
      ) {
        issues.push(fail('camera_nl_conflict', `节拍${i + 1}表演文本与 cameraMovement 冲突`));
      }
      sigs.push(cameraSignature(cam));
      if (i >= 1 && sigs[i] === sigs[i - 1] && !cam.continuityReason) {
        issues.push(fail('camera_dup2', `节拍${i}与${i + 1}镜头签名相同且无承接理由`));
      }
    }

    if (!b.primaryPurpose) {
      issues.push(fail('purpose_missing', `节拍${i + 1}缺少 primaryPurpose`));
    }
    if (!b.visiblePerformance) {
      issues.push(fail('performance_missing', `节拍${i + 1}缺少 visiblePerformance`));
    } else if (
      i > 0 &&
      beats[i - 1].visiblePerformance &&
      beats[i - 1].visiblePerformance === b.visiblePerformance
    ) {
      issues.push(fail('performance_dup', `节拍${i}与${i + 1}可见表演完全相同`));
    }
    if (!b.endState?.pose) {
      issues.push(fail('endstate_missing', `节拍${i + 1}缺少 EndState`));
    }
    for (const msg of qaActionEndStateConflicts(
      `${b.visibleAction || b.action} ${b.event || ''}`,
      b.visiblePerformance || '',
      b.endState,
    )) {
      issues.push(fail('endstate_conflict', `节拍${i + 1}${msg}`));
    }

    if (!b.lipSync) {
      if (hasSilentSpeechVerb(b.action) || hasSilentSpeechVerb(b.visiblePerformance || '')) {
        issues.push(fail('silent_speech', `节拍${i + 1}无对白却含说话动作`));
      }
    } else if (!String(b.dialogue || '').trim()) {
      issues.push(fail('lipsync_no_dialogue', `节拍${i + 1}口型开但没有对白`));
    }
  }

  if (Math.abs(prevEnd - dur) > 0.2) {
    issues.push(fail('duration_mismatch', `节拍结束 ${prevEnd}s 与镜头时长 ${dur}s 不一致`));
  }

  for (let i = 2; i < sigs.length; i += 1) {
    if (sigs[i] && sigs[i] === sigs[i - 1] && sigs[i] === sigs[i - 2]) {
      issues.push(fail('camera_dup3', `连续三镜镜头签名完全相同`));
    }
  }

  const hard = issues.filter((x) => x.severity === 'fail');
  return { ok: hard.length === 0, issues };
}

export function qaCompiledDramaPrompt(
  prompt: string,
  opts: { hasDialogue: boolean; beats?: DramaDirectingBeat[] },
): DirectorQaReport {
  const issues: DirectorQaIssue[] = [];
  const t = String(prompt || '');
  if (OR_RE.test(t) && /固定或轻微移动|或轻微/.test(t)) {
    issues.push(fail('prompt_or_camera', '最终 Prompt 含「固定或轻微移动」'));
  }
  if (RANGE_LENS_RE.test(t)) {
    issues.push(fail('prompt_lens_range', '最终 Prompt 含范围焦段'));
  }
  if (!opts.hasDialogue) {
    if (/低声交谈|交谈，|正在说话|开口说话/.test(t)) {
      issues.push(fail('prompt_silent_speech', '无对白 Prompt 仍含主体说话动作'));
    }
  }
  if (hasEmotionLabel(t)) {
    issues.push(fail('prompt_emotion_label', '最终 Prompt 含抽象情绪标签或内部导演备注'));
  }
  const blocks = t.match(/\[镜头\d+\][\s\S]*?(?=\n\[镜头\d+\]|\n本镜无对白|\n【|$)/g) || [];
  const beats = opts.beats || [];
  for (let i = 0; i < blocks.length; i += 1) {
    const movement = beats[i]?.lockedCamera?.cameraMovement;
    const body = shotBlockBodyAfterCameraLine(blocks[i]);
    if (cameraLanguageConflicts(body, movement)) {
      issues.push(fail('prompt_camera_conflict', `镜头${i + 1}自然语言运镜与 cameraMovement=${movement || '?'} 冲突`));
    }
    const compact = body.replace(/\s+/g, '');
    const half = Math.floor(compact.length / 2);
    if (half >= 10 && compact.slice(0, half) === compact.slice(half, half * 2)) {
      issues.push(fail('prompt_action_dup', `镜头${i + 1}动作被重复输出`));
    }
  }
  const hard = issues.filter((x) => x.severity === 'fail');
  return { ok: hard.length === 0, issues };
}

/** Schema 优先：删除与 cameraMovement 冲突的自然语言运镜。 */
export function repairCompiledDramaPromptCameraLanguage(
  prompt: string,
  beats: DramaDirectingBeat[],
): string {
  return String(prompt || '').replace(
    /\[镜头\d+\][\s\S]*?(?=\n\[镜头\d+\]|\n本镜无对白|\n【|$)/g,
    (block, offset, full) => {
      const idx = (full.slice(0, offset).match(/\[镜头\d+\]/g) || []).length;
      const movement = beats[idx]?.lockedCamera?.cameraMovement;
      const cam = block.match(/[^。\n]*｜[^。\n]*mm｜[^。\n]*/);
      if (!cam || cam.index == null) {
        return stripConflictingCameraLanguage(block, movement);
      }
      const head = block.slice(0, cam.index + cam[0].length);
      const body = block.slice(cam.index + cam[0].length);
      const punct = body.match(/^[。.]+/)?.[0] || '';
      return `${head}${punct}${stripConflictingCameraLanguage(body.slice(punct.length), movement)}`;
    },
  );
}

export function mergeQaReports(...reports: DirectorQaReport[]): DirectorQaReport {
  const issues = reports.flatMap((r) => r.issues);
  return { ok: issues.every((i) => i.severity !== 'fail'), issues };
}
