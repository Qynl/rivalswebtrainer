// A small transport facade keeps the same authority API as LobbyService.
// Actual player IDs belong to the worker; tokens only address local callbacks.
export class WorkerLobby {
  constructor(code, onError) {
    this.isWorker = true;
    this.rooms = new Map();
    this.clients = new Map();
    this.worker = new Worker(new URL("./host-worker.js", import.meta.url), {
      type: "module",
    });
    this.ready = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    // Recovery lobbies can be created without awaiting startup.
    this.ready.catch(() => {});
    this.timeout = setTimeout(
      () =>
        this.fail(
          new Error("Host simulation did not load. Reload the game and retry."),
        ),
      12000,
    );
    this.onError = onError;
    this.worker.onerror = (event) => {
      event.preventDefault();
      this.fail(
        new Error(
          "Could not start browser match simulation. " +
            (event.message || "Reload and retry."),
        ),
      );
    };
    this.worker.onmessage = ({ data }) => {
      if (this.disposed) return;
      if (data.type === "ready") {
        clearTimeout(this.timeout);
        this.resolveReady();
        return;
      }
      const client = this.clients.get(data.token);
      if (!client) return;
      if (data.type === "closed") {
        this.clients.delete(data.token);
        client.close?.();
        return;
      }
      if (data.type === "packet") {
        if (data.token === this.hostToken) {
          if (data.packet.type === "room") {
            const room = data.packet.room;
            this.rooms.set(room.code, {
              ...room,
              match: room.phase === "lobby" ? null : true,
            });
          } else if (data.packet.type === "left") this.rooms.clear();
        }
        client.send(data.packet);
      }
    };
    this.worker.postMessage({ type: "init", code });
  }
  fail(error) {
    if (this.disposed) return;
    clearTimeout(this.timeout);
    this.rejectReady(error);
    this.onError?.(error);
  }
  connect(send, transport, close) {
    if (this.disposed || this.clients.size >= 6) return null;
    const token = crypto.randomUUID();
    this.hostToken ||= token;
    this.clients.set(token, { send, close });
    this.worker.postMessage({ type: "connect", token });
    return token;
  }
  receive(token, packet) {
    if (!this.disposed)
      this.worker.postMessage({ type: "receive", token, packet });
  }
  disconnect(token) {
    const client = this.clients.get(token);
    this.clients.delete(token);
    if (!this.disposed) this.worker.postMessage({ type: "disconnect", token });
    client?.close?.();
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.rejectReady(new Error("Host simulation cancelled"));
    clearTimeout(this.timeout);
    for (const client of this.clients.values()) client.close?.();
    this.clients.clear();
    this.rooms.clear();
    this.worker.terminate();
  }
}
