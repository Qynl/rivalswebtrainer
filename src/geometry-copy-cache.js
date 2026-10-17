import * as THREE from "three";
// Bounded CPU-only templates, never attached/uploaded to a renderer. Every
// consumer receives independent GPU buffers and retains ordinary disposal.
export class GeometryCopyCache {
  #entries = new Map();
  constructor(limit = 96) {
    if (!Number.isInteger(limit) || limit < 1)
      throw new RangeError("Positive geometry template limit required");
    this.limit = limit;
  }
  get size() {
    return this.#entries.size;
  }
  copy(key, create) {
    let template = this.#entries.get(key);
    if (template) {
      this.#entries.delete(key);
      this.#entries.set(key, template);
    } else {
      template = create();
      if (!template?.isBufferGeometry || template.isInstancedBufferGeometry)
        throw new TypeError("Ordinary buffer geometry required");
      this.#entries.set(key, template);
      if (this.#entries.size > this.limit) {
        const first = this.#entries.keys().next().value;
        this.#entries.get(first).dispose();
        this.#entries.delete(first);
      }
    }
    return new THREE.BufferGeometry().copy(template);
  }
  clear() {
    for (const template of this.#entries.values()) template.dispose();
    this.#entries.clear();
  }
}
