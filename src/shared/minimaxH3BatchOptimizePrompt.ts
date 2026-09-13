/**
 * Batch H3 skill optimize
 */
import {
  buildMinimaxH3OptimizeMessages,
  parseMinimaxH3OptimizedPrompt,
  recoverMinimaxH3OptimizedPrompt,
  isAcceptableMinimaxH3OptimizedPrompt,
  type MinimaxH3OptimizeStructure,
  type BuildMinimaxH3OptimizeMessagesInput,
} from './minimaxH3OptimizePrompt.js';

export type BatchShotInput = {
  index: number;
  prompt: string;
  imageCount: number;
  hasRefAudio: boolean;
  durationSec: number;
};

export type BatchShotOutput = {
  index: number;
  final: string;
  ok: boolean;
};

const BATCH_DELIMITER = '=== SHOT';
const BATCH_DELIMITER_RE = /===\s*SHOT\s*(\d+)\s*===/gi;

export function buildBatchMinimaxH3OptimizeMessages(
  baseInput: BuildMinimaxH3OptimizeMessagesInput,
  shots: BatchShotInput[],
): { systemPrompt: string; userPrompt: string } {
  const first = shots[0];
  const baseInputWithFirst: BuildMinimaxH3OptimizeMessagesInput = {
    ...baseInput,
    prompt: first.prompt,
    imageCount: first.imageCount,
    hasRefAudio: first.hasRefAudio,
    durationSec: first.durationSec,
  };
  const base = buildMinimaxH3OptimizeMessages(baseInputWithFirst);
  const batchRules = [
    '',
    '# Batch Rules',
    `You are optimizing ${shots.length} shots in a single response.`,
    `Separate each shot` + "'" + `s optimized prompt with a line containing ONLY: ${BATCH_DELIMITER} N ===`,
    'Each shot section must be a complete, standalone H3 prompt following all rules above.',
    'Do NOT merge shots or share content across shot boundaries.',
  ].join('\n');
  const systemPrompt = base.systemPrompt + '\n' + batchRules;
  const shotBlocks = shots.map((s) => {
    const lines = [
      `${BATCH_DELIMITER} ${s.index} ===`,
      `Duration: ${s.durationSec}s | Images: ${s.imageCount} | Ref Audio: ${s.hasRefAudio ? 'yes' : 'no'}`,
      '',
      'Current prompt (rewrite this):',
      s.prompt,
    ];
    return lines.join('\n');
  });
  const userPrompt = [
    '## Context',
    `- Total shots to optimize: ${shots.length}`,
    '',
    '## Shots to optimize',
    'Rewrite EACH shot below into a complete H3 prompt. Separate outputs with the delimiter line.',
    '',
    shotBlocks.join('\n\n'),
    '',
    `Output ${shots.length} optimized prompts, each starting with ${BATCH_DELIMITER} N ===`,
  ].join('\n');
  return { systemPrompt, userPrompt };
}

export function parseBatchMinimaxH3OptimizedPrompts(
  text: unknown,
  structure: MinimaxH3OptimizeStructure,
  shots: BatchShotInput[],
): BatchShotOutput[] {
  const raw = typeof text === 'string' ? text : text == null ? '' : String(text);
  if (!raw.trim()) return shots.map((s) => ({ index: s.index, final: s.prompt, ok: false }));
  const segments = new Map<number, string>();
  const matches = [...raw.matchAll(BATCH_DELIMITER_RE)];
  for (let i = 0; i < matches.length; i++) {
    const shotNum = parseInt(matches[i][1], 10);
    const start = (matches[i].index as number) + matches[i][0].length;
    const end = i + 1 < matches.length ? (matches[i + 1].index as number) : raw.length;
    segments.set(shotNum, raw.slice(start, end).trim());
  }
  if (segments.size === 0) {
    const single = recoverMinimaxH3OptimizedPrompt(parseMinimaxH3OptimizedPrompt(raw, structure));
    if (isAcceptableMinimaxH3OptimizedPrompt(single) && shots.length === 1) {
      return [{ index: shots[0].index, final: single, ok: true }];
    }
    return shots.map((s) => ({ index: s.index, final: s.prompt, ok: false }));
  }
  const results: BatchShotOutput[] = [];
  for (const shot of shots) {
    const seg = segments.get(shot.index);
    if (!seg) {
      results.push({ index: shot.index, final: shot.prompt, ok: false });
      continue;
    }
    const altStructure: MinimaxH3OptimizeStructure = structure === 'ref' ? 'base' : 'ref';
    let parsed = recoverMinimaxH3OptimizedPrompt(parseMinimaxH3OptimizedPrompt(seg, structure, shot.prompt));
    if (!isAcceptableMinimaxH3OptimizedPrompt(parsed)) {
      parsed = recoverMinimaxH3OptimizedPrompt(parseMinimaxH3OptimizedPrompt(seg, altStructure, shot.prompt));
    }
    if (!isAcceptableMinimaxH3OptimizedPrompt(parsed)) {
      results.push({ index: shot.index, final: shot.prompt, ok: false });
    } else {
      results.push({ index: shot.index, final: parsed, ok: true });
    }
  }
  return results;
}
