// Static-site SPA fallbacks often return index.html with HTTP 200 for /api/*.
// Never expose a raw JSON.parse exception (or reflect a gateway's HTML) to UI.
export async function readMultiplayerHealth(response) {
  const text = await response.text();
  if (
    text.trimStart().startsWith("<") ||
    response.headers.get("content-type")?.includes("text/html")
  )
    throw new Error(
      "This address returned a web page instead of the multiplayer API. Open the full-stack game server or configure /api and WebSocket forwarding; a static-only host cannot run multiplayer.",
    );
  if (!response.ok)
    throw new Error(
      `The multiplayer server returned HTTP ${response.status}. Check that the match server is running and /api is forwarded to it`,
    );
  let health;
  try {
    health = JSON.parse(text);
  } catch {
    throw new Error(
      "The multiplayer API returned invalid JSON. Check the match server and /api proxy configuration",
    );
  }
  if (!health || typeof health !== "object" || Array.isArray(health))
    throw new Error("The multiplayer API returned an invalid health response");
  return health;
}
