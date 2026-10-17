import metadata from "./assets/studio-environment.json" with { type: "json" };
// A losslessly encoded copy of our own procedural RoomEnvironment PMREM.
// This removes the startup cube capture/convolution, not its lighting quality.
let environmentPromise;
// Two WebGL contexts need separate GPU textures, not separate CPU decodes of
// identical immutable pixels. Failed loads remain retryable on the next call.
export function loadEnvironment() {
  return (environmentPromise ||= decodeEnvironment().then((data) => {
    if (!data) environmentPromise = null;
    return data;
  }));
}
async function decodeEnvironment() {
  if (!("DecompressionStream" in globalThis)) return null;
  try {
    const response = await fetch(
      new URL("./assets/studio-environment.bin", import.meta.url),
    );
    if (!response.ok) throw Error("Environment asset " + response.status);
    const data = new Uint8Array(
      await new Response(
        response.body.pipeThrough(new DecompressionStream("gzip")),
      ).arrayBuffer(),
    );
    const count = metadata.width * metadata.height * 4;
    if (data.length !== count * 2)
      throw Error("Invalid environment data length");
    const values = new Uint16Array(count);
    for (let i = 0; i < count; i++)
      values[i] =
        ((i < 4 ? 0 : values[i - 4]) + data[i] + (data[count + i] << 8)) &
        65535;
    return { ...metadata, values };
  } catch (error) {
    console.warn("Using procedural lighting fallback:", error);
    return null;
  }
}
