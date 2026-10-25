import { describe, expect, it } from 'vitest';
import { parseFrames, scrubText } from '../../src/app/crash-record.ts';

// 19 section 6 and acceptance T-19-6: hostile strings must not leave a trace in a crash record.

const MSG_MAX = 300;
const ORIGIN = 'https://game.example';

describe('crash record scrubbing (19 section 6)', () => {
  it('removes e-mail addresses', () => {
    const out = scrubText('login failed for jane.doe+test@example.co.uk today');
    expect(out).not.toContain('@');
    expect(out).not.toContain('example');
  });

  it('removes URLs with query strings and hashes', () => {
    const out = scrubText('fetch https://sandbox.example.org/api/save?token=abc123&user=7#frag failed');
    expect(out).toBe('fetch <url> failed');
  });

  it('removes Windows paths, including folder names with spaces', () => {
    const out = scrubText('missing C:\\Users\\1rn19\\OneDrive\\Desktop\\Test Dev\\SandboxRealms\\chunk.js');
    expect(out).toBe('missing <path>');
    expect(out).not.toContain('Users');
    expect(out).not.toContain('Dev');
  });

  it('removes POSIX home paths', () => {
    const out = scrubText('open /home/alex/saves/realm.bin now');
    expect(out).toBe('open <path> now');
    expect(out).not.toContain('alex');
  });

  it('removes localhost and IP host names with ports', () => {
    const out = scrubText('connect localhost:5173 and 192.168.1.20:8080 failed');
    expect(out).toBe('connect <host> and <host> failed');
  });

  it('drops text the player typed inside quotes', () => {
    const out = scrubText('name "Brightmoor Hamlet" is invalid');
    expect(out).toBe('name "" is invalid');
    expect(out).not.toContain('Brightmoor');
  });

  it('removes long tokens', () => {
    const token = `sk_${'Ab3'.repeat(14)}`;
    const out = scrubText(`key ${token} rejected`);
    expect(out).toBe('key <token> rejected');
  });

  it('replaces digit runs longer than four with N', () => {
    expect(scrubText('at tick 1234567 of 42')).toBe('at tick N of 42');
  });

  it('truncates to the cap', () => {
    expect(scrubText('a b '.repeat(500)).length).toBeLessThanOrEqual(MSG_MAX);
    expect(scrubText('a b '.repeat(500), 40).length).toBeLessThanOrEqual(40);
  });

  it('turns a 10 KB single word into a token, not 10 KB of text', () => {
    const out = scrubText('x'.repeat(10_000));
    expect(out).toBe('<token>');
  });

  it('keeps no secret from a deterministic fuzz of 5,000 hostile strings', () => {
    const secrets = ['jane@example.com', 'https://x.test/?k=1', 'C:\\Users\\x\\y'];
    const pieces = ['a', 'Z', '9', ' ', '"', "'", '\\', '/', ':', '.', '@', '\n', '\u4e00', '\u{1F600}', 'http', '://', 'localhost', '10.0.0.1', ...secrets];
    let seed = 2026;
    const rnd = (): number => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return seed / 2 ** 32;
    };
    for (let n = 0; n < 5_000; n++) {
      let input = '';
      const len = 1 + Math.floor(rnd() * 40);
      for (let i = 0; i < len; i++) input += pieces[Math.floor(rnd() * pieces.length)] ?? '';
      const out = scrubText(input);
      expect(out.length).toBeLessThanOrEqual(MSG_MAX);
      for (const secret of secrets) expect(out).not.toContain(secret);
      expect(out).not.toContain('example.com');
      expect(out).not.toContain('x.test');
      expect(out).not.toContain('Users');
    }
  });
});

describe('crash record stack frames (19 section 5 and 6)', () => {
  it('keeps only the chunk name, with no query string', () => {
    const stack = '    at render (https://game.example/assets/chunk-AbC123.js?v=9:10:20)';
    const frames = parseFrames(stack, ORIGIN);
    expect(frames).toEqual([{ fn: 'render', file: 'chunk-AbC123.js', line: 10, col: 20 }]);
  });

  it('collapses frames from another origin to <ext>', () => {
    const stack = '    at track (https://cdn.other.test/lib.js:1:2)';
    const frames = parseFrames(stack, ORIGIN);
    expect(frames).toHaveLength(1);
    expect(frames[0]?.file).toBe('<ext>');
    expect(JSON.stringify(frames)).not.toContain('other.test');
  });

  it('keeps no path from Firefox-style frames either', () => {
    const stack = 'step@https://game.example/assets/sim.js?x=1:3:4';
    const frames = parseFrames(stack, ORIGIN);
    expect(frames[0]?.file).toBe('sim.js');
    expect(JSON.stringify(frames)).not.toContain('?x=');
  });
});
