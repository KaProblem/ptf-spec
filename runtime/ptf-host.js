/*! ptf-host.js 0.1.0 · Personal Tutor Format host runtime · MIT
 * Host side of the PTF simulator contract (SIMULATOR-SPEC.md §4).
 *
 *   const sim = PTFHost.mount(containerEl, {
 *     src: "https://sims.example.org/next-char-lab/2.0.0/index.html",
 *     init: { level: "highschool", station: null, params: {}, locale: "de", theme: {...}, state: null },
 *     onEvent(e) {}, onState(s) {}, onError(e) {}, onReady() {}, onHang() {}
 *   });
 *   sim.setLevel("college"); sim.goto("softmax"); await sim.snapshot(); sim.destroy();
 */
(function (global) {
  "use strict";
  var PING_INTERVAL_MS = 10000;
  var PING_TIMEOUT_MS = 5000;
  var MAX_STATE_BYTES = 64 * 1024;

  function mount(container, opts) {
    var iframe = document.createElement("iframe");
    // Never add allow-same-origin, allow-forms, allow-popups, allow-top-navigation, allow-modals.
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.setAttribute("title", opts.title || "Simulator");
    iframe.setAttribute("referrerpolicy", "no-referrer");
    iframe.style.cssText = "width:100%;border:0;display:block;min-height:200px";
    if (opts.srcdoc != null) iframe.srcdoc = opts.srcdoc; else iframe.src = opts.src;

    var nextId = 1, pending = {}, pingTimer = null, destroyed = false;

    function post(msg) {
      if (destroyed || !iframe.contentWindow) return;
      msg.jsonrpc = "2.0";
      // The sandboxed frame has an opaque origin ("null"), so "*" is the only usable target.
      iframe.contentWindow.postMessage(msg, "*");
    }
    function request(method, params, timeoutMs) {
      var id = nextId++;
      return new Promise(function (resolve, reject) {
        var t = setTimeout(function () { delete pending[id]; reject(new Error("timeout: " + method)); }, timeoutMs || 5000);
        pending[id] = { resolve: function (r) { clearTimeout(t); resolve(r); }, reject: function (e) { clearTimeout(t); reject(e); } };
        post({ id: id, method: method, params: params || {} });
      });
    }
    function cb(name, arg) { if (typeof opts[name] === "function") { try { opts[name](arg); } catch (e) { console.error(e); } } }

    function onMessage(ev) {
      if (ev.source !== iframe.contentWindow) return;        // only our frame
      var m = ev.data;
      if (!m || m.jsonrpc !== "2.0") return;
      if (m.id != null && !m.method) {
        var p = pending[m.id];
        if (p) { delete pending[m.id]; if (m.error) p.reject(m.error); else p.resolve(m.result); }
        return;
      }
      if (typeof m.method !== "string") return;
      var params = (m.params && typeof m.params === "object") ? m.params : {};
      switch (m.method) {
        case "ptf/initialize":
          if (m.id != null) post({ id: m.id, result: Object.assign({ level: null, station: null, params: {}, locale: null, theme: null, state: null, prefs: {} }, opts.init || {}) });
          break;
        case "ptf/ready": startPing(); cb("onReady", params); break;
        case "ptf/event": if (typeof params.verb === "string") cb("onEvent", params); break;
        case "ptf/state":
          try { if (JSON.stringify(params.state).length <= MAX_STATE_BYTES) cb("onState", params.state); } catch (e) { /* ignore */ }
          break;
        case "ptf/resize":
          var h = Number(params.height);
          if (h > 0 && h < 20000 && opts.autoHeight !== false) iframe.style.height = Math.ceil(h) + "px";
          break;
        case "ptf/error": cb("onError", { message: String(params.message || ""), source: params.source, line: params.line, stack: params.stack }); break;
        default:
          if (m.id != null) post({ id: m.id, error: { code: -32601, message: "Method not found" } });
      }
    }

    function startPing() {
      if (pingTimer || opts.heartbeat === false) return;
      pingTimer = setInterval(function () {
        request("ptf/ping", {}, PING_TIMEOUT_MS).catch(function () { cb("onHang"); });
      }, PING_INTERVAL_MS);
    }

    global.addEventListener("message", onMessage);
    container.appendChild(iframe);

    return {
      iframe: iframe,
      setLevel: function (level) { post({ method: "ptf/setLevel", params: { level: level } }); },
      goto: function (station) { post({ method: "ptf/goto", params: { station: station } }); },
      setTheme: function (theme) { post({ method: "ptf/theme", params: theme }); },
      snapshot: function () { return request("ptf/snapshot", {}).then(function (r) { return (r && r.text) || ""; }); },
      ping: function () { return request("ptf/ping", {}, PING_TIMEOUT_MS); },
      destroy: function () {
        destroyed = true;
        clearInterval(pingTimer);
        global.removeEventListener("message", onMessage);
        iframe.remove();
      }
    };
  }

  global.PTFHost = { mount: mount };
})(typeof window !== "undefined" ? window : this);
