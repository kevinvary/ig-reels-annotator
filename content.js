// IG Reels Annotator — Content Script (connected to IG Tracker API)
(function () {
  'use strict';

  if (document.getElementById('ig-annotator-panel')) return;

  // --- Storage ---
  const STORAGE_KEY = 'iga_annotations';
  const CONFIG_KEY = 'iga_config'; // { apiUrl, token }
  const DEFAULT_API_URL = 'http://204.168.197.14:3001';

  function loadAnnotations() {
    return new Promise((resolve) => {
      chrome.storage.local.get(STORAGE_KEY, (data) => resolve(data[STORAGE_KEY] || []));
    });
  }

  function saveAnnotations(annotations) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [STORAGE_KEY]: annotations }, resolve);
    });
  }

  function loadConfig() {
    return new Promise((resolve) => {
      chrome.storage.local.get(CONFIG_KEY, (data) => {
        const config = data[CONFIG_KEY] || {};
        if (!config.apiUrl) config.apiUrl = DEFAULT_API_URL;
        resolve(config);
      });
    });
  }

  function saveConfig(config) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [CONFIG_KEY]: config }, resolve);
    });
  }

  // --- API (routed through background.js to bypass mixed content) ---
  function bgFetch(url, method = 'GET', headers = {}, body = null) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'api', url, method, headers, body }, (resp) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!resp) return reject(new Error('No response from background'));
        if (!resp.ok) return reject(new Error(resp.data?.error || `HTTP ${resp.status}`));
        resolve(resp.data);
      });
    });
  }

  async function apiCall(path, method = 'GET', body = null) {
    const config = await loadConfig();
    if (!config.token) throw new Error('No autenticado — ingresa tu clave de acceso');
    const url = (config.apiUrl || DEFAULT_API_URL).replace(/\/$/, '') + path;
    return bgFetch(url, method, { 'Authorization': `Bearer ${config.token}`, 'Content-Type': 'application/json' }, body);
  }

  // Login with access key (same key used in the web app)
  async function loginWithKey(key) {
    const config = await loadConfig();
    const url = (config.apiUrl || DEFAULT_API_URL).replace(/\/$/, '') + '/api/auth/login';
    return bgFetch(url, 'POST', { 'Content-Type': 'application/json' }, { key });
  }

  async function addAccountToTracker(username, accountType) {
    return apiCall('/api/accounts', 'POST', { handle: username, account_type: accountType });
  }

  // --- Detect current reel info ---
  const RESERVED_NAMES = /^(reels?|explore|direct|accounts|p|stories|tags|locations|api|static)$/;
  const USERNAME_REGEX = /^[a-zA-Z0-9_.]{2,30}$/;

  // Extract username from href — supports /user/, /user/reels/, /user/reel/ID
  function extractUsernameFromHref(href) {
    // /username/reels/ pattern (used in reels feed)
    const reelsMatch = href.match(/^\/([a-zA-Z0-9_.]{1,30})\/reels?\//);
    if (reelsMatch && !RESERVED_NAMES.test(reelsMatch[1])) return reelsMatch[1];
    // /username/ pattern (profile links)
    const profileMatch = href.match(/^\/([a-zA-Z0-9_.]{1,30})\/$/);
    if (profileMatch && !RESERVED_NAMES.test(profileMatch[1])) return profileMatch[1];
    return null;
  }

  // Find the most centered visible video (the one the user is actually watching)
  function findActiveVideo() {
    const videos = document.querySelectorAll('video');
    let best = null;
    let bestDist = Infinity;
    const centerY = window.innerHeight / 2;
    for (const v of videos) {
      const rect = v.getBoundingClientRect();
      if (rect.height < 200 || rect.bottom < 0 || rect.top > window.innerHeight) continue;
      const mid = (rect.top + rect.bottom) / 2;
      const dist = Math.abs(mid - centerY);
      if (dist < bestDist) { bestDist = dist; best = v; }
    }
    return best;
  }

  // Find the Follow/Seguir button closest to the active video
  function findFollowButtonNearVideo(video) {
    if (!video) return null;
    const videoRect = video.getBoundingClientRect();
    const buttons = document.querySelectorAll('button');
    let best = null;
    let bestDist = Infinity;
    for (const btn of buttons) {
      const txt = btn.textContent?.trim();
      if (txt !== 'Seguir' && txt !== 'Follow') continue;
      const rect = btn.getBoundingClientRect();
      if (rect.height === 0 || rect.top > window.innerHeight || rect.bottom < 0) continue;
      // Must be within or below the video area
      const dist = Math.abs(rect.top - videoRect.bottom);
      if (dist < bestDist) { bestDist = dist; best = btn; }
    }
    return best;
  }

  function getCurrentReelInfo() {
    const url = window.location.href;
    const reelMatch = url.match(/\/reels?\/([^/?]+)/);
    const reelId = reelMatch ? reelMatch[1] : null;

    let username = '';

    // Method 0: If on a profile page (instagram.com/username/), grab from URL
    const urlPath = new URL(url).pathname;
    const profileFromUrl = extractUsernameFromHref(urlPath);
    if (profileFromUrl && !reelId) {
      username = profileFromUrl;
    }

    // For reels: find the active video first, then find username near IT specifically
    const activeVideo = !username ? findActiveVideo() : null;

    // Method 1: Find Follow/Seguir button near the active video → get username from nearby span/link
    if (!username && activeVideo) {
      const followBtn = findFollowButtonNearVideo(activeVideo);
      if (followBtn) {
        // Scan parent containers of the Follow button for username
        let scan = followBtn.parentElement;
        for (let i = 0; i < 6 && scan; i++) {
          // Check links first (href is most reliable)
          const links = scan.querySelectorAll('a[href]');
          for (const link of links) {
            const u = extractUsernameFromHref(link.getAttribute('href') || '');
            if (u) { username = u; break; }
          }
          if (username) break;

          // Check spans (reels feed shows username as plain text)
          const spans = scan.querySelectorAll('span');
          for (const span of spans) {
            const t = span.textContent?.trim();
            if (t && USERNAME_REGEX.test(t) && t !== 'Seguir' && t !== 'Follow') {
              // Make sure this span is near the Follow button vertically
              const sr = span.getBoundingClientRect();
              const fr = followBtn.getBoundingClientRect();
              if (Math.abs(sr.top - fr.top) < 50 && sr.height > 0) {
                username = t;
                break;
              }
            }
          }
          if (username) break;
          scan = scan.parentElement;
        }
      }
    }

    // Method 2: Find /username/reels/ links near the active video (main reels feed pattern)
    if (!username && activeVideo) {
      const vr = activeVideo.getBoundingClientRect();
      const allLinks = document.querySelectorAll('a[href*="/reels/"]');
      let bestLink = null;
      let bestDist = Infinity;
      for (const link of allLinks) {
        const href = link.getAttribute('href') || '';
        const m = href.match(/^\/([a-zA-Z0-9_.]{1,30})\/reels\/$/);
        if (!m || RESERVED_NAMES.test(m[1])) continue;
        const lr = link.getBoundingClientRect();
        if (lr.height === 0 || lr.left < 100) continue; // Skip sidebar
        // Must be near the video vertically
        if (lr.top >= vr.top - 50 && lr.top <= vr.bottom + 50) {
          const dist = Math.abs(lr.top - vr.bottom);
          if (dist < bestDist) { bestDist = dist; bestLink = link; username = m[1]; }
        }
      }
    }

    // Method 3: Scan the active video's parent tree for any profile links
    if (!username && activeVideo) {
      let container = activeVideo;
      for (let i = 0; i < 15 && container && container !== document.body; i++) {
        container = container.parentElement;
        const links = container.querySelectorAll('a[href]');
        for (const link of links) {
          const u = extractUsernameFromHref(link.getAttribute('href') || '');
          if (u) {
            const lr = link.getBoundingClientRect();
            const vr = activeVideo.getBoundingClientRect();
            if (lr.top >= vr.top - 100 && lr.top <= vr.bottom + 100 && lr.left > 100) {
              username = u;
              break;
            }
          }
        }
        if (username) break;
      }
    }

    // Clean username
    username = username.replace(/^@/, '').trim();

    return { url, reelId, username };
  }

  // --- Build the panel ---
  const panel = document.createElement('div');
  panel.id = 'ig-annotator-panel';
  panel.innerHTML = `
    <button class="iga-toggle" title="Toggle panel">📝</button>
    <div class="iga-header">
      <h2>IG Tracker</h2>
      <div style="display:flex;gap:6px;align-items:center">
        <span class="iga-status" id="iga-status" title="API status">⚪</span>
        <button class="iga-config-btn" id="iga-config-btn" title="Configurar API">⚙️</button>
      </div>
    </div>

    <!-- Config panel (hidden by default) -->
    <div class="iga-config" id="iga-config" style="display:none">
      <div class="iga-config-logged-out" id="iga-logged-out">
        <div style="font-size:12px;font-weight:700;color:#888;margin-bottom:8px">Clave de acceso</div>
        <input class="iga-input" id="iga-access-key" placeholder="Ingresa tu clave de acceso..." type="password" />
        <button class="iga-save-config-btn" id="iga-login-btn" style="width:100%;margin-top:6px">Entrar</button>
      </div>
      <div class="iga-config-logged-in" id="iga-logged-in" style="display:none">
        <div style="display:flex;align-items:center;justify-content:space-between">
          <span style="font-size:12px;color:#4caf50;font-weight:600" id="iga-user-label">🟢 Conectado</span>
          <button class="iga-test-config-btn" id="iga-logout-btn" style="font-size:11px;padding:4px 10px">Salir</button>
        </div>
      </div>
      <div class="iga-config-msg" id="iga-config-msg"></div>
    </div>

    <div class="iga-reel-info">
      <div class="iga-reel-user" id="iga-reel-user">Navega a un reel...</div>
      <div class="iga-reel-url" id="iga-reel-url"></div>
    </div>
    <div class="iga-quick-actions">
      <button class="iga-action-btn iga-btn-scrape" id="iga-btn-scrape">
        <span class="iga-btn-icon">🔍</span>
        <span>Scrappear</span>
      </button>
      <button class="iga-action-btn iga-btn-comp-ai" id="iga-btn-comp-ai">
        <span class="iga-btn-icon">🤖</span>
        <span>Competencia AI</span>
      </button>
      <button class="iga-action-btn iga-btn-comp" id="iga-btn-comp">
        <span class="iga-btn-icon">⚔️</span>
        <span>Competencia</span>
      </button>
    </div>
    <div class="iga-input-area">
      <textarea class="iga-textarea" id="iga-note" placeholder="Nota adicional (opcional)..."></textarea>
      <div class="iga-input-row">
        <span class="iga-shortcut-hint">Cmd+Enter</span>
        <button class="iga-save-btn" id="iga-save" disabled>Guardar nota</button>
      </div>
    </div>
    <div class="iga-list" id="iga-list">
      <div class="iga-list-header">Historial</div>
    </div>
  `;
  document.body.appendChild(panel);

  // --- Elements ---
  const toggle = panel.querySelector('.iga-toggle');
  const noteInput = document.getElementById('iga-note');
  const saveBtn = document.getElementById('iga-save');
  const listEl = document.getElementById('iga-list');
  const userEl = document.getElementById('iga-reel-user');
  const urlEl = document.getElementById('iga-reel-url');
  const btnScrape = document.getElementById('iga-btn-scrape');
  const btnCompAI = document.getElementById('iga-btn-comp-ai');
  const btnComp = document.getElementById('iga-btn-comp');
  const statusEl = document.getElementById('iga-status');
  const configBtn = document.getElementById('iga-config-btn');
  const configPanel = document.getElementById('iga-config');
  const accessKeyInput = document.getElementById('iga-access-key');
  const loginBtn = document.getElementById('iga-login-btn');
  const logoutBtn = document.getElementById('iga-logout-btn');
  const loggedOutEl = document.getElementById('iga-logged-out');
  const loggedInEl = document.getElementById('iga-logged-in');
  const userLabelEl = document.getElementById('iga-user-label');
  const configMsg = document.getElementById('iga-config-msg');

  // Stop scroll events on the panel from reaching Instagram
  panel.addEventListener('wheel', (e) => e.stopPropagation(), { passive: false });
  panel.addEventListener('scroll', (e) => e.stopPropagation());

  // --- Config ---
  let configVisible = false;
  configBtn.addEventListener('click', () => {
    configVisible = !configVisible;
    configPanel.style.display = configVisible ? 'block' : 'none';
  });

  function showLoggedIn(email) {
    loggedOutEl.style.display = 'none';
    loggedInEl.style.display = 'block';
    userLabelEl.textContent = `🟢 ${email}`;
    statusEl.textContent = '🟢';
    statusEl.title = 'Conectado';
    configMsg.textContent = '';
  }

  function showLoggedOut() {
    loggedOutEl.style.display = 'block';
    loggedInEl.style.display = 'none';
    statusEl.textContent = '⚪';
    statusEl.title = 'No autenticado';
  }

  loginBtn.addEventListener('click', async () => {
    const key = accessKeyInput.value.trim();
    if (!key) { configMsg.textContent = '❌ Ingresa tu clave'; configMsg.style.color = '#ef4444'; return; }
    loginBtn.disabled = true;
    loginBtn.textContent = 'Conectando...';
    configMsg.textContent = '';
    try {
      const data = await loginWithKey(key);
      await saveConfig({ apiUrl: DEFAULT_API_URL, token: data.token, email: data.user?.email });
      showLoggedIn(data.user?.email || 'Usuario');
      accessKeyInput.value = '';
    } catch (e) {
      configMsg.textContent = `❌ ${e.message}`;
      configMsg.style.color = '#ef4444';
    }
    loginBtn.disabled = false;
    loginBtn.textContent = 'Entrar';
  });

  accessKeyInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); loginBtn.click(); }
    e.stopPropagation();
  });
  accessKeyInput.addEventListener('keyup', (e) => e.stopPropagation());

  logoutBtn.addEventListener('click', async () => {
    await saveConfig({});
    showLoggedOut();
    configMsg.textContent = '👋 Sesion cerrada';
    configMsg.style.color = '#888';
  });

  // Check saved session on load
  loadConfig().then(async (config) => {
    if (config.token) {
      try {
        await apiCall('/api/auth/me');
        showLoggedIn(config.email || 'Usuario');
      } catch (e) {
        showLoggedOut();
      }
    } else {
      showLoggedOut();
    }
  });

  // --- Toggle ---
  let collapsed = false;
  document.body.classList.add('iga-panel-open');

  toggle.addEventListener('click', () => {
    collapsed = !collapsed;
    panel.classList.toggle('collapsed', collapsed);
    document.body.classList.toggle('iga-panel-open', !collapsed);
    document.body.classList.toggle('iga-panel-collapsed', collapsed);
  });

  // --- Note input ---
  noteInput.addEventListener('input', () => {
    saveBtn.disabled = !noteInput.value.trim();
  });
  noteInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      doSave('nota');
    }
    e.stopPropagation();
  });
  noteInput.addEventListener('keyup', (e) => e.stopPropagation());
  noteInput.addEventListener('keypress', (e) => e.stopPropagation());

  // --- Show toast ---
  function showToast(msg, type = 'ok') {
    const toast = document.createElement('div');
    toast.className = 'iga-toast';
    toast.style.background = type === 'ok' ? '#4caf50' : type === 'err' ? '#ef4444' : '#ff9800';
    toast.textContent = msg;
    panel.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }

  // --- Save annotation + send to API ---
  async function doSave(tag, extraNote) {
    const info = getCurrentReelInfo();
    const note = extraNote || noteInput.value.trim();

    const entry = {
      id: Date.now().toString(),
      tag,
      note: note || '',
      username: info.username,
      timestamp: new Date().toISOString(),
    };

    // Save locally
    const annotations = await loadAnnotations();
    annotations.unshift(entry);
    await saveAnnotations(annotations);

    // Send to API if connected
    if (info.username && (tag === 'scrappear' || tag === 'competencia_ai' || tag === 'competencia')) {
      const accountType = tag === 'scrappear' ? 'own' : tag === 'competencia_ai' ? 'competitor_ai' : 'competitor';
      try {
        await addAccountToTracker(info.username, accountType);
        showToast(`@${info.username} agregada como ${tag === 'scrappear' ? 'propia' : tag === 'competencia_ai' ? 'comp. AI' : 'competencia'}`);
        entry.synced = true;
      } catch (e) {
        if (e.message.includes('already exists')) {
          showToast(`@${info.username} ya existe en el tracker`, 'warn');
          entry.synced = true;
        } else {
          showToast(`Error: ${e.message}`, 'err');
          entry.synced = false;
        }
      }
      // Update entry sync status
      const updated = await loadAnnotations();
      const idx = updated.findIndex(a => a.id === entry.id);
      if (idx >= 0) { updated[idx] = entry; await saveAnnotations(updated); }
    }

    if (!extraNote) {
      noteInput.value = '';
      saveBtn.disabled = true;
    }

    renderList();
    return entry;
  }

  // --- Quick action buttons ---
  function flashButton(btn) {
    btn.classList.add('iga-btn-flash');
    setTimeout(() => btn.classList.remove('iga-btn-flash'), 600);
  }

  btnScrape.addEventListener('click', async () => {
    const info = getCurrentReelInfo();
    if (!info.username) { showToast('No se detecta usuario', 'err'); return; }
    btnScrape.disabled = true;
    await doSave('scrappear');
    flashButton(btnScrape);
    btnScrape.disabled = false;
  });

  btnCompAI.addEventListener('click', async () => {
    const info = getCurrentReelInfo();
    if (!info.username) { showToast('No se detecta usuario', 'err'); return; }
    btnCompAI.disabled = true;
    await doSave('competencia_ai');
    flashButton(btnCompAI);
    btnCompAI.disabled = false;
  });

  btnComp.addEventListener('click', async () => {
    const info = getCurrentReelInfo();
    if (!info.username) { showToast('No se detecta usuario', 'err'); return; }
    btnComp.disabled = true;
    await doSave('competencia');
    flashButton(btnComp);
    btnComp.disabled = false;
  });

  saveBtn.addEventListener('click', () => doSave('nota'));

  // --- Delete ---
  async function doDelete(id) {
    let annotations = await loadAnnotations();
    annotations = annotations.filter((a) => a.id !== id);
    await saveAnnotations(annotations);
    renderList();
  }

  // --- Tag labels & colors ---
  const TAG_CONFIG = {
    scrappear: { label: 'Propia', color: '#4caf50' },
    competencia_ai: { label: 'Comp. AI', color: '#2196f3' },
    competencia: { label: 'Competencia', color: '#ff9800' },
    nota: { label: 'Nota', color: '#888' },
  };

  // --- Render list ---
  async function renderList() {
    const annotations = await loadAnnotations();

    const cards = annotations.map((a) => {
      const time = new Date(a.timestamp).toLocaleDateString('es-ES', {
        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
      });
      const tagConf = TAG_CONFIG[a.tag] || TAG_CONFIG.nota;
      const tagBadge = `<span class="iga-tag" style="background:${tagConf.color}">${tagConf.label}</span>`;
      const syncIcon = a.synced === true ? '<span title="Sincronizado" style="font-size:10px">✅</span>' : a.synced === false ? '<span title="Error sync" style="font-size:10px">⚠️</span>' : '';
      return `
        <div class="iga-card" data-id="${a.id}">
          <button class="iga-card-delete" data-id="${a.id}">x</button>
          <div class="iga-card-header">${tagBadge} ${syncIcon} ${a.username ? `<span class="iga-card-user">@${escapeHtml(a.username)}</span>` : ''}</div>
          ${a.note ? `<div class="iga-card-note">${escapeHtml(a.note)}</div>` : ''}
          <div class="iga-card-meta"><span>${time}</span></div>
        </div>
      `;
    }).join('');

    listEl.innerHTML = `<div class="iga-list-header">Historial (${annotations.length})</div>${cards}`;

    listEl.querySelectorAll('.iga-card-delete').forEach((btn) => {
      btn.addEventListener('click', () => doDelete(btn.dataset.id));
    });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // --- Update current reel info ---
  function updateReelInfo() {
    const info = getCurrentReelInfo();
    userEl.textContent = info.username ? `@${info.username}` : 'Navega a un reel...';
    urlEl.textContent = info.reelId ? `Reel: ${info.reelId}` : '';
  }

  let lastUrl = '';
  let lastUsername = '';

  function checkForChanges() {
    const currentUrl = window.location.href;
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      updateReelInfo();
    } else {
      const info = getCurrentReelInfo();
      if (info.username && info.username !== lastUsername) {
        lastUsername = info.username;
        updateReelInfo();
      }
    }
  }

  setInterval(checkForChanges, 400);
  window.addEventListener('scroll', () => {
    setTimeout(checkForChanges, 200);
  }, { passive: true });

  // --- Init ---
  updateReelInfo();
  renderList();

  console.log('[IG Annotator] Panel loaded — API integration enabled');
})();
