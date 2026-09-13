import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

// 暴露受保护的方法给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  // 激活码管理
  validateActivation: (activationCode: string) => ipcRenderer.invoke('validate-activation', activationCode),
  checkActivation: () => ipcRenderer.invoke('check-activation'),
  getLicenseInfo: () => ipcRenderer.invoke('get-license-info'),
  generateActivationCode: (days: number) => ipcRenderer.invoke('generate-activation-code', days),

  // API Key 管理
  saveBLTCYApiKey: (apiKey: string) => ipcRenderer.invoke('save-bltcy-api-key', apiKey),
  saveRHApiKey: (apiKey: string) => ipcRenderer.invoke('save-rh-api-key', apiKey),
  getBLTCYApiKey: () => ipcRenderer.invoke('get-bltcy-api-key'),
  getRHApiKey: () => ipcRenderer.invoke('get-rh-api-key'),
  getVideoInteractionSettings: () => ipcRenderer.invoke('get-video-interaction-settings'),
  saveVideoInteractionSettings: (settings: {
    profile: 'smooth' | 'performance';
    ultraNearZoomThreshold: number;
    fpsDropThreshold: number;
    interactionResumeDelayMs: number;
    fastMoveSpeedThreshold: number;
    prefetchScreenFactor: number;
  }) => ipcRenderer.invoke('save-video-interaction-settings', settings),

  // 余额查询（支持强制刷新参数）
  queryBLTCYBalance: (force?: boolean) => ipcRenderer.invoke('query-bltcy-balance', force),
  queryRHBalance: (force?: boolean) => ipcRenderer.invoke('query-rh-balance', force),
  queryAllBalances: (force?: boolean) => ipcRenderer.invoke('query-all-balances', force),

  // 监听余额更新
  onBalanceUpdated: (callback: (data: { type: 'bltcy' | 'rh'; balance: number | null }) => void) => {
    ipcRenderer.on('balance-updated', (_, data) => callback(data));
  },

  // 移除监听器
  removeBalanceUpdatedListener: () => {
    ipcRenderer.removeAllListeners('balance-updated');
  },

  // Laf 云开发
  initLafUser: () => ipcRenderer.invoke('laf-init-user') as Promise<{ userId: string | null; balance: number; isPro: boolean; status: string }>,
  getLafUserState: () => ipcRenderer.invoke('laf-get-user-state') as Promise<{ userId: string | null; balance: number; isPro: boolean; status: string }>,
  /** 正式版：邮箱登录 / 注册 / 登出 */
  nxCloudLogin: (email: string, password: string) => ipcRenderer.invoke('nx-cloud-login', email, password),
  nxCloudGetFcRoute: () =>
    ipcRenderer.invoke('nx-cloud-get-fc-route') as Promise<{
      route: 'hk' | 'beijing';
      activeEndpoint: string;
      hkEndpoint: string;
      beijingEndpoint: string;
    }>,
  nxCloudSetFcRoute: (route: 'hk' | 'beijing') =>
    ipcRenderer.invoke('nx-cloud-set-fc-route', route) as Promise<{
      ok: boolean;
      route: 'hk' | 'beijing';
      activeEndpoint: string;
    }>,
  nxMediaOssGetRegion: () =>
    ipcRenderer.invoke('nx-media-oss-get-region') as Promise<{
      region: 'cn' | 'hk';
      fcRoute: 'hk' | 'beijing';
      manual: boolean;
      activeRegion: 'cn' | 'hk';
    }>,
  nxMediaOssSetRegion: (region: 'cn' | 'hk') =>
    ipcRenderer.invoke('nx-media-oss-set-region', region) as Promise<{
      ok: boolean;
      region: 'cn' | 'hk';
      fcRoute: 'hk' | 'beijing';
      activeEndpoint: string;
      preferFc: boolean;
      reachable: boolean;
      mediaRegion: 'cn' | 'hk';
    }>,
  nxCloudEnsureFcRouteForCanvas: () =>
    ipcRenderer.invoke('nx-cloud-ensure-fc-route-for-canvas') as Promise<{
      route: 'hk' | 'beijing';
      beijingAvailable: boolean;
      deferred: boolean;
      activeEndpoint: string;
    }>,
  nxCloudSendAuthCode: (email: string, purpose?: 'login' | 'change_password') =>
    ipcRenderer.invoke('nx-cloud-send-auth-code', email, purpose) as Promise<{ ok: boolean }>,
  nxCloudChangePassword: (email: string, code: string, newPassword: string) =>
    ipcRenderer.invoke('nx-cloud-change-password', email, code, newPassword) as Promise<{ ok: boolean }>,
  nxCloudLoginWithCode: (email: string, code: string) =>
    ipcRenderer.invoke('nx-cloud-login-with-code', email, code) as Promise<{
      userId: string | null;
      balance: number;
      isPro: boolean;
      status: string;
      isNewUser?: boolean;
    }>,
  nxCloudRegister: (email: string, password: string, code: string) =>
    ipcRenderer.invoke('nx-cloud-register', email, password, code),
  nxCloudLogout: () => ipcRenderer.invoke('nx-cloud-logout'),
  nxCloudGetProfile: () =>
    ipcRenderer.invoke('nx-cloud-get-profile') as Promise<{
      userId: string | null;
      balance: number;
      isPro: boolean;
      status: string;
      nxEmail?: string | null;
      isFirstRecharge?: boolean;
    }>,
  nxCloudGetTransactions: (limit?: number, page?: number) =>
    ipcRenderer.invoke('nx-cloud-get-transactions', limit, page) as Promise<{
      items: Array<{
        tx_id: string;
        task_id?: string;
        amount?: string | number;
        type?: string;
        provider?: string;
        description?: string;
        created_at?: string;
        balance_after?: string | number;
      }>;
      page: number;
      pageSize: number;
      total: number;
      hasMore: boolean;
    }>,
  nxCloudGetTasks: (limit?: number) =>
    ipcRenderer.invoke('nx-cloud-get-tasks', limit) as Promise<{
      items: Array<{
        task_id: string;
        user_id?: string;
        status?: string;
        amount?: string | number;
        cost?: string | number;
        prompt_json?: string;
        workflow_json?: string;
        result_oss_url?: string;
        error_msg?: string;
        created_at?: string | number;
        updated_at?: string | number;
      }>;
    }>,
  nxCloudTaskStatus: (taskId: string) =>
    ipcRenderer.invoke('nx-cloud-task-status', taskId) as Promise<{
      task_id: string;
      user_id?: string;
      status?: string;
      amount?: string | number;
      cost?: string | number;
      prompt_json?: string;
      workflow_json?: string;
      result_oss_url?: string;
      error_msg?: string;
      created_at?: string | number;
      updated_at?: string | number;
      balance?: number;
    }>,
  onNxCloudTrackTask: (
    callback: (payload: {
      taskId: string;
      nodeId: string;
      taskType: 'image' | 'video' | 'audio' | 'llm';
      balance?: number;
    }) => void,
  ) => {
    const handler = (
      _: IpcRendererEvent,
      payload: {
        taskId: string;
        nodeId: string;
        taskType: 'image' | 'video' | 'audio' | 'llm';
        balance?: number;
      },
    ) => {
      callback(payload);
    };
    ipcRenderer.on('nx-cloud-track-task', handler);
    return () => {
      ipcRenderer.removeListener('nx-cloud-track-task', handler);
    };
  },
  nxCloudRecharge: (amountCny: number) =>
    ipcRenderer.invoke('nx-cloud-recharge', amountCny) as Promise<{
      userId: string | null;
      balance: number;
      isPro: boolean;
      status: string;
      nxEmail?: string | null;
      isFirstRecharge?: boolean;
    }>,
  alipayCreateRechargeOrder: (packageId: string) =>
    ipcRenderer.invoke('alipay-create-recharge-order', packageId) as Promise<{
      package_id: string;
      out_trade_no: string;
      total_amount: string;
      package_yuanbao: number;
      subject: string;
      pay_url: string;
    }>,
  alipayWatchOrderSettlement: (outTradeNo: string, baselineBalance: number) =>
    ipcRenderer.invoke('alipay-watch-order-settlement', outTradeNo, baselineBalance) as Promise<{ watching: true }>,
  alipayGetOrderStatus: (outTradeNo: string) =>
    ipcRenderer.invoke('alipay-get-order-status', outTradeNo) as Promise<{
      out_trade_no: string;
      status: string;
      is_settled?: boolean;
      balance?: number | null;
    }>,
  onRechargeSettled: (
    callback: (payload: { out_trade_no: string; balance: number; added_yuanbao: number }) => void,
  ) => {
    const handler = (
      _: IpcRendererEvent,
      payload: { out_trade_no: string; balance: number; added_yuanbao: number },
    ) => {
      callback(payload);
    };
    ipcRenderer.on('recharge-settled', handler);
    return () => {
      ipcRenderer.removeListener('recharge-settled', handler);
    };
  },
  nxCloudRedeemCoupon: (code: string) =>
    ipcRenderer.invoke('nx-cloud-redeem-coupon', code) as Promise<{
      userId: string | null;
      balance: number;
      isPro: boolean;
      status: string;
      nxEmail?: string | null;
      isFirstRecharge?: boolean;
    }>,
  nxCloudFetchModelConfig: () =>
    ipcRenderer.invoke('nx-cloud-fetch-model-config') as Promise<{
      items: Array<{
        model_id: string;
        function_name?: string;
        is_active?: boolean;
        base_price?: number;
        multiplier?: number;
        yuanbao_rate?: number;
      }>;
      /** 主进程拉取失败时返回，供 UI 提示（网络 / 鉴权 / FC 等） */
      fetchError?: string;
    }>,

  /** 运营控制台（需本机 NX_ADMIN_ISSUE_COUPON_SECRET 与 FC 一致） */
  adminIssueCoupon: (amountCny: number) =>
    ipcRenderer.invoke('admin-issue-coupon', amountCny) as Promise<{ code: string; amount_cny: number }>,
  adminDashboardStats: () =>
    ipcRenderer.invoke('admin-dashboard-stats') as Promise<{
      timezone: string;
      date: string;
      today_revenue_yuanbao: number;
      total_coupon_codes: number;
      pending_failed_or_timeout_tasks: number;
      queued_tasks: number;
      producing_tasks: number;
      claimed_tasks: number;
      running_tasks: number;
      pending_tasks: number;
      processing_tasks: number;
      queued_video_tasks: number;
      queued_image_tasks: number;
      producing_video_tasks: number;
      producing_image_tasks: number;
      platform_video_running: number | null;
      platform_video_max: number | null;
      platform_image_running: number | null;
      platform_image_max: number | null;
      tx_rows_scanned: number;
      task_rows_scanned: number;
      task_scan_truncated: boolean;
      coupon_full_scan: boolean;
    }>,
  adminFailedTasks: () =>
    ipcRenderer.invoke('admin-failed-tasks') as Promise<{
      tasks: Array<{
        task_id: string;
        user_id: string;
        status: string;
        cost: number;
        error_msg?: string;
        created_at?: unknown;
        updated_at?: unknown;
      }>;
      scanned: number;
    }>,
  adminRefundTask: (userId: string, taskId: string) =>
    ipcRenderer.invoke('admin-refund-task', userId, taskId) as Promise<{
      balance: number;
      refunded?: boolean;
      idempotent?: boolean;
      reason?: string;
    }>,
  adminModelConfigList: () =>
    ipcRenderer.invoke('admin-model-config-list') as Promise<{
      items: Array<{
        model_id: string;
        function_name?: string;
        is_active?: boolean;
        base_price?: number;
        multiplier?: number;
        yuanbao_rate?: number;
      }>;
    }>,
  adminModelConfigUpsert: (row: {
    model_id: string;
    function_name?: string;
    is_active?: boolean;
    base_price?: number;
    multiplier?: number;
    yuanbao_rate?: number;
  }) => ipcRenderer.invoke('admin-model-config-upsert', row) as Promise<{ model_id: string }>,
  adminGetAllUsers: (maxScanRows?: number) =>
    ipcRenderer.invoke('admin-get-all-users', maxScanRows) as Promise<{
      users: Array<{
        user_id: string;
        email: string;
        registration_date: number;
        last_login: number | null;
        status: string;
      }>;
      total_count: number;
      scan_truncated?: boolean;
    }>,
  adminProfitAnalytics: (opts?: { maxTxScanRows?: number; maxCouponScanRows?: number }) =>
    ipcRenderer.invoke('admin-profit-analytics', opts ?? {}) as Promise<{
      timezone: string;
      daily_profits: Array<{
        period: string;
        profit_yuanbao: number;
        revenue_yuanbao: number;
        cost_yuanbao: number;
      }>;
      monthly_profits: Array<{
        period: string;
        profit_yuanbao: number;
        revenue_yuanbao: number;
        cost_yuanbao: number;
      }>;
      yearly_profits: Array<{
        period: string;
        profit_yuanbao: number;
        revenue_yuanbao: number;
        cost_yuanbao: number;
      }>;
      total_revenue: number;
      total_cost: number;
      total_profit: number;
      current_month_profit_yuanbao: number;
      current_month_revenue_yuanbao: number;
      current_month_key: string;
      model_profit_leaderboard: Array<{
        model_id: string;
        profit_yuanbao: number;
        revenue_yuanbao: number;
        cost_yuanbao: number;
        task_count: number;
      }>;
      coupon_used_count: number;
      coupon_face_value_cny_sum: number;
      coupon_estimated_yuanbao: number;
      yuanbao_per_cny_assumed: number;
      tx_rows_scanned: number;
      coupon_rows_scanned: number;
      tx_scan_truncated: boolean;
    }>,

  getNxSaasState: () =>
    ipcRenderer.invoke('get-nx-saas-state') as Promise<{
      enabled: boolean;
      loggedIn: boolean;
      balance: number;
      email: string | null;
      isFirstRecharge: boolean;
      directRechargeEnabled: boolean;
    }>,
  getOssRouteChannel: () =>
    ipcRenderer.invoke('get-oss-route-channel') as Promise<'cn' | 'global'>,
  setOssRouteChannel: (channel: 'cn' | 'global') =>
    ipcRenderer.invoke('set-oss-route-channel', channel) as Promise<{ success: true; channel: 'cn' | 'global' }>,
  getExperimentalHardwareAcceleration: () =>
    ipcRenderer.invoke('get-experimental-hardware-acceleration') as Promise<{
      enabled: boolean;
      active: boolean;
    }>,
  setExperimentalHardwareAcceleration: (enabled: boolean) =>
    ipcRenderer.invoke('set-experimental-hardware-acceleration', enabled) as Promise<{
      success: true;
      enabled: boolean;
      needsRestart: boolean;
    }>,
  relaunchApp: () => ipcRenderer.invoke('app:relaunch') as Promise<{ success: true }>,
  getGpuDiagnostics: () =>
    ipcRenderer.invoke('get-gpu-diagnostics') as Promise<{
      experimentalEnabled: boolean;
      sessionActive: boolean;
      featureStatus: Record<string, string>;
      gpuDevice: string | null;
    }>,
  onLafBalanceUpdated: (callback: (state: { userId: string | null; balance: number; isPro: boolean; status: string }) => void) => {
    const handler = (_: IpcRendererEvent, state: { userId: string | null; balance: number; isPro: boolean; status: string }) => {
      callback(state);
    };
    ipcRenderer.on('laf-balance-updated', handler);
    return () => {
      ipcRenderer.removeListener('laf-balance-updated', handler);
    };
  },

  // 项目管理
  getProjects: () => ipcRenderer.invoke('get-projects'),
  createProject: (name: string) => ipcRenderer.invoke('create-project', name),
  updateProject: (projectId: string, name: string) => ipcRenderer.invoke('update-project', projectId, name),
  reorderProjects: (projectIds: string[]) => ipcRenderer.invoke('reorder-projects', projectIds),
  deleteProject: (projectId: string) => ipcRenderer.invoke('delete-project', projectId),

  // 项目数据（节点和边）
  saveProjectData: (projectId: string, nodes: any[], edges: any[], opts?: { allowEmptyOverwrite?: boolean; allowShrinkOverwrite?: boolean; force?: boolean }) =>
    ipcRenderer.invoke('save-project-data', projectId, nodes, edges, opts),
  loadProjectData: (projectId: string) => ipcRenderer.invoke('load-project-data', projectId),
  listProjectDataBackups: (projectId: string) => ipcRenderer.invoke('list-project-data-backups', projectId),
  backupProjectData: (projectId: string) => ipcRenderer.invoke('backup-project-data', projectId),
  restoreProjectDataFromBackup: (projectId: string) =>
    ipcRenderer.invoke('restore-project-data-from-backup', projectId),
  copyFileToProjectAssets: (projectId: string | undefined, sourceFilePath: string) => ipcRenderer.invoke('copy-file-to-project-assets', projectId, sourceFilePath),
  saveDroppedFileBufferToProjectAssets: (projectId: string | undefined, fileName: string, buffer: ArrayBuffer) => ipcRenderer.invoke('save-dropped-file-buffer-to-project-assets', projectId, fileName, buffer),
  finalizeMicRecording: (projectId: string | undefined, savedPath: string) =>
    ipcRenderer.invoke('finalize-mic-recording', projectId, savedPath) as Promise<{ savedPath: string; durationSec: number }>,
  createImageLocalResourceFromFile: (projectId: string | undefined, sourceFilePath: string) =>
    ipcRenderer.invoke('local-resource:create-image-from-file', projectId, sourceFilePath),
  createImageLocalResourceFromBuffer: (projectId: string | undefined, fileName: string, buffer: ArrayBuffer) =>
    ipcRenderer.invoke('local-resource:create-image-from-buffer', projectId, fileName, buffer),
  readImageAsDataUrl: (imageUrl: string, fallbackUrl?: string, localPath?: string, ossUrl?: string) => ipcRenderer.invoke('read-image-as-data-url', imageUrl, fallbackUrl, localPath, ossUrl) as Promise<{ dataUrl: string }>,
  createVideoLocalResourceFromFile: (projectId: string | undefined, sourceFilePath: string) =>
    ipcRenderer.invoke('local-resource:create-video-from-file', projectId, sourceFilePath),
  createVideoLocalResourceFromBuffer: (projectId: string | undefined, fileName: string, buffer: ArrayBuffer) =>
    ipcRenderer.invoke('local-resource:create-video-from-buffer', projectId, fileName, buffer),
  createVideoLocalResourceFromUrl: (projectId: string | undefined, sourceUrl: string) =>
    ipcRenderer.invoke('local-resource:create-video-from-url', projectId, sourceUrl),
  /** B 站 / YouTube：主进程本地 yt-dlp，不经 FC/OSS（IPC 名历史兼容） */
  createVideoFromBilibiliPage: (projectId: string | undefined, pageUrl: string) =>
    ipcRenderer.invoke('local-resource:create-video-from-bilibili-page', projectId, pageUrl),
  extractAudioFromVideo: (projectId: string | undefined, videoUrl: string) =>
    ipcRenderer.invoke('extract-audio-from-video', projectId, videoUrl),
  separateVocalsFromAudio: (projectId: string | undefined, audioUrl: string, mode: 'vocals' | 'accompaniment') =>
    ipcRenderer.invoke('separate-vocals-from-audio', projectId, audioUrl, mode),
  /** 取消进行中的人声分离 / Whisper 转写子进程 */
  cancelAudioTranscribeJobs: () =>
    ipcRenderer.invoke('cancel-audio-transcribe-jobs') as Promise<{ success: boolean; killed: number }>,
  /** 卡拉OK字幕：探测中文字体 */
  karaokeDetectFont: () =>
    ipcRenderer.invoke('karaoke-detect-font') as Promise<{
      fontName: string;
      fontsDir: string | null;
      fontFile: string | null;
    }>,
  /** 卡拉OK：导出 ASS */
  karaokeExportAss: (project: unknown, defaultName?: string) =>
    ipcRenderer.invoke('karaoke-export-ass', project, defaultName) as Promise<{
      success: boolean;
      canceled?: boolean;
      filePath?: string;
      error?: string;
    }>,
  /** 卡拉OK：写临时 ASS */
  karaokeWriteAssTemp: (project: unknown) =>
    ipcRenderer.invoke('karaoke-write-ass-temp', project) as Promise<{
      assPath: string;
      assContent: string;
      fontName: string;
    }>,
  /** 卡拉OK：烧录字幕到成片（ASS 路径 / 兼容后备） */
  karaokeBurnSubtitles: (projectId: string | undefined, videoUrl: string, project: unknown) =>
    ipcRenderer.invoke('karaoke-burn-subtitles', projectId, videoUrl, project) as Promise<{
      success: boolean;
      canceled?: boolean;
      timedOut?: boolean;
      originalUrl?: string;
      originalPath?: string;
      posterUrl?: string;
      width?: number;
      height?: number;
      assPath?: string;
      error?: string;
    }>,
  /**
   * 卡拉OK 方案 A（默认导出）：离屏 CSS 字幕层烧录（与预览 wipe 一致）。
   * 进度见 onKaraokeCssBurnProgress。
   */
  karaokeCssBurn: (
    projectId: string | undefined,
    videoUrl: string,
    project: unknown,
    opts?: { fps?: number; durationSec?: number; lowSpec?: boolean; preferSmooth?: boolean },
  ) =>
    ipcRenderer.invoke('karaoke-css-burn', projectId, videoUrl, project, opts) as Promise<{
      success: boolean;
      canceled?: boolean;
      timedOut?: boolean;
      originalUrl?: string;
      originalPath?: string;
      posterUrl?: string;
      width?: number;
      height?: number;
      error?: string;
      engine?: 'css' | 'ass';
    }>,
  onKaraokeCssBurnProgress: (
    callback: (p: {
      phase: 'prepare' | 'capture' | 'encode' | 'done';
      frame: number;
      total: number;
      percent: number;
      message?: string;
      fps?: number;
      etaSeconds?: number | null;
      lowSpec?: boolean;
    }) => void,
  ) => {
    const handler = (
      _: unknown,
      p: {
        phase: 'prepare' | 'capture' | 'encode' | 'done';
        frame: number;
        total: number;
        percent: number;
        message?: string;
        fps?: number;
        etaSeconds?: number | null;
        lowSpec?: boolean;
      },
    ) => callback(p);
    ipcRenderer.on('karaoke-css-burn-progress', handler);
    return () => ipcRenderer.removeListener('karaoke-css-burn-progress', handler);
  },
  /** 卡拉OK：预览级合成 begin（旧 API，保留兼容） */
  karaokePreviewComposeBegin: (
    projectId: string | undefined,
    videoUrl: string,
    project: unknown,
    opts?: { fps?: number; durationSec?: number },
  ) =>
    ipcRenderer.invoke(
      'karaoke-preview-compose-begin',
      projectId,
      videoUrl,
      project,
      opts,
    ) as Promise<{
      success: boolean;
      sessionId?: string;
      fps?: number;
      durationSec?: number;
      frameCount?: number;
      captureWidth?: number;
      captureHeight?: number;
      videoWidth?: number;
      videoHeight?: number;
      error?: string;
    }>,
  /** 卡拉OK：预览级合成写帧（透明 PNG） */
  karaokePreviewComposeWriteFrame: (
    sessionId: string,
    frameIndex: number,
    png: ArrayBuffer | Uint8Array,
  ) =>
    ipcRenderer.invoke(
      'karaoke-preview-compose-write-frame',
      sessionId,
      frameIndex,
      png,
    ) as Promise<{ success: boolean; error?: string }>,
  /** 卡拉OK：预览级合成 finalize（overlay + 入库） */
  karaokePreviewComposeFinalize: (sessionId: string) =>
    ipcRenderer.invoke('karaoke-preview-compose-finalize', sessionId) as Promise<{
      success: boolean;
      canceled?: boolean;
      timedOut?: boolean;
      originalUrl?: string;
      originalPath?: string;
      posterUrl?: string;
      width?: number;
      height?: number;
      error?: string;
    }>,
  karaokePreviewComposeAbort: (sessionId: string) =>
    ipcRenderer.invoke('karaoke-preview-compose-abort', sessionId) as Promise<{
      success: boolean;
      error?: string;
    }>,
  /** 卡拉OK：取消烧录（杀 ffmpeg / 预览级合成） */
  karaokeCancelBurn: () =>
    ipcRenderer.invoke('karaoke-cancel-burn') as Promise<{ success: true; killed: number }>,
  /** 阿里云百炼实时听写（主进程 WebSocket；渲染只收发 PCM/文本） */
  asrRealtimeStart: () =>
    ipcRenderer.invoke('asr-realtime-start') as Promise<
      { ok: true; sessionId: string } | { ok: false; message: string; code?: string }
    >,
  /** 单向发送 PCM；勿用 invoke（音频路径高频调用会拖垮 / 崩渲染进程） */
  asrRealtimeSendAudio: (sessionId: string, pcmBase64: string) => {
    ipcRenderer.send('asr-realtime-send-audio', sessionId, pcmBase64);
  },
  asrRealtimeStop: (sessionId: string) =>
    ipcRenderer.invoke('asr-realtime-stop', sessionId) as Promise<{
      ok: boolean;
      text: string;
      message?: string;
    }>,
  asrRealtimeCancel: (sessionId?: string) =>
    ipcRenderer.invoke('asr-realtime-cancel', sessionId) as Promise<{ ok: boolean }>,
  onAsrRealtimeEvent: (
    callback: (event: {
      type: 'started' | 'partial' | 'final' | 'finished' | 'error';
      sessionId: string;
      text?: string;
      message?: string;
      code?: string;
    }) => void,
  ) => {
    const handler = (
      _: unknown,
      data: {
        type: 'started' | 'partial' | 'final' | 'finished' | 'error';
        sessionId: string;
        text?: string;
        message?: string;
        code?: string;
      },
    ) => callback(data);
    ipcRenderer.on('asr-realtime-event', handler);
    return () => ipcRenderer.removeListener('asr-realtime-event', handler);
  },
  /** 语音→文本：云端 fun-asr（经 FC）；契约 { text }，不再走本地 Whisper */
  transcribeSpeechFromAudioUrl: (projectId: string | undefined, audioUrl: string, language?: string) =>
    ipcRenderer.invoke('transcribe-speech-from-audio-url', projectId, audioUrl, language) as Promise<{ text: string }>,
  /** MV 歌词时间线：云端 fun-asr（经 FC）；契约 { text, segments, hasWordTimestamps? }；segments 可含 words */
  transcribeSpeechSegmentsFromAudioUrl: (
    projectId: string | undefined,
    audioUrl: string,
    language?: string,
  ) =>
    ipcRenderer.invoke(
      'transcribe-speech-segments-from-audio-url',
      projectId,
      audioUrl,
      language,
    ) as Promise<{
      text: string;
      segments: Array<{
        text: string;
        startSec: number;
        endSec: number;
        words?: Array<{ text: string; startSec: number; endSec: number }>;
      }>;
      hasWordTimestamps?: boolean;
      charged?: boolean;
      cost?: number;
      balance?: number;
      billingModelId?: string;
      billingTaskId?: string;
    }>,
  trimAudio: (projectId: string | undefined, audioUrl: string, startSec: number, endSec: number) =>
    ipcRenderer.invoke('trim-audio', projectId, audioUrl, startSec, endSec),
  trimVideo: (projectId: string | undefined, videoUrl: string, startSec: number, endSec: number) =>
    ipcRenderer.invoke('trim-video', projectId, videoUrl, startSec, endSec),
  smartAnalyzeVideoShots: (
    projectId: string | undefined,
    videoUrl: string,
    options?: {
      mode?: 'stable' | 'balanced' | 'sensitive';
      maxClips?: number;
      minClipSec?: number;
      withPosters?: boolean;
    },
  ) =>
    ipcRenderer.invoke('smart-analyze-video-shots', projectId, videoUrl, options) as Promise<{
      segments: Array<{ startSec: number; endSec: number; score: number; posterUrl?: string }>;
      cutPoints: number[];
      durationSec: number;
      downgraded: boolean;
    }>,
  smartExtractVideoClips: (
    projectId: string | undefined,
    videoUrl: string,
    options?: {
      mode?: 'stable' | 'balanced' | 'sensitive';
      maxClips?: number;
      minClipSec?: number;
      output?: 'clips' | 'keyframes';
    },
  ) =>
    ipcRenderer.invoke('smart-extract-video-clips', projectId, videoUrl, options) as Promise<{
      clips: Array<{ videoUrl: string; startSec: number; endSec: number; posterUrl?: string }>;
      keyframes?: Array<{ imageUrl: string; timeSec: number }>;
      cutPoints: number[];
      durationSec: number;
      downgraded: boolean;
    }>,
  cropVideo: (
    projectId: string | undefined,
    videoUrl: string,
    rect: { x: number; y: number; w: number; h: number },
    sourceWidth: number,
    sourceHeight: number,
  ) =>
    ipcRenderer.invoke('crop-video', projectId, videoUrl, rect, sourceWidth, sourceHeight) as Promise<{
      originalUrl: string;
      posterUrl?: string;
      ghostBase64?: string;
      width?: number;
      height?: number;
    }>,
  chromaKeyVideo: (
    projectId: string | undefined,
    videoUrl: string,
    options: { colorHex: string; similarity?: number; blend?: number },
  ) =>
    ipcRenderer.invoke('chroma-key-video', projectId, videoUrl, options) as Promise<{
      originalUrl: string;
      posterUrl?: string;
      ghostBase64?: string;
      width?: number;
      height?: number;
      hasAlpha?: boolean;
    }>,
  /** 智能抠像：阿里云 VIAPI 一键人像 → 透明 WebM（无鼠标点选） */
  smartPortraitMatting: (projectId: string | undefined, videoUrl: string) =>
    ipcRenderer.invoke('smart-portrait-matting', projectId, videoUrl) as Promise<{
      originalUrl: string;
      posterUrl?: string;
      ghostBase64?: string;
      width?: number;
      height?: number;
      hasAlpha?: boolean;
    }>,
  onSmartPortraitMattingProgress: (
    callback: (p: { phase: string; percent: number; message: string }) => void,
  ) => {
    const handler = (_: unknown, p: { phase: string; percent: number; message: string }) => callback(p);
    ipcRenderer.on('smart-portrait-matting-progress', handler);
    return () => ipcRenderer.removeListener('smart-portrait-matting-progress', handler);
  },
  getMediaDuration: (url: string, projectId?: string) => ipcRenderer.invoke('get-media-duration', url, projectId) as Promise<number>,
  exportTimelineVideo: (
    projectId: string | undefined,
    videoClipsOrTracks:
      | Array<{
          type: string;
          src: string;
          duration: number;
          startTime: number;
          trimStart?: number;
          trimEnd?: number;
          lockTrim?: boolean;
          name?: string;
          layout?: { x: number; y: number; w: number; h: number };
          crop?: { left: number; top: number; right: number; bottom: number };
          hasAlpha?: boolean;
          volume?: number;
        }>
      | Array<
          Array<{
            type: string;
            src: string;
            duration: number;
            startTime: number;
            trimStart?: number;
            trimEnd?: number;
            lockTrim?: boolean;
            name?: string;
            layout?: { x: number; y: number; w: number; h: number };
            crop?: { left: number; top: number; right: number; bottom: number };
            hasAlpha?: boolean;
            volume?: number;
          }>
        >,
    audioTracks: Array<
      Array<{
        type: string;
        src: string;
        duration: number;
        startTime: number;
        trimStart?: number;
        trimEnd?: number;
        lockTrim?: boolean;
      }>
    >,
    options?: {
      videoTrackVolume?: number | number[];
      videoTrackMuted?: boolean | boolean[];
      audioTrackVolume?: number[];
      audioTrackMuted?: boolean[];
      outputWidth?: number;
      outputHeight?: number;
    },
  ) => ipcRenderer.invoke('export-timeline-video', projectId, videoClipsOrTracks, audioTracks, options),
  exportTimelineVideoToProject: (
    projectId: string | undefined,
    videoClipsOrTracks:
      | Array<{
          type: string;
          src: string;
          duration: number;
          startTime: number;
          trimStart?: number;
          trimEnd?: number;
          lockTrim?: boolean;
          name?: string;
          layout?: { x: number; y: number; w: number; h: number };
          crop?: { left: number; top: number; right: number; bottom: number };
          hasAlpha?: boolean;
          volume?: number;
        }>
      | Array<
          Array<{
            type: string;
            src: string;
            duration: number;
            startTime: number;
            trimStart?: number;
            trimEnd?: number;
            lockTrim?: boolean;
            name?: string;
            layout?: { x: number; y: number; w: number; h: number };
            crop?: { left: number; top: number; right: number; bottom: number };
            hasAlpha?: boolean;
            volume?: number;
          }>
        >,
    audioTracks: Array<
      Array<{
        type: string;
        src: string;
        duration: number;
        startTime: number;
        trimStart?: number;
        trimEnd?: number;
        lockTrim?: boolean;
      }>
    >,
    options?: {
      videoTrackVolume?: number | number[];
      videoTrackMuted?: boolean | boolean[];
      audioTrackVolume?: number[];
      audioTrackMuted?: boolean[];
      outputWidth?: number;
      outputHeight?: number;
    },
  ) => ipcRenderer.invoke('export-timeline-video-to-project', projectId, videoClipsOrTracks, audioTracks, options),

  setSharpQueuePaused: (paused: boolean) =>
    ipcRenderer.invoke('local-resource:set-sharp-queue-paused', paused),
  getSharpQueueStats: () =>
    ipcRenderer.invoke('local-resource:get-sharp-queue-stats'),
  /** 资产库列表小缩略图（磁盘缓存，避免原图 1–3MB 解码卡死） */
  peekLibraryListThumb: (sourceUrlOrPath: string, maxEdge?: number) =>
    ipcRenderer.sendSync('local-resource:peek-library-list-thumb', sourceUrlOrPath, maxEdge) as {
      success: boolean;
      thumbUrl?: string;
      thumbPath?: string;
      cached?: boolean;
    },
  ensureLibraryListThumb: (sourceUrlOrPath: string, maxEdge?: number) =>
    ipcRenderer.invoke('local-resource:ensure-library-list-thumb', sourceUrlOrPath, maxEdge) as Promise<{
      success: boolean;
      thumbUrl?: string;
      thumbPath?: string;
      cached?: boolean;
      error?: string;
    }>,
  /** 数字人列表头像：从参考视频抽帧并写入 store */
  ensureDigitalHumanListPoster: (itemId: string) =>
    ipcRenderer.invoke('ensure-digital-human-list-poster', itemId) as Promise<{
      success: boolean;
      posterUrl?: string;
      localPosterPath?: string;
      cached?: boolean;
      error?: string;
    }>,

  /** 兼容旧调用：仅同步工程 ID */
  setScreenshotSnipArmed: (armed: boolean, projectId?: string) =>
    ipcRenderer.invoke('screenshot:set-armed', armed, projectId) as Promise<{ ok: boolean; armed: boolean }>,
  /** 同步当前工作区工程 ID，供 Alt+1 等快捷键落盘到正确项目 */
  syncScreenshotProject: (projectId?: string) =>
    ipcRenderer.invoke('screenshot:sync-project', projectId) as Promise<{ ok: boolean }>,
  /** 打开透明框选层；可传 projectId 覆盖本次落盘项目 */
  startScreenshotSnip: (projectId?: string) =>
    ipcRenderer.invoke('screenshot:start-snip', projectId) as Promise<{ ok: boolean }>,
  onScreenshotImportToCanvas: (callback: (result: Record<string, unknown>) => void) => {
    const handler = (_: unknown, result: Record<string, unknown>) => callback(result);
    ipcRenderer.on('screenshot:import-to-canvas', handler);
    return () => ipcRenderer.removeListener('screenshot:import-to-canvas', handler);
  },
  onScreenshotSnipError: (callback: (payload: { message: string }) => void) => {
    const handler = (_: unknown, p: { message: string }) => callback(p);
    ipcRenderer.on('screenshot:snip-error', handler);
    return () => ipcRenderer.removeListener('screenshot:snip-error', handler);
  },
  /** 区域截图会话进行中（覆盖层已就绪），用于工具栏相机按钮高亮 */
  onScreenshotSnipActive: (callback: (payload: { active: boolean }) => void) => {
    const handler = (_: unknown, p: { active: boolean }) => callback(p);
    ipcRenderer.on('screenshot:snip-active', handler);
    return () => ipcRenderer.removeListener('screenshot:snip-active', handler);
  },

  // 项目导入导出
  exportProject: (projectId: string, cardBgDataUrl?: string) => ipcRenderer.invoke('export-project', projectId, cardBgDataUrl),
  importProject: () => ipcRenderer.invoke('import-project'),

  // AI 调用
  invokeAI: (params: { modelId: string; nodeId: string; input: any }) => ipcRenderer.invoke('ai:invoke', params),
  /** 取消进行中的 FC LLM 请求（立刻断开，释放云端连接） */
  abortFcLlm: () => ipcRenderer.invoke('ai:abort-llm') as Promise<{ aborted: boolean }>,

  /** 读取本地镜像的 MiniMax-H3 h3-prompt-writing 指南（base / ref） */
  getMinimaxH3PromptGuide: (kind: 'base' | 'ref' = 'base') =>
    ipcRenderer.invoke('skills:get-minimax-h3-prompt-guide', kind) as Promise<
      | { ok: true; kind: 'base' | 'ref'; skillMd: string; guide: string }
      | { ok: false; error: string }
    >,

  // 熔断器状态查询（Ctrl+Shift+B 也可触发）
  getCircuitBreakerStatus: () => ipcRenderer.invoke('ai:get-circuit-breaker-status') as Promise<{ open: boolean; consecutiveTimeoutCount: number; circuitOpenUntil: number; retryAfterSeconds: number }>,
  
  // AI 状态更新监听（支持多个监听器，每个组件独立管理）
  onAIStatusUpdate: (callback: (packet: { nodeId: string; status: string; payload?: any }) => void) => {
    const handler = (_: any, packet: { nodeId: string; status: string; payload?: any }) => {
      // 调试日志：记录所有收到的状态更新，包括 payload 详情
      const hasPayload = !!packet.payload;
      const hasText = !!(packet.payload as any)?.text;
      const hasLocalPath = !!(packet.payload as any)?.localPath;
      const textLength = (packet.payload as any)?.text?.length || 0;
      const localPath = (packet.payload as any)?.localPath || 'none';
      console.log(`[preload] 收到状态更新: nodeId=${packet.nodeId}, status=${packet.status}, hasPayload=${hasPayload}, hasText=${hasText}, textLength=${textLength}, hasLocalPath=${hasLocalPath}, localPath=${localPath}`);
      
      // 如果 payload 存在，记录所有 keys
      if (packet.payload) {
        const payloadKeys = Object.keys(packet.payload);
        console.log(`[preload] payload keys: ${payloadKeys.join(', ')}`);
        
        // 特别检查 text 和 localPath
        if (packet.status === 'SUCCESS') {
          console.log(`[preload] SUCCESS 状态详情:`, {
            nodeId: packet.nodeId,
            hasText: hasText,
            textLength: textLength,
            hasLocalPath: hasLocalPath,
            localPath: localPath,
            payloadKeys: payloadKeys,
          });
        }
      }
      
      callback(packet);
    };
    ipcRenderer.on('ai:status-update', handler);
    console.log(`[preload] 注册新的 AI 状态更新监听器，当前监听器数量: ${ipcRenderer.listenerCount('ai:status-update')}`);
    // 返回清理函数，允许移除单个监听器
    return () => {
      ipcRenderer.removeListener('ai:status-update', handler);
      console.log(`[preload] 移除 AI 状态更新监听器，剩余监听器数量: ${ipcRenderer.listenerCount('ai:status-update')}`);
    };
  },
  
  // 移除 AI 状态更新监听（保留以兼容旧代码，但建议使用 onAIStatusUpdate 返回的清理函数）
  removeAIStatusUpdateListener: () => {
    ipcRenderer.removeAllListeners('ai:status-update');
  },

  // 熔断器状态（AI 连续超时后 2 分钟内禁止新任务）
  onCircuitBreakerState: (callback: (data: { open: boolean; retryAfter?: number }) => void) => {
    ipcRenderer.on('ai:circuit-breaker-state', (_, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('ai:circuit-breaker-state');
  },

  // 窗口操作
  resizeWindow: (width: number, height: number) => ipcRenderer.invoke('resize-window', width, height),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  requestRendererReload: () => ipcRenderer.invoke('request-renderer-reload') as Promise<{ success: boolean }>,
  toggleFullscreen: () => ipcRenderer.invoke('toggle-fullscreen'),
  setFullscreen: (enable: boolean) => ipcRenderer.invoke('app:set-fullscreen', enable),
  getFullscreenState: () => ipcRenderer.invoke('get-fullscreen-state') as Promise<{ isFullScreen: boolean }>,
  getAppVersion: () => ipcRenderer.invoke('app:get-version') as Promise<string>,
  getNetworkTime: () => ipcRenderer.invoke('app:get-network-time') as Promise<number>,
  /** 登录页交流群二维码：主进程列举 OSS `WX/` 最新图片 */
  getWeChatGroupQrUrl: (force?: boolean) =>
    ipcRenderer.invoke('wechat-group:get-qr-url', force) as Promise<
      { ok: true; url: string; objectKey: string } | { ok: false; error: string }
    >,
  /** 顶栏教学视频：列举北京桶 `软件内教学视频/` mp4 公开 URL */
  listTutorialVideos: (force?: boolean) =>
    ipcRenderer.invoke('tutorial-videos:list', force) as Promise<
      | {
          ok: true;
          items: Array<{ objectKey: string; title: string; url: string; sortIndex: number }>;
        }
      | { ok: false; error: string }
    >,
  checkForUpdates: () =>
    ipcRenderer.invoke('app:check-for-updates') as Promise<{
      updateAvailable: boolean;
      currentVersion: string;
      latestVersion: string | null;
      packageBytes?: number;
      error?: string | null;
    }>,
  getReleaseFeedRegion: () =>
    ipcRenderer.invoke('app:get-release-feed-region') as Promise<{
      region: 'cn' | 'hk';
      active: 'cn' | 'hk';
    }>,
  setReleaseFeedRegion: (region: 'cn' | 'hk') =>
    ipcRenderer.invoke('app:set-release-feed-region', region) as Promise<{
      ok: boolean;
      region: 'cn' | 'hk';
    }>,
  downloadAndInstallUpdate: () => ipcRenderer.invoke('app:download-and-install-update') as Promise<{ success: boolean; error?: string }>,
  pauseUpdateDownload: () =>
    ipcRenderer.invoke('app:pause-update-download') as Promise<{ success: boolean; paused?: boolean }>,
  resumeUpdateDownload: () =>
    ipcRenderer.invoke('app:resume-update-download') as Promise<{ success: boolean; paused?: boolean; error?: string }>,
  cancelUpdateDownload: () =>
    ipcRenderer.invoke('app:cancel-update-download') as Promise<{ success: boolean }>,
  onUpdateAvailable: (callback: (info: { version: string; packageBytes?: number }) => void) => {
    ipcRenderer.on('app:update-available', (_, info) => callback(info));
    return () => ipcRenderer.removeAllListeners('app:update-available');
  },
  onUpdateDownloaded: (callback: () => void) => {
    ipcRenderer.on('app:update-downloaded', () => callback());
    return () => ipcRenderer.removeAllListeners('app:update-downloaded');
  },
  onUpdateInstalling: (callback: () => void) => {
    ipcRenderer.on('app:update-installing', () => callback());
    return () => ipcRenderer.removeAllListeners('app:update-installing');
  },
  onPrepareForUpdate: (callback: () => void | Promise<void>) => {
    const handler = async () => {
      try {
        await callback();
      } finally {
        ipcRenderer.send('app:prepare-for-update-done');
      }
    };
    ipcRenderer.on('app:prepare-for-update', handler);
    return () => ipcRenderer.removeListener('app:prepare-for-update', handler);
  },
  onUpdateDownloadProgress: (
    callback: (info: {
      phase?: 'stub' | 'main-package' | 'full' | 'paused';
      percent: number;
      stubPercent?: number;
      packagePercent?: number;
      transferred: number;
      total: number;
      bytesPerSecond: number;
      packageBytes?: number;
      stubBytes?: number;
      etaSeconds?: number | null;
      fileName?: string;
      savePath?: string;
      paused?: boolean;
    }) => void,
  ) => {
    ipcRenderer.on('app:update-download-progress', (_, info) => callback(info));
    return () => ipcRenderer.removeAllListeners('app:update-download-progress');
  },
  onUpdateDownloadPaused: (callback: (info: { paused: boolean }) => void) => {
    ipcRenderer.on('app:update-download-paused', (_, info) => callback(info));
    return () => ipcRenderer.removeAllListeners('app:update-download-paused');
  },
  onUpdateDownloadCancelled: (callback: () => void) => {
    ipcRenderer.on('app:update-download-cancelled', () => callback());
    return () => ipcRenderer.removeAllListeners('app:update-download-cancelled');
  },
  onUpdateError: (callback: (info: { message: string }) => void) => {
    ipcRenderer.on('app:update-error', (_, info) => callback(info));
    return () => ipcRenderer.removeAllListeners('app:update-error');
  },

  /** 单实例：从命令行/双击 .aixflow 导入后打开项目 */
  onProjectImportedFromFile: (
    callback: (payload: {
      project: { id: string; name: string; date: string; createdAt: number; lastModified: number };
      cardBackground?: string;
    }) => void,
  ) => {
    const handler = (
      _: Electron.IpcRendererEvent,
      payload: {
        project: { id: string; name: string; date: string; createdAt: number; lastModified: number };
        cardBackground?: string;
      },
    ) => callback(payload);
    ipcRenderer.on('app:project-imported-from-file', handler);
    return () => ipcRenderer.removeListener('app:project-imported-from-file', handler);
  },

  // 全局 LLM 人设管理
  getGlobalLLMPersonas: () => ipcRenderer.invoke('get-global-llm-personas'),
  saveGlobalLLMPersona: (persona: { id: string; name: string; content: string }) => ipcRenderer.invoke('save-global-llm-persona', persona),
  updateGlobalLLMPersonas: (personas: Array<{ id: string; name: string; content: string }>) => ipcRenderer.invoke('update-global-llm-personas', personas),
  deleteGlobalLLMPersona: (personaId: string) => ipcRenderer.invoke('delete-global-llm-persona', personaId),

  // 选择自定义保存路径
  selectSavePath: () => ipcRenderer.invoke('select-save-path'),
  
  // 自动保存图片（生成完成后自动调用）
  autoSaveImage: (imageUrl: string, nodeTitle: string, projectId?: string) => ipcRenderer.invoke('auto-save-image', imageUrl, nodeTitle, projectId),
  
  // 自动保存视频（生成完成后自动调用）
  autoSaveVideo: (videoUrl: string, nodeTitle: string, projectId?: string) => ipcRenderer.invoke('auto-save-video', videoUrl, nodeTitle, projectId),
  // 自动保存音频（生成完成后自动调用，preferredFileName 如歌曲名用于保存文件名）
  autoSaveAudio: (audioUrl: string, preferredFileName: string, projectId?: string) => ipcRenderer.invoke('auto-save-audio', audioUrl, preferredFileName, projectId),
  // 下载图片（手动选择保存位置）
  downloadImage: (imageUrl: string, nodeTitle: string) => ipcRenderer.invoke('download-image', imageUrl, nodeTitle),
  
  // 下载视频（手动选择保存位置）
  downloadVideo: (videoUrl: string, nodeTitle: string) => ipcRenderer.invoke('download-video', videoUrl, nodeTitle),
  // 下载音频（手动选择保存位置）
  downloadAudio: (audioUrl: string, nodeTitle: string) => ipcRenderer.invoke('download-audio', audioUrl, nodeTitle),
  // 将已落地到本地项目目录的文件复制到用户选择的下载目录
  downloadLocalFileToFolder: (localFilePath: string, preferredFileName?: string) =>
    ipcRenderer.invoke('download-local-file-to-folder', localFilePath, preferredFileName),
  /** 解析图片 URL 为可拖出的本地绝对路径（远端会先写入临时目录） */
  prepareImageForExternalDrag: (payload: { imageUrl: string; preferredBaseName?: string }) =>
    ipcRenderer.invoke('prepare-image-for-external-drag', payload),
  /** 须在 dragstart 响应中调用：向系统发起原生文件拖出（如拖到桌面） */
  startNativeFileDrag: (absoluteFilePath: string) => ipcRenderer.send('start-native-file-drag', absoluteFilePath),

  // 打开文件
  openFile: (filePath: string) => ipcRenderer.invoke('open-file', filePath),
  
  // 选择参考音文件（Index-TTS2.0 等）
  showOpenAudioDialog: () => ipcRenderer.invoke('show-open-audio-dialog'),
  // 选择参考图片（Doubao 音频等）
  showOpenImageDialog: () => ipcRenderer.invoke('show-open-image-dialog'),
  // 选择视频文件（与 AudioNode 一致的 IPC 方案）
  showOpenVideoDialog: () => ipcRenderer.invoke('show-open-video-dialog'),
  // 在文件管理器中显示文件（打开文件所在的文件夹并选中文件）
  showItemInFolder: (filePath: string) => ipcRenderer.invoke('show-item-in-folder', filePath),
  
  // 获取用户数据路径
  getUserDataPath: () => ipcRenderer.invoke('get-user-data-path'),
  
  // 打开路径（文件夹或文件）
  openPath: (pathToOpen: string) => ipcRenderer.invoke('open-path', pathToOpen),
  openExternalUrl: (url: string) => ipcRenderer.invoke('open-external-url', url),
  /** 应用内窗口打开外链；失败时主进程会 fallback 系统浏览器 */
  openInAppBrowser: (url: string, title?: string) =>
    ipcRenderer.invoke('open-in-app-browser', url, title) as Promise<
      { ok: true; mode: 'in-app' | 'external' } | { ok: false; error: string }
    >,

  // 角色管理
  getCharacters: () => ipcRenderer.invoke('get-characters'),
  onCharactersUpdated: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('characters-updated', handler);
    return () => ipcRenderer.removeListener('characters-updated', handler);
  },
  uploadCharacterVideo: (videoUrl: string, timestamp?: string, channel?: 'plugin' | 'core') =>
    ipcRenderer.invoke('upload-character-video', videoUrl, timestamp, channel),
  createCharacter: (nickname: string, name: string, avatar: string, roleId?: string, permalink?: string, voiceClip?: string, viewImages?: string[], imageDescription?: string) =>
    ipcRenderer.invoke('create-character', nickname, name, avatar, roleId, permalink, voiceClip, viewImages, imageDescription),
  updateCharacter: (characterId: string, updates: { nickname?: string; name?: string; avatar?: string; roleId?: string; permalink?: string; voiceClip?: string; viewImages?: string[]; imageDescription?: string }) => ipcRenderer.invoke('update-character', characterId, updates),
  deleteCharacter: (characterId: string) => ipcRenderer.invoke('delete-character', characterId),
  registerImageTo3dCharacter: (payload: {
    nickname?: string;
    inputImageUrl?: string;
    localAvatarPath?: string;
    localGlbPath?: string;
    localGlbUrl?: string;
    remoteGlbUrl?: string;
    resultTextureLocalUrl?: string;
    resultTextureRemoteUrl?: string;
  }) => ipcRenderer.invoke('register-image-to-3d-character', payload),
  clearInvalidAvatarUrl: (characterId: string, invalidUrl: string) => ipcRenderer.invoke('clear-invalid-avatar-url', characterId, invalidUrl),
  exportCharacters: (characterIds: string[]) => ipcRenderer.invoke('export-characters', characterIds),
  importCharacters: () => ipcRenderer.invoke('import-characters'),

  getScenes: () => ipcRenderer.invoke('get-scenes'),
  registerScene: (payload: {
    nickname?: string;
    panoramaUrl?: string;
    normalImageUrl?: string;
    display3dImageUrl?: string;
  }) => ipcRenderer.invoke('register-scene', payload),
  updateScene: (
    sceneId: string,
    updates: { nickname?: string; normalImageUrl?: string; display3dImageUrl?: string },
  ) => ipcRenderer.invoke('update-scene', sceneId, updates),
  deleteScenes: (sceneIds: string[]) => ipcRenderer.invoke('delete-scenes', sceneIds),
  pickSceneImage: (role?: 'normal' | 'display3d') =>
    ipcRenderer.invoke('pick-scene-image', role) as Promise<{
      canceled: boolean;
      filePath?: string;
      role?: 'normal' | 'display3d';
    }>,
  pickSceneUpload: () => ipcRenderer.invoke('pick-scene-upload') as Promise<{ canceled: boolean; filePath?: string }>,
  exportScenes: (sceneIds: string[]) =>
    ipcRenderer.invoke('export-scenes', sceneIds) as Promise<{
      success: boolean;
      filePath?: string;
      count?: number;
      error?: string;
    }>,
  importScenes: () =>
    ipcRenderer.invoke('import-scenes') as Promise<{
      success: boolean;
      count?: number;
      canceled?: boolean;
      error?: string;
    }>,

  getDigitalHumans: () => ipcRenderer.invoke('get-digital-humans'),
  registerDigitalHuman: (payload: {
    nickname?: string;
    videoUrl?: string;
    audioUrl?: string;
    posterUrl?: string;
  }) => ipcRenderer.invoke('register-digital-human', payload),
  updateDigitalHuman: (
    itemId: string,
    updates: { nickname?: string; videoUrl?: string; audioUrl?: string; posterUrl?: string },
  ) => ipcRenderer.invoke('update-digital-human', itemId, updates),
  deleteDigitalHumans: (itemIds: string[]) => ipcRenderer.invoke('delete-digital-humans', itemIds),

  getRvcVoices: () => ipcRenderer.invoke('get-rvc-voices'),
  registerRvcVoice: (payload: {
    nickname?: string;
    modelPackageUrl?: string;
    modelPackageRemoteUrl?: string;
    rvcTrainModelName?: string;
    avatarUrl?: string;
    trainAudioUrl?: string;
    trainAudioRemoteUrl?: string;
  }) => ipcRenderer.invoke('register-rvc-voice', payload),
  updateRvcVoice: (
    itemId: string,
    updates: {
      nickname?: string;
      modelPackageUrl?: string;
      rvcTrainModelName?: string;
      avatarUrl?: string;
      trainAudioUrl?: string;
    },
  ) => ipcRenderer.invoke('update-rvc-voice', itemId, updates),
  deleteRvcVoices: (itemIds: string[]) => ipcRenderer.invoke('delete-rvc-voices', itemIds),
  getRvcEngineStatus: () => ipcRenderer.invoke('get-rvc-engine-status'),
  downloadRvcEngine: () => ipcRenderer.invoke('download-rvc-engine'),
  getWhisperEngineStatus: () => ipcRenderer.invoke('get-whisper-engine-status'),
  downloadWhisperEngine: () => ipcRenderer.invoke('download-whisper-engine'),
  onOptionalEngineDownloadProgress: (
    callback: (payload: {
      kind: 'rvc' | 'whisper';
      phase: 'downloading' | 'extracting' | 'done' | 'error';
      percent: number;
      message: string;
    }) => void,
  ) => {
    const handler = (
      _: Electron.IpcRendererEvent,
      payload: {
        kind: 'rvc' | 'whisper';
        phase: 'downloading' | 'extracting' | 'done' | 'error';
        percent: number;
        message: string;
      },
    ) => callback(payload);
    ipcRenderer.on('optional-engine:download-progress', handler);
    return () => ipcRenderer.removeListener('optional-engine:download-progress', handler);
  },
  pickRvcVoicePackage: () =>
    ipcRenderer.invoke('pick-rvc-voice-package') as Promise<{ canceled: boolean; filePath?: string }>,
  pickRvcVoiceAvatar: () =>
    ipcRenderer.invoke('pick-rvc-voice-avatar') as Promise<{ canceled: boolean; filePath?: string }>,
  pickRvcVoiceTrainAudio: () =>
    ipcRenderer.invoke('pick-rvc-voice-train-audio') as Promise<{ canceled: boolean; filePath?: string }>,

  // 上传视频到 OSS
  uploadVideoToOSS: (videoUrl: string) => ipcRenderer.invoke('upload-video-to-oss', videoUrl),
  
  // 上传本地视频到 OSS（用于角色创建模块）
  uploadLocalVideoToOSS: (localVideoPath: string) => ipcRenderer.invoke('upload-local-video-to-oss', localVideoPath),
  // 上传本地音频到 OSS（用于声音模块连接时，参考音上传后回传 URL）
  uploadLocalAudioToOSS: (localAudioPath: string) => ipcRenderer.invoke('upload-local-audio-to-oss', localAudioPath),

  // 上传图片到 runninghub（用于 sora-2 图生视频）
  uploadImageToRunningHub: (imageUrl: string) => ipcRenderer.invoke('upload-image-to-runninghub', imageUrl),
  imageMatting: (imageUrl: string) => ipcRenderer.invoke('image-matting', imageUrl),
  imageWatermarkRemoval: (imageUrl: string) => ipcRenderer.invoke('image-watermark-removal', imageUrl),
  imageUpscaleV3: (imageUrl: string) => ipcRenderer.invoke('image-upscale-v3', imageUrl),
  videoWatermarkRemoval: (videoUrl: string, strength?: number) =>
    ipcRenderer.invoke('video-watermark-removal', videoUrl, strength) as Promise<{ success: boolean; videoUrl: string }>,
  videoDepthConvert: (videoUrl: string) =>
    ipcRenderer.invoke('video-depth-convert', videoUrl) as Promise<{
      success: boolean;
      kind: 'video' | 'image';
      url: string;
      videoUrl?: string;
      imageUrl?: string;
    }>,
  videoSubtitleWatermarkRemoval: (videoUrl: string) =>
    ipcRenderer.invoke('video-subtitle-watermark-removal', videoUrl) as Promise<{
      success: boolean;
      kind: 'video' | 'image';
      url: string;
      videoUrl?: string;
      imageUrl?: string;
    }>,
  imageCharacterMultiAngle: (imageUrl: string) =>
    ipcRenderer.invoke('image-character-multi-angle', imageUrl) as Promise<{ success: boolean; imageUrl: string; imageUrls?: string[] }>,
  imageTo3d: (imageUrl: string, projectId?: string, nodeId?: string, modelId?: string) =>
    ipcRenderer.invoke('image-to-3d', imageUrl, projectId, nodeId, modelId) as Promise<{
      success: boolean;
      glbUrl: string;
      remoteGlbUrl: string;
      localGlbPath?: string;
      localGlbUrl: string;
      /** 云端同任务输出的贴图（用于画布预览） */
      resultTextureRemoteUrl?: string;
      resultTextureLocalUrl?: string;
    }>,
  ensureImageTo3dLocalTexture: (opts: { glbLocalPath?: string; glbResourceUrl?: string }) =>
    ipcRenderer.invoke('image-to-3d-ensure-local-texture', opts) as Promise<{
      textureLocalPath: string;
      textureLocalUrl: string;
    }>,
  saveGlbFile: (opts: { localPath?: string; remoteUrl?: string; defaultName?: string }) =>
    ipcRenderer.invoke('save-glb-file', opts) as Promise<{ canceled: boolean; filePath?: string }>,
  saveImageTo3dAixflow: (opts: {
    defaultName?: string;
    glbLocalPath?: string;
    glbRemoteUrl?: string;
    textureLocalPath?: string;
    textureRemoteUrl?: string;
    textureResourceUrl?: string;
    referenceLocalPath?: string;
    referenceRemoteUrl?: string;
  }) =>
    ipcRenderer.invoke('save-image-to-3d-aixflow', opts) as Promise<{
      canceled: boolean;
      filePath?: string;
      hasTexture?: boolean;
      hasReference?: boolean;
    }>,
  pickImageTo3dUpload: () =>
    ipcRenderer.invoke('pick-image-to-3d-upload') as Promise<{ canceled: boolean; filePath?: string }>,
  pickImageTo3dAvatar: () =>
    ipcRenderer.invoke('pick-image-to-3d-avatar') as Promise<{ canceled: boolean; filePath?: string }>,
  exportImageTo3dModels: (characterIds: string[]) =>
    ipcRenderer.invoke('export-image-to-3d-models', characterIds) as Promise<{
      success: boolean;
      filePath?: string;
      count?: number;
      error?: string;
    }>,
  importImageTo3dAsset: (opts?: { filePath?: string }) =>
    ipcRenderer.invoke('import-image-to-3d-asset', opts) as Promise<{
      canceled: boolean;
      item?: {
        nickname: string;
        localGlbPath: string;
        localGlbUrl: string;
        localTexturePath?: string;
        resultTextureUrl?: string;
        inputImageUrl?: string;
      };
      items?: Array<{
        nickname: string;
        localGlbPath: string;
        localGlbUrl: string;
        localTexturePath?: string;
        resultTextureUrl?: string;
        inputImageUrl?: string;
      }>;
    }>,
  
  // 上传图片到 OSS（接收 base64 图片数据）
  uploadImageToOSS: (imageData: string) => ipcRenderer.invoke('upload-image-to-oss', imageData),

  // 任务列表管理
  saveTasks: (tasks: any[]) => ipcRenderer.invoke('save-tasks', tasks),
  loadTasks: () => ipcRenderer.invoke('load-tasks'),
  /** 重启后根据已保存的 RunningHub taskId 恢复视频轮询 */
  resumeRunningHubVideoPoll: (args: {
    nodeId: string;
    rhTaskId: string;
    projectId?: string;
    prompt?: string;
    nodeTitle?: string;
  }) => ipcRenderer.invoke('video:resume-runninghub-poll', args),
  resumeRunningHubImagePoll: (args: {
    nodeId: string;
    rhTaskId: string;
    projectId?: string;
    prompt?: string;
    nodeTitle?: string;
  }) => ipcRenderer.invoke('image:resume-runninghub-poll', args),
  resumeRunningHubAudioPoll: (args: {
    nodeId: string;
    rhTaskId: string;
    projectId?: string;
    prompt?: string;
    nodeTitle?: string;
  }) => ipcRenderer.invoke('audio:resume-runninghub-poll', args),

  // 检查文件是否存在（用于播放器预检查）
  checkFileExists: (filePath: string) => ipcRenderer.invoke('check-file-exists', filePath),
  
  // 项目路径（统一为 projects/[项目名]，支持自定义根目录）
  ensureProjectMapping: (projectId: string) => ipcRenderer.invoke('ensure-project-mapping', projectId),
  getProjectMappedPath: (projectId: string) => ipcRenderer.invoke('get-project-mapped-path', projectId),
  getProjectOriginalPath: (projectId: string) => ipcRenderer.invoke('get-project-original-path', projectId),
  getProjectBasePath: () => ipcRenderer.invoke('get-project-base-path'),
  directorV2SaveSession: (projectId: string, session: unknown) =>
    ipcRenderer.invoke('director-v2-save-session', projectId, session) as Promise<{
      ok: boolean;
      error?: string;
      root?: string;
    }>,
  directorV2SaveAssetFile: (
    projectId: string,
    opts: { kind: 'image' | 'audio'; filename: string; mime?: string; data: ArrayBuffer | Uint8Array },
  ) =>
    ipcRenderer.invoke('director-v2-save-asset-file', projectId, opts) as Promise<{
      ok: boolean;
      url?: string;
      error?: string;
    }>,
  directorV2LoadSession: (projectId: string) =>
    ipcRenderer.invoke('director-v2-load-session', projectId) as Promise<{
      ok: boolean;
      session?: unknown;
      error?: string;
    }>,
  directorV2Exists: (projectId: string) =>
    ipcRenderer.invoke('director-v2-exists', projectId) as Promise<boolean>,
  directorV2LoadCastLibrary: (projectId: string) =>
    ipcRenderer.invoke('director-v2-load-cast-library', projectId) as Promise<{
      ok: boolean;
      library?: {
        schemaVersion: string;
        updated_at: number;
        characters: Array<{
          id: string;
          name: string;
          gender?: string;
          prompt?: string;
          imageUrl: string;
          voiceUrl: string;
          updated_at: number;
        }>;
        scenes: Array<{ id: string; name: string; imageUrl: string; updated_at: number }>;
      };
      error?: string;
    }>,
  directorV2RecoverCastPicks: (projectId: string) =>
    ipcRenderer.invoke('director-v2-recover-cast-picks', projectId) as Promise<{
      ok: boolean;
      picks?: Array<{ name: string; imageUrl: string; voiceUrl: string }>;
      error?: string;
    }>,
  directorV2UpsertCastLibrary: (
    projectId: string,
    incoming: {
      characters?: Array<{
        id?: string;
        name?: string;
        gender?: string;
        prompt?: string;
        imageUrl?: string;
        voiceUrl?: string;
      }>;
      scenes?: Array<{ id?: string; name?: string; imageUrl?: string }>;
    },
  ) =>
    ipcRenderer.invoke('director-v2-upsert-cast-library', projectId, incoming) as Promise<{
      ok: boolean;
      library?: unknown;
      error?: string;
    }>,
  setProjectBasePath: () => ipcRenderer.invoke('set-project-base-path') as Promise<{ success: boolean; path: string }>,
  diagnoseStoragePaths: () => ipcRenderer.invoke('diagnose-storage-paths') as Promise<{
    userData: string;
    projectsBase: string;
    customProjectPath: string;
    projectsDirExists: boolean;
    projectCount: number;
    projectFolders: Array<{ id: string; name: string; exists: boolean; nodeCount?: number }>;
    legacyPaths: Array<{ path: string; exists: boolean }>;
    isPackaged: boolean;
  }>,

  // 片头视频（splash-videos 文件夹）
  getSplashVideos: () => ipcRenderer.invoke('get-splash-videos') as Promise<{ folderPath: string; urls: string[]; logoUrl: string | null; musicUrl: string | null }>,
  openSplashFolder: () => ipcRenderer.invoke('open-splash-folder'),
});
