/**
 * 单镜头 TimelineEvent 实测（第一步验收）
 * 运行：npx tsx scripts/test-drama-timeline-event.ts
 */
import {
  auditDramaTimelineEventsAnswerability,
  createEmptyDramaShot,
  createEmptyDramaTimelineEvent,
  ensureDramaShotTimelineEvents,
  formatDramaTimelineEventDisplay,
} from '../src/shared/directorDomain/index.ts';

const shot = createEmptyDramaShot({
  shot_id: 'shot_demo_01',
  shot_no: '01',
  duration_sec: 11,
  scene_asset_id: 'scene_saloon',
  character_ids: ['tommy', 'snake_a', 'snake_gang'],
  size: '中景',
  angle: '正面',
  move: '固定镜头',
  timeline_events: [
    createEmptyDramaTimelineEvent({
      start_sec: 0,
      end_sec: 3,
      character_ids: ['tommy'],
      visual_action:
        '汤米从沙龙酒馆二楼东北侧木质栏杆后方跃下，双脚落到一楼中央木地板，身体向前倾斜保持平衡',
      character_state: '汤米眉头紧锁，呼吸急促',
      position: '二楼东北栏杆→一楼中央木地板',
      expression: '愤怒',
      eyeline: '目光锁定地面的响尾蛇帮众甲',
      dialogue: '',
      dialogue_character_id: '',
      environment_audio: ['衣物摩擦声', '落地声'],
      lip_sync: false,
      camera_action: '中景正面，固定镜头',
    }),
    createEmptyDramaTimelineEvent({
      start_sec: 3,
      end_sec: 6,
      character_ids: ['tommy', 'snake_a'],
      visual_action:
        '汤米落地后立即向前迈步，右腿抬起踢向响尾蛇帮众甲的胸口，将其踢倒在一楼中央靠近圆桌的位置',
      character_state: '汤米怒视；帮众甲受击倒地',
      position: '一楼中央靠近圆桌',
      expression: '汤米怒色；帮众甲疼痛',
      eyeline: '汤米始终看向被踢倒的帮众甲',
      dialogue: '',
      dialogue_character_id: '',
      environment_audio: ['身体碰撞声', '桌椅翻倒声'],
      lip_sync: false,
      camera_action: '中景正面，固定镜头',
    }),
    createEmptyDramaTimelineEvent({
      start_sec: 6,
      end_sec: 9,
      character_ids: ['snake_a', 'tommy'],
      visual_action:
        '响尾蛇帮众甲倒在一楼木地板上，用双手撑起上半身抬头看向汤米，嘴部开始说话',
      character_state: '帮众甲明显恐惧；汤米站立俯视',
      position: '帮众甲倒地于圆桌旁；汤米站其前方',
      expression: '惊恐',
      eyeline: '帮众甲抬头看向汤米',
      dialogue: '那把枪……是托马斯的枪！这小子是……治安官的儿子！',
      dialogue_character_id: 'snake_a',
      environment_audio: ['远处惊呼声'],
      lip_sync: true,
      camera_action: '中景正面，固定镜头',
    }),
    createEmptyDramaTimelineEvent({
      start_sec: 9,
      end_sec: 11,
      character_ids: ['tommy', 'snake_gang'],
      visual_action:
        '酒馆内其他响尾蛇帮众迅速向左右两侧散开，撞倒附近木桌和椅子；汤米站在画面中央',
      character_state: '帮众慌乱逃散；汤米沉默站定',
      position: '汤米画面中央；帮众向两侧',
      expression: '汤米冷硬；帮众惊慌',
      eyeline: '汤米目光看向四散人群',
      dialogue: '',
      dialogue_character_id: '',
      environment_audio: ['多人脚步声', '桌椅碰撞声', '惊叫声'],
      lip_sync: false,
      camera_action: '中景正面，固定镜头',
    }),
  ],
});

const ensured = ensureDramaShotTimelineEvents(shot);
const audit = auditDramaTimelineEventsAnswerability(ensured);

console.log('=== TimelineEvent 单镜头实测 ===');
console.log(`镜号 ${ensured.shot_no} · ${ensured.duration_sec}s · 事件 ${ensured.timeline_events.length}`);
for (const e of ensured.timeline_events) {
  console.log('-', formatDramaTimelineEventDisplay(e));
  console.log(
    `  ids=${e.character_ids.join(',') || '∅'} dlg_id=${e.dialogue_character_id || '∅'} lip=${e.lip_sync} env=${e.environment_audio.join('|') || '∅'}`,
  );
}
console.log('\n=== 验收问答 ===');
for (const a of audit.answered) console.log('✓', a);
for (const m of audit.missing) console.log('✗', m);
console.log(audit.ok ? '\nPASS：时间轴可回答验收问题' : '\nFAIL：仍有缺失');
process.exit(audit.ok ? 0 : 1);
