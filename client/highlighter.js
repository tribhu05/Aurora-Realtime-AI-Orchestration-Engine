// client/highlighter.js
// Fast, lightweight, zero-dependency syntax highlighter and code-block builder
// tailored for Aurora's visual chat interface.
// Supports: C++, Python, JavaScript, TypeScript, HTML, CSS, SQL, JSON, Bash.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AuroraHighlighter = factory();
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

  // Language token definitions
  const KEYWORDS = {
    cpp: [
      'auto',
      'break',
      'case',
      'catch',
      'class',
      'const',
      'continue',
      'default',
      'delete',
      'do',
      'else',
      'enum',
      'explicit',
      'export',
      'extern',
      'for',
      'friend',
      'goto',
      'if',
      'inline',
      'namespace',
      'new',
      'operator',
      'private',
      'protected',
      'public',
      'return',
      'sizeof',
      'static',
      'struct',
      'switch',
      'template',
      'this',
      'throw',
      'try',
      'typedef',
      'typename',
      'union',
      'using',
      'virtual',
      'volatile',
      'while',
      '#include',
      '#define',
      '#ifdef',
      '#ifndef',
      '#endif',
      'constexpr',
      'nullptr',
      'override',
      'final',
    ],
    python: [
      'and',
      'as',
      'assert',
      'async',
      'await',
      'break',
      'class',
      'continue',
      'def',
      'del',
      'elif',
      'else',
      'except',
      'finally',
      'for',
      'from',
      'global',
      'if',
      'import',
      'in',
      'is',
      'lambda',
      'nonlocal',
      'not',
      'or',
      'pass',
      'raise',
      'return',
      'try',
      'while',
      'with',
      'yield',
      'True',
      'False',
      'None',
      'self',
      'cls',
    ],
    javascript: [
      'async',
      'await',
      'break',
      'case',
      'catch',
      'class',
      'const',
      'continue',
      'debugger',
      'default',
      'delete',
      'do',
      'else',
      'export',
      'extends',
      'finally',
      'for',
      'function',
      'if',
      'import',
      'in',
      'instanceof',
      'let',
      'new',
      'return',
      'super',
      'switch',
      'this',
      'throw',
      'try',
      'typeof',
      'var',
      'void',
      'while',
      'with',
      'yield',
      'true',
      'false',
      'null',
      'undefined',
    ],
    typescript: [
      'async',
      'await',
      'break',
      'case',
      'catch',
      'class',
      'const',
      'continue',
      'debugger',
      'default',
      'delete',
      'do',
      'else',
      'export',
      'extends',
      'finally',
      'for',
      'function',
      'if',
      'import',
      'in',
      'instanceof',
      'let',
      'new',
      'return',
      'super',
      'switch',
      'this',
      'throw',
      'try',
      'typeof',
      'var',
      'void',
      'while',
      'with',
      'yield',
      'true',
      'false',
      'null',
      'undefined',
      'type',
      'interface',
      'namespace',
      'readonly',
      'implements',
      'enum',
      'as',
      'any',
      'string',
      'number',
      'boolean',
      'unknown',
      'never',
    ],
    sql: [
      'select',
      'from',
      'where',
      'insert',
      'into',
      'update',
      'delete',
      'create',
      'table',
      'drop',
      'alter',
      'join',
      'inner',
      'left',
      'right',
      'outer',
      'on',
      'group',
      'by',
      'order',
      'asc',
      'desc',
      'having',
      'limit',
      'as',
      'distinct',
      'count',
      'sum',
      'avg',
      'max',
      'min',
      'like',
      'in',
      'and',
      'or',
      'not',
      'is',
      'null',
      'primary',
      'key',
    ],
    bash: [
      'if',
      'then',
      'else',
      'elif',
      'fi',
      'for',
      'while',
      'do',
      'done',
      'in',
      'case',
      'esac',
      'function',
      'return',
      'exit',
      'export',
      'source',
      'alias',
      'cd',
      'ls',
      'echo',
      'mkdir',
      'rm',
      'npm',
      'node',
      'git',
      'curl',
      'sudo',
      'chmod',
      'chown',
      'cat',
      'grep',
    ],
  };

  const TYPES = {
    cpp: [
      'int',
      'float',
      'double',
      'char',
      'void',
      'bool',
      'long',
      'short',
      'unsigned',
      'signed',
      'size_t',
      'string',
      'vector',
      'map',
      'set',
      'pair',
      'unordered_map',
      'unordered_set',
      'cout',
      'cin',
      'endl',
      'std',
    ],
    python: [
      'int',
      'float',
      'str',
      'bool',
      'list',
      'dict',
      'tuple',
      'set',
      'print',
      'len',
      'range',
      'enumerate',
      'zip',
      'map',
      'filter',
      'open',
    ],
    javascript: [
      'Promise',
      'Array',
      'Object',
      'String',
      'Number',
      'Boolean',
      'Map',
      'Set',
      'console',
      'JSON',
      'Math',
      'Date',
      'RegExp',
      'Error',
      'window',
      'document',
      'process',
    ],
    typescript: [
      'Promise',
      'Array',
      'Object',
      'String',
      'Number',
      'Boolean',
      'Map',
      'Set',
      'console',
      'JSON',
      'Record',
      'Partial',
      'Pick',
      'Omit',
    ],
  };

  function normalizeLang(lang) {
    if (!lang) return 'code';
    const l = lang.toLowerCase().trim();
    if (l === 'c++' || l === 'cpp' || l === 'cc' || l === 'h' || l === 'hpp') return 'cpp';
    if (l === 'py' || l === 'python') return 'python';
    if (l === 'js' || l === 'javascript' || l === 'mjs' || l === 'cjs') return 'javascript';
    if (l === 'ts' || l === 'typescript') return 'typescript';
    if (l === 'html' || l === 'xml') return 'html';
    if (l === 'css' || l === 'scss') return 'css';
    if (l === 'json') return 'json';
    if (l === 'sql') return 'sql';
    if (l === 'sh' || l === 'bash' || l === 'shell' || l === 'zsh') return 'bash';
    return l;
  }

  function highlight(code, lang) {
    const nLang = normalizeLang(lang);
    if (!code) return '';

    // Fast escape
    const escaped = escapeHtml(code);

    if (nLang === 'json') {
      return highlightJson(escaped);
    }

    const kwList = KEYWORDS[nLang] || KEYWORDS.javascript;
    const typeList = TYPES[nLang] || [];

    // Line-by-line tokenization
    const lines = escaped.split('\n');
    const highlightedLines = lines.map((line) => {
      // Comments
      let commentMatch = null;
      let commentText = '';

      if (nLang === 'python' || nLang === 'bash') {
        const hashIdx = line.indexOf('#');
        if (hashIdx !== -1) {
          commentText = line.slice(hashIdx);
          line = line.slice(0, hashIdx);
          commentMatch = true;
        }
      } else {
        const slashIdx = line.indexOf('//');
        if (slashIdx !== -1) {
          commentText = line.slice(slashIdx);
          line = line.slice(0, slashIdx);
          commentMatch = true;
        }
      }

      // Strings: "...", '...', `...`
      line = line.replace(
        /(&quot;.*?&quot;|&#39;.*?&#39;|`.*?`)/g,
        '<span class="tok-str">$1</span>'
      );

      // Numbers
      line = line.replace(/\b(\d+(\.\d+)?)\b/g, '<span class="tok-num">$1</span>');

      // Types & Builtins
      if (typeList.length) {
        const typeRegex = new RegExp(`\\b(${typeList.join('|')})\\b`, 'g');
        line = line.replace(typeRegex, '<span class="tok-type">$1</span>');
      }

      // Keywords
      if (kwList.length) {
        const kwRegex = new RegExp(`\\b(${kwList.join('|')})\\b`, nLang === 'sql' ? 'gi' : 'g');
        line = line.replace(kwRegex, '<span class="tok-kw">$1</span>');
      }

      // Functions foo(...)
      line = line.replace(/\b([a-zA-Z_]\w*)\s*(?=\()/g, '<span class="tok-fn">$1</span>');

      if (commentMatch) {
        return line + `<span class="tok-com">${commentText}</span>`;
      }
      return line;
    });

    return highlightedLines.join('\n');
  }

  function highlightJson(escaped) {
    return (
      escaped
        // Keys
        .replace(/(&quot;[\w\s\-_]+&quot;)\s*:/g, '<span class="tok-prop">$1</span>:')
        // String values
        .replace(/:\s*(&quot;.*?&quot;)/g, ': <span class="tok-str">$1</span>')
        // Booleans & null
        .replace(/\b(true|false|null)\b/g, '<span class="tok-kw">$1</span>')
        // Numbers
        .replace(/\b(-?\d+(\.\d+)?)\b/g, '<span class="tok-num">$1</span>')
    );
  }

  /**
   * Generates a fully contained code block HTML card with language badge,
   * title, clean scroll container, and interactive Copy button.
   */
  function renderCodeBlock({ code, language, title }) {
    const rawCode = code || '';
    const cleanLang = normalizeLang(language);
    const displayLang = (language || 'Code').toUpperCase();
    const highlightedCode = highlight(rawCode, cleanLang);

    // Encode raw code safely in data attribute for reliable 1-click clipboard copy
    const encodedRaw = encodeURIComponent(rawCode);

    return `
<div class="code-block-wrapper" data-raw-code="${encodedRaw}">
  <div class="code-block-header">
    <div class="code-block-meta">
      <span class="code-lang-badge">${displayLang}</span>
      ${title ? `<span class="code-title">${escapeHtml(title)}</span>` : ''}
    </div>
    <button class="copy-btn" title="Copy code to clipboard">
      <svg class="copy-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>
        <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
      </svg>
      <span class="copy-text">Copy</span>
    </button>
  </div>
  <div class="code-block-body">
    <pre class="code-content"><code>${highlightedCode}</code></pre>
  </div>
</div>`.trim();
  }

  /**
   * Global event handler helper for Copy buttons.
   */
  function attachCopyHandlers(container) {
    if (!container) return;
    const buttons = container.querySelectorAll('.copy-btn');
    buttons.forEach((btn) => {
      if (btn.dataset.bound) return;
      btn.dataset.bound = 'true';
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const wrapper = btn.closest('.code-block-wrapper');
        if (!wrapper) return;
        const encoded = wrapper.dataset.rawCode || '';
        const plainText = decodeURIComponent(encoded);

        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(plainText);
          } else {
            // Fallback
            const textarea = document.createElement('textarea');
            textarea.value = plainText;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
          }

          // Visual feedback
          btn.classList.add('copied');
          btn.innerHTML = `
            <svg class="copy-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
            <span class="copy-text">Copied!</span>
          `;

          setTimeout(() => {
            btn.classList.remove('copied');
            btn.innerHTML = `
              <svg class="copy-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>
                <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
              </svg>
              <span class="copy-text">Copy</span>
            `;
          }, 2000);
        } catch (err) {
          console.error('Failed to copy code', err);
        }
      });
    });
  }

  return {
    highlight: highlight,
    renderCodeBlock: renderCodeBlock,
    attachCopyHandlers: attachCopyHandlers,
    escapeHtml: escapeHtml,
  };
});
