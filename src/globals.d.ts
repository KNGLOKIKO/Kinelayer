/// <reference types="vite/client" />

/** 构建期注入（见 vite.config.ts 的 define）。工程包 manifest 里记它，出问题时能对上版本 */
declare const __APP_VERSION__: string;
