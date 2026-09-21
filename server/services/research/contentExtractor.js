// server/services/research/contentExtractor.js
// Cleans HTML, strips boilerplate, extracts readable body text,
// and wraps untrusted web content with security isolation fences.

/**
 * Strips HTML tags, navigation, scripts, styles, and boilerplate,
 * returning clean, readable text suitable for LLM comprehension.
 *
 * @param {string} html - Raw HTML document.
 * @param {object} [options] - Options.
 * @param {number} [options.maxLength=4000] - Max characters of body text to retain.
 * @returns {{ title: string, content: string, excerpt: string }} Extracted readable content.
 */
export function extractReadableContent(html, options = {}) {
  const { maxLength = 4000 } = options;

  if (!html || typeof html !== 'string') {
    return { title: '', content: '', excerpt: '' };
  }

  // 1. Extract Page Title
  let title = '';
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) {
    title = titleMatch[1].replace(/<[^>]+>/g, '').trim();
  } else {
    const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (h1Match) {
      title = h1Match[1].replace(/<[^>]+>/g, '').trim();
    }
  }

  // 2. Remove non-content and layout tags
  let text = html;
  text = text.replace(/<!--[\s\S]*?-->/g, ' '); // Comments
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ');
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ');
  text = text.replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, ' ');
  text = text.replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, ' ');
  text = text.replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, ' ');
  text = text.replace(/<header[^>]*>[\s\S]*?<\/header>/gi, ' ');
  text = text.replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, ' ');
  text = text.replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, ' ');
  text = text.replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, ' ');

  // 3. Convert headings to markdown lines
  text = text.replace(/<h[1-2][^>]*>([\s\S]*?)<\/h[1-2]>/gi, '\n\n## $1\n\n');
  text = text.replace(/<h[3-6][^>]*>([\s\S]*?)<\/h[3-6]>/gi, '\n\n### $1\n\n');

  // 4. Convert paragraphs and list items to lines
  text = text.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '\n\n$1\n\n');
  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '\n- $1');
  text = text.replace(/<br\s*\/?>/gi, '\n');

  // 5. Strip all remaining HTML tags
  text = text.replace(/<[^>]+>/g, ' ');

  // 6. Decode common HTML entities
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–');

  // 7. Clean up whitespace
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  let cleanContent = lines.join('\n');

  // 8. Truncate to maximum allowed length
  if (cleanContent.length > maxLength) {
    cleanContent = cleanContent.slice(0, maxLength) + '... [content truncated for brevity]';
  }

  const excerpt = cleanContent.slice(0, 300).replace(/\n+/g, ' ').trim();

  return {
    title,
    content: cleanContent,
    excerpt,
  };
}

/**
 * Wraps retrieved content in security isolation tags to prevent prompt injection.
 *
 * @param {string} content - Raw or extracted text.
 * @param {string} sourceUrl - Origin URL.
 * @param {string} [title] - Page title.
 * @returns {string} Fenced untrusted content block.
 */
export function wrapUntrustedContent(content, sourceUrl, title = '') {
  return [
    `<untrusted_web_content source="${sourceUrl}" title="${title}">`,
    content,
    `</untrusted_web_content>`,
  ].join('\n');
}
