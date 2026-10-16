export async function measureWeaponPresence() {
  const g = window.__arena;
  const { WEAPONS } = await import("/src/data.js");
  const THREE = await import("/node_modules/.vite/deps/three.js");
  g.settings.shake = false;
  g.audio.volume = 0;
  g.renderer.setPixelRatio(1);
  g.renderer.setSize(960, 720, false);
  g.yaw = 0;
  g.pitch = 0;
  g.renderPrevious = null;
  Object.assign(g.player, { vx: 0, vy: 0, vz: 0 });
  const target = new THREE.WebGLRenderTarget(384, 288);
  const pixels = new Uint8Array(384 * 288 * 4),
    result = {};
  for (const [id, w] of Object.entries(WEAPONS).filter(([, w]) => w.slot < 2)) {
    g.loadout[w.slot] = id;
    g.slot = -1;
    g.equip(w.slot);
    g.switchTime =
      g.reloadTime =
      g.quickMeleeTime =
      g.quickUtilityTime =
      g.kick =
      g.flash =
        0;
    g.aiming = false;
    g.lastShotAt = -100;
    for (let i = 0; i < 160; i++) g.updateCamera(1 / 120);
    for (const hand of g.viewModel.userData.hands || []) hand.visible = false;
    g.renderer.setRenderTarget(target);
    g.renderer.setClearColor(0, 0);
    g.renderer.autoClear = true;
    g.renderer.render(g.weaponScene, g.weaponCamera);
    g.renderer.readRenderTargetPixels(target, 0, 0, 384, 288, pixels);
    let count = 0,
      minX = 384,
      maxX = 0,
      minY = 288,
      maxY = 0;
    for (let y = 0; y < 288; y++)
      for (let x = 0; x < 384; x++)
        if (pixels[(y * 384 + x) * 4 + 3] > 32) {
          count++;
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
    result[id] = {
      pixels: count,
      fraction: count / (384 * 288),
      width: maxX - minX + 1,
      height: maxY - minY + 1,
      scale: g.viewModel.scale.x,
    };
    for (const hand of g.viewModel.userData.hands || []) hand.visible = true;
    g.aiming = true;
    for (let i = 0; i < 180; i++) g.updateCamera(1 / 120);
    g.viewModel.updateMatrixWorld(true);
    const sight = g.viewModel.userData.adsPoint;
    const point = sight
      ? g.viewModel.localToWorld(sight.clone()).project(g.weaponCamera)
      : null;
    const ray = new THREE.Raycaster(
      new THREE.Vector3(),
      new THREE.Vector3(0, 0, -1),
    );
    result[id].adsError = point ? Math.hypot(point.x, point.y) : 0;
    result[id].handHits = (g.viewModel.userData.hands || []).reduce(
      (n, hand) => n + ray.intersectObject(hand, true).length,
      0,
    );
    result[id].scopeHidden = id === "sniper" ? !g.viewModel.visible : null;
    g.renderer.render(g.weaponScene, g.weaponCamera);
  }
  target.dispose();
  g.renderer.setRenderTarget(null);
  g.renderer.setClearColor(0x0b121a, 1);
  g.loadout[0] = "sniper";
  g.slot = -1;
  g.equip(0);
  g.switchTime = 0;
  g.settings.shake = true;
  g.aiming = false;
  for (let i = 0; i < 160; i++) g.updateCamera(1 / 120);
  g.renderer.autoClear = true;
  g.renderWorld();
  g.renderer.autoClear = false;
  g.renderer.clearDepth();
  g.renderer.render(g.weaponScene, g.weaponCamera);
  g.renderer.autoClear = true;
  return { guns: result, glError: g.renderer.getContext().getError() };
}
