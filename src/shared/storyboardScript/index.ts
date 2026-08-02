/**
 * Shared storyboard-script schema, prompts, and normalization for NEXFLOW.
 *
 * Ported from AI CanvasPro:
 * - `StoryboardScriptNode.js` (UI/state/display columns)
 * - `storyboardScriptGeneration.js` (prompts + JSON normalization)
 * - `storyboardScriptFactory.js` (column schema + default state)
 *
 * Source extraction: `.tmp_storyboard_prompts_extract.md`
 */

export {
  SCHEMA_VERSION,
  NODE_TYPE,
  STORYBOARD_SCRIPT_COLUMNS,
  IMAGE_MODE_COLUMN_KEYS,
  VIDEO_MODE_COLUMN_KEYS,
  getStoryboardScriptDisplayColumns,
  createEmptyStoryboardScriptRow,
  createDefaultStoryboardScriptState,
  type MediaMode,
  type SourceMode,
  type StoryboardScriptColumnKey,
  type StoryboardScriptRow,
  type StoryboardScriptDetectedIntent,
  type StoryboardScriptDocument,
  type StoryboardScriptState,
} from './schema.js';

export {
  STORYBOARD_SCRIPT_TEXT_ONLY_SYSTEM_PROMPT,
  STORYBOARD_SCRIPT_TEXT_ONLY_USER_PROMPT_TEMPLATE,
  STORYBOARD_SCRIPT_IMAGE_SYSTEM_PROMPT,
  STORYBOARD_SCRIPT_IMAGE_USER_PROMPT_TEMPLATE,
  STORYBOARD_SCRIPT_VIDEO_SYSTEM_PROMPT,
  STORYBOARD_SCRIPT_VIDEO_USER_PROMPT_TEMPLATE,
  STORYBOARD_SCRIPT_MULTIMODAL_PROMPT_TEMPLATE,
} from './prompts.js';

export {
  fillTemplate,
  resolveSourceMode,
  buildStoryboardScriptMessages,
  type BuildStoryboardScriptMessagesInput,
  type BuildStoryboardScriptMessagesResult,
} from './buildPrompt.js';

export {
  extractJsonObject,
  normalizeStoryboardScriptGenerationResult,
  type NormalizeStoryboardScriptGenerationResult,
  type NormalizeStoryboardScriptGenerationResultOptions,
} from './normalize.js';

export { serializeStoryboardScriptRowsToCsv } from './exportCsv.js';

export {
  buildStoryboardScriptStatePatch,
  updateStoryboardScriptCell,
  setStoryboardScriptSelectedRows,
} from './statePatch.js';

export {
  buildStoryboardVideoFrameReferenceSummary,
  buildImageLabels,
  buildVideoLabels,
  type StoryboardVideoFrameRef,
} from './videoFrameSummary.js';
