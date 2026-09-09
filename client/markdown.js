// client/markdown.js
// Lightweight, safe, zero-dependency Markdown and Table parser for Aurora.
// Supports: GFM Tables, Headers (H1-H4), Bold, Italic, Strikethrough,
// Unordered Lists, Ordered Lists, Blockquotes, Inline Code, and Links.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AuroraMarkdown = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      }[c];
    });
  }

  /**
   * Parses markdown tables into responsive HTML tables.
   */
  function parseTable(lines) {
    if (lines.length < 2) return null;

    // Line 0: Header row
    // Line 1: Separator row (e.g. |---|:---:|---:|)
    // Lines 2+: Data rows
    const headerLine = lines[0].trim();
    const sepLine = lines[1].trim();

    if (!headerLine.includes('|') || !sepLine.includes('|')) return null;

    // Verify separator row matches markdown table syntax
    const sepParts = sepLine
      .split('|')
      .map((s) => s.trim())
      .filter((s, idx, arr) => {
        // ignore empty leading/trailing from outer pipes
        return idx > 0 && idx < arr.length - 1 ? true : s.length > 0;
      });

    const isTableSep = sepParts.every((p) => /^:?-+:?$/.test(p));
    if (!isTableSep || sepParts.length === 0) return null;

    const alignments = sepParts.map((p) => {
      const left = p.startsWith(':');
      const right = p.endsWith(':');
      if (left && right) return 'center';
      if (right) return 'right';
      return 'left';
    });

    function splitRow(rowStr) {
      // Remove outer pipes if present
      let clean = rowStr.trim();
      if (clean.startsWith('|')) clean = clean.slice(1);
      if (clean.endsWith('|')) clean = clean.slice(0, -1);
      return clean.split('|').map((c) => c.trim());
    }

    const headerCells = splitRow(headerLine);
    let html = '<div class="table-responsive-wrapper"><table class="aurora-table"><thead><tr>';
    headerCells.forEach((cell, i) => {
      const align = alignments[i] || 'left';
      html += `<th style="text-align:${align}">${formatInline(cell)}</th>`;
    });
    html += '</tr></thead><tbody>';

    for (let i = 2; i < lines.length; i++) {
      const rowLine = lines[i].trim();
      if (!rowLine || !rowLine.includes('|')) continue;
      const cells = splitRow(rowLine);
      html += '<tr>';
      for (let j = 0; j < headerCells.length; j++) {
        const align = alignments[j] || 'left';
        const cellVal = cells[j] !== undefined ? cells[j] : '';
        html += `<td style="text-align:${align}">${formatInline(cellVal)}</td>`;
      }
      html += '</tr>';
    }

    html += '</tbody></table></div>';
    return html;
  }

  /**
   * Applies inline formatting: bold, italic, code, links, strikethrough.
   */
  function formatInline(text) {
    if (!text) return '';

    // First escape HTML entities
    let out = escapeHtml(text);

    // Inline code `code`
    out = out.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

    // Bold **text** or __text__
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/__([^_]+)__/g, '<strong>$1</strong>');

    // Italic *text* or _text_
    out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    out = out.replace(/_([^_]+)_/g, '<em>$1</em>');

    // Strikethrough ~~text~~
    out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>');

    // Links [title](url)
    out = out.replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer" class="md-link">$1</a>'
    );

    return out;
  }

  /**
   * Primary Markdown render function.
   */
  function render(markdown) {
    if (!markdown || typeof markdown !== 'string') return '';

    const lines = markdown.replace(/\r\n/g, '\n').split('\n');
    const result = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();

      // Empty line
      if (!trimmed) {
        i++;
        continue;
      }

      // Check if this might be a markdown table
      if (
        trimmed.includes('|') &&
        i + 1 < lines.length &&
        lines[i + 1].trim().includes('|') &&
        lines[i + 1].includes('-')
      ) {
        const tableLines = [];
        while (i < lines.length && lines[i].trim().includes('|')) {
          tableLines.push(lines[i]);
          i++;
        }
        const tableHtml = parseTable(tableLines);
        if (tableHtml) {
          result.push(tableHtml);
          continue;
        } else {
          // If not a valid table, rewind and process lines individually
          i -= tableLines.length;
        }
      }

      // Headers #, ##, ###, ####
      const headerMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
      if (headerMatch) {
        const level = headerMatch[1].length;
        const text = formatInline(headerMatch[2]);
        result.push(`<h${level} class="md-h${level}">${text}</h${level}>`);
        i++;
        continue;
      }

      // Blockquotes >
      if (trimmed.startsWith('>')) {
        const quoteLines = [];
        while (i < lines.length && lines[i].trim().startsWith('>')) {
          quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
          i++;
        }
        const quoteContent = quoteLines.map((q) => formatInline(q)).join('<br>');
        result.push(`<blockquote class="md-quote">${quoteContent}</blockquote>`);
        continue;
      }

      // Unordered Lists (- or * or +)
      if (/^[-*+]\s+/.test(trimmed)) {
        let listHtml = '<ul class="md-list">';
        while (i < lines.length && /^[-*+]\s+/.test(lines[i].trim())) {
          const itemText = lines[i].trim().replace(/^[-*+]\s+/, '');
          listHtml += `<li>${formatInline(itemText)}</li>`;
          i++;
        }
        listHtml += '</ul>';
        result.push(listHtml);
        continue;
      }

      // Ordered Lists (1. 2. 3.)
      if (/^\d+\.\s+/.test(trimmed)) {
        let listHtml = '<ol class="md-list md-ordered">';
        while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
          const itemText = lines[i].trim().replace(/^\d+\.\s+/, '');
          listHtml += `<li>${formatInline(itemText)}</li>`;
          i++;
        }
        listHtml += '</ol>';
        result.push(listHtml);
        continue;
      }

      // Regular paragraph
      const paraLines = [];
      while (
        i < lines.length &&
        lines[i].trim() &&
        !lines[i].trim().startsWith('#') &&
        !lines[i].trim().startsWith('>') &&
        !/^[-*+]\s+/.test(lines[i].trim()) &&
        !/^\d+\.\s+/.test(lines[i].trim())
      ) {
        if (lines[i].trim().includes('|') && i + 1 < lines.length && lines[i + 1].includes('-')) {
          break; // Stop paragraph if table begins
        }
        paraLines.push(lines[i].trim());
        i++;
      }
      if (paraLines.length > 0) {
        result.push(`<p class="md-p">${paraLines.map((l) => formatInline(l)).join(' ')}</p>`);
      }
    }

    return result.join('\n');
  }

  return {
    render: render,
    formatInline: formatInline,
    escapeHtml: escapeHtml,
  };
});
