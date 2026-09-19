// server/github.js
// Dedicated GitHub repository inspection engine for Aurora.
// Extracts owner/repo from GitHub URLs, retrieves verified metadata,
// README documentation, and file structure via GitHub REST API with
// raw.githubusercontent.com rate-limit fallback.

/**
 * Detects a GitHub repository URL in natural language text and extracts
 * the owner and repository name.
 *
 * @param {string} text - Input text or prompt.
 * @returns {{ url: string, owner: string, repo: string }|null}
 */
export function detectGitHubUrl(text) {
  if (!text || typeof text !== 'string') return null;

  const match = text.match(
    /(?:https?:\/\/)?(?:www\.)?github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+?)(?:[/#?.\s]|$)/i
  );
  if (!match) return null;

  const owner = match[1].trim();
  const repo = match[2].trim().replace(/\.git$/i, '');

  // Guard against non-repo paths like github.com/features, github.com/pricing
  const reservedPaths = new Set([
    'features',
    'pricing',
    'explore',
    'topics',
    'collections',
    'trending',
    'events',
    'contact',
    'about',
    'security',
    'enterprise',
  ]);
  if (reservedPaths.has(owner.toLowerCase()) || reservedPaths.has(repo.toLowerCase())) {
    return null;
  }

  return {
    url: `https://github.com/${owner}/${repo}`,
    owner,
    repo,
  };
}

/**
 * Fetches public GitHub repository metadata, README, and file structure
 * using GitHub REST API v3, with automatic raw.githubusercontent.com fallback.
 *
 * @param {string} owner - Repository owner (e.g. 'tribhu05').
 * @param {string} repo - Repository name (e.g. 'SolarVision').
 * @param {object} [options]
 * @param {string} [options.token] - Optional GitHub personal access token.
 * @param {AbortSignal} [options.signal] - Signal for mid-flight cancellation during barge-in.
 * @param {number} [options.timeoutMs=5000] - Hard timeout threshold.
 * @param {Function} [options.fetchFn] - Custom fetch override for unit testing.
 * @returns {Promise<{
 *   ok: boolean,
 *   owner: string,
 *   repo: string,
 *   fullName?: string,
 *   description?: string,
 *   language?: string,
 *   stars?: number,
 *   forks?: number,
 *   topics?: string[],
 *   readme?: string,
 *   files?: string[],
 *   error?: string
 * }>}
 */
export async function fetchGitHubRepoDetails(owner, repo, options = {}) {
  const {
    token = process.env.GITHUB_TOKEN || '',
    signal = null,
    timeoutMs = 5000,
    fetchFn = globalThis.fetch,
  } = options;

  if (!owner || !repo) {
    return { ok: false, owner: '', repo: '', error: 'Owner and repository name are required.' };
  }

  const cleanOwner = String(owner).trim();
  const cleanRepo = String(repo)
    .trim()
    .replace(/\.git$/i, '');

  if (signal?.aborted) {
    return { ok: false, owner: cleanOwner, repo: cleanRepo, error: 'aborted' };
  }

  const internalController = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    internalController.abort();
  }, timeoutMs);

  const onAbort = () => internalController.abort();
  if (signal) signal.addEventListener('abort', onAbort, { once: true });

  const headers = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'Aurora-Voice-AI/1.0',
  };
  if (token && typeof token === 'string' && token.trim()) {
    headers.Authorization = `Bearer ${token.trim()}`;
  }

  try {
    // 1. Fetch Repository Metadata
    const repoApiUrl = `https://api.github.com/repos/${cleanOwner}/${cleanRepo}`;
    const repoRes = await fetchFn(repoApiUrl, {
      method: 'GET',
      headers,
      signal: internalController.signal,
    });

    let repoData = {};
    let isRateLimited = false;

    if (repoRes.ok) {
      repoData = await repoRes.json();
    } else if (repoRes.status === 404) {
      return {
        ok: false,
        owner: cleanOwner,
        repo: cleanRepo,
        error: `GitHub repository ${cleanOwner}/${cleanRepo} was not found (or is private).`,
      };
    } else if (repoRes.status === 403) {
      isRateLimited = true;
      repoData = {
        name: cleanRepo,
        full_name: `${cleanOwner}/${cleanRepo}`,
        description: '',
        language: '',
      };
    }

    const defaultBranch = repoData.default_branch || 'main';

    // 2. Fetch README Content
    let readmeText = '';
    try {
      if (!isRateLimited) {
        const readmeRes = await fetchFn(
          `https://api.github.com/repos/${cleanOwner}/${cleanRepo}/readme`,
          {
            method: 'GET',
            headers: {
              ...headers,
              Accept: 'application/vnd.github.raw+json',
            },
            signal: internalController.signal,
          }
        );

        if (readmeRes.ok) {
          readmeText = await readmeRes.text();
        }
      }

      // Fallback to raw.githubusercontent.com if empty or rate limited
      if (!readmeText || isRateLimited) {
        for (const branch of [defaultBranch, 'main', 'master']) {
          const rawUrl = `https://raw.githubusercontent.com/${cleanOwner}/${cleanRepo}/${branch}/README.md`;
          const rawRes = await fetchFn(rawUrl, { signal: internalController.signal });
          if (rawRes.ok) {
            readmeText = await rawRes.text();
            break;
          }
        }
      }
    } catch (_) {}

    // Trim README to high-signal excerpt (top ~3500 characters)
    const trimmedReadme =
      readmeText && readmeText.length > 3500
        ? `${readmeText.slice(0, 3500)}\n\n[...README excerpt truncated for voice context...]`
        : readmeText;

    // 3. Fetch Top-Level File Structure
    let files = [];
    if (!isRateLimited) {
      try {
        const contentsRes = await fetchFn(
          `https://api.github.com/repos/${cleanOwner}/${cleanRepo}/contents`,
          {
            method: 'GET',
            headers,
            signal: internalController.signal,
          }
        );
        if (contentsRes.ok) {
          const contents = await contentsRes.json();
          if (Array.isArray(contents)) {
            files = contents
              .map((item) => (item.type === 'dir' ? `${item.name}/` : item.name))
              .slice(0, 25);
          }
        }
      } catch (_) {}
    }

    if (!repoRes.ok && !readmeText) {
      return {
        ok: false,
        owner: cleanOwner,
        repo: cleanRepo,
        error: `Could not access GitHub repository ${cleanOwner}/${cleanRepo}. It may not exist or is private.`,
      };
    }

    return {
      ok: true,
      owner: cleanOwner,
      repo: cleanRepo,
      fullName: repoData.full_name || `${cleanOwner}/${cleanRepo}`,
      description: repoData.description || '',
      language: repoData.language || '',
      stars: repoData.stargazers_count || 0,
      forks: repoData.forks_count || 0,
      topics: Array.isArray(repoData.topics) ? repoData.topics : [],
      readme: trimmedReadme,
      files,
    };
  } catch (err) {
    if (signal?.aborted || err?.name === 'AbortError') {
      return {
        ok: false,
        owner: cleanOwner,
        repo: cleanRepo,
        error: timedOut ? 'timeout' : 'aborted',
      };
    }
    return {
      ok: false,
      owner: cleanOwner,
      repo: cleanRepo,
      error: err.message || 'Failed to retrieve GitHub repository data.',
    };
  } finally {
    clearTimeout(timeoutId);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

/**
 * Formats retrieved GitHub repository data into structured LLM context.
 *
 * @param {object} repoData - Data returned from fetchGitHubRepoDetails.
 * @returns {string} Formatted context block.
 */
export function formatGitHubContextForLLM(repoData) {
  if (!repoData || repoData.ok === false) return '';

  const repoName =
    repoData.fullName ||
    (repoData.owner && repoData.repo
      ? `${repoData.owner}/${repoData.repo}`
      : repoData.repo || 'Unknown');

  const lines = [
    '=== GITHUB REPOSITORY DATA (VERIFIED REAL-TIME RETRIEVAL) ===',
    `### GitHub Repository Context: ${repoName}`,
    `Repository: ${repoName}`,
  ];

  if (repoData.description) {
    lines.push(`Description: ${repoData.description}`);
  }
  if (repoData.language) {
    lines.push(`Language: ${repoData.language}`);
    lines.push(`Primary Language: ${repoData.language}`);
  }
  if (repoData.stars !== undefined) {
    lines.push(`Stars: ${repoData.stars} | Forks: ${repoData.forks || 0}`);
  }

  if (Array.isArray(repoData.topics) && repoData.topics.length > 0) {
    lines.push(`Topics: ${repoData.topics.join(', ')}`);
  }

  const files = repoData.files || repoData.fileTree || [];
  if (Array.isArray(files) && files.length > 0) {
    lines.push(`Repository Structure / Key Files: ${files.join(', ')}`);
  }

  if (repoData.readme) {
    lines.push('', '--- README DOCUMENTATION ---', repoData.readme);
  }

  lines.push('');
  lines.push('Instructions for repository response:');
  lines.push('- Ground your response strictly in the retrieved repository data and README above.');
  lines.push(
    '- Spoken channel: Summarize the repository purpose, primary tech stack, and key features in 1-2 clear, natural sentences.'
  );
  lines.push(
    '- Visual channel: Present the repository name, description, tech stack, and core architecture components in clean markdown.'
  );
  lines.push('- Never claim to have inspected files that are not listed in the retrieved data.');

  return lines.join('\n');
}

/**
 * Returns a natural spoken summary lead-in for GitHub repository queries.
 *
 * @param {object} repoData
 * @returns {string}
 */
export function formatSpokenGitHubSummary(repoData) {
  if (!repoData || repoData.ok === false) return '';
  const repo =
    repoData.repo || (repoData.fullName ? repoData.fullName.split('/')[1] : '') || 'the repository';
  const fullName =
    repoData.fullName ||
    (repoData.owner && repoData.repo ? `${repoData.owner}/${repoData.repo}` : repo);
  if (repoData.description) {
    return `Based on the repository, ${repo} is a ${repoData.language ? repoData.language + ' ' : ''}project: ${repoData.description}`;
  }
  return `Based on GitHub data, ${fullName} is a ${repoData.language || 'software'} project.`;
}
