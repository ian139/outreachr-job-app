import DOMPurify from 'dompurify';

export const SANITIZER_ALLOWLIST = {
  ALLOWED_TAGS: [
    'p',
    'br',
    'b',
    'i',
    'strong',
    'em',
    'u',
    's',
    'strike',
    'sub',
    'sup',
    'span',
    'div',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'hr',
    'ul',
    'ol',
    'li',
    'dl',
    'dt',
    'dd',
    'blockquote',
    'q',
    'table',
    'thead',
    'tbody',
    'tfoot',
    'tr',
    'th',
    'td',
    'caption',
    'pre',
    'code',
    'a',
  ],
  ALLOWED_ATTR: ['href', 'target', 'rel', 'title', 'aria-label'],
  FORBID_TAGS: [
    'script',
    'style',
    'form',
    'input',
    'textarea',
    'select',
    'button',
    'iframe',
    'frame',
    'frameset',
    'embed',
    'object',
    'img',
    'image',
    'picture',
    'source',
    'svg',
    'audio',
    'video',
    'canvas',
    'applet',
    'base',
    'link',
    'meta',
  ],
  FORBID_ATTR: [
    'style',
    'id',
    'onload',
    'onerror',
    'onclick',
    'onmouseover',
    'onfocus',
    'onblur',
    'onchange',
    'onsubmit',
  ],
  ALLOW_DATA_ATTR: false,
};

/**
 * Sanitizes HTML content using DOMPurify with strict allowlist.
 * Returns safe HTML with only semantic text, lists, quotes, tables, pre, code, links.
 * Strips script, style, form, frame, images, events, active content.
 * Retains ONLY https:// href links and adds target="_blank" rel="noopener noreferrer".
 */
export function sanitizeHtml(rawHtml: string): string {
  if (!rawHtml) return '';

  const hook = (node: Element) => {
    // Strip inline style attribute on all nodes explicitly
    if (node.hasAttribute('style')) {
      node.removeAttribute('style');
    }

    if (node.tagName === 'A') {
      const href = node.getAttribute('href');
      if (href) {
        const trimmed = href.trim();
        if (trimmed.toLowerCase().startsWith('https://')) {
          node.setAttribute('target', '_blank');
          node.setAttribute('rel', 'noopener noreferrer');
        } else {
          node.removeAttribute('href');
        }
      }
    }
  };

  DOMPurify.addHook('afterSanitizeAttributes', hook);

  try {
    const clean = DOMPurify.sanitize(rawHtml, {
      ...SANITIZER_ALLOWLIST,
      RETURN_DOM_FRAGMENT: false,
      RETURN_DOM: false,
    });
    return typeof clean === 'string' ? clean : '';
  } finally {
    DOMPurify.removeHook('afterSanitizeAttributes');
  }
}

/**
 * Converts HTML content into clean plain text for fallback views.
 * Uses DOMPurify sanitization first then extracts text content.
 */
export function htmlToPlainText(rawHtml: string): string {
  if (!rawHtml) return '';
  const clean = sanitizeHtml(rawHtml);
  if (!clean) return '';
  if (typeof document !== 'undefined') {
    const temp = document.createElement('div');
    temp.innerHTML = clean;
    return temp.textContent || temp.innerText || '';
  }
  return clean.replace(/<[^>]+>/g, '').trim();
}
