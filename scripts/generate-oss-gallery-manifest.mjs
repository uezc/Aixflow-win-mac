/**
 * 列举 OSS 下 web/image、web/video、web/music、web/workflow，生成 public/data/gallery-manifest.json，
 * 供落地页拉取后展示（图/视频为相对路径字符串；音乐、工作流的 title 为文件名含扩展名，并与同目录同名封面配对）。
 *
 * 目录约定（相对 Bucket 根）：
 *   web/image/     — 展示用图片
 *   web/video/     — 视频
 *   web/music/     — 音频；同目录下同主文件名的图片（.jpg/.png/…）作为 cover（写入 cover 字段，无则 ""）
 *   web/workflow/  — 工作流 .json / .aixflow；同目录同名图片作为封面（无则 cover 为 ""）
 *
 * 凭证：.env 中 OSS_* 或回退 OTS_* / OTS_ID+OTS_SECRET（与现有脚本一致）。
 *
 * 用法：
 *   npm run gallery-manifest
 *   npm run gallery-manifest -- --upload
 */

import OSS from 'ali-oss';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const envPath = path.join(rootDir, '.env');

if (fs.existsSync(envPath)) {
    const envResult = dotenv.config({ path: envPath });
    if (envResult.error) {
        console.warn('[gallery-manifest] 读取 .env 时警告:', envResult.error);
    }
} else {
    dotenv.config();
    console.warn('[gallery-manifest] 未找到', envPath, '，仅使用当前进程环境变量');
}

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif|bmp|svg)$/i;
const VIDEO_EXT = /\.(mp4|webm|mov|m4v)$/i;
const AUDIO_EXT = /\.(mp3|wav|ogg|m4a|flac|aac)$/i;
const WORKFLOW_EXT = /\.(json|aixflow)$/i;

const region = (process.env.OSS_REGION || 'oss-cn-hongkong').trim();
const bucket = (process.env.OSS_BUCKET || 'nexflow-temp-images').trim();

function resolveOssAccessKeys() {
    const id =
        process.env.OSS_ACCESS_KEY_ID?.trim() ||
        process.env.OTS_ACCESS_KEY_ID?.trim() ||
        process.env.OTS_ID?.trim();
    const secret =
        process.env.OSS_ACCESS_KEY_SECRET?.trim() ||
        process.env.OTS_ACCESS_KEY_SECRET?.trim() ||
        process.env.OTS_SECRET?.trim();
    return { accessKeyId: id, accessKeySecret: secret };
}

const { accessKeyId, accessKeySecret } = resolveOssAccessKeys();

if (!accessKeyId || !accessKeySecret) {
    console.error(
        '缺少密钥：请在 .env 中配置 OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET，或 OTS_ACCESS_KEY_ID / OTS_ACCESS_KEY_SECRET。',
    );
    process.exit(1);
}

const client = new OSS({ region, accessKeyId, accessKeySecret, bucket });

async function listAllKeys(prefix) {
    const keys = [];
    let marker = null;
    let truncated = true;
    while (truncated) {
        const res = await client.list({
            prefix,
            'max-keys': 1000,
            marker: marker || undefined,
        });
        for (const o of res.objects || []) {
            if (o.name && !o.name.endsWith('/')) keys.push(o.name);
        }
        truncated = res.isTruncated === true;
        marker = truncated ? res.nextMarker : null;
    }
    return keys;
}

function relativeUnderPrefix(key, prefix) {
    const p = prefix.endsWith('/') ? prefix : prefix + '/';
    if (!key.startsWith(p)) return null;
    const rel = key.slice(p.length);
    return rel && !rel.endsWith('/') ? rel : null;
}

/** 同目录 + 同主文件名（不含扩展名），用于配对封面；目录与主文件名不区分大小写，避免 Flow.json 与 flow.png 对不上 */
function pairKey(relPath) {
    const norm = relPath.replace(/\\/g, '/');
    const lastSlash = norm.lastIndexOf('/');
    const dir = lastSlash < 0 ? '' : norm.slice(0, lastSlash);
    const file = lastSlash < 0 ? norm : norm.slice(lastSlash + 1);
    const dot = file.lastIndexOf('.');
    const base = dot > 0 ? file.slice(0, dot) : file;
    return `${dir.toLowerCase()}\0${base.toLowerCase()}`;
}

/**
 * 在若干「图片相对路径」里，为每个 pairKey 只保留字典序最小的一条（稳定、可复现）
 */
function buildCoverMap(imageRelPaths) {
    const map = new Map();
    for (const rel of imageRelPaths) {
        const k = pairKey(rel);
        const prev = map.get(k);
        if (!prev || rel < prev) map.set(k, rel);
    }
    return map;
}

/** 相对路径的最后一段，作为展示用文件名（含扩展名） */
function fileTitleFromRel(rel) {
    const norm = String(rel || '').replace(/\\/g, '/');
    const i = norm.lastIndexOf('/');
    return i < 0 ? norm : norm.slice(i + 1);
}

function buildMusicEntries(audioRels, imageRels) {
    const coverMap = buildCoverMap(imageRels);
    const out = [];
    for (const rel of audioRels) {
        const cover = coverMap.get(pairKey(rel)) || '';
        out.push({
            file: rel,
            title: fileTitleFromRel(rel),
            cover,
        });
    }
    out.sort((a, b) => a.file.localeCompare(b.file));
    return out;
}

function buildWorkflowEntries(wfRels, imageRels) {
    const coverMap = buildCoverMap(imageRels);
    const out = [];
    for (const rel of wfRels) {
        const cover = coverMap.get(pairKey(rel)) || '';
        out.push({
            file: rel,
            title: fileTitleFromRel(rel),
            cover,
        });
    }
    out.sort((a, b) => a.file.localeCompare(b.file));
    return out;
}

async function main() {
    const imagePrefix = 'web/image/';
    const videoPrefix = 'web/video/';
    const musicPrefix = 'web/music/';
    const workflowPrefix = 'web/workflow/';

    const [imageKeys, videoKeys, musicKeys, workflowKeys] = await Promise.all([
        listAllKeys(imagePrefix),
        listAllKeys(videoPrefix),
        listAllKeys(musicPrefix),
        listAllKeys(workflowPrefix),
    ]);

    const images = imageKeys
        .map((k) => relativeUnderPrefix(k, imagePrefix))
        .filter((r) => r && IMAGE_EXT.test(r));
    const videos = videoKeys
        .map((k) => relativeUnderPrefix(k, videoPrefix))
        .filter((r) => r && VIDEO_EXT.test(r));

    const musicRelAll = musicKeys
        .map((k) => relativeUnderPrefix(k, musicPrefix))
        .filter(Boolean);
    const musicAudios = musicRelAll.filter((r) => AUDIO_EXT.test(r));
    const musicImages = musicRelAll.filter((r) => IMAGE_EXT.test(r));

    const workflowRelAll = workflowKeys
        .map((k) => relativeUnderPrefix(k, workflowPrefix))
        .filter(Boolean);
    const workflowFiles = workflowRelAll.filter((r) => WORKFLOW_EXT.test(r));
    const workflowImages = workflowRelAll.filter((r) => IMAGE_EXT.test(r));

    images.sort();
    videos.sort();

    const music = buildMusicEntries(musicAudios, musicImages);
    const workflow = buildWorkflowEntries(workflowFiles, workflowImages);

    const manifest = {
        generatedAt: new Date().toISOString(),
        schemaVersion: 2,
        images,
        videos,
        music,
        workflow,
        hints: {
            title: '音乐、工作流的 title 为对应音频/工作流文件名（含扩展名）；cover 为同目录同主文件名图片，脚本已自动配对。',
            pairing: '例如 web/music/a.mp3 与 web/music/a.jpg；web/workflow/foo.json 与 web/workflow/foo.png',
        },
    };

    const outDir = path.join(__dirname, '..', 'public', 'data');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, 'gallery-manifest.json');
    fs.writeFileSync(outFile, JSON.stringify(manifest, null, 2), 'utf-8');
    console.log(
        '已写入',
        outFile,
        `（图 ${images.length}，视频 ${videos.length}，音乐 ${music.length}，工作流 ${workflow.length}）`,
    );

    if (process.argv.includes('--upload')) {
        const target = 'web/data/gallery-manifest.json';
        await client.put(target, Buffer.from(JSON.stringify(manifest), 'utf-8'), {
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
        });
        console.log('已上传 oss://' + bucket + '/' + target);
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
