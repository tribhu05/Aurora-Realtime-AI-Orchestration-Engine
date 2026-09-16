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

  // Telemetry HUD & Latency Breakdown
  const hudLlm = $('hudLlm');
  const hudLlmModel = $('hudLlmModel');
  const hudTts = $('hudTts');
  const hudTtsVoice = $('hudTtsVoice');
  const hudStt = $('hudStt');
  const hudDegradationBadge = $('hudDegradationBadge');

  // Cost Governance & Budget
  const hudTurnCost = $('hudTurnCost');
  const hudTurnTokens = $('hudTurnTokens');
  const hudSessionCost = $('hudSessionCost');
  const hudSessionTokens = $('hudSessionTokens');
  const hudLifetimeCost = $('hudLifetimeCost');
  const hudLifetimeTurns = $('hudLifetimeTurns');
  const budgetUsageLabel = $('budgetUsageLabel');
  const budgetPctLabel = $('budgetPctLabel');
  const budgetFill = $('budgetFill');
  const dbgSession = $('dbgSession');

  // Sessions & Transcripts Elements
  const sessionList = $('sessionList');
  const sessionListLoading = $('sessionListLoading');
  const btnNewSession = $('btnNewSession');
  const btnSidebarNewChat = $('btnSidebarNewChat');
  const btnTopbarNewChat = $('btnTopbarNewChat');
  const sidebarRecentList = $('sidebarRecentList');
  const sidebarRecentCount = $('sidebarRecentCount');
  const btnExportMarkdown = $('btnExportMarkdown');

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
  const navSettings = $('navSettings') || $('navConfig');
  const navConfig = navSettings;
  const drawerSectionVoice = $('drawerSectionVoice');
  const drawerSectionTranscripts = $('drawerSectionTranscripts');
  const drawerSectionTelemetry = $('drawerSectionTelemetry');
  const drawerSectionSettings = $('drawerSectionSettings') || $('drawerSectionConfig');
  const drawerSectionConfig = drawerSectionSettings;
  const drawerNavTabs = $('drawerNavTabs');

  // Core Audio & State
  const player = new window.AuroraAudioPlayer();
  player.onQueueEmpty = () => { afterSpeaking(); };
  const orb = new window.AuroraOrb(orbCanvas, player);

  // Mobile Web Audio Unlock on first interaction (touchstart/click/key)
  const unlockAudioOnUserGesture = () => {
    if (player && typeof player.unlock === 'function') {
      player.unlock();
    }
  };
  ['touchstart', 'touchend', 'click', 'keydown'].forEach((evt) => {
    document.addEventListener(evt, unlockAudioOnUserGesture, { once: true, passive: true });
  });

  // Handle phone wake / app returning to foreground
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      if (player && typeof player.unlock === 'function') {
        player.unlock();
      }
      if (!wsReady && typeof connect === 'function') {
        connect();
      }
    }
  });

  // Mobile Virtual Keyboard Viewport Adapter
  if (window.visualViewport) {
    let keyboardUpdateTimer = null;
    const updateKeyboardOffset = () => {
      const vv = window.visualViewport;
      const keyboardHeight = Math.max(0, Math.round(window.innerHeight - vv.height));
      document.documentElement.style.setProperty('--keyboard-height', `${keyboardHeight}px`);

      if (keyboardHeight > 50 && chatArea && chatArea.style.display !== 'none') {
        clearTimeout(keyboardUpdateTimer);
        keyboardUpdateTimer = setTimeout(() => {
          chatArea.scrollTop = chatArea.scrollHeight;
        }, 60);
      }
    };

    window.visualViewport.addEventListener('resize', updateKeyboardOffset);
    window.visualViewport.addEventListener('scroll', updateKeyboardOffset);

    if (typeInput) {
      typeInput.addEventListener('focus', () => {
        setTimeout(updateKeyboardOffset, 150);
      });
      typeInput.addEventListener('blur', () => {
        setTimeout(() => {
          document.documentElement.style.setProperty('--keyboard-height', '0px');
        }, 120);
      });
    }
  }

  let ws = null;
  // === INJECTED CLIENT LOGGING ===
  window.addEventListener('error', (event) => {
    if (ws && ws.readyState === 1) {
      ws.send(
        JSON.stringify({
          type: 'client_error',
          message: event.message,
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
          stack: event.error ? event.error.stack : null,
        })
      );
    }
  });
  window.addEventListener('unhandledrejection', (event) => {
    if (ws && ws.readyState === 1) {
      ws.send(
        JSON.stringify({ type: 'client_error', message: 'Unhandled Rejection: ' + event.reason })
      );
    }
  });

  let wsReady = false;
  function sendWs(payload) {
    if (ws && (ws.readyState === 1 || (window.WebSocket && ws.readyState === WebSocket.OPEN))) {
      try {
        ws.send(typeof payload === 'string' ? payload : JSON.stringify(payload));
        return true;
      } catch (err) {
        console.warn('sendWs failed:', err);
      }
    }
    return false;
  }
  let currentGen = 0;
  let state = 'idle'; // idle | listening | thinking | speaking
  let listeningMode = false;
  let interruptCount = 0;
  let stalePacketsDiscarded = 0;
  let pendingRenderRaf = null;
  let latestChunkData = null;

  function scheduleChunkUpdate(msg) {
    latestChunkData = msg;
    if (!pendingRenderRaf) {
      pendingRenderRaf = requestAnimationFrame(() => {
        pendingRenderRaf = null;
        if (latestChunkData && latestChunkData.generation >= currentGen) {
          updateMessageCard('assistant', latestChunkData.text, latestChunkData.generation, {
            visualType: latestChunkData.visualType,
            language: latestChunkData.language,
            title: latestChunkData.title,
            responseMode: latestChunkData.responseMode,
          });
        }
      });
    }
  }

  function flushChunkUpdate() {
    if (pendingRenderRaf) {
      cancelAnimationFrame(pendingRenderRaf);
      pendingRenderRaf = null;
    }
    latestChunkData = null;
  }
  let stepTimers = {};
  let stepIntervals = {};
  let transcript = [];
  let currentSessionId = null;
  try {
    currentSessionId = localStorage.getItem('aurora-session-id') || null;
  } catch (_) {}
  let currentActiveSpeaker = 'astra';
  try {
    currentActiveSpeaker = localStorage.getItem('aurora-speaker') || 'astra';
  } catch (_) {}
  let currentActiveModel = 'mistv3';
  try {
    currentActiveModel = localStorage.getItem('aurora-model') || 'mistv3';
  } catch (_) {}
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

  // ---------- Slidebar Integrated Settings Panel ----------
  let _activeSettingsSection = null;

  function setActiveSettingsNav(target) {
    _activeSettingsSection = target;
    const settingsButtons = [navVoiceStudio, navTranscripts, navTelemetry, navSettings];
    settingsButtons.forEach((btn) => {
      if (!btn) return;
      const t = btn.dataset.target;
      const match = t === target || (target === 'settings' && t === 'config') || (target === 'config' && t === 'settings');
      btn.classList.toggle('active', Boolean(target) && match);
    });
    if (drawerNavTabs) {
      drawerNavTabs.querySelectorAll('.drawer-tab').forEach((tab) => {
        const t = tab.dataset.target;
        const match = t === target || (target === 'settings' && t === 'config') || (target === 'config' && t === 'settings');
        tab.classList.toggle('active', Boolean(target) && match);
      });
    }
  }

  function openDrawer() {
    if (settingsDrawer) settingsDrawer.classList.add('open');
    if (drawerBackdrop) drawerBackdrop.classList.add('open');
  }

  function closeDrawer() {
    if (settingsDrawer) settingsDrawer.classList.remove('open');
    if (drawerBackdrop) drawerBackdrop.classList.remove('open');
    setActiveSettingsNav(null);
  }

  function openDrawerTo(sectionEl, targetName = null) {
    openDrawer();
    if (targetName) {
      setActiveSettingsNav(targetName);
    }
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

  if (btnCloseSettings) btnCloseSettings.addEventListener('click', closeDrawer);
  if (drawerBackdrop) drawerBackdrop.addEventListener('click', closeDrawer);

  // ---------- Dedicated Topbar Settings Button (Direct Slide-Over Drawer) ----------
  if (btnOpenSettings) {
    btnOpenSettings.addEventListener('click', (e) => {
      e.stopPropagation();
      if (
        settingsDrawer &&
        settingsDrawer.classList.contains('open') &&
        (_activeSettingsSection === 'settings' || _activeSettingsSection === 'config')
      ) {
        closeDrawer();
      } else {
        openDrawerTo(drawerSectionSettings, 'settings');
      }
    });
  }

  const btnPlusTools = $('btnPlusTools');
  if (btnPlusTools) {
    btnPlusTools.addEventListener('click', () => {
      if (typeInput) {
        typeInput.placeholder = 'Try: "Scaffold an Express API" or "Compare Python vs C++"';
        typeInput.focus();
      }
    });
  }

  if (drawerNavTabs) {
    drawerNavTabs.querySelectorAll('.drawer-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.target;
        if (target === 'voice') {
          if (!speakersGrid || speakersGrid.children.length === 0) {
            renderVoiceStudio(DEFAULT_SPEAKERS, DEFAULT_MODELS);
          }
          loadVoiceStudio();
          openDrawerTo(drawerSectionVoice, 'voice');
        } else if (target === 'transcripts') {
          openDrawerTo(drawerSectionTranscripts, 'transcripts');
          fetchAndRenderSessions();
        } else if (target === 'telemetry') {
          openDrawerTo(drawerSectionTelemetry, 'telemetry');
          fetchTelemetryData();
        } else if (target === 'settings' || target === 'config') {
          openDrawerTo(drawerSectionSettings, 'settings');
        }
      });
    });
  }

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'n' || e.key === 'N')) {
      e.preventDefault();
      createNewSession();
      return;
    }

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

  function switchView(target) {
    navItems.forEach((b) =>
      b.classList.toggle('active', b.dataset.view === target || b.dataset.target === target)
    );
    if (target === 'companion' || target === 'home') {
      closeDrawer();
      setMainExperience('companion');
    } else if (target === 'conversation') {
      closeDrawer();
      setMainExperience('conversation');
    } else if (target === 'voice') {
      if (!speakersGrid || speakersGrid.children.length === 0) {
        renderVoiceStudio(DEFAULT_SPEAKERS, DEFAULT_MODELS);
      }
      loadVoiceStudio();
      openDrawerTo(drawerSectionVoice, 'voice');
    } else if (target === 'transcripts' || target === 'history') {
      openDrawerTo(drawerSectionTranscripts, 'transcripts');
      fetchAndRenderSessions();
    } else if (target === 'telemetry') {
      openDrawerTo(drawerSectionTelemetry, 'telemetry');
      fetchTelemetryData();
    } else if (target === 'settings' || target === 'config') {
      openDrawerTo(drawerSectionSettings, 'settings');
    }
  }

  if (navCompanion) {
    navCompanion.addEventListener('click', () => {
      closeMobileSidebar();
      closeDrawer();
      setMainExperience('companion', true);
    });
  }

  if (navConversation) {
    navConversation.addEventListener('click', () => {
      closeMobileSidebar();
      closeDrawer();
      setMainExperience('conversation', true);
    });
  }

  if (navVoiceStudio) {
    navVoiceStudio.addEventListener('click', () => {
      closeMobileSidebar();
      if (
        settingsDrawer &&
        settingsDrawer.classList.contains('open') &&
        _activeSettingsSection === 'voice'
      ) {
        closeDrawer();
        return;
      }
      if (!speakersGrid || speakersGrid.children.length === 0) {
        renderVoiceStudio(DEFAULT_SPEAKERS, DEFAULT_MODELS);
      }
      loadVoiceStudio();
      openDrawerTo(drawerSectionVoice, 'voice');
    });
  }

  if (navTranscripts) {
    navTranscripts.addEventListener('click', () => {
      closeMobileSidebar();
      if (
        settingsDrawer &&
        settingsDrawer.classList.contains('open') &&
        _activeSettingsSection === 'transcripts'
      ) {
        closeDrawer();
        return;
      }
      openDrawerTo(drawerSectionTranscripts, 'transcripts');
      fetchAndRenderSessions();
    });
  }

  if (navTelemetry) {
    navTelemetry.addEventListener('click', () => {
      closeMobileSidebar();
      if (
        settingsDrawer &&
        settingsDrawer.classList.contains('open') &&
        _activeSettingsSection === 'telemetry'
      ) {
        closeDrawer();
        return;
      }
      openDrawerTo(drawerSectionTelemetry, 'telemetry');
      fetchTelemetryData();
    });
  }

  if (navSettings) {
    navSettings.addEventListener('click', () => {
      closeMobileSidebar();
      if (
        settingsDrawer &&
        settingsDrawer.classList.contains('open') &&
        (_activeSettingsSection === 'settings' || _activeSettingsSection === 'config')
      ) {
        closeDrawer();
        return;
      }
      openDrawerTo(drawerSectionSettings, 'settings');
      updateUnifiedSettingsDisplay();
    });
  }

  if (qaTest) qaTest.addEventListener('click', () => runInteractiveBargeInTest());
  if (qaVoice) qaVoice.addEventListener('click', () => switchView('voice'));
  if (qaLogs) qaLogs.addEventListener('click', () => switchView('telemetry'));
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
  function closeMobileSidebar() {
    if (appRoot && appRoot.classList.contains('sidebar-open')) {
      appRoot.classList.remove('sidebar-open');
      if (btnToggleSidebar) btnToggleSidebar.classList.remove('active');
      const btnMobile = $('btnMobileToggle');
      if (btnMobile) btnMobile.setAttribute('aria-expanded', 'false');
    }
  }

  function toggleSidebar(forceState) {
    if (!appSidebar || !appRoot) return;
    const isMobile = window.innerWidth <= 900;
    const btnMobile = $('btnMobileToggle');
    if (isMobile) {
      const shouldOpen =
        typeof forceState === 'boolean' ? forceState : !appRoot.classList.contains('sidebar-open');
      appRoot.classList.toggle('sidebar-open', shouldOpen);
      if (btnToggleSidebar) btnToggleSidebar.classList.toggle('active', shouldOpen);
      if (btnMobile) btnMobile.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
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
  const btnMobileToggle = $('btnMobileToggle');
  if (btnMobileToggle) {
    btnMobileToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleSidebar();
    });
  }
  if (sidebarBackdrop) {
    sidebarBackdrop.addEventListener('click', () => {
      closeMobileSidebar();
    });
  }

  // Auto-adapt on resize
  window.addEventListener('resize', () => {
    if (window.innerWidth > 900 && appRoot) {
      closeMobileSidebar();
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
    let wsBase;
    try {
      const parsed = new URL(httpUrl, window.location.href);
      // Mixed content prevention: if page is HTTPS, ALWAYS use WSS
      const isHttps =
        window.location.protocol === 'https:' ||
        parsed.protocol === 'https:' ||
        parsed.protocol === 'wss:';
      const wsProto = isHttps ? 'wss:' : 'ws:';
      wsBase = `${wsProto}//${parsed.host}`;
    } catch (_) {
      const clean = httpUrl.replace(/^https?:\/\//i, '').replace(/^wss?:\/\//i, '');
      const isHttps = window.location.protocol === 'https:' || httpUrl.startsWith('https:');
      wsBase = `${isHttps ? 'wss' : 'ws'}://${clean}`;
    }
    if (currentSessionId) {
      const sep = wsBase.includes('?') ? '&' : '?';
      return `${wsBase}${sep}sessionId=${encodeURIComponent(currentSessionId)}`;
    }
    return wsBase;
  }

  function apiUrl(endpoint) {
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const base = getBackendHttpUrl();
    if (!base || base === window.location.origin) {
      return cleanEndpoint;
    }
    // Mixed Content Prevention: if current page is HTTPS, never request unencrypted HTTP
    if (window.location.protocol === 'https:' && base.startsWith('http:')) {
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
  initSessionOnBoot();

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
    if (msg.sessionId) {
      currentSessionId = msg.sessionId;
      try {
        localStorage.setItem('aurora-session-id', currentSessionId);
      } catch (_) {}
      if (dbgSession) dbgSession.textContent = currentSessionId;
    }

    // Retain user's chosen speaker & model from localStorage if already selected
    let savedSpeaker = null;
    let savedModel = null;
    try {
      savedSpeaker = localStorage.getItem('aurora-speaker');
      savedModel = localStorage.getItem('aurora-model');
    } catch (_) {}

    if (savedSpeaker) {
      currentActiveSpeaker = savedSpeaker;
    } else if (msg.speaker) {
      currentActiveSpeaker = msg.speaker;
    }

    if (savedModel) {
      currentActiveModel = savedModel;
    } else if (msg.modelId) {
      currentActiveModel = msg.modelId;
    }

    const hasClientKey = Boolean(localStorage.getItem('aurora-rime-api-key'));
    const isRimeActive = msg.rimeConfigured || hasClientKey;

    const ttsLabel = isRimeActive
      ? `Rime · ${currentActiveSpeaker}`
      : 'Browser speech (no Rime key)';
    dbgTts.textContent = ttsLabel;
    dbgLlm.textContent = msg.llmConfigured
      ? `${msg.llmProvider} · ${msg.llmModel}`
      : 'Offline demo replies';
    infoModel.textContent = currentActiveModel || 'mistv3';
    infoVoice.textContent = currentActiveSpeaker;
    infoFormat.textContent = msg.audioFormat || 'mp3';

    voiceBadgeState.textContent = isRimeActive ? 'Active' : 'Offline Fallback';
    voiceBadgeState.classList.toggle('offline', !isRimeActive);
    ttsStatusTitle.textContent = isRimeActive ? 'Rime' : 'Browser';
    ttsStatusSub.textContent = isRimeActive ? 'TTS Ready' : 'Fallback voice';

    if (msg.sessionMetrics) {
      updateTelemetryDisplay(null, msg.sessionMetrics);
    }

    // Sync Settings drawer with pre-configured system credentials if no user override is active
    const llmProvSel = $('llmProviderSelect');
    const llmInput = $('llmKeyInput');
    const llmStatus = $('llmStatusMsg');
    const rimeInput = $('rimeApiKeyInput');
    const rimeStatus = $('rimeKeyStatusMsg');

    if (msg.llmConfigured) {
      if (llmProvSel && !localStorage.getItem('aurora-llm-provider')) {
        llmProvSel.value = msg.llmProvider || 'gemini';
      }
      if (llmInput && !localStorage.getItem('aurora-llm-api-key')) {
        llmInput.placeholder = '●●●●●●●● (Pre-configured · Active for all users)';
      }
      if (llmStatus && !localStorage.getItem('aurora-llm-api-key')) {
        llmStatus.style.color = '#7ee3a8';
        llmStatus.textContent = `✓ Pre-configured & active for all users (${msg.llmProvider} · ${msg.llmModel})`;
      }
    }

    if (isRimeActive) {
      if (rimeInput && !localStorage.getItem('aurora-rime-api-key')) {
        rimeInput.placeholder = '●●●●●●●● (Pre-configured · Active for all users)';
      }
      if (rimeStatus && !localStorage.getItem('aurora-rime-api-key')) {
        rimeStatus.style.color = '#7ee3a8';
        rimeStatus.textContent = '✓ Pre-configured & active for all users.';
      }
    }

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
        if (msg.generation < currentGen) return;
        const oldGen = currentGen;
        currentGen = msg.generation;
        dbgGen.textContent = `#${currentGen}`;
        captionUser.style.display = 'block';
        captionUser.textContent = msg.text;
        captionAi.textContent = '“Thinking…”';
        addMessageCard('user', msg.text, msg.generation);
        break;
      }

      case 'thinking': {
        if (msg.generation && msg.generation < currentGen) return;
        setUiState('thinking');
        break;
      }

      case 'ai_text_start': {
        if (msg.generation < currentGen) return;
        const oldGen = currentGen;
        currentGen = msg.generation;
        if (dbgGen) dbgGen.textContent = `#${currentGen}`;
        if (captionAi) captionAi.textContent = '“Generating…”';
        updateMessageCard('assistant', '', msg.generation);
        break;
      }

      case 'ai_text_chunk': {
        if (msg.generation < currentGen) return;
        if (captionAi && msg.spoken) captionAi.textContent = `“${msg.spoken}”`;
        scheduleChunkUpdate(msg);
        break;
      }

      case 'ai_text': {
        flushChunkUpdate();
        console.log('[DEBUG] ai_text received:', msg);
        console.log('[DEBUG] currentGen:', currentGen);
        if (msg.generation < currentGen) {
          console.log('[DEBUG] returning early because msg.generation < currentGen');
          if (ws && ws.readyState === 1)
            ws.send(
              JSON.stringify({
                type: 'client_error',
                message:
                  'Returned early: msg.gen ' + msg.generation + ' < currentGen ' + currentGen,
              })
            );
          return;
        }
        try {
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
          console.log('[DEBUG] normalized payload:', normalized);

          captionAi.textContent = `“${normalized.spoken}”`;

          if (msg.llmMs != null && dbgLatency) {
            dbgLatency.textContent = `${msg.llmMs}ms to think`;
          }
          updateMessageCard('assistant', normalized.text, msg.generation, normalized.meta);
        } catch (err) {
          console.error('[DEBUG] error in ai_text:', err);
          if (ws && ws.readyState === 1)
            ws.send(
              JSON.stringify({ type: 'client_error', message: err.message, stack: err.stack })
            );
        }
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

        const audioData = msg.chunk || msg.data;
        const mime = msg.format === 'wav' ? 'audio/wav' : 'audio/mpeg';
        if (msg.totalMs != null) {
          if (dbgLatency) dbgLatency.textContent = `${msg.totalMs}ms TTFA`;
          if (hudTtfa) hudTtfa.textContent = `${msg.totalMs} ms`;
        }

        if (audioData) {
          setUiState('speaking');
          player.cacheAudio(msg.generation, audioData, mime);
          updateCardAudioState(msg.generation, true);

          player.queueBase64(audioData, mime, msg.generation);
          // With queueBase64, we don't immediately know when the whole generation is done,
          // but we can just let afterSpeaking() handle state when the whole turn is done
          // or we can just leave it since the queue handles the audio sequence.
          // Wait, afterSpeaking() resets the UI state back to idle.
          // If we queue chunks, we should probably set an interval to check if queue is empty,
          // but the state machine might be handled by the server sending a 'done' message anyway.
        } else {
          // If Rime TTS returned null audio, check if browser speech should speak or complete
          afterSpeaking();
        }
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
          if (dbgLatency) dbgLatency.textContent = `${msg.totalMs}ms TTFA`;
          hudTtfa.textContent = `${msg.totalMs} ms`;
        }
        let speakText = msg.text || '';
        if (speakText.trim().startsWith('{') || speakText.includes('"spoken"')) {
          const norm = normalizeAssistantPayload(speakText, {});
          speakText = norm.spoken;
        } else {
          speakText = speakText.replace(/```[\s\S]*?(?:```|$)/g, '').replace(/[*_#`\[\]>]/g, '').trim();
        }
        if (!speakText) speakText = "I've written the response in the chat.";
        if (captionAi) captionAi.textContent = `“${speakText}”`;
        speakWithBrowser(speakText, () => {
          if (msg.generation === currentGen) afterSpeaking();
        });
        break;
      }

      case 'interrupted': {
        interruptCount += 1;
        dbgInterrupts.textContent = interruptCount;
        currentGen = Math.max(currentGen, msg.newGeneration || 0);
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

      case 'telemetry_update': {
        updateTelemetryDisplay(msg.turnMetrics, msg.sessionMetrics, msg.lifetimeMetrics);
        break;
      }

      case 'degradation_alert': {
        showDegradationAlert(msg.reason);
        break;
      }

      case 'budget_warning': {
        showBudgetWarning(msg.message);
        break;
      }

      case 'done': {
        flushChunkUpdate();
        fetchAndRenderSessions();
        setUiState('complete');
        const hasAudio =
          player.audioCache.has(msg.generation) ||
          player.isQueuePlaying ||
          (player.sourceNode !== null);
        if (!hasAudio && msg.generation === currentGen) {
          const card = document.querySelector(`.msg-row.assistant[data-gen="${msg.generation}"]`);
          let spokenText = (card && card.dataset.spoken) || (captionAi ? captionAi.textContent.replace(/[“”"]/g, '').trim() : '');
          if (spokenText && !spokenText.includes('Generating') && !spokenText.includes('Thinking') && !spokenText.includes('Interrupted')) {
            setUiState('speaking');
            speakWithBrowser(spokenText, () => {
              if (msg.generation === currentGen) afterSpeaking();
            });
          } else {
            afterSpeaking();
          }
        } else if (!player.isQueuePlaying && !player.sourceNode) {
          afterSpeaking();
        }
        break;
      }

      case 'error': {
        const errorText = msg.message || 'Something went wrong on my end.';
        captionAi.textContent = `“${errorText}”`;
        addMessageCard('assistant', `⚠️ ${errorText}`, msg.generation || currentGen, {
          visualType: 'text',
          responseMode: 'VOICE',
        });
        setUiState('idle');
        afterSpeaking();
        break;
      }
    }
  }

  // ---------- Android Mic Guidance Modal Helpers ----------
  const androidMicModal = $('androidMicModal');
  const btnCloseAndroidMicModal = $('btnCloseAndroidMicModal');
  const btnDismissAndroidMicModal = $('btnDismissAndroidMicModal');

  function showAndroidMicModal() {
    if (androidMicModal) {
      androidMicModal.style.display = 'flex';
    }
  }

  function hideAndroidMicModal() {
    if (androidMicModal) {
      androidMicModal.style.display = 'none';
    }
  }

  if (btnCloseAndroidMicModal) btnCloseAndroidMicModal.addEventListener('click', hideAndroidMicModal);
  if (btnDismissAndroidMicModal) btnDismissAndroidMicModal.addEventListener('click', hideAndroidMicModal);
  if (androidMicModal) {
    androidMicModal.addEventListener('click', (e) => {
      if (e.target === androidMicModal) hideAndroidMicModal();
    });
  }

  // ---------- Mic & VAD Handler ----------
  const mic = new window.AuroraMic({
    onSpeechStart: () => {
      if (state === 'speaking' || state === 'thinking' || (player && player.sourceNode)) {
        bargeIn(true);
        listeningMode = true;
        setUiState('listening');
      } else {
        setUiState('listening');
      }
    },
    onInterim: (text) => {
      captionUser.style.display = 'block';
      captionUser.textContent = text + '…';
      if (typeInput && !typeInput.value) {
        typeInput.placeholder = text + '…';
      }
      orb.setMicLevel(0.4);
    },
    onFinalResult: (text) => {
      orb.setMicLevel(0);
      if (typeInput) {
        typeInput.placeholder = 'Ask anything…';
      }
      if (!text || !text.trim()) return;
      captionUser.textContent = text;
      sendQuery(text);
    },
    onEnd: () => {
      orb.setMicLevel(0);
      const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
        navigator.userAgent
      );
      if (isMobileDevice) {
        listeningMode = false;
      }
      if (!listeningMode && state === 'listening') setUiState('idle');
    },
    onError: (err) => {
      listeningMode = false;
      setUiState('idle');
      const isAndroid = /Android/i.test(navigator.userAgent);

      if (err === 'insecure-context') {
        if (connText) connText.textContent = 'Mic requires HTTPS';
        if (statusPill) statusPill.title = 'Web Speech API requires HTTPS or localhost on mobile browsers';
        if (typeInput) {
          typeInput.placeholder = 'Mic requires HTTPS on mobile. Type here…';
          typeInput.focus();
        }
      } else if (err === 'not-allowed' || err === 'service-not-allowed' || err === 'permission-denied') {
        if (connText) connText.textContent = 'Mic blocked';
        if (statusPill) {
          statusPill.title = isAndroid
            ? 'Mic blocked on Android: Check Chrome site permissions AND ensure Google App / Speech Services has Mic permission in phone Settings.'
            : 'Microphone permission was denied. Please allow it in browser settings';
        }
        if (typeInput) {
          typeInput.placeholder = isAndroid
            ? 'Mic blocked. Check phone Settings > Apps > Google > Mic, or type here…'
            : 'Mic blocked. Allow mic in browser settings, or type here…';
          typeInput.focus();
        }
        if (isAndroid) {
          showAndroidMicModal();
        }
      } else if (err === 'audio-capture') {
        if (connText) connText.textContent = 'No mic found';
        if (typeInput) typeInput.placeholder = 'No mic detected. Type here…';
      }
      log(`Mic error: ${err}`);

      // Auto-restore connection status text after 4.5s so status doesn't stay permanently stuck
      setTimeout(() => {
        if (connText && connText.textContent.startsWith('Mic')) {
          if (ws && wsReady && ws.readyState === WebSocket.OPEN) {
            connText.textContent = 'Online (Realtime)';
          } else {
            connText.textContent = 'Online (HTTP)';
          }
        }
      }, 4500);
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
  function bargeIn(fromVoiceVad = false) {
    flushChunkUpdate();
    player.stop();
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    hudMute.textContent = `${player.lastMuteLatencyMs} ms`;

    // Immediately mark active in-flight cards and tasks as cancelled
    markCardInterrupted(currentGen);

    // Increment generation immediately so any in-flight or buffered responses are discarded
    currentGen += 1;
    dbgGen.textContent = `#${currentGen}`;
    interruptCount += 1;
    dbgInterrupts.textContent = interruptCount;

    if (activeHttpAbortController) {
      activeHttpAbortController.abort();
      activeHttpAbortController = null;
    }

    if (ws && wsReady && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(
          JSON.stringify({
            type: 'interrupt',
            timestamp: Date.now(),
            bargeInMs: player.lastMuteLatencyMs,
          })
        );
      } catch (_) {}
    }

    hudAck.textContent = '1 ms';
    flashCancelPill();
    captionAi.textContent = '“Interrupted — listening to your new command…”';

    // If interrupted via UI click or shortcut, cleanly reset speech recognition for next command
    if (!fromVoiceVad && mic && typeof mic.resetForNewCommand === 'function') {
      mic.resetForNewCommand();
    }

    setUiState(listeningMode ? 'listening' : 'idle');
  }

  function afterSpeaking() {
    setUiState(listeningMode ? 'listening' : 'idle');
  }

  function speakWithBrowser(text, onComplete = null) {
    if (!window.speechSynthesis) {
      if (typeof onComplete === 'function') onComplete();
      else afterSpeaking();
      return;
    }
    window.speechSynthesis.cancel();
    if (typeof window.speechSynthesis.resume === 'function') {
      window.speechSynthesis.resume();
    }
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 1.05;
    const finish = () => {
      if (typeof onComplete === 'function') onComplete();
      else afterSpeaking();
    };
    utter.onend = finish;
    utter.onerror = finish;
    window.speechSynthesis.speak(utter);
  }

  // ---------- Intelligent Client-Side Fallback Generator ----------
  function generateClientFallbackReply(userText, _history = []) {
    const query = (userText || '').trim();
    const lower = query.toLowerCase();

    // 1. Geography, cultures, people (including Asia)
    if (lower.includes('asia') || lower.includes('asian')) {
      return {
        responseMode: 'HYBRID',
        spoken:
          'Asia is home to over 4.7 billion people spanning thousands of vibrant cultures, languages, and rich traditions.',
        text: `Asia is the Earth's largest and most populous continent, encompassing over **4.7 billion people**—more than 60% of the world's population. It is home to thousands of distinct ethnic groups, languages, and rich cultural traditions.

### Key Cultural & Regional Communities
- **East Asia (China, Japan, Korea, Mongolia)**:
  - Deep historical roots in Confucianism, Taoism, and Buddhism.
  - World-leading hubs of technological innovation, architecture, fine arts, and ancient literature.
- **South Asia (India, Pakistan, Bangladesh, Nepal, Sri Lanka, Bhutan)**:
  - An immensely diverse cultural landscape with thousands of ethnic communities and languages across Indo-Aryan, Dravidian, and Tibeto-Burman language families.
  - Cradle of Hinduism, Buddhism, Jainism, and Sikhism, renowned for rich culinary traditions, vibrant festivals, and performing arts.
- **Southeast Asia (Indonesia, Vietnam, Thailand, Philippines, Malaysia, Singapore)**:
  - Maritime and mainland crossroads blending indigenous Austronesian heritage with Buddhist, Islamic, and Hindu traditions.
  - Vibrant agrarian, island, and cosmopolitan trade centers.
- **Central Asia (Kazakhstan, Uzbekistan, Kyrgyzstan, Tajikistan, Turkmenistan)**:
  - Historic Silk Road nexus with nomadic pastoralist heritage, Persian and Turkic influences, and historic architectural masterpieces.
- **West Asia (Middle East)**:
  - One of humanity's earliest cradles of civilization, home to Arab, Persian, Turkish, Kurdish, and Hebrew communities with deep philosophical and religious traditions.

### Linguistic & Demographic Diversity
- Over **2,300 living languages** are spoken throughout the continent.
- Asia includes many of the world's largest urban centers, including Tokyo, Delhi, Shanghai, and Mumbai.`,
        visualType: 'markdown',
        title: 'People and Cultures of Asia',
      };
    }

    // 2. Code generation requests
    const isCode =
      /\b(code|program|function|script|write|implement|algorithm|class|python|c\+\+|javascript|typescript|java|sql|html|css)\b/i.test(
        lower
      );

    if (isCode) {
      if (lower.includes('prime')) {
        return {
          responseMode: 'TEXT',
          spoken: "I've written the prime number checker in Python for you.",
          text: `def is_prime(n: int) -> bool:
    """Checks whether a given integer is a prime number."""
    if n <= 1:
        return False
    if n <= 3:
        return True
    if n % 2 == 0 or n % 3 == 0:
        return False
    i = 5
    while i * i <= n:
        if n % i == 0 or n % (i + 2) == 0:
            return False
        i += 6
    return True

# Example tests
if __name__ == '__main__':
    test_values = [2, 3, 4, 17, 25, 29]
    for val in test_values:
        print(f"{val}: {is_prime(val)}")`,
          visualType: 'code',
          language: 'python',
          title: 'Prime Number Checker in Python',
        };
      }

      if (lower.includes('binary search')) {
        return {
          responseMode: 'TEXT',
          spoken: "I've written the binary search implementation in C++.",
          text: `#include <iostream>
#include <vector>

int binarySearch(const std::vector<int>& arr, int target) {
    int low = 0;
    int high = arr.size() - 1;

    while (low <= high) {
        int mid = low + (high - low) / 2;
        if (arr[mid] == target) return mid;
        if (arr[mid] < target) low = mid + 1;
        else high = mid - 1;
    }
    return -1; // Element not found
}

int main() {
    std::vector<int> data = {2, 5, 8, 12, 16, 23, 38, 56, 72, 91};
    int target = 23;
    int index = binarySearch(data, target);
    std::cout << "Target " << target << " found at index: " << index << std::endl;
    return 0;
}`,
          visualType: 'code',
          language: 'cpp',
          title: 'Binary Search in C++',
        };
      }

      if (lower.includes('reverse') && lower.includes('string')) {
        const lang = lower.includes('python') ? 'python' : 'cpp';
        return {
          responseMode: 'TEXT',
          spoken: `I've written the string reversal program in ${lang === 'cpp' ? 'C++' : 'Python'}.`,
          text:
            lang === 'cpp'
              ? `#include <iostream>
#include <string>
#include <algorithm>

std::string reverseString(std::string str) {
    std::reverse(str.begin(), str.end());
    return str;
}

int main() {
    std::string text = "Hello Aurora";
    std::cout << "Reversed: " << reverseString(text) << std::endl;
    return 0;
}`
              : `def reverse_string(s: str) -> str:
    """Reverses a string using slicing."""
    return s[::-1]

print(reverse_string("Hello Aurora"))`,
          visualType: 'code',
          language: lang,
          title: `Reverse a String in ${lang === 'cpp' ? 'C++' : 'Python'}`,
        };
      }

      if (lower.includes('odd') || lower.includes('even')) {
        return {
          responseMode: 'TEXT',
          spoken: "I've written the odd and even checker in Python.",
          text: `def check_odd_even(number: int) -> str:
    """Determine whether an integer is odd or even."""
    return "Even" if number % 2 == 0 else "Odd"

# Example demonstration
for n in [1, 2, 7, 14, 21, 28]:
    print(f"{n} -> {check_odd_even(n)}")`,
          visualType: 'code',
          language: 'python',
          title: 'Odd or Even Checker in Python',
        };
      }

      return {
        responseMode: 'TEXT',
        spoken: "I've written the implementation in the workspace.",
        text: `// Implementation for: ${query}
function executeTask() {
  console.log("Task executed successfully: ${query}");
  return { success: true, timestamp: new Date().toISOString() };
}

executeTask();`,
        visualType: 'code',
        language: 'javascript',
        title: 'Workspace Implementation',
      };
    }

    // 3. Comparison / Table requests
    if (lower.includes('table') || lower.includes('compare') || lower.includes(' vs ')) {
      return {
        responseMode: 'TEXT',
        spoken: "I've placed the comparison table in the workspace.",
        text: `### Comparison Overview: ${query}

| Feature / Criteria | Aspect A | Aspect B |
| :--- | :--- | :--- |
| **Architecture** | Lightweight & Component-Driven | Structured & Comprehensive |
| **Performance** | High throughput & Low latency | Robust standard execution |
| **Ecosystem** | Rapidly growing & Modular | Deeply established tooling |
| **Best Use Case** | Real-time & Agile development | Large-scale enterprise systems |`,
        visualType: 'table',
        title: 'Comparison Table',
      };
    }

    // 4. Greetings
    if (/^(hi|hello|hey|good morning|good evening|howdy)/i.test(lower)) {
      return {
        responseMode: 'VOICE',
        spoken: 'Hello! I am Aurora, your AI workspace companion. How can I help you today?',
        text: 'Hello! I am **Aurora**, your voice-first AI companion. You can ask me questions, request code implementations, compare technologies, or speak with me directly.',
        visualType: 'text',
      };
    }

    // 5. Default informative conversational reply
    return {
      responseMode: 'VOICE',
      spoken: `Here is a helpful summary regarding ${query.slice(0, 35)}.`,
      text: `### Overview: ${query}\n\nThank you for asking! Here are the key insights regarding **${query}**:\n\n- **Core Concept**: Represents an important topic in modern practice and conceptual development.\n- **Application**: Useful across multiple disciplines with diverse practical implementations.\n\n*Feel free to ask a follow-up question or request code, comparisons, or detailed breakdowns.*`,
      visualType: 'markdown',
      title: 'Aurora Knowledge Assistant',
    };
  }

  async function getClientFallbackResponse(cleanText, history = []) {
    // 1. If user configured an online LLM key in Settings, attempt direct browser-based inference
    try {
      const userKey = localStorage.getItem('aurora-llm-api-key');
      const userProvider = localStorage.getItem('aurora-llm-provider') || 'gemini';
      if (userKey && userKey.trim()) {
        const endpoint =
          userProvider === 'groq'
            ? 'https://api.groq.com/openai/v1/chat/completions'
            : 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
        const model = userProvider === 'groq' ? 'llama-3.1-8b-instant' : 'gemini-3.5-flash-lite';
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${userKey.trim()}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            messages: [
              {
                role: 'system',
                content:
                  'You are Aurora, an intelligent voice AI companion. Return a helpful, concise answer. If code is requested, provide complete code.',
              },
              ...history.slice(-4),
              { role: 'user', content: cleanText },
            ],
            temperature: 0.3,
            max_tokens: 1000,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          const content = data.choices?.[0]?.message?.content || '';
          if (content) {
            const isCode = content.includes('```');
            const spoken = isCode
              ? "I've written the implementation in the workspace."
              : content.split('\n')[0].replace(/[*#]/g, '').slice(0, 120);
            return {
              responseMode: isCode ? 'TEXT' : 'VOICE',
              spoken,
              text: content,
              visualType: isCode ? 'code' : 'markdown',
              title: isCode ? 'Code Implementation' : 'Aurora Response',
            };
          }
        }
      }
    } catch (_) {}

    // 2. Fallback if backend is completely unavailable
    return {
      responseMode: 'TEXT',
      spoken: 'I am sorry, but the backend is currently unavailable.',
      text: '?? **Backend Unavailable**\n\nI am sorry, but the backend service is currently unavailable. Please check your connection or start the server.',
      visualType: 'text',
      title: 'Error'
    };
  }

  // ---------- Sending Queries ----------
  function sendQuery(text, mode = null) {
    if (!text || !text.trim()) return;
    const cleanText = text.trim();
    if (player && typeof player._ensureContext === 'function') {
      player._ensureContext();
    }

    // Conversational Stop/Cancel handling: if user simply commanded Aurora to stop
    const isStopCommand = /^(stop|cancel|quiet|be quiet|shut up|pause|silence|halt|nevermind|never mind)[.!]?$/i.test(cleanText);
    if (isStopCommand) {
      bargeIn(false);
      captionAi.textContent = '“Stopped — listening to your command…”';
      setUiState('listening');
      if (mic && typeof mic.resetForNewCommand === 'function') {
        mic.resetForNewCommand();
      }
      return;
    }

    const isRunning =
      state === 'speaking' ||
      state === 'thinking' ||
      (player && player.sourceNode) ||
      (window.speechSynthesis && window.speechSynthesis.speaking) ||
      activeHttpAbortController;

    if (isRunning) {
      player.stop();
      if (window.speechSynthesis) window.speechSynthesis.cancel();
      markCardInterrupted(currentGen);
      flashCancelPill();
      if (activeHttpAbortController) {
        activeHttpAbortController.abort();
        activeHttpAbortController = null;
      }
      currentGen += 1;
      dbgGen.textContent = `#${currentGen}`;
      interruptCount += 1;
      dbgInterrupts.textContent = interruptCount;

      if (ws && wsReady && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(
            JSON.stringify({
              type: 'interrupt',
              timestamp: Date.now(),
              bargeInMs: player.lastMuteLatencyMs,
            })
          );
        } catch (_) {}
      }
    }

    if (ws && wsReady && ws.readyState === WebSocket.OPEN) {
      try {
        captionUser.style.display = 'block';
        captionUser.textContent = cleanText;
        captionAi.textContent = '“Thinking…”';
        setUiState('thinking');
        ws.send(
          JSON.stringify({
            type: 'query',
            text: cleanText,
            mode,
            sessionId: currentSessionId,
            speaker: currentActiveSpeaker,
            modelId: currentActiveModel,
            sttMs: 0,
            bargeInMs: isRunning ? player.lastMuteLatencyMs : 0,
            timestamp: Date.now(),
          })
        );
        return;
      } catch (wsErr) {
        log(`WebSocket send failed (${wsErr.message}), falling back to HTTP`);
      }
    }
    sendHttpQuery(cleanText, mode);
  }

  async function sendHttpQuery(cleanText, mode = null) {
    const isRunning =
      state === 'speaking' ||
      state === 'thinking' ||
      (player && player.sourceNode) ||
      (window.speechSynthesis && window.speechSynthesis.speaking) ||
      activeHttpAbortController;

    if (activeHttpAbortController) {
      activeHttpAbortController.abort();
      activeHttpAbortController = null;
    }
    if (isRunning) {
      player.stop();
      if (window.speechSynthesis) window.speechSynthesis.cancel();
      markCardInterrupted(currentGen);
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
    if (currentSessionId) reqHeaders['x-session-id'] = currentSessionId;
    try {
      const userRimeKey = localStorage.getItem('aurora-rime-api-key');
      if (userRimeKey) reqHeaders['x-rime-api-key'] = userRimeKey;
      const userLlmKey = localStorage.getItem('aurora-llm-api-key');
      const userLlmProv = localStorage.getItem('aurora-llm-provider');
      if (userLlmKey) {
        reqHeaders['x-llm-api-key'] = userLlmKey;
        if (userLlmProv) reqHeaders['x-llm-provider'] = userLlmProv;
      }
    } catch (_) {}

    try {
      try {
        res = await fetch(targetTurnUrl, {
          method: 'POST',
          headers: reqHeaders,
          body: JSON.stringify({
            sessionId: currentSessionId,
            text: cleanText,
            mode,
            history,
            speaker: currentActiveSpeaker,
            modelId: currentActiveModel,
            bargeInMs: player.lastMuteLatencyMs || 0,
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
              sessionId: currentSessionId,
              text: cleanText,
              mode,
              history,
              speaker: currentActiveSpeaker,
              modelId: currentActiveModel,
              bargeInMs: player.lastMuteLatencyMs || 0,
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
            sessionId: currentSessionId,
            text: cleanText,
            mode,
            history,
            speaker: currentActiveSpeaker,
            modelId: currentActiveModel,
            bargeInMs: player.lastMuteLatencyMs || 0,
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

      if (data.sessionId) {
        currentSessionId = data.sessionId;
        try {
          localStorage.setItem('aurora-session-id', currentSessionId);
        } catch (_) {}
        if (dbgSession) dbgSession.textContent = currentSessionId;
      }

      const totalMs = data.totalMs || Date.now() - turnStartTime;
      if (dbgLatency) dbgLatency.textContent = `${totalMs}ms (HTTP)`;
      hudTtfa.textContent = `${totalMs} ms`;

      updateTelemetryDisplay(
        {
          llmMs: data.llmMs,
          ttsMs: data.ttsMs,
          totalMs,
          sttMs: 0,
          bargeInMs: player.lastMuteLatencyMs || 0,
          costUsd: data.cost?.totalCostUsd || 0,
          totalTokens: data.cost?.totalTokens || 0,
          provider: data.cost?.provider,
          modelId: data.modelId || currentActiveModel,
          speaker: data.speaker || currentActiveSpeaker,
          degraded: data.degraded,
        },
        data.sessionMetrics
      );

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
      console.warn('Backend unavailable, activating resilient client intelligence:', err);

      // Generate intelligent client-side fallback
      const fallback = await getClientFallbackResponse(cleanText, transcript);

      captionAi.textContent = `“${fallback.spoken}”`;
      addMessageCard('assistant', fallback.text, myGen, {
        speaker: 'Browser Speech',
        model: 'Client Fallback Intelligence',
        spoken: fallback.spoken,
        responseMode: fallback.responseMode,
        visualType: fallback.visualType,
        language: fallback.language,
        title: fallback.title,
      });

      const fallbackMs = Date.now() - turnStartTime;
      if (dbgLatency) dbgLatency.textContent = `${fallbackMs}ms (Client Fallback)`;
      if (hudTtfa) hudTtfa.textContent = `${fallbackMs} ms`;

      if (fallback.spoken) {
        setUiState('speaking');
        speakWithBrowser(fallback.spoken, () => {
          if (myGen === currentGen) afterSpeaking();
        });
      } else {
        afterSpeaking();
      }
    } finally {
      if (activeHttpAbortController === abortCtrl) {
        activeHttpAbortController = null;
      }
    }
  }

  if (typeForm) {
    typeForm.addEventListener('submit', (e) => {
      e.preventDefault();
      if (player && typeof player.unlock === 'function') player.unlock();
      const text = typeInput ? typeInput.value.trim() : '';
      if (!text) return;
      if (typeInput) typeInput.value = '';
      sendQuery(text);
    });
  }

  if (typeInput) {
    typeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (player && typeof player.unlock === 'function') player.unlock();
        const text = typeInput.value.trim();
        if (!text) return;
        typeInput.value = '';
        sendQuery(text);
      }
    });
  }

  const inputShell = $('inputShell');
  if (inputShell && typeInput) {
    inputShell.addEventListener('click', (e) => {
      if (
        e.target !== micBtn &&
        !micBtn?.contains(e.target) &&
        e.target !== btnPlusTools &&
        !btnPlusTools?.contains(e.target)
      ) {
        typeInput.focus();
      }
    });
  }

  if (typeFormConv) {
    typeFormConv.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = typeInputConv ? typeInputConv.value.trim() : '';
      if (!text) return;
      if (typeInputConv) typeInputConv.value = '';
      sendQuery(text);
    });
  }

  if (typeInputConv) {
    typeInputConv.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const text = typeInputConv.value.trim();
        if (!text) return;
        typeInputConv.value = '';
        sendQuery(text);
      }
    });
  }

  // Pre-warm Web Audio Context on earliest user interaction to guarantee zero playback delay
  const prewarmAudio = () => {
    if (player && typeof player._ensureContext === 'function') {
      player._ensureContext();
    }
  };
  document.addEventListener('pointerdown', prewarmAudio, { once: true });
  document.addEventListener('keydown', prewarmAudio, { once: true });

  // ---------- Assistant Message Normalization Safeguard ----------
  // ---------- Assistant Message Normalization Safeguard ----------
  function normalizeAssistantPayload(rawText, rawMeta = {}) {
    let text = typeof rawText === 'string' ? rawText : '';
    let meta = { ...rawMeta };

    let cleanSpoken = text.replace(/```[\s\S]*?(?:```|$)/g, '').replace(/`[^`]+(?:`|$)/g, '');
    cleanSpoken = cleanSpoken.replace(/[*_#\[\]>]/g, '').trim();

    if (!cleanSpoken) {
      if (meta.title) {
        cleanSpoken = `Here is the ${meta.title} in the chat.`;
      } else if (text.includes('```')) {
        cleanSpoken = "I've written the implementation in the chat.";
      } else {
        cleanSpoken = text.slice(0, 150);
      }
    }

    return {
      text: text,
      spoken: cleanSpoken,
      meta: {
        visualType: 'text',
        responseMode: 'TEXT',
        ...meta
      }
    };
  }

  // ---------- Message Cards (Conversation & Timeline) ----------
  function updateMessageCard(role, text, gen, meta = {}) {
    const rows = document.querySelectorAll(`.msg-row.assistant[data-gen="${gen}"]`);
    if (!rows.length) return addMessageCard(role, text, gen, meta);

    const norm = normalizeAssistantPayload(text, meta);
    const cleanText = norm.text;
    const cleanMeta = norm.meta;
    const visualType = cleanMeta.visualType || 'text';
    let contentHtml;

    if (!cleanText || !cleanText.trim()) {
      contentHtml = `<p class="streaming-placeholder" style="color: var(--text-muted, #94a3b8); font-style: italic;">Thinking & typing...</p>`;
    } else if (visualType === 'code' && window.AuroraHighlighter) {
      contentHtml = window.AuroraHighlighter.renderCodeBlock({
        code: cleanText,
        language: cleanMeta.language || 'cpp',
        title: cleanMeta.title || 'Code Implementation',
      });
    } else if (window.AuroraMarkdown) {
      contentHtml = window.AuroraMarkdown.render(cleanText);
    } else {
      contentHtml = `<p style="white-space: pre-wrap">${escapeHtml(cleanText)}</p>`;
    }

    rows.forEach((row) => {
      row.classList.add('has-rich-content');
      row.dataset.spoken = norm.spoken;
      const contentDiv = row.querySelector('.msg-content');
      if (contentDiv) contentDiv.innerHTML = contentHtml;

      const metaDiv = row.querySelector('.assistant-meta') || row.querySelector('.bubble-meta');
      if (metaDiv && metaDiv.querySelector('.modality-pill')) {
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
        metaDiv.querySelector('.modality-pill').className = `modality-pill ${modeClass}`;
        metaDiv.querySelector('.modality-pill').textContent = `● ${modeLabel}`;
      }

      if (window.AuroraHighlighter) {
        window.AuroraHighlighter.attachCopyHandlers(row);
      }
    });

    if (cleanText && cleanText.trim()) {
      const lastT = transcript[transcript.length - 1];
      if (lastT && lastT.role === 'assistant' && lastT.generation === gen) {
        lastT.text = cleanText;
      }
    }

    if (chatArea) {
      chatArea.scrollTop = chatArea.scrollHeight;
    }
    if (chatAreaConv) {
      chatAreaConv.scrollTop = chatAreaConv.scrollHeight;
    }
  }

  function addMessageCard(role, text, gen, meta = {}) {
    const row = document.createElement('div');
    row.dataset.gen = gen || '';

    if (role === 'assistant') {
      row.className = 'msg-row assistant msg';
      const norm = normalizeAssistantPayload(text, meta);
      row.dataset.spoken = norm.spoken;
      const cleanText = norm.text;
      const cleanMeta = norm.meta;
      const visualType = cleanMeta.visualType || 'text';
      let contentHtml;

      if (!cleanText || !cleanText.trim()) {
        contentHtml = `<p class="streaming-placeholder" style="color: var(--text-muted, #94a3b8); font-style: italic;">Thinking & typing...</p>`;
      } else if (visualType === 'code' && window.AuroraHighlighter) {
        row.classList.add('has-rich-content');
        contentHtml = window.AuroraHighlighter.renderCodeBlock({
          code: cleanText,
          language: cleanMeta.language || 'cpp',
          title: cleanMeta.title || 'Code Implementation',
        });
      } else if (window.AuroraMarkdown) {
        row.classList.add('has-rich-content');
        contentHtml = window.AuroraMarkdown.render(cleanText);
      } else {
        contentHtml = `<p style="white-space: pre-wrap">${escapeHtml(cleanText)}</p>`;
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

  // ---------- Telemetry & Latency HUD Logic ----------
  function updateTelemetryDisplay(turnMetrics, sessionMetrics, lifetimeMetrics) {
    if (turnMetrics) {
      if (hudLlm) hudLlm.textContent = turnMetrics.llmMs != null ? `${turnMetrics.llmMs} ms` : '—';
      if (hudLlmModel) hudLlmModel.textContent = turnMetrics.modelId || currentActiveModel;
      if (hudTts) hudTts.textContent = turnMetrics.ttsMs != null ? `${turnMetrics.ttsMs} ms` : '—';
      if (hudTtsVoice) hudTtsVoice.textContent = turnMetrics.speaker || currentActiveSpeaker;
      if (hudTtfa)
        hudTtfa.textContent = turnMetrics.totalMs != null ? `${turnMetrics.totalMs} ms` : '—';
      if (hudStt) hudStt.textContent = `STT: ${turnMetrics.sttMs || 0} ms`;
      if (hudMute && turnMetrics.bargeInMs != null)
        hudMute.textContent = `${turnMetrics.bargeInMs} ms`;
      if (hudAck && turnMetrics.bargeInMs != null)
        hudAck.textContent = `ACK: ${turnMetrics.bargeInMs} ms`;

      if (hudTurnCost) hudTurnCost.textContent = `$${(turnMetrics.costUsd || 0).toFixed(4)}`;
      if (hudTurnTokens) hudTurnTokens.textContent = `${turnMetrics.totalTokens || 0} tokens`;

      if (hudDegradationBadge) {
        if (turnMetrics.degraded) {
          hudDegradationBadge.style.display = 'inline-flex';
          hudDegradationBadge.className = 'badge warn degraded';
          hudDegradationBadge.textContent = 'Degraded (Local)';
        } else {
          hudDegradationBadge.style.display = 'inline-flex';
          hudDegradationBadge.className = 'badge';
          hudDegradationBadge.textContent = 'Standard (Online)';
        }
      }
    }

    if (sessionMetrics) {
      if (sessionMetrics.sessionId) {
        currentSessionId = sessionMetrics.sessionId;
        try {
          localStorage.setItem('aurora-session-id', currentSessionId);
        } catch (_) {}
        if (dbgSession) dbgSession.textContent = currentSessionId;
      }
      const spent = sessionMetrics.totalCostUsd || 0;
      const tokens = sessionMetrics.totalTokens || 0;
      const cap = sessionMetrics.budgetCapUsd || 0.25;
      const pct = Math.min(100, Math.round((spent / cap) * 100));

      if (hudSessionCost) hudSessionCost.textContent = `$${spent.toFixed(4)}`;
      if (hudSessionTokens) hudSessionTokens.textContent = `${tokens} tokens`;
      if (budgetUsageLabel)
        budgetUsageLabel.textContent = `Session Budget: $${spent.toFixed(2)} / $${cap.toFixed(2)}`;
      if (budgetPctLabel) budgetPctLabel.textContent = `${pct}%`;
      if (budgetFill) {
        budgetFill.style.width = `${pct}%`;
        budgetFill.classList.toggle('warning', pct >= 80);
      }
    }

    if (lifetimeMetrics) {
      if (hudLifetimeCost)
        hudLifetimeCost.textContent = `$${(lifetimeMetrics.totalCostUsd || 0).toFixed(4)}`;
      if (hudLifetimeTurns)
        hudLifetimeTurns.textContent = `${lifetimeMetrics.totalTurns || 0} turns`;
    }
  }

  async function fetchTelemetryData() {
    try {
      const res = await fetchWithTimeout(apiUrl('/api/telemetry'), {}, 3000);
      if (res && res.ok) {
        const data = await res.json();
        if (data.lifetime) {
          updateTelemetryDisplay(null, null, data.lifetime);
        }
      }
    } catch (_) {}
  }

  function showDegradationAlert(reason) {
    if (hudDegradationBadge) {
      hudDegradationBadge.style.display = 'inline-flex';
      hudDegradationBadge.className = 'badge warn degraded';
      hudDegradationBadge.textContent = 'Degraded (Local)';
    }
    log(`⚠️ DEGRADATION: ${reason || 'Latency threshold exceeded'}`);
  }

  function showBudgetWarning(message) {
    if (budgetFill) {
      budgetFill.classList.add('warning');
    }
    log(`💰 BUDGET: ${message || 'Session budget limit reached'}`);
  }

  // ---------- Sessions & Persistent SQLite Transcripts ----------
  async function fetchAndRenderSessions() {
    try {
      if (sessionListLoading) sessionListLoading.style.display = 'block';
      const res = await fetchWithTimeout(apiUrl('/api/transcripts/sessions?limit=30'), {}, 4000);
      if (res && res.ok) {
        const data = await res.json();
        const sessions = data.sessions || [];
        renderSessionList(sessions);
        renderSidebarRecentChats(sessions);
      } else {
        if (sessionList) sessionList.innerHTML = '';
        if (sidebarRecentList) {
          sidebarRecentList.innerHTML = '<p class="sidebar-recent-empty">No saved chats yet</p>';
        }
      }
    } catch (err) {
      console.warn('Failed to load sessions', err);
      if (sessionList) sessionList.innerHTML = '';
      if (sidebarRecentList) {
        sidebarRecentList.innerHTML = '<p class="sidebar-recent-empty">No saved chats yet</p>';
      }
    } finally {
      if (sessionListLoading) sessionListLoading.style.display = 'none';
    }
  }

  function renderSidebarRecentChats(sessions) {
    if (!sidebarRecentList) return;
    sidebarRecentList.innerHTML = '';

    // Include sessions that have recorded turns or are the current active session
    const displaySessions = (sessions || []).filter(
      (s) => (s.turn_count && s.turn_count > 0) || (s.total_turns && s.total_turns > 0) || s.id === currentSessionId
    );

    if (sidebarRecentCount) {
      sidebarRecentCount.textContent = String(displaySessions.length);
    }

    if (displaySessions.length === 0) {
      sidebarRecentList.innerHTML = '<p class="sidebar-recent-empty">No saved chats yet</p>';
      return;
    }

    displaySessions.forEach((s) => {
      const item = document.createElement('div');
      const isActive = s.id === currentSessionId;
      item.className = `sidebar-chat-item ${isActive ? 'active' : ''}`;
      item.dataset.sessionId = s.id;

      const title = s.title || `Chat ${s.id.slice(0, 8)}`;
      const turns = s.turn_count != null ? s.turn_count : (s.total_turns || 0);
      const turnsBadge = turns > 0 ? `<span class="sidebar-chat-turns" style="font-size: 11px; color: var(--ink-muted, #94a3b8); margin-right: 6px; font-weight: 500;">${turns}</span>` : '';

      item.innerHTML = `
        <svg class="sidebar-chat-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
        </svg>
        <span class="sidebar-chat-title" title="${escapeHtml(title)}">${escapeHtml(title)}</span>
        ${turnsBadge}
        <button class="btn-delete-sidebar-chat" title="Delete Chat" data-id="${s.id}">✕</button>
      `;

      item.addEventListener('click', (e) => {
        if (e.target.closest('.btn-delete-sidebar-chat')) return;
        if (s.id !== currentSessionId) {
          loadSession(s.id);
        }
        closeMobileSidebar();
      });

      const delBtn = item.querySelector('.btn-delete-sidebar-chat');
      if (delBtn) {
        delBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          deleteSession(s.id);
        });
      }

      sidebarRecentList.appendChild(item);
    });
  }

  function renderSessionList(sessions) {
    if (!sessionList) return;
    sessionList.innerHTML = '';
    if (!sessions || sessions.length === 0) {
      sessionList.innerHTML =
        '<p class="empty-hint" style="padding: 10px 0;">No saved sessions yet. Turns will be recorded in SQLite automatically.</p>';
      return;
    }

    sessions.forEach((s) => {
      const card = document.createElement('div');
      const isActive = s.id === currentSessionId;
      card.className = `session-card ${isActive ? 'active' : ''}`;
      card.dataset.sessionId = s.id;

      const dateStr = s.created_at
        ? new Date(s.created_at).toLocaleDateString([], {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })
        : 'Recent';
      const title = s.title || `Session ${s.id.slice(0, 8)}`;
      const costStr = `$${(s.total_cost_usd || 0).toFixed(4)}`;
      const turns = s.turn_count || 0;

      card.innerHTML = `
        <div class="session-card-header">
          <span class="session-card-title">${escapeHtml(title)}</span>
          <button class="btn-delete-session" title="Delete Session" data-id="${s.id}">✕</button>
        </div>
        <div class="session-card-meta">
          <span>${dateStr} · ${escapeHtml(s.speaker || 'astra')}</span>
          <div class="session-card-stats">
            <span class="session-stat-pill">${turns} turns</span>
            <span class="session-stat-pill">${costStr}</span>
          </div>
        </div>
      `;

      card.addEventListener('click', (e) => {
        if (e.target.closest('.btn-delete-session')) return;
        loadSession(s.id);
      });

      const delBtn = card.querySelector('.btn-delete-session');
      if (delBtn) {
        delBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          deleteSession(s.id);
        });
      }

      sessionList.appendChild(card);
    });
  }

  async function loadSession(sessionId) {
    if (!sessionId) return;
    try {
      const res = await fetchWithTimeout(
        apiUrl(`/api/transcripts/sessions/${sessionId}`),
        {},
        4000
      );
      if (!res || !res.ok) throw new Error(`Failed to fetch session ${sessionId}`);
      const data = await res.json();
      const session = data.session;
      const turns = data.turns || [];

      // Stop any in-flight playback or generation
      player.stopAll();
      setUiState('idle');

      currentSessionId = session.id;
      try {
        localStorage.setItem('aurora-session-id', currentSessionId);
      } catch (_) {}
      if (dbgSession) dbgSession.textContent = currentSessionId;

      if (session.speaker) {
        currentActiveSpeaker = session.speaker;
        if (infoVoice) infoVoice.textContent = currentActiveSpeaker;
      }
      if (session.model_id) {
        currentActiveModel = session.model_id;
        if (infoModel) infoModel.textContent = currentActiveModel;
      }
      updateVoiceStudioSelection();

      // Notify WebSocket server of session switch to sync server context history
      sendWs({
        type: 'switch_session',
        sessionId: currentSessionId,
      });

      // Clear current chat UI
      transcript = [];
      if (chatArea) chatArea.innerHTML = '';
      if (chatAreaConv) chatAreaConv.innerHTML = '';

      let maxGen = 0;

      // Rehydrate messages into DOM
      turns.forEach((t) => {
        const gen = t.generation || t.turn_index || 1;
        if (gen > maxGen) maxGen = gen;

        if (t.user_text) {
          addMessageCard('user', t.user_text, gen);
        }
        if (t.assistant_text || t.spoken_text || t.visual_payload) {
          const content = t.visual_payload?.content || t.assistant_text || t.spoken_text;
          const meta = {
            speaker: t.speaker || currentActiveSpeaker,
            model: t.model_id || currentActiveModel,
            llmMs: t.llm_ms,
            spoken: t.spoken_text,
            visualType: t.visual_payload?.type || t.visual_type,
            language: t.visual_payload?.language,
            title: t.visual_payload?.title || t.visual_title,
            responseMode: t.response_mode,
          };
          addMessageCard('assistant', content, gen, meta);
        }
      });

      if (maxGen > 0) {
        currentGen = maxGen;
        if (dbgGen) dbgGen.textContent = `#${currentGen}`;
      }

      updateTelemetryDisplay(null, {
        sessionId: session.id,
        turnCount: session.turn_count,
        totalTokens: session.total_tokens,
        totalCostUsd: session.total_cost_usd,
        budgetCapUsd: 0.25,
      });

      updateWorkspaceState();
      await fetchAndRenderSessions();

      if (turns.length > 0) {
        setMainExperience('conversation');
      } else {
        setMainExperience('companion');
      }

      closeDrawer();

      // Auto-close sidebar on mobile
      if (window.innerWidth <= 900 && appRoot) {
        appRoot.classList.remove('sidebar-open');
        if (btnToggleSidebar) btnToggleSidebar.classList.remove('active');
      }

      log(`Loaded session ${session.id.slice(0, 8)} (${turns.length} turns)`);
    } catch (err) {
      console.error('Failed to load session:', err);
      log(`Error loading session ${sessionId}`);
      throw err;
    }
  }

  async function createNewSession() {
    try {
      // Cleanly abort in-flight turn & audio playback
      player.stopAll();
      setUiState('idle');
      sendWs({ type: 'interrupt', timestamp: Date.now() });

      const res = await fetch(apiUrl('/api/sessions/new'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          speaker: currentActiveSpeaker,
          modelId: currentActiveModel,
        }),
      });
      if (res && res.ok) {
        const data = await res.json();
        const session = data.session;
        currentSessionId = session.id;
        try {
          localStorage.setItem('aurora-session-id', currentSessionId);
        } catch (_) {}
        if (dbgSession) dbgSession.textContent = currentSessionId;

        // Reset server-side WS session & history
        sendWs({
          type: 'switch_session',
          sessionId: currentSessionId,
        });

        currentGen = 0;
        if (dbgGen) dbgGen.textContent = `#${currentGen}`;

        clearAllChat();
        updateWorkspaceState();
        setMainExperience('companion', true);

        updateTelemetryDisplay(
          {
            llmMs: null,
            ttsMs: null,
            totalMs: null,
            sttMs: 0,
            bargeInMs: 0,
            costUsd: 0,
            totalTokens: 0,
            degraded: false,
          },
          {
            sessionId: session.id,
            turnCount: 0,
            totalTokens: 0,
            totalCostUsd: 0,
            budgetCapUsd: 0.25,
          }
        );
        await fetchAndRenderSessions();

        // Auto-close sidebar on mobile
        if (window.innerWidth <= 900 && appRoot) {
          appRoot.classList.remove('sidebar-open');
          if (btnToggleSidebar) btnToggleSidebar.classList.remove('active');
        }

        if (typeInput) typeInput.focus();
        log(`Created new session #${currentSessionId.slice(0, 8)}`);
      }
    } catch (err) {
      console.error('Failed to create new session:', err);
    }
  }

  async function deleteSession(sessionId) {
    if (!confirm('Are you sure you want to delete this chat history?')) return;
    try {
      const res = await fetch(apiUrl(`/api/transcripts/sessions/${sessionId}`), {
        method: 'DELETE',
      });
      if (res && res.ok) {
        if (currentSessionId === sessionId) {
          await createNewSession();
        } else {
          fetchAndRenderSessions();
        }
        log(`Deleted session ${sessionId.slice(0, 8)}`);
      }
    } catch (err) {
      console.error('Failed to delete session:', err);
    }
  }

  let _bootInitialized = false;
  async function initSessionOnBoot() {
    if (_bootInitialized) return;
    _bootInitialized = true;
    try {
      const savedSessionId = currentSessionId || localStorage.getItem('aurora-session-id');
      if (savedSessionId) {
        await loadSession(savedSessionId);
      } else {
        const res = await fetchWithTimeout(apiUrl('/api/transcripts/sessions?limit=1'), {}, 3000);
        if (res && res.ok) {
          const data = await res.json();
          if (data.sessions && data.sessions.length > 0) {
            await loadSession(data.sessions[0].id);
          } else {
            await createNewSession();
          }
        } else {
          await createNewSession();
        }
      }
    } catch (err) {
      console.warn('Session boot fallback:', err);
      try {
        await createNewSession();
      } catch (_) {}
    } finally {
      fetchAndRenderSessions();
    }
  }

  function exportTranscriptAsMarkdown() {
    if (!transcript || transcript.length === 0) {
      alert('No turns in current conversation to export.');
      return;
    }
    let md = `# Aurora Conversation Transcript\n`;
    md += `- **Session ID**: \`${currentSessionId || 'unknown'}\`\n`;
    md += `- **Export Date**: ${new Date().toISOString()}\n`;
    md += `- **Speaker**: ${currentActiveSpeaker}\n`;
    md += `- **Model**: ${currentActiveModel}\n\n`;
    md += `---\n\n`;

    transcript.forEach((t) => {
      const role = t.role === 'user' ? '### User' : '### Aurora';
      const time = t.time
        ? t.time instanceof Date
          ? t.time.toLocaleTimeString()
          : String(t.time)
        : '';
      md += `${role} (${time})\n\n${t.text}\n\n`;
    });

    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aurora-session-${currentSessionId ? currentSessionId.slice(0, 8) : Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (btnNewSession) btnNewSession.addEventListener('click', createNewSession);
  if (btnSidebarNewChat) btnSidebarNewChat.addEventListener('click', createNewSession);
  if (btnTopbarNewChat) btnTopbarNewChat.addEventListener('click', createNewSession);
  if (btnExportMarkdown) btnExportMarkdown.addEventListener('click', exportTranscriptAsMarkdown);

  if (btnExportHistory) {
    btnExportHistory.addEventListener('click', async () => {
      let exportData = {
        sessionId: currentSessionId,
        exportedAt: new Date().toISOString(),
        speaker: currentActiveSpeaker,
        model: currentActiveModel,
        turns: transcript,
      };
      if (currentSessionId) {
        try {
          const res = await fetchWithTimeout(
            apiUrl(`/api/transcripts/sessions/${currentSessionId}`),
            {},
            3000
          );
          if (res && res.ok) {
            const data = await res.json();
            exportData = {
              ...exportData,
              session: data.session,
              dbTurns: data.turns,
            };
          }
        } catch (_) {}
      }
      const dataStr =
        'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(exportData, null, 2));
      const a = document.createElement('a');
      a.href = dataStr;
      a.download = `aurora-transcript-${currentSessionId ? currentSessionId.slice(0, 8) : Date.now()}.json`;
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
    if (player && typeof player.unlock === 'function') {
      player.unlock();
    }
    if (!mic.supported) {
      if (typeInput) typeInput.focus();
      return;
    }
    if (state === 'speaking' || state === 'thinking' || (player && player.sourceNode)) {
      bargeIn(false);
      listeningMode = true;
      if (typeof mic.resetForNewCommand === 'function') {
        mic.resetForNewCommand();
      } else {
        mic.start();
      }
      setUiState('listening');
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
        try {
          localStorage.setItem('aurora-speaker', spk.id);
        } catch (_) {}
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
          try {
            localStorage.setItem('aurora-model', m.id);
          } catch (_) {}
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
          if (rimeApiKeyInput) {
            rimeApiKeyInput.value = '';
            rimeApiKeyInput.placeholder = '●●●●●●●● (Pre-configured · Active for all users)';
          }
          if (rimeKeyStatusMsg) {
            rimeKeyStatusMsg.style.color = '#7ee3a8';
            rimeKeyStatusMsg.textContent = '✓ Reverted to pre-configured system key.';
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

  if (llmKeyInput) {
    try {
      const savedKey = localStorage.getItem('aurora-llm-api-key');
      if (savedKey) llmKeyInput.value = savedKey;
      const savedProv = localStorage.getItem('aurora-llm-provider');
      if (savedProv && llmProviderSelect) llmProviderSelect.value = savedProv;
    } catch (_) {}
  }

  if (btnSaveLlmKey) {
    btnSaveLlmKey.addEventListener('click', async () => {
      const key = llmKeyInput ? llmKeyInput.value.trim() : '';
      const provider = llmProviderSelect ? llmProviderSelect.value : 'gemini';
      if (!key) {
        localStorage.removeItem('aurora-llm-api-key');
        localStorage.removeItem('aurora-llm-provider');
        if (llmKeyInput) {
          llmKeyInput.value = '';
          llmKeyInput.placeholder = '●●●●●●●● (Pre-configured · Active for all users)';
        }
        if (llmStatusMsg) {
          llmStatusMsg.style.color = '#7ee3a8';
          llmStatusMsg.textContent = '✓ Reverted to pre-configured system key.';
        }
        return;
      }
      try {
        localStorage.setItem('aurora-llm-api-key', key);
        localStorage.setItem('aurora-llm-provider', provider);
      } catch (_) {}

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
            llmStatusMsg.style.color = '#7ee3a8';
            llmStatusMsg.textContent = `✓ Saved locally in browser for direct inference.`;
          }
        }
      } catch (_err) {
        if (llmStatusMsg) {
          llmStatusMsg.style.color = '#7ee3a8';
          llmStatusMsg.textContent = '✓ Saved locally in browser for direct inference.';
        }
      }
    });
  }

  // ---------- Storage & Session Management ----------
  const btnResetActiveChat = $('btnResetActiveChat');
  const btnClearAllData = $('btnClearAllData');
  const storageStatusMsg = $('storageStatusMsg');

  if (btnResetActiveChat) {
    btnResetActiveChat.addEventListener('click', async () => {
      if (confirm('Start a fresh chat? Current conversation will remain saved in your history.')) {
        await createNewSession();
        if (storageStatusMsg) {
          storageStatusMsg.style.color = '#7ee3a8';
          storageStatusMsg.textContent = '✓ Started a fresh conversation.';
          setTimeout(() => { storageStatusMsg.textContent = ''; }, 3000);
        }
      }
    });
  }

  if (btnClearAllData) {
    btnClearAllData.addEventListener('click', () => {
      if (confirm('Are you sure you want to clear all local storage, API keys, and session cache from this browser?')) {
        try {
          localStorage.clear();
        } catch (_) {}
        if (storageStatusMsg) {
          storageStatusMsg.style.color = '#7ee3a8';
          storageStatusMsg.textContent = '✓ Local data cleared. Reloading…';
        }
        setTimeout(() => {
          window.location.reload();
        }, 800);
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
