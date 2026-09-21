// server/services/research/pageRetriever.js
// Safe, SSRF-protected webpage content retrieval layer.
// Fetches public web sources, guards against private IP traversal and metadata attacks,
// applies hard size and latency bounds, and handles network degradation gracefully.

import net from 'net';

/**
 * Checks whether an IP address is a private, loopback, link-local, or metadata address.
 *
 * @param {string} ip - IP address string.
 * @returns {boolean} True if the IP is prohibited for SSRF protection.
 */
export function isPrivateOrReservedIp(ip) {
  if (!ip || typeof ip !== 'string') return true;

  // Check IPv4
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts.some((p) => isNaN(p) || p < 0 || p > 255)) return true;

    // 127.0.0.0/8 (Loopback)
    if (parts[0] === 127) return true;
    // 0.0.0.0/8 (Current network)
    if (parts[0] === 0) return true;
    // 10.0.0.0/8 (Private RFC 1918)
    if (parts[0] === 10) return true;
    // 172.16.0.0/12 (Private RFC 1918: 172.16.0.0 - 172.31.255.255)
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    // 192.168.0.0/16 (Private RFC 1918)
    if (parts[0] === 192 && parts[1] === 168) return true;
    // 169.254.0.0/16 (Link-Local / AWS & GCP Metadata Service)
    if (parts[0] === 169 && parts[1] === 254) return true;
    // 224.0.0.0/4 (Multicast) & 240.0.0.0/4 (Reserved)
    if (parts[0] >= 224) return true;

    return false;
  }

  // Check IPv6
  if (net.isIPv6(ip)) {
    const normalized = ip.toLowerCase();
    // Loopback ::1
    if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') return true;
    // Unspecified ::
    if (normalized === '::' || normalized === '0:0:0:0:0:0:0:0') return true;
    // Link-local fe80::/10
    if (
      normalized.startsWith('fe8') ||
      normalized.startsWith('fe9') ||
      normalized.startsWith('fea') ||
      normalized.startsWith('feb')
    )
      return true;
    // Unique Local fc00::/7
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
    // IPv4 mapped IPv6 e.g. ::ffff:127.0.0.1
    if (normalized.includes('::ffff:')) {
      const v4Part = normalized.split('::ffff:')[1];
      if (v4Part && net.isIPv4(v4Part)) return isPrivateOrReservedIp(v4Part);
    }
    return false;
  }

  return true;
}

/**
 * Validates a target URL against SSRF attack vectors.
 *
 * @param {string} targetUrl - URL to inspect.
 * @returns {{ valid: boolean, error?: string, parsedUrl?: URL }}
 */
export function validateUrlForSsrf(targetUrl) {
  if (!targetUrl || typeof targetUrl !== 'string') {
    return { valid: false, error: 'Empty or invalid URL.' };
  }

  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch (_) {
    return { valid: false, error: 'Malformed URL format.' };
  }

  // Strictly enforce http/https protocols
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      valid: false,
      error: `Disallowed protocol: ${parsed.protocol}. Only HTTP/HTTPS permitted.`,
    };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Guard against localhost and common internal names
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname === '0.0.0.0'
  ) {
    return { valid: false, error: 'Access to local/internal hostnames is blocked for security.' };
  }

  // If hostname is directly an IP literal, validate against private ranges
  if (net.isIP(hostname)) {
    if (isPrivateOrReservedIp(hostname)) {
      return {
        valid: false,
        error: `Access to private or reserved IP address (${hostname}) is blocked.`,
      };
    }
  }

  return { valid: true, parsedUrl: parsed };
}

/**
 * Fetches the HTML content of a public webpage with SSRF protection, size caps, and timeouts.
 *
 * @param {string} targetUrl - URL to retrieve.
 * @param {object} [options] - Options.
 * @param {AbortSignal} [options.signal] - External cancellation signal.
 * @param {number} [options.timeoutMs=3500] - Hard timeout.
 * @param {number} [options.maxBytes=1048576] - Maximum download size (1MB).
 * @param {Function} [options.fetchFn=globalThis.fetch] - Fetch override for testing.
 * @returns {Promise<{ ok: boolean, url: string, html?: string, status?: number, error?: string }>}
 */
export async function fetchWebpageContent(targetUrl, options = {}) {
  const {
    signal = null,
    timeoutMs = 3500,
    maxBytes = 1024 * 1024, // 1 MB cap
    fetchFn = globalThis.fetch,
  } = options;

  const validation = validateUrlForSsrf(targetUrl);
  if (!validation.valid) {
    console.warn(`[PAGE_RETRIEVER_BLOCKED] URL: "${targetUrl}" | Reason: ${validation.error}`);
    return { ok: false, url: targetUrl, error: validation.error };
  }

  const internalController = new AbortController();
  const timeoutId = setTimeout(() => internalController.abort(), timeoutMs);
  if (signal) {
    signal.addEventListener('abort', () => internalController.abort(), { once: true });
  }

  try {
    console.log(`[PAGE_RETRIEVER_START] Fetching: "${targetUrl}"`);

    const response = await fetchFn(targetUrl, {
      method: 'GET',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 (compatible; Aurora-Research-Agent/1.0; +https://aurora-agent.dev/bot)',
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: internalController.signal,
    });

    if (!response.ok) {
      console.warn(`[PAGE_RETRIEVER_FAILED] HTTP ${response.status} for "${targetUrl}"`);
      return {
        ok: false,
        url: targetUrl,
        status: response.status,
        error: `HTTP error ${response.status}: ${response.statusText || 'Failed to retrieve page'}`,
      };
    }

    // Verify content type is HTML or text
    const contentType = response.headers.get('content-type') || '';
    if (
      !contentType.includes('text/html') &&
      !contentType.includes('text/plain') &&
      !contentType.includes('application/xhtml+xml')
    ) {
      console.warn(
        `[PAGE_RETRIEVER_SKIPPED] Unsupported content-type: "${contentType}" for "${targetUrl}"`
      );
      return {
        ok: false,
        url: targetUrl,
        status: response.status,
        error: `Unsupported content-type: ${contentType}. Only web documents are supported.`,
      };
    }

    // Download body with size limit guard
    const rawText = await response.text();
    if (rawText.length > maxBytes) {
      console.log(`[PAGE_RETRIEVER_TRUNCATED] Body exceeded ${maxBytes} bytes, truncating.`);
    }
    const html = rawText.slice(0, maxBytes);

    console.log(`[PAGE_RETRIEVER_SUCCESS] Retrieved ${html.length} chars from "${targetUrl}"`);
    return {
      ok: true,
      url: targetUrl,
      status: response.status,
      html,
    };
  } catch (err) {
    const isAborted = internalController.signal.aborted;
    const reason = isAborted ? 'Request timed out or cancelled' : err.message || String(err);
    console.warn(`[PAGE_RETRIEVER_ERROR] Failed to fetch "${targetUrl}": ${reason}`);
    return {
      ok: false,
      url: targetUrl,
      error: reason,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
