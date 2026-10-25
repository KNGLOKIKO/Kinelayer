import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  // 部署到 GitHub Pages 的项目页时，资源前缀是 /<repo>/。
  // 用环境变量注入，本地开发保持 '/'，避免 dev 端口多一层路径。
  base: process.env.VITE_BASE ?? '/',
  // 工程包 manifest 里要写「这份包是哪个版本导的」，构建期烧进去
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5273,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
});
