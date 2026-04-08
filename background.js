// Background service worker — handles API calls to bypass mixed content restrictions

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'api') {
    const { url, method, headers, body } = msg;
    console.log('[BG] API call:', method, url);
    fetch(url, {
      method: method || 'GET',
      headers: headers || {},
      body: body ? JSON.stringify(body) : undefined,
    })
      .then(async (resp) => {
        const text = await resp.text();
        let data;
        try { data = JSON.parse(text); } catch (e) { data = { error: text.substring(0, 200) }; }
        console.log('[BG] Response:', resp.status, resp.ok);
        sendResponse({ ok: resp.ok, status: resp.status, data });
      })
      .catch((e) => {
        console.error('[BG] Fetch error:', e.message);
        sendResponse({ ok: false, status: 0, data: { error: e.message } });
      });
    return true;
  }
});

console.log('[IG Annotator] Background service worker loaded');
