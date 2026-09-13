/** AI 短剧导演台 Domain V2 */

export * from './types.js';
export * from './ids.js';
export * from './factories.js';
export * from './shotListEdit.js';
export * from './mergeDramaShots.js';
export * from './episodes.js';
export * from './episodeBible.js';
export * from './visualDna.js';
export * from './visualStylePresets.js';
export * from './dramaManualPipeline.js';
export * from './visualStyleLookColor.js';
export * from './genreLock.js';
export * from './migrate.js';
export * from './continuity.js';
export * from './package.js';
export * from './review.js';
export * from './session.js';
export * from './userPhase.js';
export * from './normalizeAnalyze.js';
export * from './skipLlmAnalyze.js';
export * from './mergeDramaVisualEvents.js';
export * from './mergeAnalyzeBible.js';
export * from './castLibrary.js';
export * from './projectToPipeline.js';
export * from './prompts/analyze.js';
export * from './prompts/shotPlan.js';
export * from './prompts/shotPlanEnrich.js';
export * from './prompts/characterBible.js';
export * from './prompts/cameraMoveHandbook.js';
export * from './prompts/h3VideoCraftHandbook.js';
export * from './prompts/h3TimingSoundHandbook.js';
export * from './prompts/novelToScreenplay.js';
export * from './shotPlanValidate.js';
export * from './shotDurationEngine.js';
export * from './shotDurationFastPace.js';
export * from './adapters/types.js';
export * from './assetImageSync.js';
export * from './shotTimeline.js';
export * from './boardPromptSync.js';
export * from './dramaShotPromptBackfill.js';
export * from './timelineEvent.js';
export * from './ensureAppearingCharacters.js';
export * from './characterCostumes.js';
export * from './ensureVoiceSampleTexts.js';
export * from './shotAudio.js';
export {
  isDramaSystemVoiceId,
  isDramaSystemOnlyVoiceId,
  isDramaNarratorVoiceId,
  isDramaNarratorSpeakerName,
  resolveDramaVoiceRole,
  isDramaSystemVoiceEntity,
  isDramaSystemSpeakerCharacter,
  stripDramaSystemSpeakerCharacters,
  resolveDramaSystemVoice,
  resolveDramaNarratorVoice,
  dramaShotHasSystemDialogue,
  dramaShotHasNarratorDialogue,
  dramaSessionNeedsSystemVoice,
  dropDramaSystemVoice,
  suppressDramaSystemVoice,
  isDramaSystemVoiceSuppressed,
  DRAMA_SYSTEM_VOICE_SUPPRESS_KEY,
  sanitizeDramaCharacterIds,
  systemVoiceSampleUrl,
  composeDramaSystemVoiceSampleText,
  composeDramaSystemVisualPrompt,
  isDramaSystemVisualAssetId,
  resolveDramaSystemVisualAssetId,
  DRAMA_SYSTEM_SPEAKER_ID,
  DRAMA_NARRATOR_SPEAKER_ID,
  DRAMA_SYSTEM_VOICE_ENTITY,
  DRAMA_NARRATOR_VOICE_ENTITY,
  DRAMA_SYSTEM_VOICE_TIMBRE,
  DRAMA_SYSTEM_VISUAL_ASSET_NAME,
  DRAMA_SYSTEM_HOLOGRAM_VISUAL_ZH,
  DRAMA_SYSTEM_HOLOGRAM_VISUAL_EN,
  isDramaSystemHologramVisual,
  ensureDramaSystemHologramVisual,
} from './voiceEntity.js';
export {
  buildDramaShotVoiceBindingTable,
  attachDramaVoiceBindingPictures,
  formatDramaVoiceBindingTableText,
  collectDramaShotSpeakingEntities,
  resolveSpokenLineVoiceRole,
  audioIndexForVoiceEntity,
} from './voiceBinding.js';
export * from './characterDesignPrompt.js';
export * from './sceneSettingPeriod.js';
export * from './scenePromptFromOriginal.js';
export * from './principles.js';
export * from './constraints.js';
export * from './shotCastGate.js';
export * from './dependencyCheck.js';
export * from './migrateContract.js';
export * from './extractCastFromScript.js';
export * from './executeTablePrompt.js';
export * from './composeDramaH3OfficialPrompt.js';
export * from './composeDramaShotLiteralPrompt.js';
export * from './composeDramaShotLensPrompt.js';
export * from './compileDramaShotVideoRequest.js';
export * from './h3PromptCompiler.js';
export * from './h3DialogueMode.js';
export * from './migrateH3Compiler.js';
export * from './directingEnhance.js';
export * from './dramaH3PromptOptimize.js';
export * from './dramaH3SpliceIntegrate.js';
export * from './dramaShotStoryboard.js';
export * from './h3Prompts.js';
export * from './compilers/h3CompileMode.js';
export * from './compilers/h3MultiCompiler.js';
export * from './compilers/h3AudioCompiler.js';
export * from './directorCameraSchema.js';
export * from './cinematicCameraAction.js';
export * from './visiblePerformance.js';
export * from './directorQa.js';
export * from './directingBreakdown.js';
export * from './directingBreakdownPrompt.js';
export * from './directingBreakdownRules.js';
export * from './directingBreakdown.examples.js';
export * from './originalScript.js';
export * from './scriptDesign.js';
export * from './shotPlanning.js';
export * from './batchAnalyze.js';

// 注册 H3 Adapter（全能参考 / 对口型）
import './adapters/h3MultiAdapter.js';
import './adapters/h3AudioAdapter.js';
export * from './dramaVideoModels.js';
export * from './shotRefs.js';
export * from './pruneUnusedAssets.js';

