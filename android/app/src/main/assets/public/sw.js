/**
 * Copyright 2018 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// If the loader is already loaded, just stop.
if (!self.define) {
  let registry = {};

  // Used for `eval` and `importScripts` where we can't get script URL by other means.
  // In both cases, it's safe to use a global var because those functions are synchronous.
  let nextDefineUri;

  const singleRequire = (uri, parentUri) => {
    uri = new URL(uri + ".js", parentUri).href;
    return registry[uri] || (
      
        new Promise(resolve => {
          if ("document" in self) {
            const script = document.createElement("script");
            script.src = uri;
            script.onload = resolve;
            document.head.appendChild(script);
          } else {
            nextDefineUri = uri;
            importScripts(uri);
            resolve();
          }
        })
      
      .then(() => {
        let promise = registry[uri];
        if (!promise) {
          throw new Error(`Module ${uri} didn’t register its module`);
        }
        return promise;
      })
    );
  };

  self.define = (depsNames, factory) => {
    const uri = nextDefineUri || ("document" in self ? document.currentScript.src : "") || location.href;
    if (registry[uri]) {
      // Module is already loading or loaded.
      return;
    }
    let exports = {};
    const require = depUri => singleRequire(depUri, uri);
    const specialDeps = {
      module: { uri },
      exports,
      require
    };
    registry[uri] = Promise.all(depsNames.map(
      depName => specialDeps[depName] || require(depName)
    )).then(deps => {
      factory(...deps);
      return exports;
    });
  };
}
define(['./workbox-afac4cd2'], (function (workbox) { 'use strict';

  self.skipWaiting();
  workbox.clientsClaim();
  /**
   * The precacheAndRoute() method efficiently caches and responds to
   * requests for URLs in the manifest.
   * See https://goo.gl/S9QRab
   */
  workbox.precacheAndRoute([{
    "url": "registerSW.js",
    "revision": "1872c500de691dce40960bb85481de07"
  }, {
    "url": "pwa-maskable-512x512.png",
    "revision": "72309acc2152ee935e48cb01c3afcfd3"
  }, {
    "url": "pwa-512x512.png",
    "revision": "bde591c9603aa552cffb5215fffde49b"
  }, {
    "url": "pwa-192x192.png",
    "revision": "e3e147d9b41d6f4c272e5bcdb093e795"
  }, {
    "url": "index.html",
    "revision": "9cd9ce8e30bb858fb684360256a16466"
  }, {
    "url": "icon.svg",
    "revision": "737f61a0bf0dd465f8019dab8963f74e"
  }, {
    "url": "apple-touch-icon.png",
    "revision": "d4a24744526905f4c2c777f125358766"
  }, {
    "url": "tesseract/worker.min.js",
    "revision": "b1ab464237e687b323da236fff45ba05"
  }, {
    "url": "tesseract/tesseract-core-simd-lstm.wasm.js",
    "revision": "2bd630487581a49b7d7cce1bfe42314c"
  }, {
    "url": "tesseract/tesseract-core-relaxedsimd-lstm.wasm.js",
    "revision": "f267f4efd6219843707c73b3a9a70604"
  }, {
    "url": "tesseract/tesseract-core-lstm.wasm.js",
    "revision": "a3c227d2e04b7be5d1ef50d75f3a5ee3"
  }, {
    "url": "pdfjs/wasm/quickjs-eval.js",
    "revision": "09b2ab789dafda562b60dca31b2f3711"
  }, {
    "url": "pdfjs/wasm/openjpeg_nowasm_fallback.js",
    "revision": "84ca6760c86796cea2e10588dfe1c93a"
  }, {
    "url": "pdfjs/wasm/jbig2_nowasm_fallback.js",
    "revision": "802ec05c40f0ae9f581cdc997360bf00"
  }, {
    "url": "assets/web-Ccbep5QC.js",
    "revision": null
  }, {
    "url": "assets/web-CZZ-WyB-.js",
    "revision": null
  }, {
    "url": "assets/plus-jakarta-sans-latin-700-normal-DqEcQeE5.woff",
    "revision": null
  }, {
    "url": "assets/plus-jakarta-sans-latin-700-normal-CfpNZvy6.woff2",
    "revision": null
  }, {
    "url": "assets/plus-jakarta-sans-latin-600-normal-DLTa1BUW.woff2",
    "revision": null
  }, {
    "url": "assets/plus-jakarta-sans-latin-600-normal-BR_Ojra4.woff",
    "revision": null
  }, {
    "url": "assets/plus-jakarta-sans-latin-500-normal-DYtqi0QS.woff",
    "revision": null
  }, {
    "url": "assets/plus-jakarta-sans-latin-500-normal-Bf-nb4oT.woff2",
    "revision": null
  }, {
    "url": "assets/pdf.worker.min-CIqJB0yW.mjs",
    "revision": null
  }, {
    "url": "assets/jetbrains-mono-latin-600-normal-C8RAYTDA.woff2",
    "revision": null
  }, {
    "url": "assets/jetbrains-mono-latin-600-normal-BfsvjouI.woff",
    "revision": null
  }, {
    "url": "assets/jetbrains-mono-latin-500-normal-CJOVTJB7.woff",
    "revision": null
  }, {
    "url": "assets/jetbrains-mono-latin-500-normal-BWZEU5yA.woff2",
    "revision": null
  }, {
    "url": "assets/jetbrains-mono-latin-400-normal-V6pRDFza.woff2",
    "revision": null
  }, {
    "url": "assets/jetbrains-mono-latin-400-normal-6-qcROiO.woff",
    "revision": null
  }, {
    "url": "assets/index-DHk7tP1y.css",
    "revision": null
  }, {
    "url": "assets/index-BFm6lKoi.js",
    "revision": null
  }, {
    "url": "assets/dm-sans-latin-700-normal-DvUfVpUG.woff2",
    "revision": null
  }, {
    "url": "assets/dm-sans-latin-700-normal-CUSSCpQX.woff",
    "revision": null
  }, {
    "url": "assets/dm-sans-latin-600-normal-BmdmIIQ2.woff",
    "revision": null
  }, {
    "url": "assets/dm-sans-latin-600-normal-Aqo67rzb.woff2",
    "revision": null
  }, {
    "url": "assets/dm-sans-latin-500-normal-Dr3UlScf.woff",
    "revision": null
  }, {
    "url": "assets/dm-sans-latin-500-normal-B9HHJjqV.woff2",
    "revision": null
  }, {
    "url": "assets/dm-sans-latin-400-normal-CW0RaeGs.woff2",
    "revision": null
  }, {
    "url": "assets/dm-sans-latin-400-normal-BwCSEQnW.woff",
    "revision": null
  }, {
    "url": "apple-touch-icon.png",
    "revision": "d4a24744526905f4c2c777f125358766"
  }, {
    "url": "icon.svg",
    "revision": "737f61a0bf0dd465f8019dab8963f74e"
  }, {
    "url": "pwa-192x192.png",
    "revision": "e3e147d9b41d6f4c272e5bcdb093e795"
  }, {
    "url": "pwa-512x512.png",
    "revision": "bde591c9603aa552cffb5215fffde49b"
  }, {
    "url": "pwa-maskable-512x512.png",
    "revision": "72309acc2152ee935e48cb01c3afcfd3"
  }, {
    "url": "manifest.webmanifest",
    "revision": "68281a07c8e89a0eb89459a27926af5f"
  }], {});
  workbox.cleanupOutdatedCaches();
  workbox.registerRoute(new workbox.NavigationRoute(workbox.createHandlerBoundToURL("index.html")));
  workbox.registerRoute(/^https:\/\/fonts\.googleapis\.com\/.*/i, new workbox.CacheFirst({
    "cacheName": "google-fonts-cache",
    plugins: [new workbox.ExpirationPlugin({
      maxEntries: 10,
      maxAgeSeconds: 31536000
    }), new workbox.CacheableResponsePlugin({
      statuses: [0, 200]
    })]
  }), 'GET');
  workbox.registerRoute(/^https:\/\/fonts\.gstatic\.com\/.*/i, new workbox.CacheFirst({
    "cacheName": "gstatic-fonts-cache",
    plugins: [new workbox.ExpirationPlugin({
      maxEntries: 10,
      maxAgeSeconds: 31536000
    }), new workbox.CacheableResponsePlugin({
      statuses: [0, 200]
    })]
  }), 'GET');
  workbox.registerRoute(/^https?:\/\/[^/]+\/(?:tesseract|pdfjs)\/.*/i, new workbox.CacheFirst({
    "cacheName": "offline-pdf-ocr-assets",
    plugins: [new workbox.ExpirationPlugin({
      maxEntries: 250,
      maxAgeSeconds: 31536000
    }), new workbox.CacheableResponsePlugin({
      statuses: [0, 200]
    })]
  }), 'GET');

}));
