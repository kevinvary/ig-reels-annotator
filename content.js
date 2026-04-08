// IG Reels Annotator — Content Script
(function () {
  'use strict';

  if (document.getElementById('ig-annotator-panel')) return;

  // --- Storage ---
  const STORAGE_KEY = 'iga_annotations';

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
      <h2>Anotaciones</h2>
      <span class="iga-reel-count" id="iga-count">0</span>
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
  const countEl = document.getElementById('iga-count');
  const userEl = document.getElementById('iga-reel-user');
  const urlEl = document.getElementById('iga-reel-url');
  const btnScrape = document.getElementById('iga-btn-scrape');
  const btnCompAI = document.getElementById('iga-btn-comp-ai');
  const btnComp = document.getElementById('iga-btn-comp');

  // Stop scroll events on the panel from reaching Instagram
  panel.addEventListener('wheel', (e) => e.stopPropagation(), { passive: false });
  panel.addEventListener('scroll', (e) => e.stopPropagation());

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

  // --- Save annotation ---
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

    const annotations = await loadAnnotations();
    annotations.unshift(entry);
    await saveAnnotations(annotations);

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
    if (!info.username) { flashButton(btnScrape); return; }
    await doSave('scrappear');
    flashButton(btnScrape);
  });

  btnCompAI.addEventListener('click', async () => {
    const info = getCurrentReelInfo();
    if (!info.username) { flashButton(btnCompAI); return; }
    await doSave('competencia_ai');
    flashButton(btnCompAI);
  });

  btnComp.addEventListener('click', async () => {
    const info = getCurrentReelInfo();
    if (!info.username) { flashButton(btnComp); return; }
    await doSave('competencia');
    flashButton(btnComp);
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
    scrappear: { label: 'Scrappear', color: '#4caf50' },
    competencia_ai: { label: 'Comp. AI', color: '#2196f3' },
    competencia: { label: 'Competencia', color: '#ff9800' },
    nota: { label: 'Nota', color: '#888' },
  };

  // --- Render list ---
  async function renderList() {
    const annotations = await loadAnnotations();
    countEl.textContent = annotations.length;

    const cards = annotations.map((a) => {
      const time = new Date(a.timestamp).toLocaleDateString('es-ES', {
        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
      });
      const tagConf = TAG_CONFIG[a.tag] || TAG_CONFIG.nota;
      const tagBadge = `<span class="iga-tag" style="background:${tagConf.color}">${tagConf.label}</span>`;
      return `
        <div class="iga-card" data-id="${a.id}">
          <button class="iga-card-delete" data-id="${a.id}">x</button>
          <div class="iga-card-header">${tagBadge} ${a.username ? `<span class="iga-card-user">@${escapeHtml(a.username)}</span>` : ''}</div>
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
    urlEl.textContent = info.reelId ? `Reel: ${info.reelId}` : info.url;
  }

  let lastUrl = '';
  let lastUsername = '';

  function checkForChanges() {
    const currentUrl = window.location.href;
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      updateReelInfo();
    } else {
      // URL didn't change but username might (IG updates DOM before URL)
      const info = getCurrentReelInfo();
      if (info.username && info.username !== lastUsername) {
        lastUsername = info.username;
        updateReelInfo();
      }
    }
  }

  // Fast polling
  setInterval(checkForChanges, 400);

  // Also detect on scroll (reels switch on scroll)
  window.addEventListener('scroll', () => {
    setTimeout(checkForChanges, 200);
  }, { passive: true });

  // --- Init ---
  updateReelInfo();
  renderList();

  console.log('[IG Annotator] Panel loaded');
})();
