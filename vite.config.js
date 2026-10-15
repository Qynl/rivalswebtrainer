import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { createHash } from "node:crypto";
function offlineCache() {
  return {
    name: "offline-arena-cache",
    apply: "build",
    generateBundle(_, bundle) {
      const assets = [
        "./",
        "./index.html",
        "./icon.svg",
        "./manifest.webmanifest",
        ...Object.keys(bundle)
          .filter((name) => !name.endsWith(".map"))
          .map((name) => "./" + name),
      ];
      const version = createHash("sha256")
        .update(assets.join(","))
        .digest("hex")
        .slice(0, 12);
      this.emitFile({
        type: "asset",
        fileName: "sw.js",
        source: `const CACHE='offline-arena-${version}';
const ASSETS=${JSON.stringify(assets)};
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('offline-arena-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{if(e.request.method!=='GET'||new URL(e.request.url).origin!==self.location.origin)return;
if(e.request.mode==='navigate'){e.respondWith(fetch(e.request).catch(()=>caches.match('./index.html')));return;}
e.respondWith(caches.match(e.request,{ignoreVary:true}).then(cached=>cached||fetch(e.request)));});`,
      });
    },
  };
}
export default defineConfig({
  plugins: [react(), offlineCache()],
  server: { host: "0.0.0.0", allowedHosts: [".e2b.app"] },
  preview: { host: "0.0.0.0", allowedHosts: [".e2b.app"] },
  build: {
    rollupOptions: { output: { manualChunks: { three: ["three"] } } },
    chunkSizeWarningLimit: 600,
  },
});
