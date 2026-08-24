/**
 * 从 metadata.json 把导演分镜图/场景图/成片回填进 data.json
 * 用法: node scripts/recover-director-media-from-metadata.mjs <projectDir>
 */
import fs from 'fs';
import path from 'path';

const proj = process.argv[2];
if (!proj || !fs.existsSync(path.join(proj, 'data.json'))) {
  console.error('Usage: node scripts/recover-director-media-from-metadata.mjs <projectDir>');
  process.exit(1);
}

const dataPath = path.join(proj, 'data.json');
const metaPath = path.join(proj, 'metadata.json');
const assetsDir = path.join(proj, 'assets');

function toLocalResource(p) {
  let filePath = String(p || '').replace(/\\/g, '/');
  if (filePath.startsWith('local-resource://')) {
    filePath = filePath.replace(/^local-resource:\/\/+/, '');
    try { filePath = decodeURIComponent(filePath); } catch {}
  }
  if (filePath.match(/^\/[a-zA-Z]:/)) filePath = filePath.substring(1);
  if (!filePath) return '';
  const parts = filePath.split('/');
  const encoded = parts.map((part, i) => {
    if (i === 0 && /^[a-zA-Z]:$/.test(part)) return part;
    if (/[\u4e00-\u9fa5\s]/.test(part)) return encodeURIComponent(part);
    return part;
  });
  return `local-resource://${encoded.join('/')}`;
}

function parsePlotRows(scriptText) {
  const text = String(scriptText || '');
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const rows = [];
  for (const line of lines) {
    // 1|前奏|... or 1|...
    const m = line.match(/^(\d+)\s*[|｜]/);
    if (!m) continue;
    const parts = line.split(/[|｜]/).map((s) => s.trim());
    if (parts.length < 5) continue;
    const no = String(Number(parts[0]) || '').trim();
    if (!no) continue;
    rows.push({
      镜号: no,
      曲式段: parts[1] || '',
      人声: parts[2] || '',
      画面类型: parts[3] || '',
      地点: parts[4] || '',
      出场人物: parts[5] && parts[5] !== '—' ? parts[5] : '',
      镜头角度: parts[6] || '',
      焦距: parts[7] || '',
      画面描述: parts[8] || '',
      对口型动作: parts[9] && parts[9] !== '—' ? parts[9] : '',
      光影氛围: parts[10] || '',
      时长: '5',
      最终提示词: '',
    });
  }
  return rows;
}

function parseSceneNames(scriptText) {
  const text = String(scriptText || '');
  // 【场景】 section or unique from plot
  const names = [];
  const seen = new Set();
  for (const row of parsePlotRows(text)) {
    const n = String(row.地点 || '').trim();
    if (!n || n === '—' || seen.has(n)) continue;
    seen.add(n);
    names.push(n);
  }
  return names;
}

const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));

const directorNode = (data.nodes || []).find((n) => n.type === 'director' || n.type === 'directorDrama');
if (!directorNode) {
  console.error('No director node');
  process.exit(1);
}
const directorId = directorNode.id;
const d = directorNode.data.director || {};

// Collect metadata by director prefixes
const sbByShot = new Map();
const imgByAsset = new Map();
const videosBySpawn = new Map(); // spawnIndex -> {path, createdAt}
for (const [k, v] of Object.entries(meta)) {
  const nodeId = String(v?.nodeId || '');
  const localPath = String(v?.localPath || '').trim();
  if (!localPath || !fs.existsSync(localPath)) continue;
  const sb = nodeId.match(new RegExp(`^${directorId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-director-sb-(.+)$`));
  if (sb) {
    let shotNo = sb[1];
    try { shotNo = decodeURIComponent(shotNo); } catch {}
    const prev = sbByShot.get(shotNo);
    const ca = Number(v.createdAt) || 0;
    if (!prev || ca >= prev.createdAt) sbByShot.set(shotNo, { localPath, createdAt: ca });
    continue;
  }
  const img = nodeId.match(new RegExp(`^${directorId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-director-img-(.+)$`));
  if (img) {
    const assetId = img[1];
    const prev = imgByAsset.get(assetId);
    const ca = Number(v.createdAt) || 0;
    if (!prev || ca >= prev.createdAt) imgByAsset.set(assetId, { localPath, createdAt: ca });
    continue;
  }
  const vid = nodeId.match(/^video-(\d+)-(\d+)-([a-z0-9]+)$/i);
  if (vid && /\.mp4$/i.test(localPath)) {
    const batchTs = Number(vid[1]);
    const spawnIndex = Number(vid[2]);
    const ca = Number(v.createdAt) || batchTs;
    // only evening batch for this director session (~17865457*)
    if (batchTs < 1786545000000 || batchTs > 1786547000000) continue;
    const prev = videosBySpawn.get(spawnIndex);
    if (!prev || ca >= prev.createdAt) videosBySpawn.set(spawnIndex, { localPath, createdAt: ca, nodeId });
  }
}

// Also 镜N-*.mp4
const namedVideos = new Map();
if (fs.existsSync(assetsDir)) {
  for (const f of fs.readdirSync(assetsDir)) {
    const m = f.match(/^镜(\d+)-.+\.mp4$/i);
    if (!m) continue;
    namedVideos.set(String(Number(m[1])), path.join(assetsDir, f));
  }
}

console.log('Found sb', sbByShot.size, 'assetImgs', imgByAsset.size, 'spawnVideos', videosBySpawn.size, 'namedVideos', namedVideos.size);

let shots = Array.isArray(d.shots) ? [...d.shots] : [];
if (shots.length === 0) {
  shots = parsePlotRows(d.scriptText || '');
  console.log('Rebuilt shots from plot:', shots.length);
}

// Ensure storyboards map
const boards = { ...(d.storyboardsByShotNo || {}) };
let linkedSb = 0;
for (const [shotNo, info] of sbByShot) {
  const url = toLocalResource(info.localPath);
  const prev = boards[shotNo] || { imageUrl: '', status: 'pending' };
  boards[shotNo] = {
    ...prev,
    imageUrl: url,
    status: 'ready',
    error: undefined,
  };
  linkedSb++;
}

// Map videos: prefer named 镜N; else spawnIndex -> shot order among shots that have sb images
const shotNosWithSb = shots
  .map((s, i) => String(s['镜号'] || i + 1).trim())
  .filter((no) => String(boards[no]?.imageUrl || '').trim());
let linkedVid = 0;
for (const [spawnIndex, info] of videosBySpawn) {
  const shotNo = shotNosWithSb[spawnIndex];
  if (!shotNo) continue;
  const url = toLocalResource(info.localPath);
  const prev = boards[shotNo] || { imageUrl: '', status: 'pending' };
  // don't overwrite if named file exists later
  boards[shotNo] = {
    ...prev,
    videoUrl: url,
    videoStatus: 'ready',
    videoNodeId: info.nodeId,
    videoError: '',
  };
  linkedVid++;
}
for (const [shotNo, filePath] of namedVideos) {
  const url = toLocalResource(filePath);
  const prev = boards[shotNo] || { imageUrl: '', status: 'pending' };
  boards[shotNo] = {
    ...prev,
    videoUrl: url,
    videoStatus: 'ready',
    videoError: '',
  };
  linkedVid++;
}

// Scenes
let scenes = Array.isArray(d.assets?.scenes) ? [...d.assets.scenes] : [];
const sceneNames = parseSceneNames(d.scriptText || '');
const sceneMeta = [...imgByAsset.entries()]
  .filter(([id]) => id.startsWith('scene-'))
  .sort((a, b) => a[0].localeCompare(b[0]));

if (scenes.length === 0 && sceneNames.length) {
  scenes = sceneNames.map((name, i) => {
    const metaEntry = sceneMeta[i];
    const id = metaEntry?.[0] || `scene-recovered-${i}`;
    const imageUrl = metaEntry ? toLocalResource(metaEntry[1].localPath) : '';
    return {
      id,
      kind: 'scene',
      name,
      prompt: name,
      imageUrl,
      status: imageUrl ? 'ready' : 'pending',
    };
  });
  console.log('Rebuilt scenes:', scenes.map((s) => `${s.name}:${s.status}`).join(', '));
} else {
  // match by index to scene-* meta sorted
  scenes = scenes.map((s, i) => {
    if (String(s.imageUrl || '').trim()) return s;
    const byId = imgByAsset.get(s.id);
    const byIdx = sceneMeta[i];
    const info = byId || byIdx?.[1];
    if (!info) return s;
    return { ...s, imageUrl: toLocalResource(info.localPath), status: 'ready', error: undefined };
  });
}

// Characters: fill missing from meta
let characters = Array.isArray(d.assets?.characters) ? [...d.assets.characters] : [];
characters = characters.map((c) => {
  if (String(c.imageUrl || '').trim()) return c;
  const info = imgByAsset.get(c.id);
  if (!info) return c;
  return { ...c, imageUrl: toLocalResource(info.localPath), status: 'ready' };
});
for (const [assetId, info] of imgByAsset) {
  if (!assetId.startsWith('character-')) continue;
  if (characters.some((c) => c.id === assetId)) continue;
  characters.push({
    id: assetId,
    kind: 'character',
    name: '楚辞',
    prompt: '',
    imageUrl: toLocalResource(info.localPath),
    status: 'ready',
  });
}

const boardImg = Object.values(boards).filter((b) => String(b.imageUrl || '').trim()).length;
const boardVid = Object.values(boards).filter((b) => String(b.videoUrl || '').trim()).length;

directorNode.data.director = {
  ...d,
  shots,
  storyboardsByShotNo: boards,
  assets: {
    ...(d.assets || {}),
    characters,
    scenes,
    props: d.assets?.props || [],
    creatures: d.assets?.creatures || [],
  },
  phase: boardVid > 0 ? 'videos' : boardImg > 0 ? 'shots' : d.phase || 'assets',
  isGenerating: false,
  error: '',
};

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const bak = path.join(proj, `data.json.pre-recover-${stamp}.bak`);
fs.copyFileSync(dataPath, bak);
fs.writeFileSync(dataPath, JSON.stringify({ nodes: data.nodes, edges: data.edges || [] }));
// also refresh slot-b for durability loader
const slotB = path.join(proj, 'data.slot-b.json');
fs.writeFileSync(slotB, JSON.stringify({ nodes: data.nodes, edges: data.edges || [] }));
console.log('Recovered:', { linkedSb, linkedVid, boardImg, boardVid, shots: shots.length, scenes: scenes.length, bak });
console.log('OK. Re-open the project in Aixflow.');
