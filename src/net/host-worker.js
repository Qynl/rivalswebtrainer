import { LobbyService } from "../../server/lobbies.js";

// Authority is isolated from WebGL, shader compilation, UI work and pointer input.
// Only validated protocol messages cross the worker boundary.
let service, timer;
const clients = new Map();
self.onmessage = ({ data }) => {
  if (data.type === "init") {
    service = new LobbyService({
      maxClients: 6,
      maxRooms: 1,
      roomCode: () => data.code,
    });
    let previous = performance.now(),
      accumulator = 0,
      sweep = 0;
    timer = setInterval(() => {
      const now = performance.now();
      const elapsed = Math.min(0.1, Math.max(0, (now - previous) / 1000));
      previous = now;
      accumulator += elapsed;
      sweep += elapsed;
      while (accumulator >= 1 / 120) {
        service.step(1 / 120);
        accumulator -= 1 / 120;
      }
      if (sweep > 5) {
        service.sweep();
        sweep = 0;
      }
    }, 1000 / 120);
    self.postMessage({ type: "ready" });
  } else if (data.type === "connect") {
    const id = service.connect(
      (packet) =>
        self.postMessage({ type: "packet", token: data.token, packet }),
      "peer",
      () => {
        clients.delete(data.token);
        self.postMessage({ type: "closed", token: data.token });
      },
    );
    if (id) clients.set(data.token, id);
    else self.postMessage({ type: "closed", token: data.token });
  } else if (data.type === "receive") {
    const id = clients.get(data.token);
    if (id) service.receive(id, data.packet);
  } else if (data.type === "disconnect") {
    const id = clients.get(data.token);
    clients.delete(data.token);
    if (id) service.disconnect(id);
  } else if (data.type === "dispose") {
    clearInterval(timer);
    service?.dispose();
    clients.clear();
    self.close();
  }
};
