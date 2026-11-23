import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages처럼 하위 주소(/저장소이름/)에 올릴 때는 BASE_PATH로 알려 준다. 기본은 '/'.
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const base = env.BASE_PATH || '/';

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      // 등록은 src/pwa.ts에서 직접 한다 (Android 앱 안에서는 등록하지 않기 위해)
      injectRegister: false,
      // 새 버전은 안내를 띄우고 사용자가 누를 때 바꾼다 (src/pwa.ts)
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: '반걸음',
        short_name: '반걸음',
        description: '큰 목표를 지금 바로 할 수 있는 작은 단계로 나눠 주는 앱',
        lang: 'ko',
        // 매니페스트 위치(= base) 기준 상대 주소라 어느 하위 주소에 올려도 맞는다
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#eef2ef',
        theme_color: '#eef2ef',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // 화면 전환은 # 뒤로만 하므로 base 주소 하나만 열리면 된다 (base/ → base/index.html)
      },
    }),
  ],
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
  },
});
