/**
 * Minimal WebGL2 + Canvas2D stubs.
 *
 * There is no GPU in CI and no headless Chromium in this sandbox, so the tests
 * feed three.js a fake context: every GL enum becomes a stable fake id, every
 * call is a no-op, and draw calls are counted. A real page still needs a real
 * driver, but scene construction and the per-frame update path run for real.
 */

export const glStats = { draws: 0, canvases: 0 };

const noop = (): void => undefined;

function stubGL(canvas: HTMLCanvasElement): WebGL2RenderingContext {
  const base: Record<string, unknown> = { canvas, drawingBufferWidth: 1280, drawingBufferHeight: 720 };
  const enumNames = new Map<number, string>();
  const enumIds = new Map<string, number>();
  const enumId = (name: string): number => {
    const known = enumIds.get(name);
    if (known !== undefined) return known;
    const id = 0x8000 + enumIds.size;
    enumIds.set(name, id);
    enumNames.set(id, name);
    return id;
  };
  const STRINGS: Record<string, string> = {
    VERSION: 'WebGL 2.0 (stub)',
    SHADING_LANGUAGE_VERSION: 'WebGL GLSL ES 3.00 (stub)',
    VENDOR: 'stub',
    RENDERER: 'stub',
  };
  const param = (id: number): unknown => {
    const name = enumNames.get(id) ?? '';
    if (STRINGS[name]) return STRINGS[name];
    if (name.includes('VIEWPORT') || name.includes('SCISSOR')) return new Int32Array([0, 0, 1280, 720]);
    if (name === 'MAX_TEXTURE_SIZE' || name === 'MAX_CUBE_MAP_TEXTURE_SIZE' || name === 'MAX_RENDERBUFFER_SIZE') return 16384;
    if (name.includes('MAX_')) return 32;
    return 8192;
  };
  return new Proxy(base, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      if (/^[A-Z][A-Z0-9_]*$/.test(prop)) return enumId(prop);
      return (...args: unknown[]) => {
        switch (prop) {
          case 'getParameter':
            return param(args[0] as number);
          case 'getExtension': {
            // Pretend every extension exists but is inert: three only calls
            // optional entry points behind a null check.
            const ext = new Proxy({}, {
              get(target, key: string) {
                if (key in target) return target[key as keyof typeof target];
                return () => null;
              },
            });
            return ext;
          }
          case 'getShaderPrecisionFormat':
            return { precision: 23, rangeMin: 127, rangeMax: 127 };
          case 'getContextAttributes':
            return {
              alpha: true,
              antialias: true,
              depth: true,
              stencil: false,
              premultipliedAlpha: true,
              preserveDrawingBuffer: false,
              powerPreference: 'default',
              failIfMajorPerformanceCaveat: false,
              desynchronized: false,
            };
          case 'createBuffer':
          case 'createTexture':
          case 'createFramebuffer':
          case 'createRenderbuffer':
          case 'createProgram':
          case 'createShader':
          case 'createVertexArray':
            return {};
          case 'getProgramParameter':
          case 'getShaderParameter':
            return true;
          case 'getProgramInfoLog':
          case 'getShaderInfoLog':
            return '';
          case 'getUniformLocation':
            return {};
          case 'getAttribLocation':
            return 0;
          case 'getActiveUniform':
          case 'getActiveAttrib':
            return { name: 'x', size: 1, type: 0 };
          case 'checkFramebufferStatus':
            return 36053;
          case 'isContextLost':
            return false;
          case 'getError':
            return 0;
          case 'drawElements':
          case 'drawArrays':
          case 'drawElementsInstanced':
          case 'drawArraysInstanced':
            glStats.draws++;
            return undefined;
          default:
            return noop();
        }
      };
    },
  }) as unknown as WebGL2RenderingContext;
}

/** Canvas2D is only used for the glow sprite; a no-op gradient is enough. */
function stub2d(): CanvasRenderingContext2D {
  const gradient = { addColorStop: (): void => undefined };
  return new Proxy({} as CanvasRenderingContext2D, {
    get(_t, prop: string) {
      if (prop === 'createRadialGradient' || prop === 'createLinearGradient') return () => gradient;
      if (prop === 'getImageData') {
        return (_x: number, _y: number, w = 1, h = 1) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
      }
      if (prop === 'createImageData') {
        return (w = 1, h = 1) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
      }
      return () => undefined;
    },
    set() {
      return true;
    },
  });
}

/** Patch everything the client touches that jsdom does not implement. */
export function installDomStubs(): void {
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string): unknown {
    if (type === '2d') return stub2d();
    if (type === 'webgl2' || type === 'webgl') {
      glStats.canvases++;
      return stubGL(this);
    }
    return null;
  } as never;
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  proto.requestPointerLock = function (this: HTMLElement): void {
    Object.defineProperty(document, 'pointerLockElement', { value: this, configurable: true });
    document.dispatchEvent(new Event('pointerlockchange'));
  };
  (document as unknown as Record<string, unknown>).exitPointerLock = function (): void {
    Object.defineProperty(document, 'pointerLockElement', { value: null, configurable: true });
    document.dispatchEvent(new Event('pointerlockchange'));
  };
}

/**
 * jsdom ships no WebSocket, and Node's built-in one rejects jsdom's Event
 * instances, so tests use a thin `ws`-backed shim with the browser surface the
 * client actually touches (onopen/onmessage/onclose/send/close/readyState).
 */
export async function installWebSocketShim(): Promise<void> {
  const { WebSocket: NodeWS } = await import('ws');
  class Shim {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    readyState = 0;
    onopen: ((ev: unknown) => void) | null = null;
    onmessage: ((ev: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: ((ev: unknown) => void) | null = null;
    private inner: InstanceType<typeof NodeWS>;
    constructor(url: string) {
      this.inner = new NodeWS(url);
      this.inner.on('open', () => {
        this.readyState = 1;
        this.onopen?.({});
      });
      this.inner.on('message', (data: { toString(): string }) => {
        this.onmessage?.({ data: data.toString() });
      });
      this.inner.on('close', () => {
        this.readyState = 3;
        this.onclose?.();
      });
      this.inner.on('error', (err: Error) => {
        this.onerror?.(err);
      });
    }
    send(data: string): void {
      if (this.readyState === 1) this.inner.send(data);
    }
    close(): void {
      this.readyState = 3;
      this.inner.close();
    }
  }
  Object.defineProperty(globalThis, 'WebSocket', { value: Shim, configurable: true, writable: true });
}
