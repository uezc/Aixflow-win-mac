/**
 * 用真实 15s 项目（周一川雨夜写字楼）重编译最终 Prompt。
 */
import fs from 'node:fs';
import { compileDramaShotVideoRequest } from '../src/shared/directorDomain/compileDramaShotVideoRequest.ts';
import { dramaVideoModelRequiresShotAudio, resolveDramaShotVideoModel } from '../src/shared/directorDomain/dramaVideoModels.ts';

const projectPath =
  'E:/我的项目NEXFLOW/project-1786408202194-zzd61uffo/data.json';
const raw = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
const node = (raw.nodes || []).find((n: { id?: string }) => n.id === 'directorDrama-1786880913126');
if (!node?.data?.directorDomain) {
  throw new Error('找不到真实导演台 session');
}
const session = node.data.directorDomain;
const shot = session.shots?.[0];
if (!shot) throw new Error('找不到镜头01');

const hasDlg =
  (shot.dialogue || []).some((d: { text?: string }) => String(d.text || '').trim()) ||
  (shot.timeline_events || []).some((e: { dialogue?: string }) => String(e.dialogue || '').trim());
const hasAudio = !!String(shot.audio_url || '').trim();
const model = resolveDramaShotVideoModel(shot.model_params, session.meta?.videoBatchModel, {
  hasDialogue: hasDlg,
  hasShotAudio: hasAudio,
});
const mode = hasAudio || dramaVideoModelRequiresShotAudio(model) ? 'h3-audio' : 'h3-multi';
const compiled = compileDramaShotVideoRequest(session, shot, { mode, model, locale: 'zh' });

const out = {
  shot_id: shot.shot_id,
  duration_sec: shot.duration_sec,
  mode: compiled.mode,
  model: compiled.model,
  events: (shot.timeline_events || []).map((e: { start_sec: number; end_sec: number; visual_action: string; dialogue: string }) => ({
    start: e.start_sec,
    end: e.end_sec,
    action: e.visual_action,
    dlg: e.dialogue,
  })),
  audio_timeline: compiled.debug.audio_timeline,
  prompt: compiled.prompt,
};
process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
