/*! ptf-sim.js 0.1.0 · Personal Tutor Format simulator runtime · MIT
 * Simulator side of the PTF host contract (SIMULATOR-SPEC.md §4).
 * Usage: const ptf = PTF.connect({ id, version, onInit, onSetLevel, onGoto, onTheme, snapshot });
 */
(function (global) {
  "use strict";
  var PROTOCOL = "0.1";
  var INIT_TIMEOUT_MS = 500;

  function connect(opts) {
    opts = opts || {};
    var embedded = global.parent && global.parent !== global;
    var nextId = 1;
    var pending = {};
    var ctx = null;
    var lastHeight = 0;

    function post(msg) {
      if (!embedded) return;
      msg.jsonrpc = "2.0";
      // Opaque-origin sandbox: the parent origin is unknown, so "*" is required.
      // Never send anything sensitive (SIMULATOR-SPEC.md §4.1).
      global.parent.postMessage(msg, "*");
    }
    function notify(method, params) { post({ method: method, params: params || {} }); }
    function request(method, params) {
      var id = nextId++;
      return new Promise(function (resolve, reject) {
        pending[id] = { resolve: resolve, reject: reject };
        post({ id: id, method: method, params: params || {} });
      });
    }
    function respond(id, result) { post({ id: id, result: result }); }
    function respondError(id, code, message) { post({ id: id, error: { code: code, message: message } }); }

    function applyTheme(theme) {
      if (!theme) return;
      var root = document.documentElement;
      if (theme.mode) root.setAttribute("data-theme", theme.mode);
      var tokens = theme.tokens || {};
      for (var k in tokens) {
        if (Object.prototype.hasOwnProperty.call(tokens, k) && /^--[a-z0-9-]+$/.test(k)) {
          root.style.setProperty(k, String(tokens[k]));
        }
      }
    }

    function call(fn, arg) {
      if (typeof fn !== "function") return undefined;
      try { return fn(arg); } catch (e) { reportError(e); }
    }

    function reportError(e, extra) {
      var err = e && e.message ? e : { message: String(e) };
      notify("ptf/error", {
        message: String(err.message).slice(0, 2000),
        source: extra && extra.source, line: extra && extra.line,
        stack: err.stack ? String(err.stack).slice(0, 4000) : undefined
      });
    }

    global.addEventListener("error", function (ev) {
      reportError(ev.error || { message: ev.message }, { source: ev.filename, line: ev.lineno });
    });
    global.addEventListener("unhandledrejection", function (ev) { reportError(ev.reason || "unhandled rejection"); });

    global.addEventListener("message", function (ev) {
      if (!embedded || ev.source !== global.parent) return;
      var m = ev.data;
      if (!m || m.jsonrpc !== "2.0") return;

      if (m.id != null && !m.method) {            // response to our request
        var p = pending[m.id];
        if (!p) return;
        delete pending[m.id];
        if (m.error) p.reject(m.error); else p.resolve(m.result);
        return;
      }
      if (typeof m.method !== "string") return;
      var params = m.params || {};
      switch (m.method) {
        case "ptf/setLevel": call(opts.onSetLevel, params.level); break;
        case "ptf/goto": call(opts.onGoto, params.station); break;
        case "ptf/theme": applyTheme(params); call(opts.onTheme, params); break;
        case "ptf/ping": if (m.id != null) respond(m.id, {}); break;
        case "ptf/snapshot":
          if (m.id != null) {
            var text = call(opts.snapshot);
            respond(m.id, { text: typeof text === "string" ? text.slice(0, 4000) : "" });
          }
          break;
        default:
          if (m.id != null) respondError(m.id, -32601, "Method not found: " + m.method);
      }
    });

    function defaults() {
      return {
        level: opts.defaultLevel || null, station: null, params: {}, locale: null,
        theme: null, state: null, prefs: {}, standalone: true
      };
    }

    function start(context) {
      ctx = context;
      applyTheme(ctx.theme);
      call(opts.onInit, ctx);
      notify("ptf/ready", {});
      observeSize();
    }

    function observeSize() {
      if (!embedded || typeof ResizeObserver === "undefined") return;
      var ro = new ResizeObserver(function () {
        var h = Math.ceil(document.documentElement.scrollHeight);
        if (Math.abs(h - lastHeight) > 1) { lastHeight = h; notify("ptf/resize", { height: h }); }
      });
      ro.observe(document.documentElement);
    }

    function boot() {
      if (!embedded) { start(defaults()); return; }
      var done = false;
      var timer = setTimeout(function () { if (!done) { done = true; start(defaults()); } }, INIT_TIMEOUT_MS);
      request("ptf/initialize", { sim: { id: opts.id, version: opts.version }, protocol: PROTOCOL })
        .then(function (result) {
          if (done) return;            // already running standalone; ignore a late host
          done = true; clearTimeout(timer);
          var c = defaults();
          result = result || {};
          for (var k in result) if (Object.prototype.hasOwnProperty.call(result, k)) c[k] = result[k];
          c.standalone = false;
          start(c);
        }, function () { if (!done) { done = true; clearTimeout(timer); start(defaults()); } });
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
    else boot();

    return {
      get context() { return ctx; },
      get embedded() { return embedded; },
      event: function (verb, data) {
        var params = { verb: verb };
        data = data || {};
        for (var k in data) if (Object.prototype.hasOwnProperty.call(data, k)) params[k] = data[k];
        notify("ptf/event", params);
      },
      stationCompleted: function (station, data) {
        this.event("station_completed", Object.assign({ station: station }, data || {}));
      },
      saveState: function (state) { notify("ptf/state", { state: state }); },
      error: function (e) { reportError(e); }
    };
  }

  global.PTF = { connect: connect, protocol: PROTOCOL };
})(typeof window !== "undefined" ? window : this);
