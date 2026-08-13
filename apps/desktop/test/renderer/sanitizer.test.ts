import { describe, expect, it } from 'vitest';
import {
  htmlToPlainText,
  sanitizeHtml,
  SANITIZER_ALLOWLIST,
} from '../../src/renderer/src/lib/sanitizer';

describe('sanitizer - DOMPurify allowlist helper', () => {
  it('allows semantic text, lists, quotes, tables, pre, code, and links', () => {
    const raw = `
      <h1>Heading</h1>
      <p>Paragraph with <strong>strong</strong> and <em>emphasis</em>.</p>
      <ul><li>Item 1</li><li>Item 2</li></ul>
      blockquote>Quoted text</blockquote>
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

  it('strips script, style, form, frame, images, svg, video, audio, and active content', () => {
    const raw = `
      <p>Normal text</p>
      <script>alert("xss")</script>
      <style>body { display: none; }</style>
      <form action="/submit"><input type="text" /><button type="submit">Send</button></form>
      <iframe src="https://malicious.com"></iframe>
      <img src="https://example.com/pic.png" alt="test" />
      <svg><circle cx="50" cy="50" r="40" /></svg>
      <video src="video.mp4"></video>
      <audio src="audio.mp3"></audio>
    `;

    const clean = sanitizeHtml(raw);

    expect(clean).toContain('<p>Normal text</p>');
    expect(clean).not.toContain('<script');
    expect(clean).not.toContain('alert');
    expect(clean).not.toContain('<style');
    expect(clean).not.toContain('<form');
    expect(clean).not.toContain('<input');
    expect(clean).not.toContain('<button');
    expect(clean).not.toContain('<iframe');
    expect(clean).not.toContain('<img');
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

  it('converts HTML content to clean plain text for fallback views', () => {
    const html = '<h1>Title</h1><p>Hello <strong>World</strong>!</p><script>alert(1)</script>';
    const plain = htmlToPlainText(html);

    expect(plain).toBe('TitleHello World!');
    expect(plain).not.toContain('<');
    expect(plain).not.toContain('alert');
  });

  it('exports SANITIZER_ALLOWLIST with expected configurations', () => {
    expect(SANITIZER_ALLOWLIST.ALLOWED_TAGS).toContain('a');
    expect(SANITIZER_ALLOWLIST.FORBID_TAGS).toContain('script');
    expect(SANITIZER_ALLOWLIST.FORBID_TAGS).toContain('img');
    expect(SANITIZER_ALLOWLIST.FORBID_ATTR).toContain('style');
  });
});
