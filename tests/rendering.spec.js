import { test, expect } from "@playwright/test";

test("depth-aware world pass really shades contact surfaces, resizes, and bypasses in performance mode", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto("/");
  await page.waitForFunction(() => window.__arena?.state === "lobby");
  const result = await page.evaluate(async () => {
    const THREE = await import("/node_modules/three/build/three.module.js"),
      g = window.__arena;
    g.frame = () => {};
    g.renderer.setPixelRatio(0.5);
    g.resize();
    g.renderer.autoClear = true;
    const scene = new THREE.Scene(),
      camera = new THREE.PerspectiveCamera(
        55,
        innerWidth / innerHeight,
        0.1,
        20,
      );
    scene.background = new THREE.Color(0x101820);
    camera.position.set(2, 2.1, 3);
    camera.lookAt(0, 0.3, 0);
    const material = new THREE.MeshStandardMaterial({
      color: 0x999999,
      roughness: 1,
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), material);
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);
    const cube = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
    cube.position.y = 0.5;
    scene.add(cube);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x777777, 2));
    const gl = g.renderer.getContext(),
      size = g.renderer.getDrawingBufferSize(new THREE.Vector2());
    const read = () => {
      gl.finish();
      const pixels = new Uint8Array(size.x * size.y * 4);
      gl.readPixels(0, 0, size.x, size.y, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return pixels;
    };
    const strength = g.presentation.material.uniforms.aoStrength;
    const original = strength.value;
    strength.value = 0;
    g.presentation.render(scene, camera);
    const base = read();
    strength.value = original;
    g.presentation.render(scene, camera);
    const shaded = read();
    let darkened = 0;
    for (let i = 0; i < base.length; i += 4)
      if (base[i] - shaded[i] > 2) darkened++;
    const target = g.presentation.target,
      dimensions = target.width === size.x && target.height === size.y;
    g.setSettings({ ...g.settings, performance: true });
    const render = g.presentation.render;
    let called = false;
    g.presentation.render = () => {
      called = true;
    };
    g.renderWorld();
    g.presentation.render = render;
    g.setSettings({ ...g.settings, performance: false });
    const resized =
      g.presentation.target.width === gl.drawingBufferWidth &&
      g.presentation.target.height === gl.drawingBufferHeight;
    cube.geometry.dispose();
    floor.geometry.dispose();
    material.dispose();
    return {
      darkened,
      dimensions,
      resized,
      bypassed: !called,
      glError: gl.getError(),
    };
  });
  expect(result.darkened).toBeGreaterThan(100);
  expect(result).toMatchObject({
    dimensions: true,
    resized: true,
    bypassed: true,
    glError: 0,
  });
  expect(errors).toEqual([]);
});
