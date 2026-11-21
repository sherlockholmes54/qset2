import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icon.svg', 'apple-touch-icon.png', 'pwa-192x192.png', 'pwa-512x512.png', 'pwa-maskable-512x512.png'],
        manifest: {
          id: '/',
          name: 'Qset maker',
          short_name: 'Qset maker',
          description: 'Scan PDF question banks, crop specific questions with OCR recognition, and merge them into high-quality printable PDF question sets.',
          theme_color: '#000000',
          background_color: '#000000',
          display: 'standalone',
          orientation: 'any',
          start_url: '/',
          scope: '/',
          icons: [
            {
              src: '/pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,mjs,woff,woff2}'],
          maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'gstatic-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https?:\/\/[^/]+\/(?:tesseract|pdfjs)\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'offline-pdf-ocr-assets',
                expiration: {
                  maxEntries: 250,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
          ],
        },
        devOptions: {
          enabled: true,
          type: 'module',
        },
      }),
      // Copies src/assets into dist/ and bundles local PDF.js + Tesseract OCR assets
      // so Android WebView runs completely offline with zero CDN dependencies.
      {
        name: 'copy-unbundled-src-assets',
        configureServer(server) {
          const mimeTypes: Record<string, string> = {
            '.js': 'application/javascript; charset=utf-8',
            '.mjs': 'application/javascript; charset=utf-8',
            '.wasm': 'application/wasm',
            '.gz': 'application/gzip',
            '.bcmap': 'application/octet-stream',
            '.ttf': 'font/ttf',
            '.pfb': 'application/octet-stream',
          };
          const staticMappings: Array<{ prefix: string; target: string }> = [
            { prefix: '/tesseract/lang/', target: path.resolve(__dirname, 'node_modules/@tesseract.js-data/eng/4.0.0_best_int') },
            { prefix: '/tesseract/worker.min.js', target: path.resolve(__dirname, 'node_modules/tesseract.js/dist/worker.min.js') },
            { prefix: '/tesseract/', target: path.resolve(__dirname, 'node_modules/tesseract.js-core') },
            { prefix: '/pdfjs/cmaps/', target: path.resolve(__dirname, 'node_modules/pdfjs-dist/cmaps') },
            { prefix: '/pdfjs/standard_fonts/', target: path.resolve(__dirname, 'node_modules/pdfjs-dist/standard_fonts') },
            { prefix: '/pdfjs/wasm/', target: path.resolve(__dirname, 'node_modules/pdfjs-dist/wasm') },
          ];
          server.middlewares.use((req, res, next) => {
            const urlPath = (req.url || '').split('?')[0];
            for (const mapping of staticMappings) {
              if (mapping.prefix.endsWith('.js') && urlPath === mapping.prefix) {
                if (fs.existsSync(mapping.target)) {
                  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
                  fs.createReadStream(mapping.target).pipe(res);
                  return;
                }
              } else if (mapping.prefix.endsWith('/') && urlPath.startsWith(mapping.prefix)) {
                const rel = urlPath.slice(mapping.prefix.length);
                if (!rel || rel.includes('..')) break;
                const filePath = path.join(mapping.target, rel);
                if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
                  const ext = path.extname(filePath).toLowerCase();
                  res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
                  fs.createReadStream(filePath).pipe(res);
                  return;
                }
              }
            }
            next();
          });
        },
        closeBundle(error?: Error): void {
          if (error) {
            return;
          }
          const distDir = path.resolve(__dirname, 'dist');
          if (!fs.existsSync(distDir)) return;

          const srcAssets = path.resolve(__dirname, 'src/assets');
          const distAssets = path.resolve(distDir, 'src/assets');
          if (fs.existsSync(srcAssets)) {
            fs.cpSync(srcAssets, distAssets, {recursive: true, force: true});
          }

          const distTesseract = path.resolve(distDir, 'tesseract');
          const distTesseractLang = path.resolve(distTesseract, 'lang');
          fs.mkdirSync(distTesseractLang, {recursive: true});

          const tesseractFiles: Array<[string, string]> = [
            [
              path.resolve(__dirname, 'node_modules/tesseract.js/dist/worker.min.js'),
              path.resolve(distTesseract, 'worker.min.js'),
            ],
            [
              path.resolve(__dirname, 'node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js'),
              path.resolve(distTesseract, 'tesseract-core-lstm.wasm.js'),
            ],
            [
              path.resolve(__dirname, 'node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js'),
              path.resolve(distTesseract, 'tesseract-core-simd-lstm.wasm.js'),
            ],
            [
              path.resolve(__dirname, 'node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js'),
              path.resolve(distTesseract, 'tesseract-core-relaxedsimd-lstm.wasm.js'),
            ],
            [
              path.resolve(__dirname, 'node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'),
              path.resolve(distTesseractLang, 'eng.traineddata.gz'),
            ],
          ];
          for (const [srcFile, destFile] of tesseractFiles) {
            if (fs.existsSync(srcFile)) {
              fs.copyFileSync(srcFile, destFile);
            }
          }

          const distPdfjs = path.resolve(distDir, 'pdfjs');
          const pdfjsDirs: Array<[string, string]> = [
            [path.resolve(__dirname, 'node_modules/pdfjs-dist/cmaps'), path.resolve(distPdfjs, 'cmaps')],
            [path.resolve(__dirname, 'node_modules/pdfjs-dist/standard_fonts'), path.resolve(distPdfjs, 'standard_fonts')],
            [path.resolve(__dirname, 'node_modules/pdfjs-dist/wasm'), path.resolve(distPdfjs, 'wasm')],
          ];
          for (const [srcFolder, destFolder] of pdfjsDirs) {
            if (fs.existsSync(srcFolder)) {
              fs.cpSync(srcFolder, destFolder, {recursive: true, force: true});
            }
          }
        },
      },
    ],
    build: {
      outDir: 'dist',
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
