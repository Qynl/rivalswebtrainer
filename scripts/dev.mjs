import { PROTOCOL } from "../src/net/protocol.js";
import { createServer, preview } from "vite";
import { createMultiplayerServer } from "../server/index.js";
const args = process.argv.slice(2),
  at = args.indexOf("--port"),
  productionPreview = args.includes("--preview"),
  port = at >= 0 ? Number(args[at + 1]) : productionPreview ? 4173 : 5173;
const multiplayer = await createMultiplayerServer();
await new Promise((resolve, reject) => {
  multiplayer.server.once("error", async (error) => {
    if (error.code === "EADDRINUSE") {
      try {
        const health = await fetch("http://127.0.0.1:3001/api/health").then(
          (r) => r.json(),
        );
        if (health.protocol !== PROTOCOL)
          throw Error("Port 3001 belongs to another application");
        console.log("Using existing multiplayer server on port 3001");
        resolve();
      } catch (error) {
        reject(error);
      }
    } else reject(error);
  });
  multiplayer.server.listen(3001, "0.0.0.0", resolve);
});
const frontendOptions = {
  port,
  host: "0.0.0.0",
  strictPort: args.includes("--strictPort"),
};
const vite = productionPreview
  ? await preview({ preview: frontendOptions })
  : await createServer({ server: frontendOptions });
if (!productionPreview) await vite.listen();
vite.printUrls();
console.log(
  `Multiplayer: ${multiplayer.geckos() ? "geckos.io + WebSocket" : "WebSocket fallback"} (same-origin /api)`,
);
async function close() {
  if (productionPreview)
    await new Promise((resolve) => vite.httpServer.close(resolve));
  else await vite.close();
  await multiplayer.close();
  process.exit(0);
}
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, close);
