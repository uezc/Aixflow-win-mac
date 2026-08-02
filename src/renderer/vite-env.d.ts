/// <reference types="vite/client" />

declare module '*.md?raw' {
  const content: string;
  export default content;
}

interface ImportMetaEnv {
  /** 可选：与主进程 OSS_PUBLIC_BASE_URL 同值的 CDN 根，用于场景 web 静态资源拼接（需重新构建） */
  readonly VITE_OSS_PUBLIC_BASE?: string;
  readonly VITE_OSS_SCENE_CONFIG_URL?: string;
  /** 登录页微信交流群二维码图片 URL（覆盖默认 OSS 地址） */
  readonly VITE_WECHAT_GROUP_QR_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  electronAPI: {
    // 激活码管理（双重时限版：NXF-SERIAL-ENCODED_GEN-DAYS-SIGN）
    validateActivation: (activationCode: string) => Promise<{ valid: boolean; message?: string; expireAt?: number; errorCode?: 'ERR_CODE_EXPIRED' | 'ERR_TIME_ROLLBACK'; level?: 'PRO' }>;
    checkActivation: () => Promise<{
      activated: boolean;
      /** 产品关闭激活流程时为 true，前端应直接进主界面 */
      skipped?: boolean;
      status?: string;
      activationCode: string;
      expireAt?: number;
      message?: string;
      level?: 'PRO';
    }>;
    getLicenseInfo: () => Promise<{ level: 'PRO' | null }>;
    generateActivationCode: (days: number) => Promise<{ code: string }>;
    /** 运营控制台（需本机 NX_ADMIN_ISSUE_COUPON_SECRET） */
    adminIssueCoupon: (amountCny: number) => Promise<{ code: string; amount_cny: number }>;
    adminDashboardStats: () => Promise<{
      timezone: string;
      date: string;
      today_revenue_yuanbao: number;
      total_coupon_codes: number;
      pending_failed_or_timeout_tasks: number;
      tx_rows_scanned: number;
      task_rows_scanned: number;
      coupon_full_scan: boolean;
    }>;
    adminFailedTasks: () => Promise<{
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
    }>;
    adminRefundTask: (userId: string, taskId: string) => Promise<{
      balance: number;
      refunded?: boolean;
      idempotent?: boolean;
      reason?: string;
    }>;
    adminModelConfigList: () => Promise<{
      items: Array<{
        model_id: string;
        function_name?: string;
        is_active?: boolean;
        base_price?: number;
        multiplier?: number;
        yuanbao_rate?: number;
      }>;
    }>;
    adminModelConfigUpsert: (row: {
      model_id: string;
      function_name?: string;
      is_active?: boolean;
      base_price?: number;
      multiplier?: number;
      yuanbao_rate?: number;
    }) => Promise<{ model_id: string }>;
    adminGetAllUsers: (maxScanRows?: number) => Promise<{
      users: Array<{
        user_id: string;
        email: string;
        registration_date: number;
        last_login: number | null;
        status: string;
      }>;
      total_count: number;
      scan_truncated?: boolean;
    }>;
    adminProfitAnalytics: (opts?: { maxTxScanRows?: number; maxCouponScanRows?: number }) => Promise<{
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
    }>;

    // API Key 管理
    saveBLTCYApiKey: (apiKey: string) => Promise<{ success: boolean }>;
    saveRHApiKey: (apiKey: string) => Promise<{ success: boolean }>;
    getBLTCYApiKey: () => Promise<string>;
    getRHApiKey: () => Promise<string>;
    getVideoInteractionSettings: () => Promise<{
      profile: 'smooth' | 'performance';
      ultraNearZoomThreshold: number;
      fpsDropThreshold: number;
      interactionResumeDelayMs: number;
      fastMoveSpeedThreshold: number;
      prefetchScreenFactor: number;
    }>;
    saveVideoInteractionSettings: (settings: {
      profile: 'smooth' | 'performance';
      ultraNearZoomThreshold: number;
      fpsDropThreshold: number;
      interactionResumeDelayMs: number;
      fastMoveSpeedThreshold: number;
      prefetchScreenFactor: number;
    }) => Promise<{
      success: boolean;
      settings: {
        profile: 'smooth' | 'performance';
        ultraNearZoomThreshold: number;
        fpsDropThreshold: number;
        interactionResumeDelayMs: number;
        fastMoveSpeedThreshold: number;
        prefetchScreenFactor: number;
      };
    }>;

    // 余额查询（支持强制刷新参数）
    queryBLTCYBalance: (force?: boolean) => Promise<number | null>;
    queryRHBalance: (force?: boolean) => Promise<number | null>;
    queryAllBalances: (force?: boolean) => Promise<{ bltcy: number | null; rh: number | null }>;
    
    // 监听余额更新
    onBalanceUpdated: (callback: (data: { type: 'bltcy' | 'rh'; balance: number | null }) => void) => void;
    removeBalanceUpdatedListener: () => void;

    // Laf 云开发
    initLafUser: () => Promise<{ userId: string | null; balance: number; isPro: boolean; status: string }>;
    getLafUserState: () => Promise<{ userId: string | null; balance: number; isPro: boolean; status: string }>;
    onLafBalanceUpdated: (callback: (state: { userId: string | null; balance: number; isPro: boolean; status: string }) => void) => () => void;
    nxCloudLogin: (email: string, password: string) => Promise<{ userId: string | null; balance: number; isPro: boolean; status: string }>;
    nxCloudGetFcRoute: () => Promise<{
      route: 'hk' | 'beijing';
      activeEndpoint: string;
      hkEndpoint: string;
      beijingEndpoint: string;
    }>;
    nxCloudSetFcRoute: (route: 'hk' | 'beijing') => Promise<{
      ok: boolean;
      route: 'hk' | 'beijing';
      activeEndpoint: string;
    }>;
    nxMediaOssGetRegion: () => Promise<{
      region: 'cn' | 'hk';
      fcRoute: 'hk' | 'beijing';
      manual: boolean;
      activeRegion: 'cn' | 'hk';
    }>;
    nxMediaOssSetRegion: (region: 'cn' | 'hk') => Promise<{
      ok: boolean;
      region: 'cn' | 'hk';
      fcRoute: 'hk' | 'beijing';
      activeEndpoint: string;
      preferFc: boolean;
      reachable: boolean;
      mediaRegion: 'cn' | 'hk';
    }>;
    nxCloudEnsureFcRouteForCanvas: () => Promise<{
      route: 'hk' | 'beijing';
      beijingAvailable: boolean;
      deferred: boolean;
      activeEndpoint: string;
    }>;
    nxCloudSendAuthCode: (email: string, purpose?: 'login' | 'change_password') => Promise<{ ok: boolean }>;
    nxCloudChangePassword: (email: string, code: string, newPassword: string) => Promise<{ ok: boolean }>;
    nxCloudLoginWithCode: (
      email: string,
      code: string,
    ) => Promise<{ userId: string | null; balance: number; isPro: boolean; status: string; isNewUser?: boolean }>;
    nxCloudRegister: (
      email: string,
      password: string,
      code: string,
    ) => Promise<{ userId: string | null; balance: number; isPro: boolean; status: string }>;
    nxCloudLogout: () => Promise<{ userId: string | null; balance: number; isPro: boolean; status: string }>;
    nxCloudGetProfile: () => Promise<{ userId: string | null; balance: number; isPro: boolean; status: string; nxEmail?: string | null; isFirstRecharge?: boolean }>;
    nxCloudGetTransactions: (limit?: number) => Promise<{
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
    }>;
    nxCloudGetTasks: (limit?: number) => Promise<{
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
    }>;
    nxCloudTaskStatus: (taskId: string) => Promise<{
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
    }>;
    onNxCloudTrackTask: (
      callback: (payload: {
        taskId: string;
        nodeId: string;
        taskType: 'image' | 'video' | 'audio' | 'llm';
        balance?: number;
      }) => void,
    ) => () => void;
    nxCloudRecharge: (amountCny: number) => Promise<{ userId: string | null; balance: number; isPro: boolean; status: string; nxEmail?: string | null; isFirstRecharge?: boolean }>;
    alipayCreateRechargeOrder: (packageId: string) => Promise<{
      package_id: string;
      out_trade_no: string;
      total_amount: string;
      package_yuanbao: number;
      subject: string;
      pay_url: string;
    }>;
    alipayWatchOrderSettlement: (outTradeNo: string, baselineBalance: number) => Promise<{ watching: true }>;
    alipayGetOrderStatus: (outTradeNo: string) => Promise<{
      out_trade_no: string;
      status: string;
      is_settled?: boolean;
      balance?: number | null;
    }>;
    onRechargeSettled: (callback: (payload: { out_trade_no: string; balance: number; added_yuanbao: number }) => void) => () => void;
    nxCloudRedeemCoupon: (code: string) => Promise<{ userId: string | null; balance: number; isPro: boolean; status: string; nxEmail?: string | null; isFirstRecharge?: boolean }>;
    nxCloudFetchModelConfig: () => Promise<{
      items: Array<{
        model_id: string;
        function_name?: string;
        is_active?: boolean;
        base_price?: number;
        multiplier?: number;
        yuanbao_rate?: number;
      }>;
      fetchError?: string;
    }>;
    getNxSaasState: () => Promise<{
      enabled: boolean;
      loggedIn: boolean;
      balance: number;
      email: string | null;
      /** 上次成功登录邮箱，登出后仍保留，用于预填 */
      lastLoginEmail: string | null;
      isFirstRecharge: boolean;
      directRechargeEnabled: boolean;
    }>;
    getOssRouteChannel: () => Promise<'cn' | 'global'>;
    setOssRouteChannel: (channel: 'cn' | 'global') => Promise<{ success: true; channel: 'cn' | 'global' }>;
    getExperimentalHardwareAcceleration: () => Promise<{ enabled: boolean; active: boolean }>;
    setExperimentalHardwareAcceleration: (enabled: boolean) => Promise<{
      success: true;
      enabled: boolean;
      needsRestart: boolean;
    }>;
    relaunchApp: () => Promise<{ success: true }>;
    getGpuDiagnostics: () => Promise<{
      experimentalEnabled: boolean;
      sessionActive: boolean;
      featureStatus: Record<string, string>;
      gpuDevice: string | null;
    }>;

    // 项目管理
    getProjects: () => Promise<Array<{ id: string; name: string; date: string; createdAt: number; lastModified: number }>>;
    createProject: (name: string) => Promise<{ id: string; name: string; date: string; createdAt: number; lastModified: number }>;
    updateProject: (projectId: string, name: string) => Promise<{ id: string; name: string; date: string; createdAt: number; lastModified: number }>;
    reorderProjects: (projectIds: string[]) => Promise<Array<{ id: string; name: string; date: string; createdAt: number; lastModified: number }>>;
    deleteProject: (projectId: string) => Promise<{ success: boolean }>;

    // 项目数据（节点和边）
    saveProjectData: (
      projectId: string,
      nodes: any[],
      edges: any[],
      opts?: { allowEmptyOverwrite?: boolean },
    ) => Promise<{ success: true } | { success: false; code: 'EMPTY_OVERWRITE_BLOCKED' }>;
    loadProjectData: (projectId: string) => Promise<{ nodes: any[]; edges: any[]; lastModified: number }>;
    backupProjectData: (
      projectId: string,
    ) => Promise<
      | { success: true; files: string[] }
      | { success: false; error: 'NO_DATA_FILES' | 'NO_PROJECT' | 'IO_ERROR' | string; files: string[] }
    >;
    restoreProjectDataFromBackup: (
      projectId: string,
    ) => Promise<
      | { success: true; nodeCount: number; previousCount: number }
      | {
          success: false;
          error: 'NO_PROJECT' | 'NO_BACKUP' | 'BACKUP_NOT_NEWER' | 'IO_ERROR' | string;
          currentCount?: number;
          backupCount?: number;
        }
    >;
    copyFileToProjectAssets: (projectId: string | undefined, sourceFilePath: string) => Promise<{ savedPath: string }>;
    saveDroppedFileBufferToProjectAssets: (projectId: string | undefined, fileName: string, buffer: ArrayBuffer) => Promise<{ savedPath: string }>;
    finalizeMicRecording?: (projectId: string | undefined, savedPath: string) => Promise<{ savedPath: string; durationSec: number }>;
    createImageLocalResourceFromFile: (
      projectId: string | undefined,
      sourceFilePath: string
    ) => Promise<{
      originalPath: string;
      previewPath: string;
      tinyPath: string;
      originalUrl: string;
      previewUrl: string;
      tinyUrl: string;
      bytesOriginal: number;
      bytesPreview: number;
      bytesTiny: number;
      avgColorHex?: string;
      ghostBase64?: string;
      width?: number;
      height?: number;
    }>;
    createImageLocalResourceFromBuffer: (
      projectId: string | undefined,
      fileName: string,
      buffer: ArrayBuffer
    ) => Promise<{
      originalPath: string;
      previewPath: string;
      tinyPath: string;
      originalUrl: string;
      previewUrl: string;
      tinyUrl: string;
      bytesOriginal: number;
      bytesPreview: number;
      bytesTiny: number;
      avgColorHex?: string;
      ghostBase64?: string;
      width?: number;
      height?: number;
    }>;
    readImageAsDataUrl: (imageUrl: string, fallbackUrl?: string, localPath?: string, ossUrl?: string) => Promise<{ dataUrl: string }>;
    createVideoLocalResourceFromFile: (
      projectId: string | undefined,
      sourceFilePath: string
    ) => Promise<{
      originalPath: string;
      originalUrl: string;
      posterPath?: string;
      posterUrl?: string;
      ghostBase64?: string;
      bytesOriginal: number;
      bytesPoster?: number;
      width?: number;
      height?: number;
    }>;
    createVideoLocalResourceFromBuffer: (
      projectId: string | undefined,
      fileName: string,
      buffer: ArrayBuffer
    ) => Promise<{
      originalPath: string;
      originalUrl: string;
      posterPath?: string;
      posterUrl?: string;
      ghostBase64?: string;
      bytesOriginal: number;
      bytesPoster?: number;
      width?: number;
      height?: number;
    }>;
    createVideoLocalResourceFromUrl: (
      projectId: string | undefined,
      sourceUrl: string
    ) => Promise<{
      originalPath: string;
      originalUrl: string;
      posterPath?: string;
      posterUrl?: string;
      ghostBase64?: string;
      bytesOriginal: number;
      bytesPoster?: number;
      width?: number;
      height?: number;
    }>;
    /** yt-dlp：哔哩哔哩 / YouTube 页或短链；主进程本地下载，不经阿里云（IPC 名历史保留） */
    createVideoFromBilibiliPage: (
      projectId: string | undefined,
      pageUrl: string
    ) => Promise<{
      originalPath: string;
      originalUrl: string;
      posterPath?: string;
      posterUrl?: string;
      ghostBase64?: string;
      bytesOriginal: number;
      bytesPoster?: number;
      width?: number;
      height?: number;
    }>;
    extractAudioFromVideo: (projectId: string | undefined, videoUrl: string) => Promise<{ audioUrl: string }>;
    separateVocalsFromAudio: (projectId: string | undefined, audioUrl: string, mode: 'vocals' | 'accompaniment') => Promise<{ audioUrl: string }>;
    /** 取消人声分离 / Whisper 子进程 */
    cancelAudioTranscribeJobs: () => Promise<{ success: boolean; killed: number }>;
    /** 百炼实时听写：主进程 WebSocket，渲染只收发 PCM/文本 */
    asrRealtimeStart: () => Promise<
      { ok: true; sessionId: string } | { ok: false; message: string; code?: string }
    >;
    /** 单向发送 PCM（无 Promise；勿在音频回调里 invoke） */
    asrRealtimeSendAudio: (sessionId: string, pcmBase64: string) => void;
    asrRealtimeStop: (sessionId: string) => Promise<{ ok: boolean; text: string; message?: string }>;
    asrRealtimeCancel: (sessionId?: string) => Promise<{ ok: boolean }>;
    onAsrRealtimeEvent: (
      callback: (event: {
        type: 'started' | 'partial' | 'final' | 'finished' | 'error';
        sessionId: string;
        text?: string;
        message?: string;
        code?: string;
      }) => void,
    ) => () => void;
    /** 语音→文本：云端 fun-asr；契约 { text } */
    transcribeSpeechFromAudioUrl: (projectId: string | undefined, audioUrl: string, language?: string) => Promise<{ text: string }>;
    /** MV 歌词时间线：云端 fun-asr；契约 { text, segments } */
    transcribeSpeechSegmentsFromAudioUrl: (
      projectId: string | undefined,
      audioUrl: string,
      language?: string,
    ) => Promise<{ text: string; segments: Array<{ text: string; startSec: number; endSec: number }> }>;
    trimAudio: (projectId: string | undefined, audioUrl: string, startSec: number, endSec: number) => Promise<{ audioUrl: string }>;
    trimVideo: (projectId: string | undefined, videoUrl: string, startSec: number, endSec: number) => Promise<{ videoUrl: string; durationSec?: number }>;
    smartAnalyzeVideoShots: (
      projectId: string | undefined,
      videoUrl: string,
      options?: {
        mode?: 'stable' | 'balanced' | 'sensitive';
        maxClips?: number;
        minClipSec?: number;
        withPosters?: boolean;
      },
    ) => Promise<{
      segments: Array<{ startSec: number; endSec: number; score: number; posterUrl?: string }>;
      cutPoints: number[];
      durationSec: number;
      downgraded: boolean;
    }>;
    smartExtractVideoClips: (
      projectId: string | undefined,
      videoUrl: string,
      options?: {
        mode?: 'stable' | 'balanced' | 'sensitive';
        maxClips?: number;
        minClipSec?: number;
        output?: 'clips' | 'keyframes';
      },
    ) => Promise<{
      clips: Array<{ videoUrl: string; startSec: number; endSec: number; posterUrl?: string }>;
      keyframes?: Array<{ imageUrl: string; timeSec: number }>;
      cutPoints: number[];
      durationSec: number;
      downgraded: boolean;
    }>;
    cropVideo: (
      projectId: string | undefined,
      videoUrl: string,
      rect: { x: number; y: number; w: number; h: number },
      sourceWidth: number,
      sourceHeight: number,
    ) => Promise<{
      originalUrl: string;
      posterUrl?: string;
      ghostBase64?: string;
      width?: number;
      height?: number;
    }>;
    chromaKeyVideo: (
      projectId: string | undefined,
      videoUrl: string,
      options: { colorHex: string; similarity?: number; blend?: number },
    ) => Promise<{
      originalUrl: string;
      posterUrl?: string;
      ghostBase64?: string;
      width?: number;
      height?: number;
      hasAlpha?: boolean;
    }>;
    /** 智能抠像（VIAPI 一键人像 → WebM alpha） */
    smartPortraitMatting: (
      projectId: string | undefined,
      videoUrl: string,
    ) => Promise<{
      originalUrl: string;
      posterUrl?: string;
      ghostBase64?: string;
      width?: number;
      height?: number;
      hasAlpha?: boolean;
    }>;
    onSmartPortraitMattingProgress?: (
      callback: (p: { phase: string; percent: number; message: string }) => void,
    ) => () => void;
    getMediaDuration: (url: string, projectId?: string) => Promise<number>;
    exportTimelineVideo: (
      projectId: string | undefined,
      videoClips: Array<{
        type: string;
        src: string;
        duration: number;
        startTime: number;
        trimStart?: number;
        trimEnd?: number;
        name?: string;
        layout?: { x: number; y: number; w: number; h: number };
        crop?: { left: number; top: number; right: number; bottom: number };
      }>,
      audioTracks: Array<Array<{ type: string; src: string; duration: number; startTime: number; trimStart?: number; trimEnd?: number }>>,
      options?: { videoTrackVolume?: number; videoTrackMuted?: boolean; audioTrackVolume?: number[]; audioTrackMuted?: boolean[]; outputWidth?: number; outputHeight?: number }
    ) => Promise<{ success: boolean; videoPath?: string; hasAudio?: boolean; error?: string }>;
    exportTimelineVideoToProject: (
      projectId: string | undefined,
      videoClips: Array<{
        type: string;
        src: string;
        duration: number;
        startTime: number;
        trimStart?: number;
        trimEnd?: number;
        name?: string;
        layout?: { x: number; y: number; w: number; h: number };
        crop?: { left: number; top: number; right: number; bottom: number };
      }>,
      audioTracks: Array<Array<{ type: string; src: string; duration: number; startTime: number; trimStart?: number; trimEnd?: number }>>,
      options?: { videoTrackVolume?: number; videoTrackMuted?: boolean; audioTrackVolume?: number[]; audioTrackMuted?: boolean[]; outputWidth?: number; outputHeight?: number }
    ) => Promise<{
      success: boolean;
      hasAudio?: boolean;
      error?: string;
      originalUrl?: string;
      originalPath?: string;
      posterUrl?: string;
      ghostBase64?: string;
      width?: number;
      height?: number;
    }>;
    setSharpQueuePaused: (paused: boolean) => Promise<{ success: boolean; paused: boolean }>;
    getSharpQueueStats: () => Promise<{
      maxConcurrency: number;
      running: number;
      queued: number;
      paused: boolean;
      throughputPerSec: number;
      pauseTotalMs: number;
    }>;
    ensureLibraryListThumb: (
      sourceUrlOrPath: string,
      maxEdge?: number,
    ) => Promise<{
      success: boolean;
      thumbUrl?: string;
      thumbPath?: string;
      cached?: boolean;
      error?: string;
    }>;
    ensureDigitalHumanListPoster: (itemId: string) => Promise<{
      success: boolean;
      posterUrl?: string;
      localPosterPath?: string;
      cached?: boolean;
      error?: string;
    }>;

    setScreenshotSnipArmed: (armed: boolean, projectId?: string) => Promise<{ ok: boolean; armed: boolean }>;
    syncScreenshotProject: (projectId?: string) => Promise<{ ok: boolean }>;
    startScreenshotSnip: (projectId?: string) => Promise<{ ok: boolean }>;
    onScreenshotImportToCanvas: (callback: (result: {
      originalPath: string;
      previewPath: string;
      tinyPath: string;
      originalUrl: string;
      previewUrl: string;
      tinyUrl: string;
      bytesOriginal: number;
      bytesPreview: number;
      bytesTiny: number;
      avgColorHex?: string;
      ghostBase64?: string;
      width?: number;
      height?: number;
    }) => void) => () => void;
    onScreenshotSnipError: (callback: (payload: { message: string }) => void) => () => void;
    onScreenshotSnipActive: (callback: (payload: { active: boolean }) => void) => () => void;

    // 项目导入导出
    exportProject: (projectId: string, cardBgDataUrl?: string) => Promise<{ success: boolean; canceled?: boolean; filePath?: string }>;
    importProject: () => Promise<{ success: boolean; canceled?: boolean; project?: { id: string; name: string; date: string; createdAt: number; lastModified: number }; cardBackground?: string }>;

    // AI 调用
    invokeAI: (params: { modelId: string; nodeId: string; input: any }) => Promise<void>;
    
    // AI 状态更新监听（返回清理函数）
    onAIStatusUpdate: (callback: (packet: { nodeId: string; status: 'START' | 'PROCESSING' | 'SUCCESS' | 'ERROR'; payload?: { text?: string; url?: string; progress?: number; error?: string } }) => void) => (() => void) | void;
    
    // 移除 AI 状态更新监听（保留以兼容旧代码）
    removeAIStatusUpdateListener: () => void;

    // 熔断器状态（连续超时后 2 分钟内禁止新任务）
    onCircuitBreakerState: (callback: (data: { open: boolean; retryAfter?: number }) => void) => () => void;

    // 熔断器状态查询（Ctrl+Shift+B 也可触发）
    getCircuitBreakerStatus: () => Promise<{ open: boolean; consecutiveTimeoutCount: number; circuitOpenUntil: number; retryAfterSeconds: number }>;

    // 窗口操作
    resizeWindow: (width: number, height: number) => Promise<{ success: boolean }>;
    quitApp: () => Promise<{ success: boolean }>;
    requestRendererReload: () => Promise<{ success: boolean }>;
    toggleFullscreen: () => Promise<{ success: boolean; isFullScreen: boolean }>;
    setFullscreen: (enable: boolean) => Promise<{ success: boolean }>;
    getFullscreenState: () => Promise<{ isFullScreen: boolean }>;
    getAppVersion: () => Promise<string>;
    getNetworkTime: () => Promise<number>;
    /** 列举北京桶 WX/ 最新图片公开 URL */
    getWeChatGroupQrUrl: (force?: boolean) => Promise<
      { ok: true; url: string; objectKey: string } | { ok: false; error: string }
    >;
    /** 列举北京桶教学视频目录 mp4 公开 URL（按文件名序号排序） */
    listTutorialVideos: (force?: boolean) => Promise<
      | {
          ok: true;
          items: Array<{ objectKey: string; title: string; url: string; sortIndex: number }>;
        }
      | { ok: false; error: string }
    >;
    checkForUpdates: () => Promise<{ updateAvailable: boolean; currentVersion: string; latestVersion: string | null; packageBytes?: number; error?: string | null }>;
    downloadAndInstallUpdate: () => Promise<{ success: boolean; error?: string }>;
    pauseUpdateDownload: () => Promise<{ success: boolean; paused?: boolean }>;
    resumeUpdateDownload: () => Promise<{ success: boolean; paused?: boolean; error?: string }>;
    cancelUpdateDownload: () => Promise<{ success: boolean }>;
    onUpdateAvailable: (callback: (info: { version: string; packageBytes?: number }) => void) => () => void;
    onUpdateDownloaded: (callback: () => void) => () => void;
    onUpdateInstalling: (callback: () => void) => () => void;
    onPrepareForUpdate: (callback: () => void | Promise<void>) => () => void;
    onUpdateDownloadProgress: (callback: (info: {
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
    }) => void) => () => void;
    onUpdateDownloadPaused: (callback: (info: { paused: boolean }) => void) => () => void;
    onUpdateDownloadCancelled: (callback: () => void) => () => void;
    onUpdateError: (callback: (info: { message: string }) => void) => () => void;
    onProjectImportedFromFile: (
      callback: (payload: {
        project: { id: string; name: string; date: string; createdAt: number; lastModified: number };
        cardBackground?: string;
      }) => void,
    ) => () => void;

    // 全局 LLM 人设管理
    getGlobalLLMPersonas: () => Promise<Array<{ id: string; name: string; content: string }>>;
    saveGlobalLLMPersona: (persona: { id: string; name: string; content: string }) => Promise<{ success: boolean }>;
    updateGlobalLLMPersonas: (personas: Array<{ id: string; name: string; content: string }>) => Promise<{ success: boolean }>;
    deleteGlobalLLMPersona: (personaId: string) => Promise<{ success: boolean }>;

    // 选择自定义保存路径
    selectSavePath: () => Promise<{ success: boolean; path?: string; error?: string }>;
    
    // 自动保存图片（生成完成后自动调用）
    autoSaveImage: (imageUrl: string, nodeTitle: string, projectId?: string) => Promise<{ success: boolean; filePath?: string; error?: string }>;
    
    // 自动保存视频（生成完成后自动调用）
    autoSaveVideo: (videoUrl: string, nodeTitle: string, projectId?: string) => Promise<{ success: boolean; filePath?: string; error?: string }>;
    // 自动保存音频（生成完成后自动调用，preferredFileName 如歌曲名用作保存文件名）
    autoSaveAudio: (audioUrl: string, preferredFileName: string, projectId?: string) => Promise<{ success: boolean; filePath?: string; error?: string }>;
    // 下载图片（手动选择保存位置）
    downloadImage: (imageUrl: string, nodeTitle: string) => Promise<{ success: boolean; filePath?: string; error?: string }>;
    
    // 下载视频（手动选择保存位置）
    downloadVideo: (videoUrl: string, nodeTitle: string) => Promise<{ success: boolean; filePath?: string; error?: string }>;
    // 下载音频（手动选择保存位置）
    downloadAudio: (audioUrl: string, nodeTitle: string) => Promise<{ success: boolean; filePath?: string; error?: string }>;
    // 将本地文件复制到用户选择的下载目录
    downloadLocalFileToFolder: (localFilePath: string, preferredFileName?: string) => Promise<{ success: boolean; filePath?: string; error?: string }>;
    prepareImageForExternalDrag: (payload: {
      imageUrl: string;
      preferredBaseName?: string;
    }) => Promise<{ success: boolean; path?: string; error?: string }>;
    startNativeFileDrag: (absoluteFilePath: string) => void;

    // 打开文件
    openFile: (filePath: string) => Promise<{ success: boolean; error?: string }>;
    
    // 选择参考音文件（Index-TTS2.0 等）
    showOpenAudioDialog: () => Promise<{ success: boolean; filePath?: string; error?: string }>;
    // 选择参考图片（Doubao 音频等）
    showOpenImageDialog: () => Promise<{ success: boolean; filePath?: string; error?: string }>;
    // 选择视频文件（与 AudioNode 一致的 IPC 方案）
    showOpenVideoDialog: () => Promise<{ success: boolean; filePath?: string; error?: string }>;
    // 在文件管理器中显示文件（打开文件所在的文件夹并选中文件）
    showItemInFolder: (filePath: string) => Promise<{ success: boolean; error?: string }>;
    
    // 获取用户数据路径
    getUserDataPath: () => Promise<string>;
    
    // 打开路径（文件夹或文件）
    openPath: (pathToOpen: string) => Promise<{ success: boolean; error?: string }>;
    openExternalUrl: (url: string) => Promise<void>;
    openInAppBrowser: (
      url: string,
      title?: string,
    ) => Promise<{ ok: true; mode: 'in-app' | 'external' } | { ok: false; error: string }>;

    // 项目存储根路径（自定义保存位置）
    getProjectBasePath: () => Promise<string>;
    setProjectBasePath: () => Promise<{ success: boolean; path: string }>;
    diagnoseStoragePaths: () => Promise<{
      userData: string;
      projectsBase: string;
      customProjectPath: string;
      projectsDirExists: boolean;
      projectCount: number;
      projectFolders: Array<{ id: string; name: string; exists: boolean; nodeCount?: number }>;
      legacyPaths: Array<{ path: string; exists: boolean }>;
      isPackaged: boolean;
    }>;

    // 角色管理
    getCharacters: () => Promise<Array<{ id: string; nickname: string; name: string; username?: string; avatar: string; roleId?: string; permalink?: string; createdAt: number; localAvatarPath?: string; voiceClip?: string; localVoicePath?: string; viewImages?: string[]; localViewPaths?: string[]; assetKind?: 'role' | 'imageTo3d'; inputImageUrl?: string; localGlbPath?: string; localGlbUrl?: string; remoteGlbUrl?: string; resultTextureUrl?: string; localTexturePath?: string }>>;
    registerImageTo3dCharacter: (payload: {
      nickname?: string;
      inputImageUrl?: string;
      localAvatarPath?: string;
      localGlbPath?: string;
      localGlbUrl?: string;
      remoteGlbUrl?: string;
      resultTextureLocalUrl?: string;
      resultTextureRemoteUrl?: string;
    }) => Promise<{ id: string; nickname: string; name: string; avatar: string; createdAt: number; assetKind?: 'imageTo3d'; inputImageUrl?: string; localAvatarPath?: string; localGlbPath?: string; localGlbUrl?: string; remoteGlbUrl?: string; resultTextureUrl?: string; localTexturePath?: string }>;
    uploadCharacterVideo: (videoUrl: string, timestamp?: string, channel?: 'plugin' | 'core') => Promise<{ success: boolean; url: string; roleId?: string; permalink?: string; username?: string }>;
    createCharacter: (nickname: string, name: string, avatar: string, roleId?: string, permalink?: string, voiceClip?: string, viewImages?: string[]) => Promise<{ id: string; nickname: string; name: string; username?: string; avatar: string; roleId?: string; permalink?: string; createdAt: number; localAvatarPath?: string; voiceClip?: string; localVoicePath?: string; viewImages?: string[]; localViewPaths?: string[] }>;
    updateCharacter: (characterId: string, updates: { nickname?: string; name?: string; avatar?: string; roleId?: string; permalink?: string; voiceClip?: string; viewImages?: string[] }) => Promise<{ id: string; nickname: string; name: string; avatar: string; roleId?: string; permalink?: string; createdAt: number; localAvatarPath?: string; voiceClip?: string; localVoicePath?: string; viewImages?: string[]; localViewPaths?: string[] }>;
    deleteCharacter: (characterId: string) => Promise<{ success: boolean }>;
    clearInvalidAvatarUrl: (characterId: string, invalidUrl: string) => Promise<{ success: boolean; message?: string }>;
    exportCharacters: (characterIds: string[]) => Promise<{ success: boolean; filePath?: string; error?: string }>;
    importCharacters: () => Promise<{ success: boolean; count?: number; error?: string }>;

    getScenes: () => Promise<
      Array<{
        id: string;
        nickname: string;
        name: string;
        avatar: string;
        localAvatarPath?: string;
        normalImageUrl?: string;
        localNormalImagePath?: string;
        display3dImageUrl?: string;
        localDisplay3dImagePath?: string;
        panoramaUrl?: string;
        localPanoramaPath?: string;
        createdAt: number;
      }>
    >;
    registerScene: (payload: {
      nickname?: string;
      panoramaUrl?: string;
      normalImageUrl?: string;
      display3dImageUrl?: string;
    }) => Promise<{
      id: string;
      nickname: string;
      name: string;
      avatar: string;
      normalImageUrl?: string;
      display3dImageUrl?: string;
      panoramaUrl?: string;
      createdAt: number;
    }>;
    updateScene: (
      sceneId: string,
      updates: { nickname?: string; normalImageUrl?: string; display3dImageUrl?: string },
    ) => Promise<Record<string, unknown>>;
    deleteScenes: (sceneIds: string[]) => Promise<{ success: boolean }>;
    pickSceneImage: (role?: 'normal' | 'display3d') => Promise<{
      canceled: boolean;
      filePath?: string;
      role?: 'normal' | 'display3d';
    }>;
    pickSceneUpload: () => Promise<{ canceled: boolean; filePath?: string }>;
    exportScenes: (sceneIds: string[]) => Promise<{
      success: boolean;
      filePath?: string;
      count?: number;
      error?: string;
    }>;
    importScenes: () => Promise<{
      success: boolean;
      count?: number;
      canceled?: boolean;
      error?: string;
    }>;

    getDigitalHumans: () => Promise<
      Array<{
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
      }>
    >;
    registerDigitalHuman: (payload: {
      nickname?: string;
      videoUrl?: string;
      audioUrl?: string;
      posterUrl?: string;
    }) => Promise<Record<string, unknown>>;
    updateDigitalHuman: (
      itemId: string,
      updates: { nickname?: string; videoUrl?: string; audioUrl?: string; posterUrl?: string },
    ) => Promise<Record<string, unknown>>;
    deleteDigitalHumans: (itemIds: string[]) => Promise<{ success: boolean }>;

    getRvcVoices: () => Promise<
      Array<{
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
        trainAudioUrl?: string;
        localTrainAudioPath?: string;
        originalTrainAudioUrl?: string;
      }>
    >;
    registerRvcVoice: (payload: {
      nickname?: string;
      modelPackageUrl?: string;
      modelPackageRemoteUrl?: string;
      rvcTrainModelName?: string;
      trainAudioUrl?: string;
      trainAudioRemoteUrl?: string;
    }) => Promise<Record<string, unknown>>;
    updateRvcVoice: (
      itemId: string,
      updates: {
        nickname?: string;
        modelPackageUrl?: string;
        rvcTrainModelName?: string;
        avatarUrl?: string;
        trainAudioUrl?: string;
      },
    ) => Promise<Record<string, unknown>>;
    deleteRvcVoices: (itemIds: string[]) => Promise<{ success: boolean }>;
    getRvcEngineStatus: () => Promise<{
      ready: boolean;
      engineDir: string;
      cliPath: string | null;
      hubertPath: string | null;
      rmvpePath: string | null;
      missing: string[];
      version?: string;
      downloadUrlConfigured: boolean;
    }>;
    downloadRvcEngine: () => Promise<{
      ready: boolean;
      engineDir: string;
      cliPath: string | null;
      hubertPath: string | null;
      rmvpePath: string | null;
      missing: string[];
      version?: string;
      downloadUrlConfigured: boolean;
    }>;
    getWhisperEngineStatus: () => Promise<{
      ready: boolean;
      engineDir: string;
      binaryPath: string | null;
      modelPath: string | null;
      missing: string[];
      version?: string;
      downloadUrlConfigured: boolean;
    }>;
    downloadWhisperEngine: () => Promise<{
      ready: boolean;
      engineDir: string;
      binaryPath: string | null;
      modelPath: string | null;
      missing: string[];
      version?: string;
      downloadUrlConfigured: boolean;
    }>;
    onOptionalEngineDownloadProgress: (
      callback: (payload: {
        kind: 'rvc' | 'whisper';
        phase: 'downloading' | 'extracting' | 'done' | 'error';
        percent: number;
        message: string;
      }) => void,
    ) => () => void;
    pickRvcVoicePackage: () => Promise<{ canceled: boolean; filePath?: string }>;
    pickRvcVoiceAvatar: () => Promise<{ canceled: boolean; filePath?: string }>;
    pickRvcVoiceTrainAudio: () => Promise<{ canceled: boolean; filePath?: string }>;

    // 上传图片到 runninghub（用于 sora-2 图生视频）
    uploadImageToRunningHub: (imageUrl: string) => Promise<{ success: boolean; url: string }>;
    imageMatting: (imageUrl: string) => Promise<{ success: boolean; imageUrl: string }>;
    imageWatermarkRemoval: (imageUrl: string) => Promise<{ success: boolean; imageUrl: string }>;
    imageUpscaleV3: (imageUrl: string) => Promise<{ success: boolean; imageUrl: string }>;
    videoWatermarkRemoval: (videoUrl: string, strength?: number) => Promise<{ success: boolean; videoUrl: string }>;
    videoDepthConvert: (videoUrl: string) => Promise<{
      success: boolean;
      kind: 'video' | 'image';
      url: string;
      videoUrl?: string;
      imageUrl?: string;
    }>;
    videoSubtitleWatermarkRemoval: (videoUrl: string) => Promise<{
      success: boolean;
      kind: 'video' | 'image';
      url: string;
      videoUrl?: string;
      imageUrl?: string;
    }>;
    imageCharacterMultiAngle: (imageUrl: string) => Promise<{ success: boolean; imageUrl: string; imageUrls?: string[] }>;
    imageTo3d: (
      imageUrl: string,
      projectId?: string,
      nodeId?: string,
      modelId?: string,
    ) => Promise<{
      success: boolean;
      glbUrl: string;
      remoteGlbUrl: string;
      localGlbPath?: string;
      localGlbUrl: string;
      resultTextureRemoteUrl?: string;
      resultTextureLocalUrl?: string;
      resultTextureLocalPath?: string;
    }>;
    ensureImageTo3dLocalTexture: (opts: {
      glbLocalPath?: string;
      glbResourceUrl?: string;
    }) => Promise<{ textureLocalPath: string; textureLocalUrl: string }>;
    saveImageTo3dAixflow: (opts: {
      defaultName?: string;
      glbLocalPath?: string;
      glbRemoteUrl?: string;
      textureLocalPath?: string;
      textureRemoteUrl?: string;
      textureResourceUrl?: string;
      referenceLocalPath?: string;
      referenceRemoteUrl?: string;
    }) => Promise<{ canceled: boolean; filePath?: string; hasTexture?: boolean; hasReference?: boolean }>;
    pickImageTo3dUpload: () => Promise<{ canceled: boolean; filePath?: string }>;
    pickImageTo3dAvatar: () => Promise<{ canceled: boolean; filePath?: string }>;
    exportImageTo3dModels: (characterIds: string[]) => Promise<{
      success: boolean;
      filePath?: string;
      count?: number;
      error?: string;
    }>;
    importImageTo3dAsset: (opts?: { filePath?: string }) => Promise<{
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
    }>;
    saveGlbFile: (opts: {
      localPath?: string;
      remoteUrl?: string;
      defaultName?: string;
    }) => Promise<{ canceled: boolean; filePath?: string }>;

    // 上传视频到 OSS
    uploadVideoToOSS: (videoUrl: string) => Promise<{ success: boolean; url?: string; error?: string }>;
    
    // 上传本地视频到 OSS（用于角色创建模块）
    uploadLocalVideoToOSS: (localVideoPath: string) => Promise<{ success: boolean; url?: string; error?: string }>;
    // 上传本地音频到 OSS（声音模块连接时，参考音上传后回传 URL）
    uploadLocalAudioToOSS: (localAudioPath: string) => Promise<{ success: boolean; url?: string; error?: string }>;

    // 上传图片到 OSS（接收 base64 图片数据）
    uploadImageToOSS: (imageData: string) => Promise<{ success: boolean; url?: string; error?: string }>;

    // 任务列表管理
    saveTasks: (tasks: any[]) => Promise<{ success: boolean; tasks?: any[]; error?: string }>;
    loadTasks: () => Promise<{ success: boolean; tasks?: any[]; error?: string }>;
    resumeRunningHubVideoPoll: (args: {
      nodeId: string;
      rhTaskId: string;
      projectId?: string;
      prompt?: string;
      nodeTitle?: string;
    }) => Promise<{ success: boolean; error?: string }>;
    resumeRunningHubImagePoll: (args: {
      nodeId: string;
      rhTaskId: string;
      projectId?: string;
      prompt?: string;
      nodeTitle?: string;
    }) => Promise<{ success: boolean; error?: string }>;
    resumeRunningHubAudioPoll: (args: {
      nodeId: string;
      rhTaskId: string;
      projectId?: string;
      prompt?: string;
      nodeTitle?: string;
    }) => Promise<{ success: boolean; error?: string }>;

    // 检查文件是否存在（用于播放器预检查）
    checkFileExists: (filePath: string) => Promise<{ exists: boolean; path?: string; size?: number; readable?: boolean; error?: string }>;
    
    // 项目路径映射
    ensureProjectMapping: (projectId: string) => Promise<string | null>;
    getProjectMappedPath: (projectId: string) => Promise<string | null>;
    getProjectOriginalPath: (projectId: string) => Promise<string | null>;
  };
}
