import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// 地図・海図のタイル。見た範囲と、出港前に保存した範囲（src/tiles.ts の TILE_CACHE）を、電波がない時に表示する
const TILE_HOSTS = /^https:\/\/(cyberjapandata\.gsi\.go\.jp|tile\.openstreetmap\.org|tiles\.openseamap\.org|wms\.gebco\.net)\//

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon-32.png', 'apple-touch-icon.png'],
      manifest: {
        name: '海ログ OceanLog',
        short_name: '海ログ',
        description: 'ボート・水上バイクの航行支援アプリ。現在地・航跡・潮汐・日の出日没・風・気圧・波',
        lang: 'ja',
        id: './',
        display: 'standalone',
        orientation: 'portrait',
        categories: ['navigation', 'weather', 'sports'],
        start_url: './',
        scope: './',
        background_color: '#0b3d5c',
        theme_color: '#0b3d5c',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        // help.html はアプリ（SPA）ではない単独のページ。指定しないと、オフライン対応の仕組みがアプリの画面を返してしまう
        navigateFallbackDenylist: [/\/help\.html(\?.*)?$/],
        runtimeCaching: [
          {
            urlPattern: TILE_HOSTS,
            handler: 'CacheFirst',
            options: {
              cacheName: 'map-tiles',
              expiration: { maxEntries: 20000, maxAgeSeconds: 90 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // OCR の部品（tesseract.js の worker・wasm・言語データ）は CDN から読み込む。一度読み込んだら端末に保存する（LeadLog と同じ）
            urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/npm\/(?:tesseract\.js|tesseract\.js-core|@tesseract\.js-data)/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'ocr-assets',
              expiration: { maxEntries: 40, maxAgeSeconds: 365 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // 気象庁の地域の表（めったに変わらない）
            urlPattern: /^https:\/\/www\.jma\.go\.jp\/bosai\/common\/const\/area\.json$/,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'jma-area', cacheableResponse: { statuses: [0, 200] } },
          },
        ],
      },
    }),
  ],
})
