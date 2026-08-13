import { describe, expect, it, vi } from 'vitest';
import {
  htmlToPlainText,
  plainTextToSafeHtml,
  sanitizeHtml,
  SANITIZER_ALLOWLIST,
} from '../../src/renderer/src/lib/sanitizer';

describe('sanitizer - DOMPurify allowlist helper', () => {
  it('allows semantic text, lists, quotes, tables, pre, code, and links', () => {
    const raw = `
      <h1>Heading</h1>
      <p>Paragraph with <strong>strong</strong> and <em>emphasis</em>.</p>
      <ul><li>Item 1</li><li>Item 2</li></ul>
      <blockquote>Quoted text</blockquote>
      <table>
        <thead><tr><th>Col 1</th></tr></thead>
        <tbody><tr><td>Cell 1</td></tr></tbody>
      </table>
      <pre><code>const x = 42;</code></pre>
      <a href="https://example.com">Safe link</a>
    `;

    const clean = sanitizeHtml(raw);

    expect(clean).toContain('<h1>Heading</h1>');
    expect(clean).toContain('<strong>strong</strong>');
    expect(clean).toContain('<em>emphasis</em>');
    expect(clean).toContain('<ul><li>Item 1</li><li>Item 2</li></ul>');
    expect(clean).toContain('<table>');
    expect(clean).toContain('<pre><code>const x = 42;</code></pre>');
    expect(clean).toContain('href="https://example.com"');
    expect(clean).toContain('target="_blank"');
    expect(clean).toContain('rel="noopener noreferrer"');
  });

  it('strips active content and replaces remote images with a readable omission', () => {
    const raw = `
      <p>Normal text</p>
      <script>alert("xss")</script>
      <style>body { display: none; }</style>
      <form action="/submit"><input type="text" /><button type="submit">Send</button></form>
      <iframe src="https://malicious.com"></iframe>
      <img src="https://tracking.example.com/pixel.png" alt="Company logo" />
      <picture><source srcset="https://tracking.example.com/hero.webp" /><img src="https://tracking.example.com/hero.png" /></picture>
      <svg><circle cx="50" cy="50" r="40" /></svg>
      <video src="video.mp4"></video>
      <audio src="audio.mp3"></audio>
    `;

    const clean = sanitizeHtml(raw);

    expect(clean).toContain('<p>Normal text</p>');
    expect(clean).toContain('Remote image omitted: Company logo');
    expect(clean).toContain('Remote image omitted');
    expect(clean).not.toContain('tracking.example.com');
    expect(clean).not.toContain('<script');
    expect(clean).not.toContain('alert');
    expect(clean).not.toContain('<style');
    expect(clean).not.toContain('<form');
    expect(clean).not.toContain('<input');
    expect(clean).not.toContain('<button');
    expect(clean).not.toContain('<iframe');
    expect(clean).not.toContain('<img');
    expect(clean).not.toContain('<picture');
    expect(clean).not.toContain('<source');
    expect(clean).not.toContain('src=');
    expect(clean).not.toContain('srcset=');
    expect(clean).not.toContain('<svg');
    expect(clean).not.toContain('<video');
    expect(clean).not.toContain('<audio');
  });

  it('strips all event attributes and inline style attributes', () => {
    const raw = `
      <p style="color: red; position: absolute;" onclick="alert('click')" onload="alert('load')" onerror="alert('error')">
        Styled & active paragraph
      </p>
    `;

    const clean = sanitizeHtml(raw);

    expect(clean).not.toContain('style=');
    expect(clean).not.toContain('onclick');
    expect(clean).not.toContain('onload');
    expect(clean).not.toContain('onerror');
    expect(clean).toContain('<p>');
  });

  it('retains ONLY https:// href links and strips http, javascript, data URLs', () => {
    const raw = `
      <a href="https://secure.example.com">HTTPS Link</a>
      <a href="http://insecure.example.com">HTTP Link</a>
      <a href="javascript:alert(1)">JS Link</a>
      <a href="data:text/html,hack">Data Link</a>
    `;

    const clean = sanitizeHtml(raw);

    expect(clean).toContain('href="https://secure.example.com"');
    expect(clean).toContain('target="_blank"');
    expect(clean).toContain('rel="noopener noreferrer"');

    expect(clean).not.toContain('href="http://');
    expect(clean).not.toContain('href="javascript:');
    expect(clean).not.toContain('href="data:');
  });

  it('converts semantic HTML to readable block-aware plain text', () => {
    const html = `
      <h1>Application update</h1>
      <p>Hello <strong>World</strong>!</p>
      <ul><li>First item</li><li>Second item</li></ul>
      <blockquote><p>Quoted line</p></blockquote>
      <pre><code>const answer = 42;</code></pre>
      <table><tr><th>Role</th><th>Status</th></tr><tr><td>Engineer</td><td>Interview</td></tr></table>
      <script>alert(1)</script>
    `;

    expect(htmlToPlainText(html)).toBe(
      [
        'Application update',
        '',
        'Hello World!',
        '',
        '• First item',
        '• Second item',
        '',
        '> Quoted line',
        '',
        'const answer = 42;',
        '',
        'Role | Status',
        'Engineer | Interview',
      ].join('\n'),
    );
  });

  it('renders Markdown-like plain text semantically without interpreting embedded raw HTML', () => {
    const plainText = [
      '# Interview steps',
      '',
      '1. Review the **role brief**',
      '2. Visit [the secure portal](https://jobs.example.com/interview)',
      '',
      '> Bring questions',
      '',
      '```ts',
      'const confirmed = true;',
      '```',
      '',
      '<img src="https://tracking.example.com/pixel" onerror="alert(1)">',
      '<script>alert("markdown-xss")</script>',
    ].join('\n');

    const clean = plainTextToSafeHtml(plainText);

    expect(clean).toContain('<h1>Interview steps</h1>');
    expect(clean).toContain('<ol>');
    expect(clean).toContain('<strong>role brief</strong>');
    expect(clean).toContain('<blockquote>');
    expect(clean).toContain('<pre><code');
    expect(clean).toContain('href="https://jobs.example.com/interview"');
    expect(clean).toContain('&lt;img src="https://tracking.example.com/pixel"');
    expect(clean).toContain('&lt;script&gt;alert("markdown-xss")&lt;/script&gt;');
    expect(clean).not.toContain('<img');
    expect(clean).not.toContain('<script');
  });

  it('never browser-parses raw provider HTML: only neutralized markup reaches DOMParser, zero network', () => {
    const parseSpy = vi.spyOn(DOMParser.prototype, 'parseFromString');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const xhrOpenSpy = vi.spyOn(XMLHttpRequest.prototype, 'open');

    const raw = `
      <img src="https://tracker.example/pixel.png" srcset="https://tracker.example/a.png 1x, https://tracker.example/b.png 2x" alt="pixel">
      <p>Safe body text</p>
    `;

    const clean = sanitizeHtml(raw);
    // Defense in depth: DOMPurify may parse, but only ever the neutralized
    // intermediate. Raw resource-bearing provider HTML must never reach a
    // browser DOM parser, and no request can fire at any point.
    for (const [input] of parseSpy.mock.calls) {
      expect(String(input)).not.toContain('tracker.example');
      expect(String(input)).not.toContain('<img');
      expect(String(input)).not.toContain('srcset');
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhrOpenSpy).not.toHaveBeenCalled();
    expect(clean).not.toContain('tracker.example');
    expect(clean).not.toContain('srcset');
    expect(clean).toContain('Safe body text');

    const plain = htmlToPlainText(raw);
    for (const [input] of parseSpy.mock.calls) {
      expect(String(input)).not.toContain('tracker.example');
      expect(String(input)).not.toContain('<img');
      expect(String(input)).not.toContain('srcset');
    }
    expect(plain).not.toContain('tracker.example');
    expect(plain).toContain('Safe body text');
  });

  it('removes every auto-fetch resource and unsafe URL attribute before DOMPurify', () => {
    const raw = `
      <img src="https://t.example/pixel.png" srcset="https://t.example/a.webp 1x, https://t.example/b.webp 2x" alt="Ad">
      <picture><source srcset="https://t.example/hero.webp"><img src="https://t.example/hero.png" alt="Hero"></picture>
      <svg><image href="https://t.example/vector.png"/></svg>
      <video src="https://t.example/movie.mp4" poster="https://t.example/poster.jpg"><source src="https://t.example/movie.webm"></video>
      <audio src="https://t.example/sound.mp3"><source src="https://t.example/sound.ogg"></audio>
      <iframe src="https://t.example/frame.html"></iframe>
      <object data="https://t.example/flash.swf"></object>
      <embed src="https://t.example/plugin.swf">
      <link rel="stylesheet" href="https://t.example/theme.css">
      <meta http-equiv="refresh" content="0;url=https://t.example/go">
      <style>@import url("https://t.example/import.css"); body { background: url(https://t.example/bg.png); }</style>
      <img src=unquoted.png>
      <IMG SRC="https://t.example/UPPER.PNG">
      <a href="https://example.com/link" style="background: url(https://t.example/inline.png)" onmouseover="alert(1)">safe link</a>
    `;

    const clean = sanitizeHtml(raw);

    expect(clean).not.toContain('t.example');
    expect(clean).not.toContain('src=');
    expect(clean).not.toContain('srcset');
    expect(clean).not.toContain('poster');
    expect(clean).not.toContain('xlink');
    expect(clean).not.toContain('@import');
    expect(clean).not.toContain('url(');
    expect(clean).not.toContain('<img');
    expect(clean).not.toContain('<iframe');
    expect(clean).not.toContain('<object');
    expect(clean).not.toContain('<embed');
    expect(clean).not.toContain('<link');
    expect(clean).not.toContain('<meta');
    expect(clean).not.toContain('<style');
    expect(clean).not.toContain('<video');
    expect(clean).not.toContain('<audio');
    expect(clean).not.toContain('<svg');
    expect(clean).not.toContain('unquoted.png');
    expect(clean).not.toContain('onmouseover');
    expect(clean).toContain('Remote image omitted: Ad');
    expect(clean).toContain('Remote image omitted: Hero');
    expect(clean).toContain('safe link');
    expect(clean).toContain('href="https://example.com/link"');
  });

  it('tolerates malformed markup without leaking resources or active content', () => {
    const raw = `
      <p>Text <b>bold
      <img src="https://t.example/x.png" alt="Broken">
      <scr<script>ipt>alert(1)</script>
      <a href="javascript:alert(1)" onclick="x()">js link</a>
      <p>unclosed <div>nested
      <<<p>angle noise</p>
      </b></i></u>
    `;

    const clean = sanitizeHtml(raw);

    expect(clean).not.toContain('t.example');
    expect(clean).not.toContain('javascript:');
    expect(clean).not.toContain('onclick');
    expect(clean).not.toContain('<script');
    // The broken script-like token is never an active element; its residue
    // survives only as escaped, inert text.
    expect(clean).toContain('ipt&gt;alert(1)');
    expect(clean).toContain('bold');
    expect(clean).toContain('nested');
    expect(clean).toContain('angle noise');
    expect(clean).toContain('&lt;');
    expect(clean).toContain('Remote image omitted: Broken');
  });

  it('exports SANITIZER_ALLOWLIST with expected configurations', () => {
    expect(SANITIZER_ALLOWLIST.ALLOWED_TAGS).toContain('a');
    expect(SANITIZER_ALLOWLIST.FORBID_TAGS).toContain('script');
    expect(SANITIZER_ALLOWLIST.FORBID_TAGS).toContain('img');
    expect(SANITIZER_ALLOWLIST.FORBID_ATTR).toContain('style');
  });
});
