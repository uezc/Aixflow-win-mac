import { app } from 'electron';
import path from 'path';
import Store from 'electron-store';

// 统一 userData 路径：开发模式与打包模式使用相同目录，避免「安装软件包后草稿/模块丢失」
// 打包版曾用 productName；开发版可能用 package name(nexflow) 或 Electron。统一固定为 NEXFLOW 目录，避免切换后草稿丢失（与品牌显示名无关）
const appData = app.getPath('appData');
app.setPath('userData', path.join(appData, 'NEXFLOW'));

/**
 * 使用 electron-store 进行本地数据存储
 * 确保 Key 和激活码等敏感信息安全存储
 */
export const store = new Store({
  name: 'nexflow-config',
  defaults: {
    // 激活状态（已废弃直接读写；以 license_info_encrypted 解密后验签为准）
    activated: false,
    activationCode: '',
    // 加密后的授权信息（防止篡改；每次启动重新验签）
    license_info_encrypted: '',
    // 激活时的机器 ID（审计预留，当前不强制绑定）
    machine_id: '',
    // 项目列表
    projects: [] as Array<{
      id: string;
      name: string;
      date: string;
      createdAt: number;
      lastModified: number;
    }>,
    // 全局 LLM 人设列表（所有 LLM 节点共享）
    globalLLMPersonas: [] as Array<{
      id: string;
      name: string;
      content: string;
    }>,
    // 角色列表
    characters: [] as Array<{
      id: string;
      nickname: string; // 角色昵称
      name: string; // 角色名字（由 AI 生成）
      avatar: string; // 角色头像 URL（由 AI 生成）
      createdAt: number; // 创建时间戳
      permalink?: string;
      voiceClip?: string; // 角色参考音 local-resource 或 URL
      localVoicePath?: string; // 本地声音片段路径（删除角色时清理）
      viewImages?: string[]; // 四视图槽位 URL（最多 4 项，空串占位）
      localViewPaths?: string[]; // 四视图本地文件（删除角色时清理）
    }>,
    /** 数字人资产库（HeyGem 参考视频 + 可选驱动音频） */
    digitalHumanLibrary: [] as Array<{
      id: string;
      nickname: string;
      name: string;
      createdAt: number;
      poster?: string;
      localPosterPath?: string;
      videoUrl?: string;
      localVideoPath?: string;
      originalVideoUrl?: string;
      audioUrl?: string;
      localAudioPath?: string;
      originalAudioUrl?: string;
    }>,
    /** RVC 音色模型资产库（训练产出的 zip 包） */
    rvcVoiceLibrary: [] as Array<{
      id: string;
      nickname: string;
      name: string;
      createdAt: number;
      avatar?: string;
      localAvatarPath?: string;
      rvcTrainModelName?: string;
      packageFileName?: string;
      modelPackageUrl?: string;
      localModelPath?: string;
      originalModelUrl?: string;
      /** 训练用声音片段（local-resource） */
      trainAudioUrl?: string;
      localTrainAudioPath?: string;
      /** 训练音频原始远程 URL（OSS 等） */
      originalTrainAudioUrl?: string;
    }>,
    // 阿里云 OSS 配置（可选，优先使用环境变量）
    ossAccessKeyId: '',
    ossAccessKeySecret: '',
    ossRegion: 'oss-cn-hongkong',
    ossBucket: 'nexflow-temp-images',
    /** OSS 访问通道：cn=中国直连 OSS 源站；global=CDN（需 OSS_PUBLIC_BASE_URL 闭环后再开） */
    ossRouteChannel: 'cn' as 'cn' | 'global',
    /** 云端 FC 入口；与 nxMediaOssRegion 同步（画布「中国优化/全球线路」） */
    nxCloudFcRoute: 'beijing' as 'hk' | 'beijing',
    /** 临时素材 OSS 桶：cn=北京桶，hk=香港桶（设置页「素材线路」） */
    nxMediaOssRegion: '' as '' | 'cn' | 'hk',
    // 任务列表
    tasks: [] as Array<{
      id: string;
      nodeId: string;
      nodeTitle: string;
      imageUrl?: string;
      videoUrl?: string;
      audioUrl?: string;
      prompt: string;
      createdAt: number;
      status?: 'success' | 'error' | 'processing';
      errorMessage?: string;
      taskType?: 'image' | 'video' | 'text' | 'audio';
      localFilePath?: string;
      /** RunningHub /query 用 taskId，用于应用重启后恢复轮询 */
      runningHubTaskId?: string;
    }>,
    // 项目存储根路径（空则使用安装目录下的 projects）
    customProjectPath: '' as string,
    // 其他配置项
    /** 上次成功登录的邮箱（登出后仍保留，用于设置页预填；与 cloudUser.nxEmail 分离） */
    nxLastLoginEmail: '' as string,
    /** 实验性硬件加速：开启后画布/视频可走 GPU；部分机器可能黑屏，须重启生效 */
    experimentalHardwareAcceleration: false as boolean,
  },
});

/** 物理删除历史版本持久化的第三方 Key 字段（若存在） */
for (const legacyKey of ['bltcyApiKey', 'runningHubApiKey'] as const) {
  try {
    if ((store as unknown as { has: (k: string) => boolean }).has(legacyKey)) {
      (store as unknown as { delete: (k: string) => void }).delete(legacyKey);
    }
  } catch {
    /* noop */
  }
}
