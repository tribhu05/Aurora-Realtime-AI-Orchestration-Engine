// client/highlighter.js
// Fast, deterministic, zero-dependency syntax highlighter and code-block builder
// tailored for Aurora's visual chat interface.
// Uses a robust lexical tokenizer to guarantee zero HTML tag corruption or double-escaping.
// Supports: JavaScript, TypeScript, C++, Python, HTML, CSS, SQL, JSON, Bash.

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

  // Language keywords
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
      'require',
      'module',
      'exports',
      'of',
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
      'require',
      'module',
      'exports',
      'of',
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

  // Deterministic lexical tokenizer for a single source code line
  function highlightLine(line, nLang, kwSet, typeSet) {
    let result = '';
    let i = 0;
    const len = line.length;

    while (i < len) {
      // 1. Line Comments
      if (
        (nLang !== 'python' && nLang !== 'bash' && line.startsWith('//', i)) ||
        ((nLang === 'python' || nLang === 'bash') && line[i] === '#')
      ) {
        const comment = line.slice(i);
        result += `<span class="tok-com">${escapeHtml(comment)}</span>`;
        break;
      }

      // 2. Block Comments (single-line slice)
      if (line.startsWith('/*', i)) {
        const endIdx = line.indexOf('*/', i + 2);
        if (endIdx !== -1) {
          const comment = line.slice(i, endIdx + 2);
          result += `<span class="tok-com">${escapeHtml(comment)}</span>`;
          i = endIdx + 2;
          continue;
        } else {
          const comment = line.slice(i);
          result += `<span class="tok-com">${escapeHtml(comment)}</span>`;
          break;
        }
      }

      // 3. String Literals ("...", '...', `...`)
      const ch = line[i];
      if (ch === '"' || ch === "'" || ch === '`') {
        const quote = ch;
        let strEnd = i + 1;
        while (strEnd < len) {
          if (line[strEnd] === '\\') {
            strEnd += 2; // skip escaped character
            continue;
          }
          if (line[strEnd] === quote) {
            strEnd++;
            break;
          }
          strEnd++;
        }
        const strVal = line.slice(i, strEnd);
        result += `<span class="tok-str">${escapeHtml(strVal)}</span>`;
        i = strEnd;
        continue;
      }

      // 4. Numbers (decimal, hex, binary, float with exponents)
      const isDigit = ch >= '0' && ch <= '9';
      const prevChar = i > 0 ? line[i - 1] : ' ';
      const isWordChar = /[a-zA-Z0-9_$]/.test(prevChar);

      if (isDigit && !isWordChar) {
        const numMatch = line
          .slice(i)
          .match(/^(?:0[xX][0-9a-fA-F]+|0[bB][01]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b/);
        if (numMatch) {
          result += `<span class="tok-num">${escapeHtml(numMatch[0])}</span>`;
          i += numMatch[0].length;
          continue;
        }
      }

      // 5. Identifiers, Keywords, Types, Function Invocations
      if (/[a-zA-Z_$]/.test(ch) || (ch === '#' && nLang === 'cpp')) {
        const identMatch = line.slice(i).match(/^#?[a-zA-Z_$][a-zA-Z0-9_$]*/);
        if (identMatch) {
          const word = identMatch[0];
          const nextIdx = i + word.length;
          const isFuncCall = /^\s*\(/.test(line.slice(nextIdx));

          if (kwSet.has(word) || (nLang === 'sql' && kwSet.has(word.toLowerCase()))) {
            result += `<span class="tok-kw">${escapeHtml(word)}</span>`;
          } else if (typeSet.has(word)) {
            result += `<span class="tok-type">${escapeHtml(word)}</span>`;
          } else if (isFuncCall) {
            result += `<span class="tok-fn">${escapeHtml(word)}</span>`;
          } else {
            result += escapeHtml(word);
          }
          i += word.length;
          continue;
        }
      }

      // 6. Common Programming Operators
      const opMatch = line.slice(i).match(/^(?:===|!==|==|!=|<=|>=|=>|&&|\|\||[+\-*/%=<>!&|^~?:])/);
      if (opMatch) {
        result += `<span class="tok-op">${escapeHtml(opMatch[0])}</span>`;
        i += opMatch[0].length;
        continue;
      }

      // 7. Plain Punctuation and Whitespace
      result += escapeHtml(ch);
      i++;
    }

    return result;
  }

  // Dedicated JSON Tokenizer
  function highlightJson(code) {
    if (!code) return '';
    const lines = code.split('\n');
    return lines
      .map((line) => {
        let res = '';
        let i = 0;
        const len = line.length;

        while (i < len) {
          const ch = line[i];

          // String
          if (ch === '"') {
            let end = i + 1;
            while (end < len) {
              if (line[end] === '\\') {
                end += 2;
                continue;
              }
              if (line[end] === '"') {
                end++;
                break;
              }
              end++;
            }
            const strVal = line.slice(i, end);
            const isKey = /^\s*:/.test(line.slice(end));
            const tokenClass = isKey ? 'tok-prop' : 'tok-str';
            res += `<span class="${tokenClass}">${escapeHtml(strVal)}</span>`;
            i = end;
            continue;
          }

          // Number
          if ((ch >= '0' && ch <= '9') || (ch === '-' && i + 1 < len && line[i + 1] >= '0')) {
            const numMatch = line.slice(i).match(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/);
            if (numMatch) {
              res += `<span class="tok-num">${escapeHtml(numMatch[0])}</span>`;
              i += numMatch[0].length;
              continue;
            }
          }

          // Booleans & null
          const boolMatch = line.slice(i).match(/^(?:true|false|null)\b/);
          if (boolMatch) {
            res += `<span class="tok-kw">${escapeHtml(boolMatch[0])}</span>`;
            i += boolMatch[0].length;
            continue;
          }

          res += escapeHtml(ch);
          i++;
        }
        return res;
      })
      .join('\n');
  }

  function highlight(code, lang) {
    const nLang = normalizeLang(lang);
    if (!code) return '';

    if (nLang === 'json') {
      return highlightJson(code);
    }

    const kwList = KEYWORDS[nLang] || KEYWORDS.javascript;
    const typeList = TYPES[nLang] || [];
    const kwSet = new Set(kwList);
    const typeSet = new Set(typeList);

    const lines = String(code).split('\n');
    const highlightedLines = lines.map((line) => highlightLine(line, nLang, kwSet, typeSet));
    return highlightedLines.join('\n');
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
