// IG Reels Annotator — Content Script (connected to IG Tracker API)
(function () {
  'use strict';

  if (document.getElementById('ig-annotator-panel')) return;

  // --- Storage ---
  const STORAGE_KEY = 'iga_annotations';
  const CONFIG_KEY = 'iga_config'; // { apiUrl, token }

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
      chrome.storage.local.get(CONFIG_KEY, (data) => resolve(data[CONFIG_KEY] || {}));
    });
  }

  function saveConfig(config) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [CONFIG_KEY]: config }, resolve);
    });
  }

  // --- API ---
  async function apiCall(path, method = 'GET', body = null) {
    const config = await loadConfig();
    if (!config.apiUrl || !config.token) throw new Error('API no configurada');
    const url = config.apiUrl.replace(/\/$/, '') + path;
    const opts = {
      method,
      headers: { 'Authorization': `Bearer ${config.token}`, 'Content-Type': 'application/json' },
    };
    if (body) opts.body = JSON.stringify(body);
    const resp = await fetch(url, opts);
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
    return data;
  }

  async function addAccountToTracker(username, accountType) {
    return apiCall('/api/accounts', 'POST', { handle: username, account_type: accountType });
  }

  // --- Detect current reel info ---
  function getCurrentReelInfo() {
    const url = window.location.href;
    const reelMatch = url.match(/\/reels?\/([^/?]+)/);
    const reelId = reelMatch ? reelMatch[1] : null;

    let username = '';

    const videos = document.querySelectorAll('video');
    let visibleVideo = null;
    for (const v of videos) {
      const rect = v.getBoundingClientRect();
      if (rect.top < window.innerHeight && rect.bottom > 0 && rect.height > 200) {
        visibleVideo = v;
        break;
      }
    }

    if (visibleVideo) {
      let container = visibleVideo;
      for (let i = 0; i < 15 && container && container !== document.body; i++) {
        container = container.parentElement;
        const links = container.querySelectorAll('a[href]');
        for (const link of links) {
          const href = link.getAttribute('href') || '';
          if (href.match(/^\/[a-zA-Z0-9_.]{1,30}\/$/) &&
              !href.match(/^\/(reels?|explore|direct|accounts|p|stories)\//)) {
            const text = link.textContent?.trim();
            if (text && text.length > 0 && text.length < 30) {
              username = text.split('\n')[0].trim();
              break;
            }
          }
        }
        if (username) break;
      }
    }

    if (!username) {
      const allLinks = document.querySelectorAll('a[href]');
      for (const link of allLinks) {
        const href = link.getAttribute('href') || '';
        if (!href.match(/^\/[a-zA-Z0-9_.]{1,30}\/$/)) continue;
        if (href.match(/^\/(reels?|explore|direct|accounts|p|stories)\//)) continue;
        const rect = link.getBoundingClientRect();
        if (rect.top > window.innerHeight * 0.5 && rect.bottom < window.innerHeight && rect.height > 0) {
          const text = link.textContent?.trim();
          if (text && text.length > 0 && text.length < 30) {
            username = text.split('\n')[0].trim();
            break;
          }
        }
      }
    }

    if (!username) {
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        if (btn.textContent?.trim() === 'Seguir' || btn.textContent?.trim() === 'Follow') {
          const rect = btn.getBoundingClientRect();
          if (rect.top > window.innerHeight * 0.4) {
            const parent = btn.parentElement;
            if (parent) {
              const link = parent.querySelector('a[href]') || parent.previousElementSibling?.querySelector('a[href]');
              if (link) {
                const text = link.textContent?.trim();
                if (text && text.length < 30) {
                  username = text.split('\n')[0].trim();
                  break;
                }
              }
            }
          }
        }
      }
    }

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
      <div style="font-size:12px;font-weight:700;color:#888;margin-bottom:8px">Configuracion API</div>
      <input class="iga-input" id="iga-api-url" placeholder="URL del servidor (ej: https://tu-dominio.com)" />
      <input class="iga-input" id="iga-api-token" placeholder="Token JWT" type="password" />
      <div style="display:flex;gap:6px;margin-top:8px">
        <button class="iga-save-config-btn" id="iga-save-config">Conectar</button>
        <button class="iga-test-config-btn" id="iga-test-config">Probar</button>
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
  const apiUrlInput = document.getElementById('iga-api-url');
  const apiTokenInput = document.getElementById('iga-api-token');
  const saveConfigBtn = document.getElementById('iga-save-config');
  const testConfigBtn = document.getElementById('iga-test-config');
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

  saveConfigBtn.addEventListener('click', async () => {
    const apiUrl = apiUrlInput.value.trim();
    const token = apiTokenInput.value.trim();
    if (!apiUrl || !token) { configMsg.textContent = '❌ URL y Token requeridos'; configMsg.style.color = '#ef4444'; return; }
    await saveConfig({ apiUrl, token });
    configMsg.textContent = '✅ Configuracion guardada';
    configMsg.style.color = '#4caf50';
    checkApiStatus();
  });

  testConfigBtn.addEventListener('click', async () => {
    configMsg.textContent = '⏳ Probando...';
    configMsg.style.color = '#888';
    try {
      const data = await apiCall('/api/auth/me');
      configMsg.textContent = `✅ Conectado como ${data.email || data.id}`;
      configMsg.style.color = '#4caf50';
      statusEl.textContent = '🟢';
      statusEl.title = 'API conectada';
    } catch (e) {
      configMsg.textContent = `❌ ${e.message}`;
      configMsg.style.color = '#ef4444';
      statusEl.textContent = '🔴';
      statusEl.title = 'API desconectada';
    }
  });

  async function checkApiStatus() {
    try {
      const config = await loadConfig();
      if (!config.apiUrl || !config.token) { statusEl.textContent = '⚪'; statusEl.title = 'No configurada'; return; }
      await apiCall('/api/auth/me');
      statusEl.textContent = '🟢';
      statusEl.title = 'API conectada';
    } catch (e) {
      statusEl.textContent = '🔴';
      statusEl.title = 'API desconectada';
    }
  }

  // Load saved config into inputs
  loadConfig().then(config => {
    if (config.apiUrl) apiUrlInput.value = config.apiUrl;
    if (config.token) apiTokenInput.value = config.token;
    checkApiStatus();
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
