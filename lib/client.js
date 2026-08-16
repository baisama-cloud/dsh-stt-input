/* dsh-stt-input — client bundle (web platform).
 *
 * Speech-to-text voice input for the DSH web GUI:
 *   - a 🎤 mic button in the composer tool row (conversation.input.left),
 *   - a status pill under the composer (conversation.composer.dock),
 *   - a settings page (settings.section → 语音输入) to pick the engine/model.
 *
 * Engines:
 *   - browser : Web Speech API (SpeechRecognition, Chrome/Edge), zero-config,
 *               live interim results written straight into the input box;
 *   - api     : MediaRecorder captures audio, POSTs base64 JSON to the host
 *               route /stt-input/transcribe (lib/index.js), which uploads it
 *               to an OpenAI-compatible /v1/audio/transcriptions endpoint
 *               (OpenAI / Groq / custom) with a selectable model.
 *
 * The API key stays in page memory only (never persisted); the non-secret
 * config survives reloads via localStorage.
 */
window.__ModuleLoader__.load({
  id: 'dsh-stt-input',
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;

    var React = require('react');

    var CSS =
      '.stt-mic-btn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:8px;border:1px solid var(--color-border,#3a3f47);background:transparent;color:var(--color-text,#e8e8e8);cursor:pointer;padding:0;transition:background .15s ease,box-shadow .15s ease;flex:none;}' +
      '.stt-mic-btn:hover{background:rgba(255,255,255,.07);}' +
      '.stt-mic-btn.stt-recording{background:rgba(239,68,68,.16);border-color:#ef4444;color:#f87171;animation:stt-pulse 1.2s ease-in-out infinite;}' +
      '.stt-mic-btn.stt-transcribing{opacity:.7;cursor:default;}' +
      '.stt-spin{animation:stt-rotate 1s linear infinite;}' +
      '.stt-status{display:inline-flex;align-items:center;gap:6px;font-size:12px;line-height:1.4;padding:3px 10px;border-radius:999px;background:rgba(255,255,255,.05);color:var(--color-text-dim,#9aa0a6);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
      '.stt-status.stt-recording{color:#f87171;}' +
      '.stt-status.stt-error{color:#f87171;background:rgba(239,68,68,.12);}' +
      '.stt-status.stt-ok{color:#4ade80;background:rgba(34,197,94,.1);}' +
      '.stt-dot{width:8px;height:8px;border-radius:50%;background:currentColor;flex:none;animation:stt-blink 1s ease-in-out infinite;}' +
      '.stt-settings{display:flex;flex-direction:column;gap:14px;padding:4px 2px 24px;color:var(--color-text,#e8e8e8);font-size:13px;line-height:1.5;}' +
      '.stt-head{display:flex;flex-direction:column;gap:4px;}' +
      '.stt-title{font-size:16px;font-weight:600;}' +
      '.stt-desc{color:var(--color-text-dim,#9aa0a6);font-size:12px;}' +
      '.stt-field{display:flex;flex-direction:column;gap:5px;}' +
      '.stt-label{font-size:12px;color:var(--color-text-dim,#9aa0a6);}' +
      '.stt-field input,.stt-field select{background:var(--color-bg,#15181d);border:1px solid var(--color-border,#2c313a);border-radius:7px;color:var(--color-text,#e8e8e8);padding:7px 9px;font-size:13px;}' +
      '.stt-field input:focus,.stt-field select:focus{outline:none;border-color:var(--color-accent,#7ea2ff);}' +
      '.stt-row{display:flex;gap:14px;flex-wrap:wrap;align-items:center;}' +
      '.stt-radio{display:inline-flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;color:var(--color-text,#e8e8e8);}' +
      '.stt-note{font-size:11px;color:var(--color-text-dim,#9aa0a6);line-height:1.7;border-top:1px solid var(--color-border,#2c313a);padding-top:10px;}' +
      '@keyframes stt-pulse{0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,.35);}50%{box-shadow:0 0 0 5px rgba(239,68,68,0);}}' +
      '@keyframes stt-blink{50%{opacity:.3;}}' +
      '@keyframes stt-rotate{to{transform:rotate(360deg);}}';

    // ---------- config (persist non-secret parts, never the API key) ----------
    var CONFIG_KEY = 'dsh-stt-input:config';
    var DEFAULT_CONFIG = {
      engine: 'browser',
      provider: 'openai',
      baseUrl: 'https://api.openai.com',
      model: 'whisper-1',
      customModel: '',
      apiKey: '',
      language: 'auto',
      insertMode: 'append'
    };

    function loadConfig() {
      var cfg = {};
      for (var k in DEFAULT_CONFIG) cfg[k] = DEFAULT_CONFIG[k];
      try {
        var raw = window.localStorage.getItem(CONFIG_KEY);
        if (raw) {
          var saved = JSON.parse(raw);
          if (saved && typeof saved === 'object') {
            for (var k2 in saved) if (k2 in cfg) cfg[k2] = saved[k2];
          }
        }
      } catch (e) {}
      return cfg;
    }

    function saveConfig(cfg) {
      try {
        var copy = {};
        for (var k in cfg) if (k !== 'apiKey') copy[k] = cfg[k];
        window.localStorage.setItem(CONFIG_KEY, JSON.stringify(copy));
      } catch (e) {}
    }

    // ---------- shared store ----------
    var store = {
      config: loadConfig(),
      status: { kind: 'idle' },
      listeners: new Set(),
      timer: undefined
    };

    function notify() {
      var fns = Array.from(store.listeners);
      for (var i = 0; i < fns.length; i++) { try { fns[i](); } catch (e) {} }
    }

    function setConfig(patch) {
      for (var k in patch) store.config[k] = patch[k];
      saveConfig(store.config);
      notify();
    }

    function setStatus(s) { store.status = s; notify(); }

    function subscribe(fn) {
      store.listeners.add(fn);
      return function () { store.listeners.delete(fn); };
    }

    function useStore() {
      var state = React.useState(0);
      var force = state[1];
      React.useEffect(function () {
        return subscribe(function () { force(function (n) { return n + 1; }); });
      }, []);
      return store;
    }

    // ---------- recording session (module-level, shared by button + pill) ----------
    var activeRec = null;
    var recChunks = [];
    var recStartedAt = 0;

    function browserSR() {
      return (typeof window !== 'undefined') ? (window.SpeechRecognition || window.webkitSpeechRecognition) : undefined;
    }

    function pickMime() {
      if (typeof MediaRecorder === 'undefined') return null;
      var list = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
      for (var i = 0; i < list.length; i++) {
        try { if (MediaRecorder.isTypeSupported(list[i])) return list[i]; } catch (e) {}
      }
      return null;
    }

    function bytesToBase64(bytes) {
      var bin = '';
      var CHUNK = 0x8000;
      for (var i = 0; i < bytes.length; i += CHUNK) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
      }
      return btoa(bin);
    }

    function applyText(inputActions, base, text) {
      var t = (text || '').trim();
      var next = t ? (base ? base + ' ' + t : t) : base;
      inputActions.setDraft(next);
    }

    function callTranscribe(payload) {
      return fetch('/stt-input/transcribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify(payload)
      }).then(function (res) { return res.json(); });
    }

    function startRecording(inputActions, base, cfg) {
      recStartedAt = Date.now();
      if (cfg.engine === 'browser') {
        var SR = browserSR();
        if (!SR) {
          setStatus({ kind: 'error', msg: '当前浏览器不支持本地语音识别，请使用 Chrome / Edge，或在 设置→语音输入 切换到 API 识别' });
          return;
        }
        var rec = new SR();
        rec.lang = cfg.language === 'auto' ? (navigator.language || 'zh-CN') : cfg.language;
        rec.continuous = true;
        rec.interimResults = true;
        var finalText = '';
        rec.onresult = function (e) {
          var f = '';
          var it = '';
          for (var i = e.resultIndex; i < e.results.length; i++) {
            if (e.results[i].isFinal) f += e.results[i][0].transcript;
            else it += e.results[i][0].transcript;
          }
          finalText = f;
          var combined = (f + it).replace(/\s+$/, '');
          applyText(inputActions, base, combined);
        };
        rec.onerror = function (e) {
          activeRec = null;
          setStatus({ kind: 'error', msg: '本地识别出错：' + ((e && e.error) || 'unknown') });
        };
        rec.onend = function () {
          activeRec = null;
          applyText(inputActions, base, finalText);
          setStatus({ kind: 'idle' });
        };
        activeRec = rec;
        setStatus({ kind: 'recording' });
        try { rec.start(); } catch (e) {
          activeRec = null;
          setStatus({ kind: 'error', msg: '无法启动本地识别：' + ((e && e.message) || e) });
        }
      } else {
        if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          setStatus({ kind: 'error', msg: '当前浏览器不支持麦克风录音' });
          return;
        }
        navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
          var mime = pickMime();
          var opts = { audioBitsPerSecond: 32000 };
          if (mime) opts.mimeType = mime;
          var rec = new MediaRecorder(stream, opts);
          recChunks = [];
          rec.ondataavailable = function (e) { if (e.data && e.data.size > 0) recChunks.push(e.data); };
          rec.onstop = function () {
            var tracks = stream.getTracks();
            for (var i = 0; i < tracks.length; i++) { try { tracks[i].stop(); } catch (e) {} }
            finalizeApi(inputActions, base, cfg);
          };
          rec.start();
          activeRec = rec;
          setStatus({ kind: 'recording' });
        }).catch(function (e) {
          setStatus({ kind: 'error', msg: '无法访问麦克风：' + (((e && e.name) || (e && e.message)) || e) });
        });
      }
    }

    function finalizeApi(inputActions, base, cfg) {
      setStatus({ kind: 'transcribing' });
      if (!recChunks.length) {
        setStatus({ kind: 'error', msg: '未录制到音频，请重试' });
        return;
      }
      var mime = recChunks[0].type || 'audio/webm';
      var blob = new Blob(recChunks, { type: mime });
      blob.arrayBuffer().then(function (buf) {
        var b64 = bytesToBase64(new Uint8Array(buf));
        if (b64.length > 6 * 1024 * 1024) {
          setStatus({ kind: 'error', msg: '录音过长，请分段识别' });
          return;
        }
        return callTranscribe({
          audioBase64: b64,
          mimeType: mime,
          model: cfg.model === 'custom' ? (cfg.customModel || 'whisper-1') : cfg.model,
          baseUrl: cfg.baseUrl,
          apiKey: cfg.apiKey,
          language: cfg.language === 'auto' ? '' : cfg.language
        });
      }).then(function (r) {
        if (r && r.ok && r.text) {
          applyText(inputActions, base, r.text);
          setStatus({ kind: 'idle' });
        } else {
          setStatus({ kind: 'error', msg: (r && r.error) || '识别失败，请检查 API Key 与网络' });
        }
      }).catch(function (e) {
        setStatus({ kind: 'error', msg: '识别出错：' + ((e && e.message) || e) });
      });
    }

    function stopRecording(inputActions, base, cfg) {
      var rec = activeRec;
      activeRec = null;
      if (!rec) return;
      try { rec.stop(); } catch (e) {
        if (cfg.engine === 'api') finalizeApi(inputActions, base, cfg);
        else setStatus({ kind: 'error', msg: '停止识别失败' });
      }
    }

    // ---------- icons ----------
    var MicIcon = React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
      React.createElement('path', { d: 'M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z' }),
      React.createElement('path', { d: 'M19 10v2a7 7 0 0 1-14 0v-2' }),
      React.createElement('line', { x1: '12', y1: '19', x2: '12', y2: '22' }));
    var StopIcon = React.createElement('svg', { width: 12, height: 12, viewBox: '0 0 24 24', fill: 'currentColor' },
      React.createElement('rect', { x: 6, y: 6, width: 12, height: 12, rx: 2 }));
    var SpinIcon = React.createElement('svg', { className: 'stt-spin', width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' },
      React.createElement('path', { d: 'M21 12a9 9 0 1 1-6.2-8.56' }));

    // ---------- mic button (composer tool row) ----------
    function MicButton(props) {
      var st = store.status;
      var cfg = store.config;
      var inputActions = props.inputActions;
      if (!inputActions) return null;
      var recording = st.kind === 'recording';
      var transcribing = st.kind === 'transcribing';
      var draft = (props.input && props.input.draft) || '';
      var onClick = function () {
        if (transcribing) return;
        var base = cfg.insertMode === 'replace' ? '' : draft;
        if (recording) stopRecording(inputActions, base, cfg);
        else startRecording(inputActions, base, cfg);
      };
      var title = recording ? '正在录音，点击停止并识别' : transcribing ? '正在识别语音…' : '语音输入（点击开始录音）';
      var cls = 'stt-mic-btn' + (recording ? ' stt-recording' : '') + (transcribing ? ' stt-transcribing' : '');
      var icon = recording ? StopIcon : transcribing ? SpinIcon : MicIcon;
      return React.createElement('button', { className: cls, onClick: onClick, title: title, 'aria-label': title }, icon);
    }

    // ---------- status pill (under the composer) ----------
    function StatusPill() {
      var st = store.status;
      var state = React.useState(0);
      var now = state[0];
      var setNow = state[1];
      React.useEffect(function () {
        if (st.kind !== 'recording' || !store.timer) return undefined;
        setNow(Date.now());
        return store.timer.interval(function () { setNow(Date.now()); }, 1000);
      }, [st.kind]);
      if (st.kind === 'idle') return null;
      var cls = 'stt-status';
      var content;
      if (st.kind === 'recording') {
        cls += ' stt-recording';
        var secs = recStartedAt ? Math.max(0, Math.round(((now || Date.now()) - recStartedAt) / 1000)) : 0;
        content = React.createElement('span', null,
          React.createElement('span', { className: 'stt-dot' }),
          React.createElement('span', null, '正在录音 ' + secs + 's — 点击麦克风停止并识别'));
      } else if (st.kind === 'transcribing') {
        content = React.createElement('span', null, '正在识别语音…');
      } else if (st.kind === 'error') {
        cls += ' stt-error';
        content = React.createElement('span', null, '⚠ ' + st.msg);
      } else {
        cls += ' stt-ok';
        content = React.createElement('span', null, '✓ ' + (st.msg || '已识别'));
      }
      return React.createElement('div', { className: cls }, content);
    }

    // ---------- settings page ----------
    function Opts(list) {
      return list.map(function (o) { return React.createElement('option', { key: o.v, value: o.v }, o.t); });
    }

    function Field(props) {
      return React.createElement('label', { className: 'stt-field' },
        React.createElement('span', { className: 'stt-label' }, props.label),
        props.children);
    }

    function SttSettings() {
      var cfg = store.config;
      var set = function (patch) { setConfig(patch); };
      var api = cfg.engine === 'api';
      var customModel = cfg.model === 'custom';
      var onProvider = function (p) {
        set({ provider: p });
        if (p === 'openai') set({ baseUrl: 'https://api.openai.com', model: 'whisper-1' });
        else if (p === 'groq') set({ baseUrl: 'https://api.groq.com/openai', model: 'whisper-large-v3' });
      };
      return React.createElement('div', { className: 'stt-settings' },
        React.createElement('div', { className: 'stt-head' },
          React.createElement('div', { className: 'stt-title' }, '语音输入（STT）'),
          React.createElement('div', { className: 'stt-desc' }, '点击输入框旁的 🎤 按钮开始录音，再点一次停止并把识别文字填入输入框。')),
        React.createElement(Field, { label: '识别引擎' },
          React.createElement('select', { value: cfg.engine, onChange: function (e) { set({ engine: e.target.value }); } }, Opts([
            { v: 'browser', t: '浏览器本地识别（Chrome/Edge，无需密钥）' },
            { v: 'api', t: 'API 识别（OpenAI 兼容接口）' }
          ]))),
        api ? React.createElement(React.Fragment, null,
          React.createElement(Field, { label: '服务预设' },
            React.createElement('select', { value: cfg.provider, onChange: function (e) { onProvider(e.target.value); } }, Opts([
              { v: 'openai', t: 'OpenAI（api.openai.com）' },
              { v: 'groq', t: 'Groq（api.groq.com，whisper-large-v3 免费）' },
              { v: 'custom', t: '自定义接口' }
            ]))),
          React.createElement(Field, { label: 'API Base URL' },
            React.createElement('input', { type: 'text', value: cfg.baseUrl, placeholder: 'https://api.openai.com', onChange: function (e) { set({ baseUrl: e.target.value }); } })),
          React.createElement(Field, { label: '识别模型' },
            React.createElement('select', { value: cfg.model, onChange: function (e) { set({ model: e.target.value }); } }, Opts([
              { v: 'whisper-1', t: 'whisper-1（OpenAI）' },
              { v: 'whisper-large-v3', t: 'whisper-large-v3（Groq）' },
              { v: 'whisper-large-v3-turbo', t: 'whisper-large-v3-turbo（Groq）' },
              { v: 'distil-whisper-large-v3-en', t: 'distil-whisper-large-v3-en（Groq，仅英文）' },
              { v: 'custom', t: '自定义模型…' }
            ]))),
          customModel ? React.createElement(Field, { label: '自定义模型名称' },
            React.createElement('input', { type: 'text', value: cfg.customModel, placeholder: '例如 whisper-large-v3-turbo', onChange: function (e) { set({ customModel: e.target.value }); } })) : null,
          React.createElement(Field, { label: 'API Key' },
            React.createElement('input', { type: 'password', value: cfg.apiKey, placeholder: 'sk-…', onChange: function (e) { set({ apiKey: e.target.value }); } }))
        ) : null,
        React.createElement(Field, { label: '识别语言' },
          React.createElement('select', { value: cfg.language, onChange: function (e) { set({ language: e.target.value }); } }, Opts([
            { v: 'auto', t: '自动检测' }, { v: 'zh', t: '中文' }, { v: 'en', t: '英文' },
            { v: 'ja', t: '日语' }, { v: 'ko', t: '韩语' }, { v: 'fr', t: '法语' },
            { v: 'de', t: '德语' }, { v: 'es', t: '西班牙语' }, { v: 'ru', t: '俄语' },
            { v: 'pt', t: '葡萄牙语' }, { v: 'it', t: '意大利语' }
          ]))),
        React.createElement('div', { className: 'stt-field' },
          React.createElement('span', { className: 'stt-label' }, '识别结果写入方式'),
          React.createElement('div', { className: 'stt-row' },
            React.createElement('label', { className: 'stt-radio' },
              React.createElement('input', { type: 'radio', name: 'stt-insert', checked: cfg.insertMode === 'append', onChange: function () { set({ insertMode: 'append' }); } }),
              React.createElement('span', null, '追加到输入框')),
            React.createElement('label', { className: 'stt-radio' },
              React.createElement('input', { type: 'radio', name: 'stt-insert', checked: cfg.insertMode === 'replace', onChange: function () { set({ insertMode: 'replace' }); } }),
              React.createElement('span', null, '替换输入框内容')))),
        React.createElement('div', { className: 'stt-note' },
          '浏览器本地识别使用系统自带的语音识别（Chrome / Edge），即时显示中间结果、无需配置密钥；' +
          'API 识别会把录音发送到 OpenAI 兼容的 /v1/audio/transcriptions 接口（OpenAI、Groq 等），需要填写 API Key。' +
          '密钥仅保存在当前页面内存中，不写入本地存储。')
      );
    }

    // ---------- plugin ----------
    var inject = ['slots'];

    function apply(ctx) {
      store.timer = ctx.get('timer');
      try {
        var style = document.createElement('style');
        style.setAttribute('data-plugin', 'dsh-stt-input');
        style.textContent = CSS;
        document.head.appendChild(style);
        if (typeof ctx.effect === 'function') {
          ctx.effect(function () {
            return function () { if (style.parentNode) style.parentNode.removeChild(style); };
          });
        }
      } catch (e) {}

      function register(name, id, order, component, extra) {
        ctx.slots.inject(name, function () {
          var opts = { name: name, id: id, order: order };
          if (extra) for (var k in extra) opts[k] = extra[k];
          return ctx.slots.register(opts, component);
        });
      }

      register('conversation.input.left', 'stt-input-mic', 30, MicButton);
      register('conversation.composer.dock', 'stt-input-status', 100, StatusPill);
      register('settings.section', 'stt-input', 52, SttSettings, {
        label: function () { return '语音输入'; },
        inject: function () { return {}; }
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.name = 'dsh-stt-input';
    return module.exports;
  }
});
