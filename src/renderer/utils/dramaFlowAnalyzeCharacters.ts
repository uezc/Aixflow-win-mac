/**
 * AI 短剧 2 代：复用 1 代剧本分析链路，抽出角色列表。
 */
import {
  analyzeDramaEpisodeOriginal,
  applyLlmAnalyzeOntoProgramSession,
  applyVisualStyleLookGrade,
  buildDramaDomainAnalyzeCompactMessages,
  buildDramaDomainAnalyzeMessages,
  composeDramaCharacterDesignPrompt,
  composeDramaSceneDesignPrompt,
  composeDramaVoiceSampleLine,
  createEmptyDramaEpisode,
  createEmptyDramaSession,
  ensureAppearingCharactersInBible,
  ensureVoiceSampleTexts,
  isDramaSystemSpeakerCharacter,
  normalizeDramaDomainAnalyzeResult,
  resolveSkipLlmAnalyze,
  type DramaCharacter,
  type DramaCreature,
  type DramaDirectorSession,
  type DramaProp,
  type DramaSceneAsset,
} from '../../shared/directorDomain';

export type DramaFlowAnalyzeCharacter = {
  characterId: string;
  name: string;
  role: string;
  identity: string;
  personality: string;
  prompt: string;
  imageUrl: string;
  voiceId: string;
  voiceSampleUrl: string;
  voicePrompt: string;
};

export type DramaFlowAnalyzeScene = {
  sceneId: string;
  name: string;
  location: string;
  kind: string;
  mood: string;
  timeDefault: string;
  weatherDefault: string;
  intro: string;
  prompt: string;
  imageUrl: string;
  spatial_structure: string;
  architecture: string;
  materials: string;
  lighting: string;
  fixed_elements: string[];
};

export type DramaFlowAnalyzeProp = {
  propId: string;
  name: string;
  intro: string;
  prompt: string;
  imageUrl: string;
};

export type DramaFlowAnalyzeCreature = {
  creatureId: string;
  name: string;
  /** 动物 | 怪兽 */
  category: '动物' | '怪兽';
  intro: string;
  prompt: string;
  imageUrl: string;
};

export type DramaFlowAnalyzeResult = {
  session: DramaDirectorSession;
  characters: DramaFlowAnalyzeCharacter[];
  scenes: DramaFlowAnalyzeScene[];
  props: DramaFlowAnalyzeProp[];
  creatures: DramaFlowAnalyzeCreature[];
};

function waitChatText(opts: {
  nodeId: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  projectId?: string;
  maxTokens?: number;
  temperature?: number;
  jsonMode?: boolean;
}): Promise<string> {
  const api = window.electronAPI;
  if (!api?.invokeAI || !api?.onAIStatusUpdate) {
    return Promise.reject(new Error('AI 通道不可用'));
  }
  const requestId = `drama-flow-analyze-${opts.nodeId}-${Date.now()}`;
  const chatNodeId = `${opts.nodeId}::flow-analyze`;
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let remove: (() => void) | undefined;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      try {
        remove?.();
      } catch {
        /* ignore */
      }
      fn();
    };
    const timer = window.setTimeout(() => {
      finish(() => reject(new Error('分析超时，请重试')));
    }, 180_000);
    remove = api.onAIStatusUpdate((packet: {
      nodeId?: string;
      status?: string;
      payload?: { text?: string; content?: string; error?: string; directorChatRequestId?: string };
    }) => {
      if (String(packet?.nodeId || '') !== chatNodeId) return;
      const rid = String(packet?.payload?.directorChatRequestId || '').trim();
      if (rid && rid !== requestId) return;
      const st = String(packet?.status || '').toUpperCase();
      if (st === 'SUCCESS' || st === 'COMPLETED' || st === 'DONE') {
        const text = String(
          packet?.payload?.text || packet?.payload?.content || '',
        ).trim();
        finish(() => {
          if (!text) reject(new Error('分析返回为空'));
          else resolve(text);
        });
        return;
      }
      if (st === 'ERROR' || st === 'FAILED') {
        finish(() =>
          reject(new Error(String(packet?.payload?.error || '分析失败'))),
        );
      }
    });
    void api
      .invokeAI({
        modelId: 'chat',
        nodeId: chatNodeId,
        input: {
          model: opts.model,
          messages: [
            { role: 'system', content: opts.systemPrompt },
            { role: 'user', content: opts.userPrompt },
          ],
          stream: false,
          projectId: opts.projectId || undefined,
          nodeTitle: 'AI短剧2代·分析角色',
          directorChatRequestId: requestId,
          ...(opts.maxTokens != null ? { max_tokens: opts.maxTokens } : {}),
          ...(opts.temperature != null ? { temperature: opts.temperature } : {}),
          ...(opts.jsonMode
            ? { response_format: { type: 'json_object' as const } }
            : {}),
        },
      })
      .catch((e: unknown) => {
        finish(() =>
          reject(e instanceof Error ? e : new Error(String(e || '分析失败'))),
        );
      });
  });
}

function mapCharacters(session: DramaDirectorSession): DramaFlowAnalyzeCharacter[] {
  const voices = session.bible?.voices || [];
  return (session.bible?.characters || [])
    .filter((c) => !isDramaSystemSpeakerCharacter(c))
    .map((c: DramaCharacter) => {
      const prompt =
        String(c.prompt || '').trim() ||
        composeDramaCharacterDesignPrompt({
          name: c.name,
          age: c.age,
          gender: c.gender,
          role: c.role,
          identity: c.identity,
          personality: c.personality,
          backstory: c.backstory,
          prompt: c.prompt,
          visual: c.visual,
        });
      const voiceId = String(c.voice_id || '').trim();
      const voice =
        voices.find((v) => String(v.voice_id || '') === voiceId) ||
        voices.find((v) => String(v.character_id || '') === String(c.character_id || ''));
      const existingVoicePrompt = String(voice?.sample_text || '').trim();
      const voicePrompt =
        existingVoicePrompt ||
        composeDramaVoiceSampleLine({
          name: c.name,
          age: c.age,
          role: c.role,
          identity: c.identity,
          personality: c.personality,
          gender: c.gender,
          timbre: voice?.timbre,
          voiceStyle: voice?.voiceStyle,
          language_style: voice?.language_style,
          emotion_range: voice?.emotion_range,
        });
      return {
        characterId: String(c.character_id || '').trim(),
        name: String(c.name || '未命名角色').trim() || '未命名角色',
        role: String(c.role || '').trim(),
        identity: String(c.identity || '').trim(),
        personality: String(c.personality || '').trim(),
        prompt,
        imageUrl: String(c.imageUrl || '').trim(),
        voiceId: voiceId || String(voice?.voice_id || '').trim(),
        voiceSampleUrl: String(voice?.sample_url || '').trim(),
        voicePrompt,
      };
    })
    .filter((c) => c.characterId);
}

function mapScenes(session: DramaDirectorSession): DramaFlowAnalyzeScene[] {
  return (session.bible?.scenes || [])
    .map((s: DramaSceneAsset) => {
      const name = String(s.name || s.location || '未命名场景').trim() || '未命名场景';
      const location = String(s.location || '').trim();
      const kind = String(s.kind || '').trim();
      const mood = String(s.mood || '').trim();
      const timeDefault = String(s.time_default || '').trim();
      const weatherDefault = String(s.weather_default || '').trim();
      const fixed = Array.isArray(s.fixed_elements)
        ? s.fixed_elements.map((x) => String(x || '').trim()).filter(Boolean)
        : [];
      const prompt =
        String(s.prompt || '').trim() ||
        composeDramaSceneDesignPrompt({
          name,
          location,
          mood,
          time_default: timeDefault,
          weather_default: weatherDefault,
          kind,
          spatial_structure: s.spatial_structure,
          architecture: s.architecture,
          materials: s.materials,
          lighting: s.lighting,
          fixed_elements: fixed,
        });
      const intro = [location || name, kind, mood, timeDefault, weatherDefault]
        .map((x) => String(x || '').trim())
        .filter(Boolean)
        .join(' · ');
      return {
        sceneId: String(s.scene_id || '').trim(),
        name,
        location,
        kind,
        mood,
        timeDefault,
        weatherDefault,
        intro,
        prompt,
        imageUrl: String(s.imageUrl || '').trim(),
        spatial_structure: String(s.spatial_structure || '').trim(),
        architecture: String(s.architecture || '').trim(),
        materials: String(s.materials || '').trim(),
        lighting: String(s.lighting || '').trim(),
        fixed_elements: fixed,
      };
    })
    .filter((s) => s.sceneId);
}

function inferCreatureCategory(c: DramaCreature): '动物' | '怪兽' {
  const blob = [c.name, c.appearance, c.behavior, c.motion_traits, c.prompt]
    .map((x) => String(x || ''))
    .join(' ');
  if (
    /怪兽|妖怪|妖兽|魔兽|异兽|巨龙|恶龙|麒麟|修罗|魔君|demon|monster|dragon|beast|妖|魔(?!法)/i.test(
      blob,
    )
  ) {
    return '怪兽';
  }
  return '动物';
}

function mapProps(session: DramaDirectorSession): DramaFlowAnalyzeProp[] {
  return (session.bible?.props || [])
    .map((p: DramaProp) => {
      const name = String(p.name || '未命名道具').trim() || '未命名道具';
      const prompt =
        String(p.prompt || '').trim() ||
        [p.appearance, p.material, p.description].map((x) => String(x || '').trim()).filter(Boolean).join('，');
      const intro = [p.description, p.appearance, p.material]
        .map((x) => String(x || '').trim())
        .filter(Boolean)
        .join(' · ');
      return {
        propId: String(p.prop_id || '').trim(),
        name,
        intro: intro || name,
        prompt: prompt || name,
        imageUrl: String(p.imageUrl || '').trim(),
      };
    })
    .filter((p) => p.propId);
}

function mapCreatures(session: DramaDirectorSession): DramaFlowAnalyzeCreature[] {
  return (session.bible?.creatures || [])
    .map((c: DramaCreature) => {
      const name = String(c.name || '未命名生物').trim() || '未命名生物';
      const category = inferCreatureCategory(c);
      const prompt =
        String(c.prompt || '').trim() ||
        [c.appearance, c.behavior, c.motion_traits]
          .map((x) => String(x || '').trim())
          .filter(Boolean)
          .join('，');
      const intro = [category, c.appearance, c.behavior]
        .map((x) => String(x || '').trim())
        .filter(Boolean)
        .join(' · ');
      return {
        creatureId: String(c.creature_id || '').trim(),
        name,
        category,
        intro: intro || `${category} · ${name}`,
        prompt: prompt || name,
        imageUrl: String(c.imageUrl || '').trim(),
      };
    })
    .filter((c) => c.creatureId);
}

export async function analyzeDramaFlowCharacters(opts: {
  scriptText: string;
  scriptTitle?: string;
  stylePresetId?: string;
  visualLookId?: string;
  visualGradeId?: string;
  stylePrompt?: string;
  chatModel?: string;
  projectId?: string;
  nodeId: string;
  onHint?: (hint: string) => void;
}): Promise<DramaFlowAnalyzeResult> {
  const source = String(opts.scriptText || '').trim();
  if (!source) throw new Error('请先粘贴剧本');

  const title = String(opts.scriptTitle || '').trim() || '我的剧本';
  const ep = createEmptyDramaEpisode({
    episode_id: `ep-flow-${Date.now()}`,
    episode_no: 1,
    title,
    text: source,
  });

  let session = createEmptyDramaSession({
    episodes: [ep],
    active_episode_id: ep.episode_id,
    meta: {
      phase: 'analyze',
      source_novel: source,
      source_script: source,
      chatModel: String(opts.chatModel || 'gpt-4o').trim(),
      stylePresetId: String(opts.stylePresetId || '').trim(),
      globalStyle: String(opts.stylePrompt || '').trim(),
      aspect_ratio: '9:16',
    },
    bible: {
      project: {
        name: title,
        type: '',
        style: '',
        worldview: '',
        visual_style: String(opts.stylePrompt || '').trim(),
        color_style: '',
        era: '',
        references: [],
      },
    } as any,
  });

  if (opts.visualLookId && opts.visualGradeId) {
    const pvb = applyVisualStyleLookGrade(opts.visualLookId, opts.visualGradeId);
    session = {
      ...session,
      bible: {
        ...session.bible,
        projectVisualBible: pvb,
        visualDNA: pvb.visualDNA,
        project: {
          ...session.bible.project,
          visual_style: String(pvb.stylePrompt || session.bible.project.visual_style || ''),
        },
      },
      meta: {
        ...session.meta,
        stylePresetId: pvb.presetId,
        globalStyle: String(pvb.stylePrompt || ''),
      },
    };
  }

  opts.onHint?.('正在切分原文…');
  const originalAnalyzed = analyzeDramaEpisodeOriginal({
    source,
    episodeId: ep.episode_id,
    characters: session.bible.characters || [],
    scenes: session.bible.scenes || [],
    voices: session.bible.voices || [],
    visualBible: session.bible.projectVisualBible,
  });

  session = {
    ...session,
    scene_beats: originalAnalyzed.scene_beats,
    episodes: (session.episodes || []).map((e) =>
      e.episode_id === ep.episode_id
        ? {
            ...e,
            visual_events: originalAnalyzed.visual_events,
            official_scene_beats: originalAnalyzed.scene_beats,
            text: source,
            updated_at: Date.now(),
          }
        : e,
    ),
  };

  const skipLlm = resolveSkipLlmAnalyze(
    (import.meta as { env?: { VITE_SKIP_LLM_ANALYZE?: string } }).env?.VITE_SKIP_LLM_ANALYZE,
  );

  if (!skipLlm) {
    opts.onHint?.('正在分析角色…');
    const styleHint =
      String(opts.stylePrompt || session.meta.globalStyle || session.bible.project.visual_style || '').trim();
    const sourceChars = source.replace(/\s+/g, '').length;
    const preferCompact = sourceChars >= 1200;
    const full = buildDramaDomainAnalyzeMessages({
      sourceText: source,
      title,
      styleHint,
      existingCharacterNames: (session.bible.characters || []).map((c) => c.name),
      existingSceneNames: (session.bible.scenes || []).map((s) => s.name || s.location),
      originalSegments: originalAnalyzed.original_segments,
    });
    const compact = buildDramaDomainAnalyzeCompactMessages({
      sourceText: source,
      title,
      styleHint,
      originalSegments: originalAnalyzed.original_segments,
    });
    const first = preferCompact ? compact : full;
    const second = preferCompact ? full : compact;
    const model = String(opts.chatModel || 'gpt-4o').trim() || 'gpt-4o';

    const runOnce = async (sys: string, user: string, jsonMode: boolean) => {
      try {
        return await waitChatText({
          nodeId: opts.nodeId,
          model,
          systemPrompt: sys,
          userPrompt: user,
          projectId: opts.projectId,
          maxTokens: preferCompact ? 8192 : 16384,
          temperature: 0.35,
          jsonMode,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (jsonMode && /response_format|json_object|unsupported|不支持/i.test(msg)) {
          return waitChatText({
            nodeId: opts.nodeId,
            model,
            systemPrompt: sys,
            userPrompt: user,
            projectId: opts.projectId,
            maxTokens: preferCompact ? 8192 : 16384,
            temperature: 0.35,
            jsonMode: false,
          });
        }
        throw err;
      }
    };

    let text = await runOnce(first.systemPrompt, first.userPrompt, true);
    let normalized = normalizeDramaDomainAnalyzeResult(text, session);
    if (!normalized.ok) {
      opts.onHint?.('改用精简提示重试…');
      text = await runOnce(second.systemPrompt, second.userPrompt, true);
      normalized = normalizeDramaDomainAnalyzeResult(text, session);
    }
    if (!normalized.ok) {
      text = await runOnce(
        compact.systemPrompt,
        `${compact.userPrompt}\n\n必须输出完整 JSON，含 characters，以 } 结束。`,
        false,
      );
      normalized = normalizeDramaDomainAnalyzeResult(text, session);
    }
    if (!normalized.ok) throw new Error(normalized.error);
    session = applyLlmAnalyzeOntoProgramSession(session, normalized.session);
  }

  session = ensureAppearingCharactersInBible(session);
  session = ensureVoiceSampleTexts(session);
  const characters = mapCharacters(session);
  if (!characters.length) {
    throw new Error('未识别到可建卡人物，请检查正文是否有「姓名：」等说话人格式');
  }
  // 分析结果写回 bible.voices.sample_text，避免建卡后弹窗仍空
  {
    const byId = new Map(characters.map((c) => [c.characterId, c.voicePrompt]));
    const voices = (session.bible.voices || []).map((v) => {
      const cid = String(v.character_id || '').trim();
      const filled = byId.get(cid);
      if (!filled || String(v.sample_text || '').trim()) return v;
      return { ...v, sample_text: filled };
    });
    session = createEmptyDramaSession({
      ...session,
      bible: { ...session.bible, voices },
    });
  }
  // 场景提示词空壳时补齐，便于建卡与生图
  {
    const scenes = mapScenes(session);
    const byId = new Map(scenes.map((s) => [s.sceneId, s.prompt]));
    const nextScenes = (session.bible.scenes || []).map((s) => {
      const filled = byId.get(String(s.scene_id || '').trim());
      if (!filled || String(s.prompt || '').trim()) return s;
      return { ...s, prompt: filled };
    });
    session = createEmptyDramaSession({
      ...session,
      bible: { ...session.bible, scenes: nextScenes },
    });
  }
  return {
    session,
    characters,
    scenes: mapScenes(session),
    props: mapProps(session),
    creatures: mapCreatures(session),
  };
}
