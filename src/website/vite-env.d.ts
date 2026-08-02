/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 场景配置 JSON 完整 URL（默认香港示例桶 config.json） */
  readonly VITE_OSS_SCENE_CONFIG_URL: string;
  /** 官网站点区域强制：cn=北京优先 / hk=香港优先（默认按域名 aixflow.com.cn / aixflow.ai） */
  readonly VITE_SITE_REGION?: string;
  /** 安装包下载区域：cn|hk|auto（auto 跟站点区域） */
  readonly VITE_DOWNLOAD_REGION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
