import metadata from "./assets/studio-environment.json";
// A losslessly encoded copy of our own procedural RoomEnvironment PMREM.
// This removes the startup cube capture/convolution, not its lighting quality.
export async function loadEnvironment() {
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
