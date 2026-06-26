/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 场景配置 JSON 完整 URL（默认香港示例桶 config.json） */
  readonly VITE_OSS_SCENE_CONFIG_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
