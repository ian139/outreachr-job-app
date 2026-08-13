import DOMPurify from 'dompurify';
import { parseFragment } from 'parse5';
import type { DefaultTreeAdapterTypes } from 'parse5';
import { marked, Renderer } from 'marked';

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
    'aside',
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

type ParsedNode = DefaultTreeAdapterTypes.Node;
type ParsedElement = DefaultTreeAdapterTypes.Element;

const SAFE_TAGS: Record<string, true> = Object.fromEntries(
  SANITIZER_ALLOWLIST.ALLOWED_TAGS.map((tag) => [tag, true] as const),
);
const SAFE_ATTRIBUTES: Record<string, true> = Object.fromEntries(
  SANITIZER_ALLOWLIST.ALLOWED_ATTR.map((attribute) => [attribute, true] as const),
);
const IMAGE_TAGS: Record<string, true> = { img: true, image: true };
const IMAGE_CONTAINER_TAGS: Record<string, true> = { picture: true, svg: true };
const DROP_CONTENT_TAGS: Record<string, true> = {
  script: true,
  style: true,
  iframe: true,
  frame: true,
  frameset: true,
  embed: true,
  object: true,
  source: true,
  audio: true,
  video: true,
  canvas: true,
  applet: true,
  base: true,
  link: true,
  meta: true,
};
const VOID_TAGS: Record<string, true> = { br: true, hr: true };

function isElement(node: ParsedNode): node is ParsedElement {
  return 'tagName' in node;
}

function isText(node: ParsedNode): node is DefaultTreeAdapterTypes.TextNode {
  return node.nodeName === '#text';
}

function escapeHtmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function imageOmission(element: ParsedElement): string {
  const alt = element.attrs.find((attribute) => attribute.name.toLowerCase() === 'alt')?.value?.trim();
  const text = alt ? `Remote image omitted: ${alt}` : 'Remote image omitted';
  return `<aside aria-label="Remote image omitted">${escapeHtmlText(text)}</aside>`;
}

/**
 * Extracts inert omission text for every image found inside image-container
 * elements (picture, svg). All other content of those containers is dropped.
 */
function renderImageOmissions(node: ParsedElement): string {
  let rendered = '';
  for (const child of node.childNodes) {
    if (!isElement(child)) continue;
    const tagName = child.tagName.toLowerCase();
    rendered += IMAGE_TAGS[tagName] === true ? imageOmission(child) : renderImageOmissions(child);
  }
  return rendered;
}

function serializeAttributes(element: ParsedElement, tagName: string): string {
  let serialized = '';
  for (const attribute of element.attrs) {
    const name = attribute.name.toLowerCase();
    if (SAFE_ATTRIBUTES[name] !== true) continue;
    if (name === 'href') {
      if (tagName !== 'a' || !attribute.value.trim().toLowerCase().startsWith('https://')) {
        continue;
      }
    } else if ((name === 'target' || name === 'rel') && tagName !== 'a') {
      continue;
    }
    serialized += ` ${name}="${escapeHtmlText(attribute.value).replace(/"/g, '&quot;')}"`;
  }
  return serialized;
}

function serializeSafeNode(node: ParsedNode): string {
  if (isText(node)) return escapeHtmlText(node.value);
  if (!isElement(node)) return '';

  const tagName = node.tagName.toLowerCase();
  if (IMAGE_TAGS[tagName] === true) return imageOmission(node);
  if (IMAGE_CONTAINER_TAGS[tagName] === true) return renderImageOmissions(node);
  if (DROP_CONTENT_TAGS[tagName] === true) return '';

  let children = '';
  for (const child of node.childNodes) {
    children += serializeSafeNode(child);
  }
  if (SAFE_TAGS[tagName] !== true) return children;

  const attributes = serializeAttributes(node, tagName);
  if (VOID_TAGS[tagName] === true) return `<${tagName}${attributes}>`;
  return `<${tagName}${attributes}>${children}</${tagName}>`;
}

/**
 * Parses provider HTML with an inert parser (parse5), producing an
 * allowlisted, resource-free, attribute-safe intermediate. Remote images
 * become inert omission text and every auto-fetch or active element is
 * removed before the result reaches DOMPurify.
 */
function neutralizeProviderHtml(rawHtml: string): string {
  try {
    const fragment = parseFragment(rawHtml);
    let rendered = '';
    for (const child of fragment.childNodes) {
      rendered += serializeSafeNode(child);
    }
    return rendered;
  } catch {
    // Never fall back to raw HTML if malformed input hits an unexpected
    // parser failure. An empty result is safer than passing it downstream.
    return '';
  }
}

/**
 * Sanitizes HTML content using a strict semantic allowlist.
 * Remote images are represented as inert text so email tracking URLs never render or fetch.
 */
export function sanitizeHtml(rawHtml: string): string {
  if (!rawHtml) return '';

  const hook = (node: Element) => {
    if (node.tagName === 'A') {
      const href = node.getAttribute('href')?.trim();
      if (href?.toLowerCase().startsWith('https://')) {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
      } else {
        node.removeAttribute('href');
      }
    }
  };

  DOMPurify.addHook('afterSanitizeAttributes', hook);
  try {
    const clean = DOMPurify.sanitize(neutralizeProviderHtml(rawHtml), {
      ...SANITIZER_ALLOWLIST,
      RETURN_DOM_FRAGMENT: false,
      RETURN_DOM: false,
    });
    return typeof clean === 'string' ? clean : '';
  } finally {
    DOMPurify.removeHook('afterSanitizeAttributes');
  }
}

function normalizePlainText(value: string): string {
  return value
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function textContentOf(node: ParsedNode): string {
  if (isText(node)) return node.value;
  if (!isElement(node)) return '';
  let value = '';
  for (const child of node.childNodes) {
    value += textContentOf(child);
  }
  return value;
}

function descendantElements(node: ParsedNode): ParsedElement[] {
  const found: ParsedElement[] = [];
  if (!isElement(node)) return found;
  for (const child of node.childNodes) {
    if (!isElement(child)) continue;
    found.push(child, ...descendantElements(child));
  }
  return found;
}

function renderPlainText(node: ParsedNode): string {
  if (isText(node)) return node.value.replace(/\s+/g, ' ');
  if (!isElement(node)) return '';

  const element = node;
  const tagName = element.tagName.toLowerCase();
  const children = () => element.childNodes.map(renderPlainText).join('');
  const block = (value: string) => `\n\n${value.trim()}\n\n`;

  switch (tagName) {
    case 'br':
      return '\n';
    case 'pre':
      return block(textContentOf(element).trim());
    case 'p':
    case 'div':
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
    case 'dt':
    case 'dd':
    case 'aside':
      return block(children());
    case 'ul':
    case 'ol': {
      const items = element.childNodes
        .filter(isElement)
        .filter((child) => child.tagName.toLowerCase() === 'li')
        .map((item, index) => {
          const marker = tagName === 'ol' ? `${index + 1}. ` : '• ';
          return `${marker}${normalizePlainText(renderPlainText(item)).replace(/\n+/g, ' ')}`;
        })
        .join('\n');
      return block(items);
    }
    case 'li':
      return children();
    case 'blockquote': {
      const quoted = normalizePlainText(children())
        .split('\n')
        .map((line) => (line ? `> ${line}` : '>'))
        .join('\n');
      return block(quoted);
    }
    case 'table': {
      const rows = descendantElements(element)
        .filter((row) => row.tagName.toLowerCase() === 'tr')
        .map((row) =>
          row.childNodes
            .filter(isElement)
            .filter((cell) => {
              const cellName = cell.tagName.toLowerCase();
              return cellName === 'th' || cellName === 'td';
            })
            .map((cell) => normalizePlainText(renderPlainText(cell)).replace(/\n+/g, ' '))
            .join(' | '),
        );
      return block(rows.join('\n'));
    }
    default:
      return children();
  }
}

/**
 * Converts sanitized provider HTML into readable plain text while preserving semantic block boundaries.
 */
export function htmlToPlainText(rawHtml: string): string {
  const clean = sanitizeHtml(rawHtml);
  if (!clean) return '';
  const fragment = parseFragment(clean);
  return normalizePlainText(fragment.childNodes.map(renderPlainText).join(''));
}

/**
 * Converts Markdown-like plain text to semantic HTML. Raw HTML tokens are escaped before sanitization.
 */
export function plainTextToSafeHtml(plainText: string): string {
  if (!plainText) return '';

  const renderer = new Renderer();
  renderer.html = ({ text }) =>
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const rendered = marked.parse(plainText, {
    async: false,
    breaks: true,
    gfm: true,
    renderer,
  });
  return sanitizeHtml(rendered);
}
