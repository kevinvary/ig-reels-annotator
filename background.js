// Background service worker — handles API calls to bypass mixed content restrictions
// (Instagram is HTTPS, our API may be HTTP)

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'api') {
    const { url, method, headers, body } = msg;
    fetch(url, {
      method: method || 'GET',
      headers: headers || {},
      body: body ? JSON.stringify(body) : undefined,
    })
      .then(async (resp) => {
        const data = await resp.json().catch(() => ({}));
        sendResponse({ ok: resp.ok, status: resp.status, data });
      })
      .catch((e) => {
        sendResponse({ ok: false, status: 0, data: { error: e.message } });
      });
    return true; // keep sendResponse alive for async
  }
});
