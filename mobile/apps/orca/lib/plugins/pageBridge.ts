// The window.orca bridge a plugin page expects, as the desktop injects it from
// src/slic3r/plugin/host/PluginPages.cpp (PLUGIN_PAGE_BRIDGE_JS). The page posts through
// window.wx.postMessage, so a shim routes that to the React Native WebView; the host
// pushes through window.__orcaDispatch. Keep the bridge text in sync with PluginPages.cpp
// so plugin HTML needs no change between the desktop and the app.

const WX_SHIM = `
(function () {
  if (window.wx && typeof window.wx.postMessage === 'function') return;
  window.wx = { postMessage: function (m) {
    window.ReactNativeWebView.postMessage(typeof m === 'string' ? m : JSON.stringify(m));
  } };
})();
`

const PLUGIN_PAGE_BRIDGE_JS = `
(function () {
  if (window.top !== window.self) return;
  if (window.orca) return;
  var handlers = [];
  function deliver(payload, attempts) {
    try {
      if (window.wx && typeof window.wx.postMessage === 'function') {
        window.wx.postMessage(payload);
        return;
      }
    } catch (e) { /* retry while the native handler is being registered */ }
    if (attempts < 100)
      window.setTimeout(function () { deliver(payload, attempts + 1); }, 25);
  }
  function send(data) {
    deliver(JSON.stringify({
      channel: 'orca', kind: 'message', data: (data === undefined ? null : data)
    }), 0);
  }
  window.orca = {
    postMessage: function (data) { send(data); },
    onMessage: function (callback) {
      if (typeof callback === 'function') handlers.push(callback);
    }
  };
  window.__orcaDispatch = function (payload) {
    var data = payload ? payload.data : null;
    for (var i = 0; i < handlers.length; i++) {
      try { handlers[i](data); } catch (e) {}
    }
  };
})();
`

/** Injected before the page's own scripts run. */
export const PAGE_BRIDGE = `${WX_SHIM}${PLUGIN_PAGE_BRIDGE_JS} true;`

/**
 * The payload of a page's postMessage, or undefined when the message is not one of the
 * bridge's (a stray postMessage from the page's own code, say). The plugin receives the
 * `data` as JSON text, which its on_message trampoline parses.
 */
export function pageMessageData(raw: string): string | undefined {
  let envelope: unknown
  try {
    envelope = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (typeof envelope !== 'object' || envelope === null) return undefined
  const e = envelope as Record<string, unknown>
  if (e.channel !== 'orca' || e.kind !== 'message') return undefined
  return JSON.stringify(e.data ?? null)
}

/**
 * The script that delivers a plugin's post_message to the page. The message is the JSON
 * the plugin sent; it retries while the bridge is still being installed, as the desktop does.
 */
export function dispatchScript(messageJson: string): string {
  let data: unknown
  try {
    data = JSON.parse(messageJson)
  } catch {
    data = messageJson
  }
  const payload = JSON.stringify({ data })
  return `(function dispatch(payload, attempts) {
  if (typeof window.__orcaDispatch === 'function') { window.__orcaDispatch(payload); return; }
  if (attempts < 100) window.setTimeout(function() { dispatch(payload, attempts + 1); }, 25);
})(${payload}, 0); true;`
}
