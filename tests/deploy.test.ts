/**
 * Static-build contract.
 *
 * The deploy target is GitHub Pages: a plain file host under a project path,
 * with no Node and no rewrite rules. Two things can silently break there and
 * neither shows up in the other tests:
 *
 *  1. absolute asset URLs (`/assets/…`) 404 under `/repo/`,
 *  2. a `node:` import leaking into the client bundle crashes the page on load.
 *
 * So this builds the real bundle the deploy workflow ships and inspects it.
 */
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { build } from 'vite';

const OUT = 'dist-check';

describe('static build', () => {
  afterAll(() => {
    rmSync(OUT, { recursive: true, force: true });
  });

  it('emits relative asset URLs and no Node imports', async () => {
    await build({ logLevel: 'silent', build: { outDir: OUT, emptyOutDir: true } });

    const html = readFileSync(join(OUT, 'index.html'), 'utf8');
    // Relative, so the same artifact works at /, /repo/ and file://.
    expect(html).toMatch(/<script[^>]+src="\.\/assets\//);
    expect(html).toMatch(/<link[^>]+href="\.\/assets\//);
    expect(html).not.toMatch(/src="\/src\//);
    expect(html).not.toMatch(/href="\/assets\//);
    // Jekyll must not touch the artifact (GitHub Pages serves raw files).
    expect(existsSync(join(OUT, '.nojekyll'))).toBe(true);

    const assets = readdirSync(join(OUT, 'assets'));
    const js = assets.filter((f) => f.endsWith('.js'));
    expect(js.length).toBeGreaterThan(0);
    for (const file of js) {
      const code = readFileSync(join(OUT, 'assets', file), 'utf8');
      expect(code).not.toMatch(/from\s*["']node:/);
      expect(code).not.toMatch(/require\(\s*["']node:/);
      // The offline authority has to be in the bundle, not behind a socket.
      expect(code).toMatch(/SPECTER/);
    }
    const css = assets.filter((f) => f.endsWith('.css'));
    expect(css.length).toBe(1);
  }, 120000);
});
