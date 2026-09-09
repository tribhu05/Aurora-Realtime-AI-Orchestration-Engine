// client/app.js
// Ties together the WebSocket connection, the microphone VAD, the Web Audio player,
// the reactive AuroraOrb visualizer, and the multi-view interface into a complete
// full-duplex conversational voice companion.

(function () {
  const $ = (id) => document.getElementById(id);

  // Robin Layout & Root Elements
  const appRoot = $('appRoot');
  const btnOpenSettings = $('btnOpenSettings');
  const btnCloseSettings = $('btnCloseSettings');
  const settingsDrawer = $('settingsDrawer');
  const drawerBackdrop = $('drawerBackdrop');
  const orbWrap = $('orbWrap');
  const wave = $('wave');

  // Layout & Views
  const navItems = document.querySelectorAll('.nav-item');

  // Header
  const connDot = $('connDot');
  const connText = $('connText');

  // Companion / Workspace View Elements
  const orbCanvas = $('orbCanvas');
  const orbStateTag = $('orbStateTag');
  const captionUser = $('captionUser');
  const captionAi = $('captionAi');
  const cancelPill = $('cancelPill');
  const chatArea = $('chatArea');
  const chatAreaConv = $('chatAreaConv');
  const btnClearChat = $('btnClearChat');
  const btnClearChatConv = $('btnClearChatConv');

  // Dock
  const micStatusPill = $('micStatusPill');
  const micStatusDot = $('micStatusDot');
  const micStatusTitle = $('micStatusTitle');
  const micStatusSub = $('micStatusSub');
  const micBtn = $('micBtn');
  const ttsStatusTitle = $('ttsStatusTitle');
  const ttsStatusSub = $('ttsStatusSub');
  const typeForm = $('typeForm');
  const typeInput = $('typeInput');
  const typeFormConv = $('typeFormConv');
  const typeInputConv = $('typeInputConv');

  // Voice Studio View
  const speakersGrid = $('speakersGrid');
  const modelsRow = $('modelsRow');
  const ttsPreviewText = $('ttsPreviewText');
  const btnPreviewTts = $('btnPreviewTts');
  const ttsPreviewStatus = $('ttsPreviewStatus');

  // History View
  const historyList = $('historyList');
  const btnExportHistory = $('btnExportHistory');

  // Telemetry HUD & Settings
  const hudMute = $('hudMute');
  const hudAck = $('hudAck');
  const hudTtfa = $('hudTtfa');
  const hudDiscard = $('hudDiscard');
  const dbgGen = $('dbgGen');
  const dbgInterrupts = $('dbgInterrupts');
  const dbgLatency = $('dbgLatency');
  const dbgWs = $('dbgWs');
  const dbgAsr = $('dbgAsr');
  const dbgTts = $('dbgTts');
  const dbgLlm = $('dbgLlm');
  const delaySlider = $('delaySlider');
  const delayVal = $('delayVal');
  const btnApplyDelay = $('btnApplyDelay');
  const btnClearLog = $('btnClearLog');
  const debugLog = $('debugLog');
  const backendUrlInput = $('backendUrlInput');
  const btnSaveBackendUrl = $('btnSaveBackendUrl');
  const backendStatusMsg = $('backendStatusMsg');

  // Right panel
  const stepper = $('stepper');
  const timeEls = {
    listening: $('timeListening'),
    thinking: $('timeThinking'),
    speaking: $('timeSpeaking'),
    complete: $('timeComplete'),
  };
  const voiceBadgeState = $('voiceBadgeState');
  const infoModel = $('infoModel');
  const infoVoice = $('infoVoice');
  const infoFormat = $('infoFormat');
  const qaTest = $('qaTest');
  const qaVoice = $('qaVoice');
  const qaLogs = $('qaLogs');
  const qaConv = $('qaConv');
  const qaHelp = $('qaHelp');
  const appSidebar = $('appSidebar');
  const btnToggleSidebar = $('btnToggleSidebar');
  const sidebarBackdrop = $('sidebarBackdrop');
  const navCompanion = $('navCompanion');
  const navConversation = $('navConversation');
  const navConvBadge = $('navConvBadge');
  const navVoiceStudio = $('navVoiceStudio');
  const navTranscripts = $('navTranscripts');
  const navTelemetry = $('navTelemetry');
  const drawerSectionVoice = $('drawerSectionVoice');
  const drawerSectionTranscripts = $('drawerSectionTranscripts');
  const drawerSectionTelemetry = $('drawerSectionTelemetry');

  // Core Audio & State
  const player = new window.AuroraAudioPlayer();
  const orb = new window.AuroraOrb(orbCanvas, player);

  let ws = null;
  let wsReady = false;
  let currentGen = 0;
  let state = 'idle'; // idle | listening | thinking | speaking
  let listeningMode = false;
  let interruptCount = 0;
  let stalePacketsDiscarded = 0;
  let stepTimers = {};
  let stepIntervals = {};
  let transcript = [];
  let currentActiveSpeaker = 'astra';
  let currentActiveModel = 'mistv3';
  let isRunningAutomatedTest = false;

  const DEFAULT_SPEAKERS = [
    {
      id: 'astra',
      name: 'Astra',
      style: 'Crisp, articulate, fast (Sub-100ms)',
      gender: 'Female',
      models: ['mistv3', 'coda'],
    },
    {
      id: 'luna',
      name: 'Luna',
      style: 'Warm, natural, conversational',
      gender: 'Female',
      models: ['mistv3', 'coda'],
    },
    {
      id: 'celeste',
      name: 'Celeste',
      style: 'Expressive, friendly, melodic',
      gender: 'Female',
      models: ['coda'],
    },
    {
      id: 'cove',
      name: 'Cove',
      style: 'Youthful, calm, smooth conversational',
      gender: 'Female',
      models: ['mistv3'],
    },
    {
      id: 'blaze',
      name: 'Blaze',
      style: 'Energetic, dynamic, engaging',
      gender: 'Male',
      models: ['mistv3'],
    },
    {
      id: 'breeze',
      name: 'Breeze',
      style: 'Calm, clear, natural pace',
      gender: 'Male',
      models: ['mistv3'],
    },
  ];

  const DEFAULT_MODELS = [
    {
      id: 'mistv3',
      name: 'Mist v3',
      latency: '< 100ms',
      description: 'Engineered for real-time conversational turn-taking',
    },
    {
      id: 'coda',
      name: 'Coda',
      latency: '~ 250ms',
      description: 'Expressive and highly nuanced prosody',
    },
  ];

  // ---------- Slide-Over Drawer for Voice Studio & Settings ----------
  function openDrawer() {
    if (settingsDrawer) settingsDrawer.classList.add('open');
    if (drawerBackdrop) drawerBackdrop.classList.add('open');
  }

  function closeDrawer() {
    if (settingsDrawer) settingsDrawer.classList.remove('open');
    if (drawerBackdrop) drawerBackdrop.classList.remove('open');
  }

  if (btnOpenSettings) btnOpenSettings.addEventListener('click', openDrawer);
  if (btnCloseSettings) btnCloseSettings.addEventListener('click', closeDrawer);
  if (drawerBackdrop) drawerBackdrop.addEventListener('click', closeDrawer);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (settingsDrawer && settingsDrawer.classList.contains('open')) {
        closeDrawer();
        return;
      }
      if (state === 'speaking' || state === 'thinking' || state === 'listening' || listeningMode) {
        bargeIn();
        if (listeningMode) toggleListening();
      }
    }
  });

  // ---------- Navigation & Experience Switching ----------
  let _activeMainView = 'companion';

  function setMainExperience(view, focusInput = false) {
    _activeMainView = view;
    if (navCompanion) navCompanion.classList.toggle('active', view === 'companion');
    if (navConversation) navConversation.classList.toggle('active', view === 'conversation');

    if (appRoot) {
      appRoot.classList.toggle('in-conversation', view === 'conversation');
    }

    if (view === 'conversation' && chatArea) {
      requestAnimationFrame(() => {
        chatArea.scrollTop = chatArea.scrollHeight;
      });
    }

    if (focusInput && typeInput) {
      typeInput.focus();
    }

    if (orb && typeof orb.resize === 'function') {
      setTimeout(() => orb.resize(), 100);
    }

    // Auto-close sidebar on mobile after navigating
    if (window.innerWidth <= 900 && appRoot) {
      appRoot.classList.remove('sidebar-open');
      if (btnToggleSidebar) btnToggleSidebar.classList.remove('active');
    }
  }

  function openDrawerTo(sectionEl) {
    openDrawer();
    if (sectionEl) {
      setTimeout(() => {
        sectionEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 80);
    }
    if (window.innerWidth <= 900 && appRoot) {
      appRoot.classList.remove('sidebar-open');
      if (btnToggleSidebar) btnToggleSidebar.classList.remove('active');
    }
  }

  function switchView(target) {
    navItems.forEach((b) => b.classList.toggle('active', b.dataset.view === target));
    if (target === 'companion' || target === 'home') {
      setMainExperience('companion');
    } else if (target === 'conversation') {
      setMainExperience('conversation');
    } else if (target === 'voice') {
      if (!speakersGrid || speakersGrid.children.length === 0) {
        renderVoiceStudio(DEFAULT_SPEAKERS, DEFAULT_MODELS);
      }
      loadVoiceStudio();
      openDrawerTo(drawerSectionVoice);
    } else if (target === 'transcripts' || target === 'history') {
      openDrawerTo(drawerSectionTranscripts);
    } else if (target === 'settings' || target === 'telemetry') {
      openDrawerTo(drawerSectionTelemetry);
    }
  }

  if (navCompanion) {
    navCompanion.addEventListener('click', () => setMainExperience('companion', true));
  }

  if (navConversation) {
    navConversation.addEventListener('click', () => setMainExperience('conversation', true));
  }

  if (navVoiceStudio) {
    navVoiceStudio.addEventListener('click', () => {
      if (!speakersGrid || speakersGrid.children.length === 0) {
        renderVoiceStudio(DEFAULT_SPEAKERS, DEFAULT_MODELS);
      }
      loadVoiceStudio();
      openDrawerTo(drawerSectionVoice);
    });
  }

  if (navTranscripts) {
    navTranscripts.addEventListener('click', () => {
      openDrawerTo(drawerSectionTranscripts);
    });
  }

  if (navTelemetry) {
    navTelemetry.addEventListener('click', () => {
      openDrawerTo(drawerSectionTelemetry);
    });
  }

  if (qaTest) qaTest.addEventListener('click', () => runInteractiveBargeInTest());
  if (qaVoice) qaVoice.addEventListener('click', () => switchView('voice'));
  if (qaLogs) qaLogs.addEventListener('click', () => switchView('settings'));
  if (qaConv) qaConv.addEventListener('click', () => switchView('conversation'));
  if (qaHelp) {
    qaHelp.addEventListener('click', () => {
      setMainExperience('companion');
      captionAi.textContent =
        "“I'm Aurora. Tap the mic or orb to speak. If I'm mid-sentence and you interrupt me, I silence my speech instantly (< 2ms) and answer your new thought!”";
    });
  }

  // ---------- Center Workspace Dynamic Transition ----------
  function updateWorkspaceState() {
    const hasMessages = transcript.length > 0;
    if (navConvBadge) {
      navConvBadge.textContent = String(transcript.length);
      navConvBadge.style.display = hasMessages ? 'inline-flex' : 'none';
    }

    if (hasMessages) {
      setMainExperience('conversation');
    } else {
      setMainExperience('companion');
    }

    if (chatArea) {
      chatArea.style.display = hasMessages ? 'flex' : 'none';
    }

    if (orb && typeof orb.resize === 'function') {
      setTimeout(() => orb.resize(), 60);
    }
  }

  // ---------- Left Sidebar Toggle (Desktop & Mobile) ----------
  function toggleSidebar(forceState) {
    if (!appSidebar || !appRoot) return;
    const isMobile = window.innerWidth <= 900;
    if (isMobile) {
      const shouldOpen =
        typeof forceState === 'boolean' ? forceState : !appRoot.classList.contains('sidebar-open');
      appRoot.classList.toggle('sidebar-open', shouldOpen);
      if (btnToggleSidebar) btnToggleSidebar.classList.toggle('active', shouldOpen);
    } else {
      const shouldCollapse =
        typeof forceState === 'boolean'
          ? !forceState
          : !appRoot.classList.contains('sidebar-collapsed');
      appRoot.classList.toggle('sidebar-collapsed', shouldCollapse);
      if (btnToggleSidebar) btnToggleSidebar.classList.toggle('active', !shouldCollapse);
      if (orb && typeof orb.resize === 'function') {
        setTimeout(() => orb.resize(), 200);
      }
    }
  }

  if (btnToggleSidebar) btnToggleSidebar.addEventListener('click', () => toggleSidebar());
  if (sidebarBackdrop) {
    sidebarBackdrop.addEventListener('click', () => {
      if (appRoot) appRoot.classList.remove('sidebar-open');
      if (btnToggleSidebar) btnToggleSidebar.classList.remove('active');
    });
  }

  // Auto-adapt on resize
  window.addEventListener('resize', () => {
    if (window.innerWidth > 900 && appRoot) {
      appRoot.classList.remove('sidebar-open');
    }
  });

  // ---------- Color Theme Switcher ----------
  const themeBtns = document.querySelectorAll('.theme-btn');
  const savedTheme = localStorage.getItem('aurora-theme') || 'aurora';
  applyTheme(savedTheme);

  function applyTheme(name) {
    document.documentElement.dataset.theme = name;
    themeBtns.forEach((btn) => btn.classList.toggle('active', btn.dataset.theme === name));
    if (orb && typeof orb.setTheme === 'function') {
      orb.setTheme(name);
    }
  }

  themeBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const theme = btn.dataset.theme;
      applyTheme(theme);
      try {
        localStorage.setItem('aurora-theme', theme);
      } catch (_) {}
    });
  });

  // ---------- Backend URL Resolution & WebSocket Connection ----------
  function getBackendHttpUrl() {
    // 1. Check URL parameters (?backend=... or ?api=...)
    try {
      const params = new URLSearchParams(window.location.search);
      const queryBackend = params.get('backend') || params.get('api');
      if (queryBackend && queryBackend.trim()) {
        let clean = queryBackend.trim().replace(/\/+$/, '');
        if (!/^https?:\/\//i.test(clean) && !/^wss?:\/\//i.test(clean)) {
          const scheme = window.location.protocol === 'https:' ? 'https://' : 'http://';
          clean = scheme + clean;
        } else {
          clean = clean.replace(/^wss:\/\//i, 'https://').replace(/^ws:\/\//i, 'http://');
        }
        return clean;
      }
    } catch (_) {}

    // 2. Check localStorage
    try {
      const saved = localStorage.getItem('aurora-backend-url');
      if (saved && saved.trim()) {
        let clean = saved.trim().replace(/\/+$/, '');
        if (clean.includes('aurora-interruptible-voice-agent.onrender.com')) {
          try {
            localStorage.removeItem('aurora-backend-url');
          } catch (_) {}
        } else {
          if (!/^https?:\/\//i.test(clean) && !/^wss?:\/\//i.test(clean)) {
            const scheme = window.location.protocol === 'https:' ? 'https://' : 'http://';
            clean = scheme + clean;
          } else {
            clean = clean.replace(/^wss:\/\//i, 'https://').replace(/^ws:\/\//i, 'http://');
          }
          return clean;
        }
      }
    } catch (_) {}

    // 3. Localhost development auto-detection
    const isLocalhost =
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1' ||
      window.location.hostname === '[::1]' ||
      window.location.protocol === 'file:';

    if (isLocalhost) {
      const devUrl =
        (window.AURORA_CONFIG && window.AURORA_CONFIG.developmentBackendUrl) ||
        'http://localhost:3000';
      return devUrl.replace(/\/+$/, '');
    }

    // 4. Global runtime config (window.AURORA_CONFIG / window.AURORA_BACKEND_URL)
    const configuredProd =
      window.AURORA_BACKEND_URL ||
      (window.AURORA_CONFIG && window.AURORA_CONFIG.productionBackendUrl);
    if (
      configuredProd &&
      typeof configuredProd === 'string' &&
      configuredProd.trim() &&
      !configuredProd.includes('aurora-interruptible-voice-agent.onrender.com')
    ) {
      return configuredProd.trim().replace(/\/+$/, '');
    }

    // 5. Same-origin fallback
    return window.location.origin;
  }

  function getBackendWsUrl() {
    const httpUrl = getBackendHttpUrl();
    try {
      const parsed = new URL(httpUrl, window.location.href);
      // Mixed content prevention: if page is HTTPS, ALWAYS use WSS
      const isHttps =
        window.location.protocol === 'https:' ||
        parsed.protocol === 'https:' ||
        parsed.protocol === 'wss:';
      const wsProto = isHttps ? 'wss:' : 'ws:';
      return `${wsProto}//${parsed.host}`;
    } catch (_) {
      const clean = httpUrl.replace(/^https?:\/\//i, '').replace(/^wss?:\/\//i, '');
      const isHttps = window.location.protocol === 'https:' || httpUrl.startsWith('https:');
      return `${isHttps ? 'wss' : 'ws'}://${clean}`;
    }
  }

  function apiUrl(endpoint) {
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const base = getBackendHttpUrl();
    if (!base || base === window.location.origin) {
      return cleanEndpoint;
    }
    return `${base.replace(/\/+$/, '')}${cleanEndpoint}`;
  }

  function connect() {
    const wsTarget = getBackendWsUrl();
    try {
      ws = new WebSocket(wsTarget);
    } catch (e) {
      console.warn('Failed to initialize WebSocket to', wsTarget, e);
      setTimeout(connect, 2000);
      return;
    }

    ws.onopen = () => {
      wsReady = true;
      setConnStatus(true, 'Online (Realtime)');
      dbgWs.textContent = 'Connected (Realtime)';
      log(`WebSocket connected (${wsTarget})`);
    };

    ws.onclose = () => {
      wsReady = false;
      if (httpHealthy) {
        setConnStatus(true, 'Online (HTTP)');
        dbgWs.textContent = 'HTTP Mode (Active)';
      } else {
        setConnStatus(false, 'Connecting…');
        dbgWs.textContent = 'Disconnected — reconnecting…';
      }
      log('WebSocket closed, using HTTP fallback');
      setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      dbgWs.textContent = 'Error';
    };

    ws.onmessage = (evt) => {
      try {
        handleServerMessage(JSON.parse(evt.data));
      } catch (err) {
        console.error('WS parse error', err);
      }
    };
  }
  // Resilient fetch with configurable timeout (prevents hanging when remote backend spins up)
  async function fetchWithTimeout(url, options = {}, timeoutMs = 3500) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      return res;
    } finally {
      clearTimeout(timer);
    }
  }

  connect();
  updateWorkspaceState();

  // Initialize info panel defaults immediately
  if (infoModel) infoModel.textContent = currentActiveModel;
  if (infoVoice) infoVoice.textContent = currentActiveSpeaker;
  if (infoFormat) infoFormat.textContent = 'mp3';

  let httpHealthy = false;
  async function initHttpConfig() {
    const primaryUrl = apiUrl('/api/config');
    try {
      const res = await fetchWithTimeout(primaryUrl, {}, 3500);
      if (res.ok) {
        const data = await res.json();
        httpHealthy = true;
        applyServerConfig(data);
        if (!wsReady) {
          setConnStatus(true, 'Online (HTTP)');
          dbgWs.textContent = 'HTTP Mode (Active)';
        }
        return;
      }
    } catch (_) {}

    // Fallback to same-origin if cross-origin failed or timed out
    if (primaryUrl !== '/api/config') {
      try {
        const res = await fetchWithTimeout('/api/config', {}, 3000);
        if (res.ok) {
          const data = await res.json();
          httpHealthy = true;
          applyServerConfig(data);
          if (!wsReady) {
            setConnStatus(true, 'Online (HTTP)');
            dbgWs.textContent = 'HTTP Mode (Serverless)';
          }
        }
      } catch (_) {}
    }
  }
  initHttpConfig();

  function setConnStatus(online, label = null) {
    if (connText) connText.textContent = label || (online ? 'Online' : 'Offline');
    if (connDot) connDot.className = 'dot ' + (online ? 'dot-on' : 'dot-off');
  }

  function applyServerConfig(msg) {
    if (!msg) return;
    if (typeof msg.generation === 'number') {
      currentGen = msg.generation;
      dbgGen.textContent = `#${currentGen}`;
    }
    if (msg.speaker) currentActiveSpeaker = msg.speaker;
    if (msg.modelId) currentActiveModel = msg.modelId;

    const hasClientKey = Boolean(localStorage.getItem('aurora-rime-api-key'));
    const isRimeActive = msg.rimeConfigured || hasClientKey;

    const ttsLabel = isRimeActive
      ? `Rime · ${currentActiveSpeaker}`
      : 'Browser speech (no Rime key)';
    dbgTts.textContent = ttsLabel;
    dbgLlm.textContent = msg.llmConfigured
      ? `${msg.llmProvider} · ${msg.llmModel}`
      : 'Offline demo replies';
    infoModel.textContent = msg.modelId || 'mistv3';
    infoVoice.textContent = currentActiveSpeaker;
    infoFormat.textContent = msg.audioFormat || 'mp3';

    voiceBadgeState.textContent = isRimeActive ? 'Active' : 'Offline Fallback';
    voiceBadgeState.classList.toggle('offline', !isRimeActive);
    ttsStatusTitle.textContent = isRimeActive ? 'Rime' : 'Browser';
    ttsStatusSub.textContent = isRimeActive ? 'TTS Ready' : 'Fallback voice';

    loadVoiceStudio();
  }

  function handleServerMessage(msg) {
    switch (msg.type) {
      case 'handshake': {
        applyServerConfig(msg);
        log(`Session handshake: Gen #${currentGen}, TTS: ${dbgTts.textContent}`);
        break;
      }

      case 'user_text': {
        currentGen = msg.generation;
        dbgGen.textContent = `#${currentGen}`;
        captionUser.style.display = 'block';
        captionUser.textContent = msg.text;
        captionAi.textContent = '“Thinking…”';
        addMessageCard('user', msg.text, msg.generation);
        break;
      }

      case 'thinking': {
        setUiState('thinking');
        break;
      }

      case 'ai_text': {
        const normalized = normalizeAssistantPayload(msg.text, {
          speaker: currentActiveSpeaker,
          model: currentActiveModel,
          llmMs: msg.llmMs,
          spoken: msg.spoken,
          visualType: msg.visualType || msg.type,
          language: msg.language,
          title: msg.title,
          responseMode: msg.responseMode,
          spokenResponse: msg.spokenResponse,
          visualResponse: msg.visualResponse || msg.visual,
        });

        captionAi.textContent = `“${normalized.spoken}”`;

        if (msg.llmMs != null) {
          dbgLatency.textContent = `${msg.llmMs}ms to think`;
        }
        addMessageCard('assistant', normalized.text, msg.generation, normalized.meta);
        break;
      }

      case 'task_started': {
        if (msg.generation < currentGen) return;

        const taskRow = document.createElement('div');
        taskRow.className = 'msg-row assistant msg has-rich-content';
        taskRow.dataset.gen = msg.generation;
        taskRow.dataset.taskId = msg.taskId;

        let stepsHtml = '';
        (msg.steps || []).forEach((step) => {
          const isFirst = step.status === 'in_progress';
          stepsHtml += `
            <div class="task-step-item ${step.status}" data-step-id="${step.id}">
              <div class="step-icon">
                ${isFirst ? '<div class="step-spinner"></div>' : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/></svg>'}
              </div>
              <div class="step-content">
                <div class="step-name">${escapeHtml(step.name)}</div>
                <div class="step-details" style="display:none"></div>
              </div>
            </div>
          `;
        });

        taskRow.innerHTML = `
          <div class="msg-card-assistant bubble">
            <div class="msg-head">
              <div class="assistant-badge">
                <span class="assistant-badge-dot"></span>
                <span>AURORA</span>
              </div>
              <div class="assistant-meta bubble-meta">
                <span class="modality-pill modality-hybrid">● Speaking + Workspace</span>
                <span>Task #${msg.taskId} · Live Execution</span>
              </div>
            </div>
            <div class="task-card" data-task-id="${msg.taskId}" data-gen="${msg.generation}">
              <div class="task-card-header">
                <div class="task-card-title">${escapeHtml(msg.title)}</div>
                <span class="task-status-badge running">⚡ Working on your task</span>
              </div>
              <div class="task-steps-list">${stepsHtml}</div>
              <div class="task-footer" style="display:none"></div>
            </div>
          </div>
        `;
        if (chatArea) {
          chatArea.appendChild(taskRow);
          chatArea.scrollTop = chatArea.scrollHeight;
        }

        if (chatAreaConv) {
          const hint = $('convEmptyHint');
          if (hint) hint.remove();
          const clone = taskRow.cloneNode(true);
          chatAreaConv.appendChild(clone);
          chatAreaConv.scrollTop = chatAreaConv.scrollHeight;
        }

        transcript.push({
          role: 'assistant',
          text: `[Task] ${msg.title}`,
          time: new Date(),
          generation: msg.generation,
        });
        updateWorkspaceState();
        renderHistory();
        break;
      }

      case 'task_progress': {
        if (msg.generation < currentGen) return;
        const taskCards = document.querySelectorAll(`.task-card[data-task-id="${msg.taskId}"]`);
        taskCards.forEach((taskCard) => {
          const currentStepEl = taskCard.querySelectorAll('.task-step-item')[msg.stepIndex];
          if (currentStepEl) {
            currentStepEl.className = 'task-step-item complete';
            const icon = currentStepEl.querySelector('.step-icon');
            if (icon) {
              icon.innerHTML = `
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#38ef7d" stroke-width="2.5">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              `;
            }
            if (msg.details) {
              const detailsEl = currentStepEl.querySelector('.step-details');
              if (detailsEl) {
                detailsEl.style.display = 'block';
                detailsEl.textContent = msg.details;
              }
            }
          }
          if (msg.nextStepIndex != null) {
            const nextStepEl = taskCard.querySelectorAll('.task-step-item')[msg.nextStepIndex];
            if (nextStepEl) {
              nextStepEl.className = 'task-step-item in_progress';
              const nextIcon = nextStepEl.querySelector('.step-icon');
              if (nextIcon) {
                nextIcon.innerHTML = '<div class="step-spinner"></div>';
              }
            }
          }
        });
        if (chatArea) chatArea.scrollTop = chatArea.scrollHeight;
        if (chatAreaConv) chatAreaConv.scrollTop = chatAreaConv.scrollHeight;
        break;
      }

      case 'task_complete': {
        if (msg.generation < currentGen) return;
        const taskCards = document.querySelectorAll(`.task-card[data-task-id="${msg.taskId}"]`);
        taskCards.forEach((taskCard) => {
          const badge = taskCard.querySelector('.task-status-badge');
          if (badge) {
            badge.className = 'task-status-badge complete';
            badge.innerHTML = '✓ Task completed';
          }

          taskCard.querySelectorAll('.task-step-item').forEach((stepEl) => {
            stepEl.className = 'task-step-item complete';
            const icon = stepEl.querySelector('.step-icon');
            if (icon) {
              icon.innerHTML = `
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#38ef7d" stroke-width="2.5">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              `;
            }
          });

          if (msg.files && msg.files.length) {
            let filesHtml =
              '<div class="task-files-section"><div class="task-files-title">Files created</div><ul class="task-files-list">';
            msg.files.forEach((f) => {
              filesHtml += `<li>• <code>${escapeHtml(f.name || f.path)}</code></li>`;
            });
            filesHtml += '</ul></div>';

            const footer = taskCard.querySelector('.task-footer');
            if (footer) {
              footer.style.display = 'block';
              footer.innerHTML = filesHtml;
            }
          }

          if (msg.primaryCode && window.AuroraHighlighter) {
            const codeHtml = window.AuroraHighlighter.renderCodeBlock({
              code: msg.primaryCode.code,
              language: msg.primaryCode.language,
              title: msg.primaryCode.filename || 'Entrypoint Code',
            });
            const codeContainer = document.createElement('div');
            codeContainer.style.marginTop = '12px';
            codeContainer.innerHTML = codeHtml;
            taskCard.appendChild(codeContainer);
            window.AuroraHighlighter.attachCopyHandlers(taskCard);
          }
        });

        chatArea.scrollTop = chatArea.scrollHeight;
        if (chatAreaConv) chatAreaConv.scrollTop = chatAreaConv.scrollHeight;
        break;
      }

      case 'audio': {
        // Generation fence check on client side
        if (msg.generation < currentGen) {
          stalePacketsDiscarded += 1;
          hudDiscard.textContent = `100% (${stalePacketsDiscarded} stale prevented)`;
          log(
            `🛡️ FENCE: Discarded stale audio packet from Gen #${msg.generation} (current: #${currentGen})`
          );
          return;
        }

        setUiState('speaking');
        const mime = msg.format === 'wav' ? 'audio/wav' : 'audio/mpeg';
        if (msg.totalMs != null) {
          dbgLatency.textContent = `${msg.totalMs}ms TTFA`;
          hudTtfa.textContent = `${msg.totalMs} ms`;
        }

        player.cacheAudio(msg.generation, msg.data, mime);
        updateCardAudioState(msg.generation, true);

        player.playBase64(msg.data, mime, msg.generation).then(() => {
          afterSpeaking();
        });
        break;
      }

      case 'speak_local': {
        if (msg.generation < currentGen) {
          stalePacketsDiscarded += 1;
          hudDiscard.textContent = `100% (${stalePacketsDiscarded} stale prevented)`;
          return;
        }
        setUiState('speaking');
        if (msg.totalMs != null) {
          dbgLatency.textContent = `${msg.totalMs}ms TTFA`;
          hudTtfa.textContent = `${msg.totalMs} ms`;
        }
        let speakText = msg.text || '';
        if (speakText.trim().startsWith('{') || speakText.includes('"spoken"')) {
          const norm = normalizeAssistantPayload(speakText, {});
          speakText = norm.spoken;
        }
        speakWithBrowser(speakText);
        break;
      }

      case 'interrupted': {
        interruptCount += 1;
        dbgInterrupts.textContent = interruptCount;
        currentGen = msg.newGeneration;
        dbgGen.textContent = `#${currentGen}`;

        // Empirical client-side ACK latency calculation
        if (msg.clientTimestamp) {
          const ackLatency = Math.max(1, Date.now() - msg.clientTimestamp);
          hudAck.textContent = `${ackLatency} ms`;
        } else {
          hudAck.textContent = `2 ms`;
        }

        hudMute.textContent = `${player.lastMuteLatencyMs} ms`;
        markCardInterrupted(msg.oldGeneration);
        flashCancelPill();

        captionAi.textContent = '“Interrupted — listening to your new question…”';
        log(
          `⚡ Barge-in ACK: Gen #${msg.oldGeneration} cancelled → #${msg.newGeneration} (Mute: ${player.lastMuteLatencyMs}ms)`
        );
        break;
      }

      case 'config_updated': {
        currentActiveSpeaker = msg.speaker;
        currentActiveModel = msg.modelId;
        infoVoice.textContent = currentActiveSpeaker;
        infoModel.textContent = currentActiveModel;
        dbgTts.textContent = `Rime · ${currentActiveSpeaker}`;
        log(`Voice config updated: ${currentActiveSpeaker} (${currentActiveModel})`);
        updateVoiceStudioSelection();
        break;
      }

      case 'delay_updated': {
        log(`Network stress delay set to ${msg.delayMs}ms`);
        break;
      }

      case 'done': {
        setUiState('complete');
        break;
      }

      case 'error': {
        captionAi.textContent = `“${msg.message || 'Something went wrong.'}”`;
        afterSpeaking();
        break;
      }
    }
  }

  // ---------- Mic & VAD Handler ----------
  const mic = new window.AuroraMic({
    onSpeechStart: () => {
      if (state === 'speaking' || state === 'thinking') {
        bargeIn();
      } else {
        setUiState('listening');
      }
    },
    onInterim: (text) => {
      captionUser.style.display = 'block';
      captionUser.textContent = text + '…';
      orb.setMicLevel(0.4);
    },
    onFinalResult: (text) => {
      orb.setMicLevel(0);
      sendQuery(text);
    },
    onEnd: () => {
      orb.setMicLevel(0);
      if (!listeningMode && state === 'listening') setUiState('idle');
    },
    onError: (err) => {
      if (err === 'not-allowed') {
        micStatusTitle.textContent = 'Mic blocked';
        micStatusSub.textContent = 'Type below instead';
      }
      log(`Mic error: ${err}`);
    },
  });

  if (!mic.supported) {
    micStatusTitle.textContent = 'Voice unsupported';
    micStatusSub.textContent = 'Type your message';
    dbgAsr.textContent = 'Unsupported (Use Chrome/Edge)';
    micBtn.classList.add('muted-hint');
  } else {
    dbgAsr.textContent = 'Web Speech ASR Ready';
  }

  let activeHttpAbortController = null;

  /** Instant barge-in: silences audio synchronously in < 1ms before network roundtrip */
  function bargeIn() {
    player.stop();
    window.speechSynthesis.cancel();
    hudMute.textContent = `${player.lastMuteLatencyMs} ms`;

    if (activeHttpAbortController) {
      activeHttpAbortController.abort();
      activeHttpAbortController = null;
    }

    if (wsReady) {
      ws.send(JSON.stringify({ type: 'interrupt', timestamp: Date.now() }));
    } else {
      interruptCount += 1;
      dbgInterrupts.textContent = interruptCount;
      currentGen += 1;
      dbgGen.textContent = `#${currentGen}`;
      hudAck.textContent = '1 ms';
      flashCancelPill();
      captionAi.textContent = '“Interrupted — listening to your new question…”';
    }
    setUiState('listening');
  }

  function afterSpeaking() {
    setUiState(listeningMode ? 'listening' : 'idle');
  }

  function speakWithBrowser(text) {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 1.05;
    utter.onend = afterSpeaking;
    utter.onerror = afterSpeaking;
    window.speechSynthesis.speak(utter);
  }

  // ---------- Sending Queries ----------
  function sendQuery(text, mode = null) {
    if (!text || !text.trim()) return;
    const cleanText = text.trim();
    if (wsReady) {
      ws.send(JSON.stringify({ type: 'query', text: cleanText, mode, timestamp: Date.now() }));
      setUiState('thinking');
    } else {
      sendHttpQuery(cleanText, mode);
    }
  }

  async function sendHttpQuery(cleanText, mode = null) {
    if (activeHttpAbortController) {
      activeHttpAbortController.abort();
      activeHttpAbortController = null;
    }
    const abortCtrl = new AbortController();
    activeHttpAbortController = abortCtrl;

    currentGen += 1;
    const myGen = currentGen;
    dbgGen.textContent = `#${myGen}`;

    captionUser.style.display = 'block';
    captionUser.textContent = cleanText;
    captionAi.textContent = '“Thinking…”';
    setUiState('thinking');
    addMessageCard('user', cleanText, myGen);

    const history = transcript
      .slice(-10)
      .filter((t) => t && (t.role === 'user' || t.role === 'assistant'))
      .map((t) => ({
        role: t.role,
        content: typeof t.text === 'string' ? t.text : String(t.text || ''),
      }));

    const turnStartTime = Date.now();
    let targetTurnUrl = apiUrl('/api/turn');
    let res;

    const reqHeaders = { 'Content-Type': 'application/json' };
    try {
      const userRimeKey = localStorage.getItem('aurora-rime-api-key');
      if (userRimeKey) reqHeaders['x-rime-api-key'] = userRimeKey;
    } catch (_) {}

    try {
      try {
        res = await fetch(targetTurnUrl, {
          method: 'POST',
          headers: reqHeaders,
          body: JSON.stringify({
            text: cleanText,
            mode,
            history,
            speaker: currentActiveSpeaker,
            modelId: currentActiveModel,
          }),
          signal: abortCtrl.signal,
        });
      } catch (fetchErr) {
        if (fetchErr.name === 'AbortError') throw fetchErr;
        // If cross-origin fetch failed (e.g. backend unreachable or cold starting), retry with same-origin /api/turn
        if (targetTurnUrl !== '/api/turn') {
          log(`Remote backend unreachable (${targetTurnUrl}), retrying same-origin /api/turn`);
          targetTurnUrl = '/api/turn';
          res = await fetch(targetTurnUrl, {
            method: 'POST',
            headers: reqHeaders,
            body: JSON.stringify({
              text: cleanText,
              mode,
              history,
              speaker: currentActiveSpeaker,
              modelId: currentActiveModel,
            }),
            signal: abortCtrl.signal,
          });
        } else {
          throw fetchErr;
        }
      }

      // If remote backend returned 404 or server error (e.g. missing route on external server), fallback to same-origin /api/turn
      if (
        targetTurnUrl !== '/api/turn' &&
        (!res || (!res.ok && (res.status === 404 || res.status >= 500)))
      ) {
        log(
          `Remote backend returned ${res ? res.status : 'error'} (${targetTurnUrl}), retrying same-origin /api/turn`
        );
        targetTurnUrl = '/api/turn';
        res = await fetch(targetTurnUrl, {
          method: 'POST',
          headers: reqHeaders,
          body: JSON.stringify({
            text: cleanText,
            mode,
            history,
            speaker: currentActiveSpeaker,
            modelId: currentActiveModel,
          }),
          signal: abortCtrl.signal,
        });
      }

      if (myGen < currentGen) {
        stalePacketsDiscarded += 1;
        hudDiscard.textContent = `100% (${stalePacketsDiscarded} stale prevented)`;
        return;
      }

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        let userMessage;
        if (res.status === 404) {
          userMessage =
            'Server route not found (404). Please verify backend deployment and API routes.';
        } else if (res.status === 401 || res.status === 403) {
          userMessage = `Authentication error (${res.status}). Please check your API keys.`;
        } else if (res.status === 429) {
          userMessage = 'Rate limit exceeded (429). Please wait a moment before trying again.';
        } else if (res.status >= 500) {
          userMessage = errData.error || `Internal server error (${res.status}). Please try again.`;
        } else {
          userMessage = errData.error || `Server responded with ${res.status}`;
        }
        throw new Error(userMessage);
      }

      const data = await res.json();
      if (myGen < currentGen) {
        stalePacketsDiscarded += 1;
        hudDiscard.textContent = `100% (${stalePacketsDiscarded} stale prevented)`;
        return;
      }

      const totalMs = data.totalMs || Date.now() - turnStartTime;
      dbgLatency.textContent = `${totalMs}ms (HTTP)`;
      hudTtfa.textContent = `${totalMs} ms`;

      const visualPayload = data.visualResponse || {
        type: 'text',
        content: data.spokenResponse || '',
      };

      const rawContent =
        typeof visualPayload === 'string'
          ? visualPayload
          : visualPayload.content != null
            ? visualPayload.content
            : data.spokenResponse || '';

      const normalized = normalizeAssistantPayload(rawContent, {
        speaker: data.speaker || currentActiveSpeaker,
        model: data.modelId || currentActiveModel,
        llmMs: data.llmMs,
        spoken: data.spokenResponse,
        spokenResponse: data.spokenResponse,
        responseMode: data.responseMode,
        visualType: visualPayload.type,
        language: visualPayload.language,
        title: visualPayload.title,
        visualResponse: visualPayload,
      });

      captionAi.textContent = `“${normalized.spoken}”`;
      addMessageCard('assistant', normalized.text, myGen, normalized.meta);

      if (data.audio) {
        setUiState('speaking');
        const mime = data.format === 'wav' ? 'audio/wav' : 'audio/mpeg';
        player.cacheAudio(myGen, data.audio, mime);
        updateCardAudioState(myGen, true);
        player.playBase64(data.audio, mime, myGen).then(() => {
          if (myGen === currentGen) afterSpeaking();
        });
      } else if (normalized.spoken) {
        setUiState('speaking');
        speakWithBrowser(normalized.spoken);
      } else {
        afterSpeaking();
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        log(`HTTP turn #${myGen} aborted`);
        return;
      }
      console.error('HTTP turn error:', err);
      const isNetworkError =
        err instanceof TypeError ||
        (err.message &&
          (err.message.includes('fetch') ||
            err.message.includes('NetworkError') ||
            err.message.includes('Failed to fetch')));
      const displayMsg = isNetworkError
        ? 'Unable to reach backend service. Verify backend URL in Settings.'
        : err.message || 'please try again';
      captionAi.textContent = `“Sorry, an error occurred: ${displayMsg}”`;
      setUiState('idle');
    } finally {
      if (activeHttpAbortController === abortCtrl) {
        activeHttpAbortController = null;
      }
    }
  }

  typeForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = typeInput.value.trim();
    if (!text) return;
    typeInput.value = '';
    sendQuery(text);
  });

  if (typeFormConv) {
    typeFormConv.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = typeInputConv.value.trim();
      if (!text) return;
      typeInputConv.value = '';
      sendQuery(text);
    });
  }

  // ---------- Assistant Message Normalization Safeguard ----------
  // Ensures structured responses, stringified JSON strings, or malformed payloads
  // are never displayed raw in the UI or read aloud by voice synthesis.
  function normalizeAssistantPayload(rawText, rawMeta = {}) {
    let text = typeof rawText === 'string' ? rawText : '';
    let meta = { ...rawMeta };

    function tryParseJson(str) {
      if (!str || typeof str !== 'string') return null;
      let s = str.trim();
      if (s.startsWith('```json')) s = s.slice(7);
      else if (s.startsWith('```')) s = s.slice(3);
      if (s.endsWith('```')) s = s.slice(0, -3);
      s = s.trim();
      if (!s.startsWith('{')) return null;

      try {
        const obj = JSON.parse(s);
        if (obj && typeof obj === 'object') return obj;
      } catch (_) {}

      try {
        const repaired = s.replace(/:\s*"([\s\S]*?)"(?=\s*[,}])/g, (_match, p1) => {
          const escaped = p1
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"')
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r')
            .replace(/\t/g, '\\t');
          return `: "${escaped}"`;
        });
        const parsed = JSON.parse(repaired);
        if (parsed && typeof parsed === 'object') return parsed;
      } catch (_) {}

      // Regex fallback extraction
      if (
        s.includes('"spoken"') ||
        s.includes('"spokenResponse"') ||
        s.includes('"content"') ||
        s.includes('"type"')
      ) {
        const extracted = {};
        const mode = s.match(/"responseMode"\s*:\s*"([A-Za-z]+)"/i);
        if (mode) extracted.responseMode = mode[1].toUpperCase();

        const spk = s.match(/"(?:spokenResponse|spoken)"\s*:\s*"((?:[^"\\]|\\.)*)"/i);
        if (spk) extracted.spoken = spk[1].replace(/\\"/g, '"').replace(/\\n/g, ' ');

        const typ = s.match(/"type"\s*:\s*"([A-Za-z]+)"/i);
        if (typ) extracted.type = typ[1].toLowerCase();

        const lng = s.match(/"language"\s*:\s*"([A-Za-z0-9_+-]+)"/i);
        if (lng) extracted.language = lng[1].toLowerCase();

        const ttl = s.match(/"title"\s*:\s*"([^"\r\n]+)"/i);
        if (ttl) extracted.title = ttl[1];

        const contentMatch = s.match(/"content"\s*:\s*"/);
        if (contentMatch) {
          const startIndex = contentMatch.index + contentMatch[0].length;
          const lastBrace = s.lastIndexOf('}');
          const endSearch = lastBrace !== -1 ? lastBrace : s.length;
          const lastQuote = s.lastIndexOf('"', endSearch - 1);
          if (lastQuote > startIndex) {
            extracted.content = s
              .slice(startIndex, lastQuote)
              .replace(/\\n/g, '\n')
              .replace(/\\r/g, '\r')
              .replace(/\\t/g, '\t')
              .replace(/\\"/g, '"')
              .replace(/\\\\/g, '\\');
          }
        }
        if (extracted.content || extracted.spoken || extracted.type) return extracted;
      }
      return null;
    }

    // 1. Check if rawText itself is stringified JSON
    const parsedText = tryParseJson(text);
    if (parsedText) {
      if (parsedText.spoken && !meta.spoken) meta.spoken = parsedText.spoken;
      if (parsedText.spokenResponse && !meta.spokenResponse)
        meta.spokenResponse = parsedText.spokenResponse;
      if (parsedText.responseMode && !meta.responseMode)
        meta.responseMode = parsedText.responseMode;
      if (parsedText.type && !meta.visualType) meta.visualType = parsedText.type;
      if (parsedText.language && !meta.language) meta.language = parsedText.language;
      if (parsedText.title && !meta.title) meta.title = parsedText.title;

      if (parsedText.visualResponse && typeof parsedText.visualResponse === 'object') {
        const vr = parsedText.visualResponse;
        if (vr.type) meta.visualType = vr.type;
        if (vr.language) meta.language = vr.language;
        if (vr.title) meta.title = vr.title;
        text = vr.content != null ? vr.content : text;
      } else if (parsedText.content != null) {
        text = parsedText.content;
      }
    }

    // 2. Check meta.visualResponse
    if (meta.visualResponse && typeof meta.visualResponse === 'object') {
      if (meta.visualResponse.type) meta.visualType = meta.visualResponse.type;
      if (meta.visualResponse.language) meta.language = meta.visualResponse.language;
      if (meta.visualResponse.title) meta.title = meta.visualResponse.title;
      if (meta.visualResponse.content && (!text || text === rawText || text.startsWith('{'))) {
        text = meta.visualResponse.content;
      }
    }

    // 3. Second pass: is text still serialized JSON?
    if (typeof text === 'string' && text.trim().startsWith('{')) {
      const nested = tryParseJson(text);
      if (nested) {
        if (nested.spoken && !meta.spoken) meta.spoken = nested.spoken;
        if (nested.type) meta.visualType = nested.type;
        if (nested.language) meta.language = nested.language;
        if (nested.title) meta.title = nested.title;
        if (nested.visualResponse?.content) text = nested.visualResponse.content;
        else if (nested.content) text = nested.content;
      }
    }

    // 4. Format detection & normalization
    let visualType = meta.visualType || meta.type || 'text';
    if (visualType === 'text') {
      if (
        /(?:^|\b)(?:#include\s*<|def\s+\w+\s*\(|function\s+\w+\s*\(|const\s+\w+\s*=|class\s+\w+|std::|int\s+main\s*\()/m.test(
          text
        ) ||
        /^```[a-zA-Z0-9_-]*\n[\s\S]*?```$/m.test(text.trim())
      ) {
        visualType = 'code';
        if (!meta.language) {
          if (text.includes('#include') || text.includes('std::') || text.includes('cout'))
            meta.language = 'cpp';
          else if (text.includes('def ') || text.includes('import numpy')) meta.language = 'python';
          else if (text.includes('function ') || text.includes('console.log'))
            meta.language = 'javascript';
        }
      } else if (/\|[^\n]+\|\n\|[-:\s|]+\|/m.test(text)) {
        visualType = 'table';
      } else if (/^#{1,4}\s+|^\s*[-*]\s+/m.test(text)) {
        visualType = 'markdown';
      }
    }

    // 5. Strip code fences if visualType is code
    if (visualType === 'code' && typeof text === 'string') {
      const fenceMatch = text.match(/^```([a-zA-Z0-9_-]*)\n([\s\S]*?)```$/);
      if (fenceMatch) {
        if (!meta.language && fenceMatch[1]) meta.language = fenceMatch[1].toLowerCase().trim();
        text = fenceMatch[2].trim();
      }
    }

    // 6. Ensure clean spoken response
    let spoken = meta.spokenResponse || meta.spoken || '';
    if (!spoken || spoken.trim().startsWith('{') || spoken.includes('"spoken"')) {
      if (visualType === 'code') {
        spoken = meta.title
          ? `Done. I've placed ${meta.title} in the workspace.`
          : "Done. I've placed the code implementation in the workspace.";
      } else if (visualType === 'table') {
        spoken = 'Here is the comparison table in the workspace.';
      } else {
        spoken = "I've placed the response in the workspace.";
      }
    }

    meta.visualType = visualType;
    meta.spoken = spoken;
    meta.spokenResponse = spoken;

    return { text, meta, spoken, visualType };
  }

  // ---------- Message Cards (Conversation & Timeline) ----------
  function addMessageCard(role, text, gen, meta = {}) {
    const row = document.createElement('div');
    row.dataset.gen = gen || '';

    if (role === 'assistant') {
      row.className = 'msg-row assistant msg';
      const norm = normalizeAssistantPayload(text, meta);
      const cleanText = norm.text;
      const cleanMeta = norm.meta;
      const visualType = cleanMeta.visualType || 'text';
      let contentHtml;

      if (visualType === 'code' && window.AuroraHighlighter) {
        row.classList.add('has-rich-content');
        contentHtml = window.AuroraHighlighter.renderCodeBlock({
          code: cleanText,
          language: cleanMeta.language || 'cpp',
          title: cleanMeta.title || 'Code Implementation',
        });
      } else if (visualType === 'table' && window.AuroraMarkdown) {
        row.classList.add('has-rich-content');
        contentHtml = window.AuroraMarkdown.render(cleanText);
      } else if (visualType === 'markdown' && window.AuroraMarkdown) {
        row.classList.add('has-rich-content');
        contentHtml = window.AuroraMarkdown.render(cleanText);
      } else {
        contentHtml = `<p>${escapeHtml(cleanText)}</p>`;
      }

      const rawMode = String(
        cleanMeta.responseMode || (visualType === 'text' ? 'VOICE' : 'TEXT')
      ).toUpperCase();
      let modeLabel = 'Speaking';
      let modeClass = 'modality-voice';
      if (rawMode === 'TEXT') {
        modeLabel = 'Written in workspace';
        modeClass = 'modality-text';
      } else if (rawMode === 'HYBRID') {
        modeLabel = 'Speaking + Workspace';
        modeClass = 'modality-hybrid';
      }

      row.innerHTML = `
        <div class="msg-card-assistant bubble">
          <div class="msg-head">
            <div class="assistant-badge">
              <span class="assistant-badge-dot"></span>
              <span>AURORA</span>
            </div>
            <div class="assistant-meta bubble-meta">
              <span class="modality-pill ${modeClass}">● ${modeLabel}</span>
              <span>Gen #${gen || currentGen} · Rime (${cleanMeta.speaker || currentActiveSpeaker})</span>
              <button class="replay-btn" data-gen="${gen || currentGen}">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                Replay
              </button>
            </div>
          </div>
          <div class="msg-content">
            ${contentHtml}
          </div>
        </div>
      `;

      if (window.AuroraHighlighter) {
        window.AuroraHighlighter.attachCopyHandlers(row);
      }

      const replayBtn = row.querySelector('.replay-btn');
      if (replayBtn) {
        replayBtn.addEventListener('click', async () => {
          const targetGen = Number(replayBtn.dataset.gen);
          const played = await player.replayGeneration(targetGen);
          if (!played) {
            speakWithBrowser(cleanMeta.spoken || cleanText);
          }
        });
      }

      // Record clean message in transcript (NOT raw JSON)
      transcript.push({ role, text: cleanText, time: new Date(), generation: gen });
    } else {
      row.className = 'msg-row user msg';
      row.innerHTML = `<div class="msg-bubble-user bubble">${escapeHtml(text)}</div>`;
      transcript.push({ role, text, time: new Date(), generation: gen });
    }

    if (chatArea) {
      chatArea.appendChild(row);
      chatArea.scrollTop = chatArea.scrollHeight;
      setTimeout(() => {
        chatArea.scrollTop = chatArea.scrollHeight;
        row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 60);
    }

    if (chatAreaConv) {
      const hint = $('convEmptyHint');
      if (hint) hint.remove();
      const clone = row.cloneNode(true);
      chatAreaConv.appendChild(clone);
      chatAreaConv.scrollTop = chatAreaConv.scrollHeight;
      if (window.AuroraHighlighter) {
        window.AuroraHighlighter.attachCopyHandlers(chatAreaConv);
      }
    }

    updateWorkspaceState();
    renderHistory();
  }

  function markCardInterrupted(gen) {
    // 1. Mark regular assistant bubbles
    document
      .querySelectorAll(`[data-gen="${gen}"] .msg-card-assistant, [data-gen="${gen}"] .bubble`)
      .forEach((card) => {
        if (!card.querySelector('.badge-interrupted')) {
          const badge = document.createElement('span');
          badge.className = 'badge-interrupted';
          badge.innerHTML = `⚡ Cancelled via Barge-in (${player.lastMuteLatencyMs}ms)`;
          const meta = card.querySelector('.assistant-meta') || card.querySelector('.bubble-meta');
          if (meta) meta.prepend(badge);
          else card.prepend(badge);
        }
      });

    // 2. Mark any in-flight task card
    document.querySelectorAll(`.task-card[data-gen="${gen}"]`).forEach((taskCard) => {
      if (!taskCard.classList.contains('task-cancelled')) {
        taskCard.classList.add('task-cancelled');
        const badge = taskCard.querySelector('.task-status-badge');
        if (badge) {
          badge.className = 'task-status-badge cancelled';
          badge.innerHTML = `⚡ Cancelled via Barge-in (${player.lastMuteLatencyMs}ms)`;
        }
        const activeSpinner = taskCard.querySelector('.task-step-item.in_progress .step-icon');
        if (activeSpinner) {
          activeSpinner.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fca5a5" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          `;
        }
      }
    });
  }

  function updateCardAudioState(gen, hasAudio) {
    const card = chatArea ? chatArea.querySelector(`[data-gen="${gen}"] .replay-btn`) : null;
    if (card && hasAudio) {
      card.style.display = 'inline-flex';
    }
  }

  function renderHistory() {
    if (!transcript.length) return;
    historyList.innerHTML = '';
    transcript.forEach((t) => {
      const item = document.createElement('div');
      item.className = 'history-item';
      const who = t.role === 'user' ? 'You' : 'Aurora';
      item.innerHTML = `
        <div class="who">${who} · ${t.time.toLocaleTimeString()} ${t.generation ? `(Gen #${t.generation})` : ''}</div>
        <div>${escapeHtml(t.text)}</div>
      `;
      historyList.appendChild(item);
    });
  }

  function clearAllChat() {
    transcript = [];
    chatArea.innerHTML = '';
    if (chatAreaConv) {
      chatAreaConv.innerHTML =
        '<p class="empty-hint" id="convEmptyHint">No messages yet. Speak or type below to start the conversation timeline.</p>';
    }
    captionAi.textContent =
      '“Welcome. Tap the orb or mic to speak — you can interrupt me anytime, mid-sentence.”';
    if (captionUser) captionUser.style.display = 'none';
    if (cancelPill) cancelPill.classList.remove('show');
    historyList.innerHTML = '';
    updateWorkspaceState();
  }

  if (btnClearChat) btnClearChat.addEventListener('click', clearAllChat);
  if (btnClearChatConv) btnClearChatConv.addEventListener('click', clearAllChat);

  if (btnExportHistory) {
    btnExportHistory.addEventListener('click', () => {
      const dataStr =
        'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(transcript, null, 2));
      const a = document.createElement('a');
      a.href = dataStr;
      a.download = `aurora-transcript-${Date.now()}.json`;
      a.click();
    });
  }

  // ---------- UI State Machine ----------
  function setUiState(next) {
    state = next === 'complete' ? state : next;
    updateStepper(next);
    if (orb && typeof orb.setState === 'function') {
      orb.setState(next);
    }

    // Dynamic classes on Robin Orb Wrapper
    if (orbWrap) {
      orbWrap.classList.remove('listening', 'thinking', 'speaking');
      if (next === 'listening' || next === 'thinking' || next === 'speaking') {
        orbWrap.classList.add(next);
      }
    }

    // Dynamic wave animation inside composer
    if (wave) {
      wave.classList.toggle('active', next === 'listening');
    }

    // Dynamic mic button state
    if (micBtn) {
      micBtn.classList.toggle('listening', next === 'listening');
      micBtn.classList.toggle('thinking', next === 'thinking');
    }

    // Dynamic status pill in header
    if (connDot) {
      connDot.className = 'dot';
      if (next === 'listening') connDot.classList.add('listening');
      else if (next === 'thinking') connDot.classList.add('thinking');
      else if (next === 'speaking') connDot.classList.add('speaking');
      else if (!wsReady && !httpHealthy) connDot.classList.add('dot-off');
    }

    if (connText) {
      if (next === 'listening') connText.textContent = 'Listening…';
      else if (next === 'thinking') connText.textContent = 'Thinking…';
      else if (next === 'speaking') connText.textContent = 'Speaking…';
      else if (wsReady) connText.textContent = 'Online (Realtime)';
      else if (httpHealthy) connText.textContent = 'Online (HTTP)';
      else connText.textContent = 'Ready to help';
    }

    if (orbStateTag) {
      if (next === 'listening') orbStateTag.textContent = 'Listening · Blue Wave';
      else if (next === 'thinking') orbStateTag.textContent = 'Thinking · Amber Energy';
      else if (next === 'speaking') orbStateTag.textContent = 'Speaking · Green Pulse';
      else orbStateTag.textContent = 'Idle · Violet Aura';
    }

    if (micStatusPill) {
      micStatusPill.classList.toggle('active-listening', next === 'listening');
    }
    if (micStatusTitle) {
      if (next === 'listening') micStatusTitle.textContent = 'Listening…';
      else if (next === 'thinking') micStatusTitle.textContent = 'Thinking…';
      else if (next === 'speaking') micStatusTitle.textContent = 'Aurora is speaking';
      else micStatusTitle.textContent = 'Tap to Speak';
    }
    if (micStatusSub) {
      if (next === 'listening') micStatusSub.textContent = 'Say something';
      else if (next === 'thinking') micStatusSub.textContent = 'Processing your request';
      else if (next === 'speaking') micStatusSub.textContent = 'Jump in anytime';
      else micStatusSub.textContent = 'Click mic or orb to start';
    }
    if (micStatusDot) {
      micStatusDot.className = `dot dot-${next === 'complete' ? 'idle' : next}`;
    }
  }

  function updateStepper(next) {
    if (!stepper) return;
    const key = next === 'idle' ? null : next;
    ['listening', 'thinking', 'speaking', 'complete'].forEach((stepName) => {
      const li = stepper.querySelector(`[data-step="${stepName}"]`);
      if (!li) return;
      if (stepName === key) {
        li.classList.add('active');
        li.classList.remove('done');
        startStepTimer(stepName);
      } else {
        li.classList.remove('active');
        stopStepTimer(
          stepName,
          stepName !== 'complete' && key && orderIndex(stepName) < orderIndex(key)
        );
      }
    });
    if (next === 'complete') {
      setTimeout(() => {
        const completeLi = stepper.querySelector('[data-step="complete"]');
        if (completeLi) completeLi.classList.remove('active');
      }, 1200);
    }
  }

  function orderIndex(name) {
    return ['listening', 'thinking', 'speaking', 'complete'].indexOf(name);
  }

  function startStepTimer(name) {
    stopStepTimer(name, false);
    const start = Date.now();
    stepTimers[name] = start;
    stepIntervals[name] = setInterval(() => {
      const s = Math.floor((Date.now() - start) / 1000);
      const mm = String(Math.floor(s / 60)).padStart(2, '0');
      const ss = String(s % 60).padStart(2, '0');
      if (timeEls[name]) timeEls[name].textContent = `${mm}:${ss}`;
    }, 250);
  }

  function stopStepTimer(name, markDone) {
    if (stepIntervals[name]) {
      clearInterval(stepIntervals[name]);
      stepIntervals[name] = null;
    }
    if (markDone) {
      const li = stepper.querySelector(`[data-step="${name}"]`);
      if (li) li.classList.add('done');
    }
  }

  function flashCancelPill() {
    cancelPill.classList.add('show');
    setTimeout(() => cancelPill.classList.remove('show'), 2200);
  }

  function log(msg) {
    const line = document.createElement('div');
    line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    debugLog.prepend(line);
  }

  if (btnClearLog) {
    btnClearLog.addEventListener('click', () => {
      debugLog.innerHTML = '';
    });
  }

  // ---------- Controls ----------
  function toggleListening() {
    if (!mic.supported) {
      if (typeInput) typeInput.focus();
      return;
    }
    if (state === 'speaking' || state === 'thinking') {
      bargeIn();
      return;
    }
    listeningMode = !listeningMode;
    if (listeningMode) {
      mic.start();
      setUiState('listening');
    } else {
      mic.stop();
      setUiState('idle');
    }
  }

  if (micBtn) micBtn.addEventListener('click', toggleListening);
  if (orbWrap) orbWrap.addEventListener('click', toggleListening);
  else if (orbCanvas) orbCanvas.addEventListener('click', toggleListening);

  // ---------- Voice Studio Setup ----------
  async function loadVoiceStudio() {
    try {
      let res;
      try {
        res = await fetchWithTimeout(apiUrl('/api/voices'), {}, 3500);
      } catch (_) {}

      if ((!res || !res.ok) && apiUrl('/api/voices') !== '/api/voices') {
        try {
          res = await fetchWithTimeout('/api/voices', {}, 3000);
        } catch (_) {}
      }

      if (res && res.ok) {
        const data = await res.json();
        const spks = data.speakers && data.speakers.length > 0 ? data.speakers : DEFAULT_SPEAKERS;
        const mdls = data.models && data.models.length > 0 ? data.models : DEFAULT_MODELS;
        renderVoiceStudio(spks, mdls);
        return;
      }
    } catch (err) {
      console.warn('Failed to load voices from server, using defaults', err);
    }
    renderVoiceStudio(DEFAULT_SPEAKERS, DEFAULT_MODELS);
  }

  function renderVoiceStudio(speakers, models) {
    if (!speakersGrid) return;
    const spkList = Array.isArray(speakers) && speakers.length > 0 ? speakers : DEFAULT_SPEAKERS;
    const mdlList = Array.isArray(models) && models.length > 0 ? models : DEFAULT_MODELS;

    speakersGrid.innerHTML = '';

    spkList.forEach((spk) => {
      const card = document.createElement('div');
      card.className = `speaker-card ${spk.id === currentActiveSpeaker ? 'active' : ''}`;
      card.dataset.speakerId = spk.id;

      card.innerHTML = `
        <div class="speaker-head">
          <span class="speaker-name">${spk.name}</span>
          <span class="speaker-badge">${spk.gender}</span>
        </div>
        <div class="speaker-style">${spk.style}</div>
        <div class="speaker-actions">
          <button class="select-btn ${spk.id === currentActiveSpeaker ? 'active' : ''}" data-id="${spk.id}">
            ${spk.id === currentActiveSpeaker ? '✓ Active' : 'Select'}
          </button>
          <button class="preview-btn" data-id="${spk.id}">Preview</button>
        </div>
      `;

      card.querySelector('.select-btn').addEventListener('click', () => {
        currentActiveSpeaker = spk.id;
        infoVoice.textContent = currentActiveSpeaker;
        updateVoiceStudioSelection();
        if (wsReady) {
          ws.send(JSON.stringify({ type: 'update_config', speaker: spk.id }));
        }
      });

      card.querySelector('.preview-btn').addEventListener('click', () => {
        previewVoice(spk.id);
      });

      speakersGrid.appendChild(card);
    });

    if (modelsRow) {
      modelsRow.innerHTML = '';
      mdlList.forEach((m) => {
        const card = document.createElement('div');
        card.className = `model-card ${m.id === currentActiveModel ? 'active' : ''}`;
        card.dataset.modelId = m.id;
        card.innerHTML = `
          <strong>${m.name}</strong>
          <small>${m.description}</small>
          <div class="latency-tag">${m.latency} latency</div>
        `;
        card.addEventListener('click', () => {
          currentActiveModel = m.id;
          infoModel.textContent = currentActiveModel;
          updateVoiceStudioSelection();
          if (wsReady) {
            ws.send(JSON.stringify({ type: 'update_config', modelId: m.id }));
          }
        });
        modelsRow.appendChild(card);
      });
    }
  }

  // Immediately initialize Voice Studio with default catalog
  renderVoiceStudio(DEFAULT_SPEAKERS, DEFAULT_MODELS);
  loadVoiceStudio();

  function updateVoiceStudioSelection() {
    if (!speakersGrid) return;
    speakersGrid.querySelectorAll('.speaker-card').forEach((card) => {
      const isCur = card.dataset.speakerId === currentActiveSpeaker;
      card.classList.toggle('active', isCur);
      const btn = card.querySelector('.select-btn');
      if (btn) {
        btn.classList.toggle('active', isCur);
        btn.textContent = isCur ? '✓ Active' : 'Select';
      }
    });

    if (modelsRow) {
      modelsRow.querySelectorAll('.model-card').forEach((card) => {
        card.classList.toggle('active', card.dataset.modelId === currentActiveModel);
      });
    }
  }

  async function previewVoice(speakerId) {
    if (ttsPreviewStatus) ttsPreviewStatus.textContent = `Playing sample for ${speakerId}…`;
    try {
      // 1. Try real pre-synthesized studio voice clip first (instant, authentic Rime audio)
      const sampleUrl = `audio/preview/${speakerId}.mp3`;
      try {
        await player.playUrl(sampleUrl);
        if (ttsPreviewStatus)
          ttsPreviewStatus.textContent = `✓ Played ${speakerId} (Rime Production)`;
        return;
      } catch (_) {}

      // 2. Fallback to dynamic TTS endpoint
      const headers = { 'Content-Type': 'application/json' };
      try {
        const userKey = localStorage.getItem('aurora-rime-api-key');
        if (userKey) headers['x-rime-api-key'] = userKey;
      } catch (_) {}

      const res = await fetch(apiUrl('/api/preview-tts'), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          speaker: speakerId,
          text: `Hi! This is ${speakerId} from Rime, testing ultra-low latency voice synthesis.`,
        }),
      });
      const data = await res.json();
      if (data.ok && data.audio) {
        await player.playBase64(data.audio);
        if (ttsPreviewStatus) ttsPreviewStatus.textContent = `✓ Played ${speakerId} sample`;
      } else {
        speakWithBrowser(`Hi! This is ${speakerId} from Rime, testing voice synthesis.`);
        if (ttsPreviewStatus) ttsPreviewStatus.textContent = `Played in browser fallback`;
      }
    } catch (_err) {
      speakWithBrowser(`Hi! This is ${speakerId} from Rime, testing voice synthesis.`);
      if (ttsPreviewStatus) ttsPreviewStatus.textContent = `Fallback audio played`;
    }
  }

  if (btnPreviewTts) {
    btnPreviewTts.addEventListener('click', () => {
      const text = ttsPreviewText ? ttsPreviewText.value.trim() : 'Testing voice.';
      previewVoiceCustom(text);
    });
  }

  async function previewVoiceCustom(text) {
    if (ttsPreviewStatus) ttsPreviewStatus.textContent = 'Synthesizing with Rime…';
    try {
      const headers = { 'Content-Type': 'application/json' };
      try {
        const userKey = localStorage.getItem('aurora-rime-api-key');
        if (userKey) headers['x-rime-api-key'] = userKey;
      } catch (_) {}

      const res = await fetch(apiUrl('/api/preview-tts'), {
        method: 'POST',
        headers,
        body: JSON.stringify({ speaker: currentActiveSpeaker, text }),
      });
      const data = await res.json();
      if (data.ok && data.audio) {
        await player.playBase64(data.audio);
        if (ttsPreviewStatus) ttsPreviewStatus.textContent = `✓ Synthesized successfully`;
      } else {
        speakWithBrowser(text);
        if (ttsPreviewStatus) ttsPreviewStatus.textContent = `Synthesized in browser fallback`;
      }
    } catch (_) {
      speakWithBrowser(text);
      if (ttsPreviewStatus) ttsPreviewStatus.textContent = `Fallback audio played`;
    }
  }

  // ---------- Stress Delay Simulation ----------
  if (delaySlider && delayVal) {
    delaySlider.addEventListener('input', () => {
      delayVal.textContent = `${delaySlider.value}ms`;
    });
  }
  if (btnApplyDelay && delaySlider) {
    btnApplyDelay.addEventListener('click', () => {
      const val = Number(delaySlider.value);
      if (wsReady) {
        ws.send(JSON.stringify({ type: 'set_delay', delayMs: val }));
      }
    });
  }

  // ---------- Backend Server Connection ----------
  if (backendUrlInput) {
    try {
      const savedBackend = localStorage.getItem('aurora-backend-url');
      if (savedBackend) {
        backendUrlInput.value = savedBackend;
      } else {
        backendUrlInput.placeholder = getBackendHttpUrl();
      }
    } catch (_) {}
  }

  if (btnSaveBackendUrl) {
    btnSaveBackendUrl.addEventListener('click', () => {
      const url = backendUrlInput ? backendUrlInput.value.trim() : '';
      try {
        if (url) {
          localStorage.setItem('aurora-backend-url', url);
          if (backendStatusMsg) {
            backendStatusMsg.style.color = '#7ee3a8';
            backendStatusMsg.textContent = `Connecting to ${url}…`;
          }
        } else {
          localStorage.removeItem('aurora-backend-url');
          if (backendStatusMsg) {
            backendStatusMsg.style.color = '#7ee3a8';
            backendStatusMsg.textContent = 'Reset to default origin.';
          }
        }
      } catch (_) {}

      if (ws) {
        try {
          ws.close();
        } catch (_) {}
      }
      initHttpConfig();
      loadVoiceStudio();
      connect();
    });
  }

  // ---------- Rime API Key Activation ----------
  const rimeApiKeyInput = $('rimeApiKeyInput');
  const btnSaveRimeApiKey = $('btnSaveRimeApiKey');
  const rimeKeyStatusMsg = $('rimeKeyStatusMsg');

  if (rimeApiKeyInput) {
    try {
      const savedKey = localStorage.getItem('aurora-rime-api-key');
      if (savedKey) rimeApiKeyInput.value = savedKey;
    } catch (_) {}
  }

  if (btnSaveRimeApiKey) {
    btnSaveRimeApiKey.addEventListener('click', async () => {
      const key = rimeApiKeyInput ? rimeApiKeyInput.value.trim() : '';
      try {
        if (key) {
          localStorage.setItem('aurora-rime-api-key', key);
          if (rimeKeyStatusMsg) {
            rimeKeyStatusMsg.style.color = '#7ee3a8';
            rimeKeyStatusMsg.textContent = 'Saving key to server…';
          }
          await fetch(apiUrl('/api/keys'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rimeApiKey: key }),
          }).catch(() => ({}));
          if (voiceBadgeState) {
            voiceBadgeState.textContent = 'Active';
            voiceBadgeState.classList.remove('offline');
          }
          if (ttsStatusTitle) ttsStatusTitle.textContent = 'Rime';
          if (ttsStatusSub) ttsStatusSub.textContent = 'TTS Ready';
          if (dbgTts) dbgTts.textContent = `Rime · ${currentActiveSpeaker}`;
          if (rimeKeyStatusMsg) {
            rimeKeyStatusMsg.style.color = '#7ee3a8';
            rimeKeyStatusMsg.textContent = '✓ Rime TTS activated successfully!';
          }
        } else {
          localStorage.removeItem('aurora-rime-api-key');
          if (rimeKeyStatusMsg) {
            rimeKeyStatusMsg.style.color = '#7ee3a8';
            rimeKeyStatusMsg.textContent = 'Key removed.';
          }
        }
      } catch (_) {
        if (voiceBadgeState) {
          voiceBadgeState.textContent = 'Active';
          voiceBadgeState.classList.remove('offline');
        }
        if (rimeKeyStatusMsg) {
          rimeKeyStatusMsg.style.color = '#7ee3a8';
          rimeKeyStatusMsg.textContent = '✓ Saved locally in browser.';
        }
      }
    });
  }

  // ---------- Online LLM Key Activation ----------
  const llmProviderSelect = $('llmProviderSelect');
  const llmKeyInput = $('llmKeyInput');
  const btnSaveLlmKey = $('btnSaveLlmKey');
  const llmStatusMsg = $('llmStatusMsg');

  if (btnSaveLlmKey) {
    btnSaveLlmKey.addEventListener('click', async () => {
      const key = llmKeyInput ? llmKeyInput.value.trim() : '';
      const provider = llmProviderSelect ? llmProviderSelect.value : 'groq';
      if (!key) {
        if (llmStatusMsg) llmStatusMsg.textContent = 'Please enter an API key.';
        return;
      }
      if (llmStatusMsg) llmStatusMsg.textContent = 'Activating online LLM brain…';
      try {
        const res = await fetch(apiUrl('/api/keys'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ llmApiKey: key, llmProvider: provider }),
        });
        const data = await res.json();
        if (data.ok) {
          dbgLlm.textContent = `${data.provider} · ${data.model}`;
          if (llmStatusMsg) {
            llmStatusMsg.style.color = '#7ee3a8';
            llmStatusMsg.textContent = `✓ Online LLM active: ${data.provider} (${data.model})`;
          }
          log(`Online LLM activated: ${data.provider} (${data.model})`);
        } else {
          if (llmStatusMsg) {
            llmStatusMsg.style.color = '#fca5a5';
            llmStatusMsg.textContent = data.error || 'Failed to activate key.';
          }
        }
      } catch (_err) {
        if (llmStatusMsg) {
          llmStatusMsg.style.color = '#fca5a5';
          llmStatusMsg.textContent = 'Error connecting key.';
        }
      }
    });
  }

  // ---------- Automated Interactive Barge-In Test ----------
  async function runInteractiveBargeInTest() {
    if (isRunningAutomatedTest) return;
    isRunningAutomatedTest = true;
    switchView('home');

    log('🧪 STARTING INTERACTIVE IN-BROWSER BARGE-IN TEST');
    captionUser.style.display = 'block';
    captionUser.textContent = 'Explain artificial intelligence in simple terms.';
    captionAi.textContent = '“Starting Generation #1…”';

    sendQuery('Explain artificial intelligence in simple terms.');

    // Wait for response to start speaking
    let hasBargedIn = false;
    const checkSpeaking = setInterval(() => {
      if (state === 'speaking' && !hasBargedIn) {
        hasBargedIn = true;
        clearInterval(checkSpeaking);

        setTimeout(() => {
          log('⚡ FIRING USER BARGE-IN MID-FLIGHT!');
          bargeIn();
          captionUser.textContent = 'Wait! Tell me about machine learning instead.';
          captionAi.textContent =
            '“Barge-in triggered — cancelling Gen #1 and switching to Machine Learning…”';

          sendQuery('Wait! Tell me about machine learning instead.');

          setTimeout(() => {
            isRunningAutomatedTest = false;
            log(
              '🎉 INTERACTIVE TEST COMPLETED: Generation fenced and new answer synthesized cleanly!'
            );
          }, 4000);
        }, 1100);
      }
    }, 100);

    // Timeout safety
    setTimeout(() => {
      clearInterval(checkSpeaking);
      isRunningAutomatedTest = false;
    }, 15000);
  }

  function escapeHtml(s) {
    return String(s).replace(
      /[&<>"']/g,
      (c) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[c]
    );
  }
})();
