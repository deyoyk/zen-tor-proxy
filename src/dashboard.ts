import type { HealthPayload } from './proxy/server.js';
import type { HistoryPoint, RequestLogEntry } from './metrics.js';

export interface DashboardPayload {
  health: HealthPayload;
  stats: Record<string, unknown>;
  history: HistoryPoint[];
  statusCounts: Record<number, number>;
  models: Record<string, number>;
  recent: RequestLogEntry[];
  config: Record<string, unknown>;
  version: string;
  runtime: { node: string; platform: string; arch: string; pid: number };
}

export const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>zen-tor-proxy · dashboard</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%23000'/%3E%3Crect x='1' y='1' width='30' height='30' rx='5' fill='none' stroke='%23fff' stroke-width='2'/%3E%3Cpath d='M9 10h14l-12 12h12' stroke='%23fff' stroke-width='3' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E" />
<style>
:root {
  --bg: #000000;
  --fg: #fafafa;
  --muted: #8a8a8a;
  --line: #262626;
  --line2: #161616;
  --card: #0a0a0a;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  background: var(--bg);
  color: var(--fg);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Inter, Helvetica, Arial, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}
.mono { font-family: ui-monospace, 'SF Mono', 'Geist Mono', Menlo, Consolas, monospace; }
.wrap { max-width: 1080px; margin: 0 auto; padding: 24px 24px 64px; }
header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 0 20px; border-bottom: 1px solid var(--line); margin-bottom: 22px;
  flex-wrap: wrap; gap: 14px;
}
.brand { display: flex; align-items: center; gap: 12px; }
.mark {
  width: 34px; height: 34px; background: #fff; color: #000; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  font-weight: 700; font-size: 15px;
}
.title { font-weight: 600; font-size: 15px; letter-spacing: -0.01em; }
.sub { color: var(--muted); font-size: 12px; }
.meta { display: flex; gap: 14px; align-items: center; font-size: 12px; color: var(--muted); }
.pill {
  border: 1px solid var(--fg); padding: 2px 10px; border-radius: 999px;
  font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--fg);
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
}
.pill.degraded { border-color: var(--muted); color: var(--muted); }
.pill.offline { border-color: var(--muted); color: var(--muted); }
.grid { display: grid; gap: 12px; }
.stats { grid-template-columns: repeat(auto-fill, minmax(164px, 1fr)); margin-bottom: 24px; }
.card { border: 1px solid var(--line); border-radius: 12px; padding: 16px; background: var(--card); }
.stat-label {
  font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em;
  color: var(--muted); margin-bottom: 6px;
}
.stat-value {
  font-family: ui-monospace, 'SF Mono', 'Geist Mono', Menlo, Consolas, monospace;
  font-size: 22px; font-weight: 600; letter-spacing: -0.02em; line-height: 1.2;
}
.stat-sub { font-size: 11px; color: var(--muted); margin-top: 4px; }
h3 {
  font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em;
  color: var(--muted); font-weight: 600; margin-bottom: 14px;
}
.charts { grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); margin-bottom: 24px; }
.chart canvas { width: 100%; height: 90px; display: block; }
.chart-meta {
  display: flex; justify-content: space-between; margin-top: 8px;
  font-family: ui-monospace, 'SF Mono', Menlo, monospace; font-size: 11px; color: var(--muted);
}
.two { grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); margin-bottom: 24px; }
.section { margin-bottom: 24px; }
table { width: 100%; border-collapse: collapse; font-size: 12px; }
td, th { padding: 6px 8px; border-bottom: 1px solid var(--line2); text-align: left; vertical-align: top; }
th {
  color: var(--muted); font-weight: 500; text-transform: uppercase;
  font-size: 10px; letter-spacing: 0.08em;
}
td.key { color: var(--muted); white-space: nowrap; font-family: ui-monospace, 'SF Mono', Menlo, monospace; }
td.val { font-family: ui-monospace, 'SF Mono', Menlo, monospace; word-break: break-all; }
.bar { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; font-size: 12px; }
.bar .bl { width: 48px; color: var(--muted); text-align: right; font-family: ui-monospace, Menlo, monospace; }
.bar .bv { width: 52px; color: var(--fg); text-align: right; font-family: ui-monospace, Menlo, monospace; }
.bar-track { flex: 1; height: 6px; background: #161616; border-radius: 999px; overflow: hidden; }
.bar-fill { height: 100%; background: #fff; border-radius: 999px; }
.req-table { width: 100%; font-size: 12px; }
.req-table td { font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace; padding: 5px 8px; }
.badge {
  padding: 1px 6px; border-radius: 4px; font-size: 10px;
  border: 1px solid var(--muted); color: var(--muted);
}
.badge.ok { border-color: var(--fg); color: var(--fg); }
.badge.err { border-color: var(--fg); color: var(--fg); background: #fff; }
details { margin-top: 24px; border: 1px solid var(--line); border-radius: 12px; background: var(--card); }
summary {
  cursor: pointer; padding: 12px 16px; font-size: 11px; text-transform: uppercase;
  letter-spacing: 0.1em; color: var(--muted); user-select: none;
}
pre {
  padding: 16px; overflow: auto; max-height: 420px; font-size: 11px;
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  color: var(--muted); border-top: 1px solid var(--line); white-space: pre-wrap;
}
footer { margin-top: 28px; text-align: center; font-size: 11px; color: var(--muted); }
</style>
</head>
<body>
<div class="wrap">

  <header>
    <div class="brand">
      <div class="mark">Z</div>
      <div>
        <div class="title">zen-tor-proxy</div>
        <div class="sub">OpenAI-compatible endpoint routed through Tor &middot; automatic exit-IP rotation</div>
      </div>
    </div>
    <div class="meta">
      <span class="pill" id="status">connecting</span>
      <span id="version">v—</span>
      <span id="clock">--:--:--</span>
    </div>
  </header>

  <section class="grid stats" id="stats"></section>

  <section class="grid charts">
    <div class="card chart">
      <h3>Requests / s</h3>
      <canvas id="chart-req"></canvas>
      <div class="chart-meta"><span id="req-now">—</span><span id="req-avg">—</span></div>
    </div>
    <div class="card chart">
      <h3>Throughput (KB/s)</h3>
      <canvas id="chart-bytes"></canvas>
      <div class="chart-meta"><span id="bytes-now">—</span><span id="bytes-avg">—</span></div>
    </div>
    <div class="card chart">
      <h3>Errors / s</h3>
      <canvas id="chart-err"></canvas>
      <div class="chart-meta"><span id="err-now">—</span><span id="err-avg">—</span></div>
    </div>
  </section>

  <section class="grid two">
    <div class="card">
      <h3>Status codes</h3>
      <div id="statuscodes"></div>
    </div>
    <div class="card">
      <h3>Models</h3>
      <div id="models"></div>
    </div>
  </section>

  <section class="grid two">
    <div class="card">
      <h3>Tor</h3>
      <table id="tor"></table>
    </div>
    <div class="card">
      <h3>Configuration</h3>
      <table id="config"></table>
    </div>
  </section>

  <section class="section card">
    <h3>Recent requests</h3>
    <div style="overflow-x:auto"><table class="req-table" id="requests"></table></div>
  </section>

  <details>
    <summary>Raw JSON — everything, verbatim</summary>
    <pre id="raw"></pre>
  </details>

  <footer id="footer"></footer>
</div>

<script>
'use strict';
function $(id) { return document.getElementById(id); }
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function fmtBytes(n) {
  n = Number(n) || 0;
  if (n >= 1073741824) return (n / 1073741824).toFixed(2) + ' GB';
  if (n >= 1048576) return (n / 1048576).toFixed(2) + ' MB';
  if (n >= 1024) return (n / 1024).toFixed(1) + ' KB';
  return n + ' B';
}
function fmtDur(ms) {
  if (ms == null) return '—';
  ms = Number(ms);
  if (ms < 1000) return ms + ' ms';
  var s = Math.round(ms / 1000);
  if (s < 60) return s + ' s';
  var m = Math.floor(s / 60), r = s % 60;
  if (m < 60) return m + 'm ' + r + 's';
  var h = Math.floor(m / 60); m = m % 60;
  return h + 'h ' + m + 'm';
}
function fmtUptime(sec) {
  sec = Number(sec) || 0;
  var d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  if (d > 0) return d + 'd ' + h + 'h';
  if (h > 0) return h + 'h ' + m + 'm';
  if (m > 0) return m + 'm ' + s + 's';
  return s + 's';
}
function fmtTime(ts) {
  if (ts == null) return '—';
  return new Date(Number(ts)).toLocaleTimeString();
}
function fmtInterval(ms) {
  if (ms == null) return '—';
  if (ms <= 0) return 'off — on-demand only';
  return fmtDur(ms);
}
function arrSum(a) {
  var t = 0; for (var i = 0; i < a.length; i++) t += a[i]; return t;
}
function avgLast(a, n) {
  if (!a.length) return 0;
  var slice = a.slice(-n);
  return arrSum(slice) / slice.length;
}

var state = null;

function drawChart(id, datasets, unit) {
  var canvas = $(id);
  if (!canvas) return;
  var dpr = window.devicePixelRatio || 1;
  var w = canvas.clientWidth, h = canvas.clientHeight;
  if (w === 0) return;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  var ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  var N = 0;
  datasets.forEach(function (d) { if (d.data.length > N) N = d.data.length; });
  if (N < 2) return;
  var pad = 2;
  var maxV = 0;
  datasets.forEach(function (d) {
    d.data.forEach(function (v) { if (v > maxV) maxV = v; });
  });
  if (maxV <= 0) maxV = 1;
  ctx.strokeStyle = '#161616';
  ctx.lineWidth = 1;
  for (var g = 0; g < 4; g++) {
    var gy = pad + (h - pad * 2) * (g / 3);
    ctx.beginPath(); ctx.moveTo(pad, gy); ctx.lineTo(w - pad, gy); ctx.stroke();
  }
  var plotW = w - pad * 2, plotH = h - pad * 2;
  var step = plotW / (N - 1);
  datasets.forEach(function (d) {
    var start = N - d.data.length;
    ctx.beginPath();
    for (var i = 0; i < d.data.length; i++) {
      var x = pad + (start + i) * step;
      var y = h - pad - (d.data[i] / maxV) * plotH;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = d.color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    if (d.fill) {
      ctx.lineTo(pad + (start + d.data.length - 1) * step, h - pad);
      ctx.lineTo(pad, h - pad);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fill();
    }
  });
}

function statCard(label, value, sub) {
  return '<div class="card"><div class="stat-label">' + esc(label) + '</div>' +
    '<div class="stat-value">' + esc(value) + '</div>' +
    (sub ? '<div class="stat-sub">' + esc(sub) + '</div>' : '') + '</div>';
}

function bars(map, total) {
  var keys = Object.keys(map);
  if (!keys.length) return '<div style="color:var(--muted);font-size:12px">no data yet</div>';
  keys.sort(function (a, b) { return map[b] - map[a]; });
  var html = '';
  keys.slice(0, 12).forEach(function (k) {
    var v = map[k];
    var pct = total > 0 ? (v / total) * 100 : 0;
    html += '<div class="bar"><span class="bl">' + esc(k) + '</span>' +
      '<div class="bar-track"><div class="bar-fill" style="width:' + pct.toFixed(1) + '%"></div></div>' +
      '<span class="bv">' + v + '</span></div>';
  });
  return html;
}

function rows(pairs) {
  var html = '';
  pairs.forEach(function (p) {
    html += '<tr><td class="key">' + esc(p[0]) + '</td><td class="val">' + esc(p[1]) + '</td></tr>';
  });
  return html;
}

function setStatus(label, cls) {
  var el = $('status');
  el.textContent = label;
  el.className = 'pill' + (cls ? ' ' + cls : '');
}

function render(p) {
  state = p;
  var s = p.stats;
  var h = p.health;
  var last = p.history.length ? p.history[p.history.length - 1] : null;
  var reqRate = last ? last.requests : 0;
  var bytesRate = last ? (last.bytesDown + last.bytesUp) : 0;
  var errRate = last ? last.errors : 0;

  setStatus(p.health.status === 'ok' ? 'ok' : p.health.status, p.health.status === 'ok' ? '' : 'degraded');
  $('version').textContent = 'v' + esc(p.version) + ' · ' + esc(p.runtime.platform) + '/' + esc(p.runtime.arch) + ' · node ' + esc(p.runtime.node) + ' · pid ' + esc(p.runtime.pid);

  var stats = [
    ['Requests', s.requestsTotal],
    ['Active', s.activeRequests + ' / ' + s.peakActiveRequests, 'current / peak'],
    ['Streaming', s.streamingRequests],
    ['Errors', s.errorsTotal],
    ['Upstream errors', s.upstreamErrors],
    ['Retries', s.retries],
    ['Success rate', String(s.successRate) + '%'],
    ['Bytes up', fmtBytes(s.bytesUp)],
    ['Bytes down', fmtBytes(s.bytesDown)],
    ['Total bytes', fmtBytes((Number(s.bytesUp) || 0) + (Number(s.bytesDown) || 0))],
    ['Req / s', reqRate.toFixed(1), 'now'],
    ['KB / s down', bytesRate ? (bytesRate / 1024).toFixed(1) : '0', 'now'],
    ['Avg latency', fmtDur(s.avgDurationMs)],
    ['Longest', fmtDur(s.longestRequestMs)],
    ['Rotations', s.rotations],
    ['Rotation failures', s.rotationFailures],
    ['Exit IP', s.lastExitIp || 'unknown'],
    ['Uptime', fmtUptime(s.uptimeSec)],
  ];
  var html = '';
  stats.forEach(function (st) { html += statCard(st[0], st[1], st[2]); });
  $('stats').innerHTML = html;

  var reqData = p.history.map(function (x) { return x.requests; });
  var errData = p.history.map(function (x) { return x.errors; });
  var upData = p.history.map(function (x) { return x.bytesUp / 1024; });
  var downData = p.history.map(function (x) { return x.bytesDown / 1024; });

  drawChart('chart-req', [{ data: reqData, color: '#ffffff', fill: true }]);
  drawChart('chart-bytes', [
    { data: upData, color: '#6b6b6b', fill: false },
    { data: downData, color: '#ffffff', fill: true },
  ]);
  drawChart('chart-err', [{ data: errData, color: '#ffffff', fill: true }]);

  $('req-now').textContent = 'now ' + reqRate.toFixed(1) + '/s';
  $('req-avg').textContent = 'avg ' + avgLast(reqData, 30).toFixed(1) + '/s';
  $('err-now').textContent = 'now ' + errRate.toFixed(1) + '/s';
  $('err-avg').textContent = 'avg ' + avgLast(errData, 30).toFixed(1) + '/s';
  $('bytes-now').textContent = 'now ' + (bytesRate / 1024).toFixed(1) + ' KB/s';
  $('bytes-avg').textContent = 'avg ' + avgLast(downData, 30).toFixed(1) + ' KB/s';

  var totalStatus = 0;
  Object.keys(p.statusCounts).forEach(function (k) { totalStatus += p.statusCounts[k]; });
  $('statuscodes').innerHTML = bars(p.statusCounts, totalStatus);
  var totalModels = 0;
  Object.keys(p.models).forEach(function (k) { totalModels += p.models[k]; });
  $('models').innerHTML = bars(p.models, totalModels);

  $('tor').innerHTML = rows([
    ['running', h.tor.running ? 'yes' : 'no'],
    ['binary', h.tor.binaryPath || '—'],
    ['socks port', h.tor.socksPort != null ? h.tor.socksPort : '—'],
    ['control port', h.tor.controlPort != null ? h.tor.controlPort : '—'],
    ['started', fmtTime(h.tor.startedAt)],
    ['restarts', h.tor.restarts],
    ['exit ip', h.exitIp || 'unknown'],
    ['ip checked', fmtTime(h.lastIpCheckedAt)],
    ['last rotation', fmtTime(s.lastRotationAt)],
    ['next rotation', h.nextRotationAt != null ? fmtTime(h.nextRotationAt) : 'never'],
    ['rotate interval', fmtInterval(h.rotateIntervalMs)],
    ['upstream', h.upstream],
  ]);

  var configPairs = [];
  Object.keys(p.config).sort().forEach(function (k) {
    configPairs.push([k, p.config[k]]);
  });
  $('config').innerHTML = rows(configPairs);

  var reqHtml = '<thead><tr><th>time</th><th>status</th><th>kind</th><th>model</th><th>stream</th><th>latency</th><th>up</th><th>down</th></tr></thead><tbody>';
  var recent = p.recent.slice(-40).reverse();
  recent.forEach(function (r) {
    var badge = r.kind === 'ok' ? 'ok' : 'err';
    var label = r.kind === 'ok' ? String(r.status) : (r.status != null ? String(r.status) : r.kind);
    reqHtml += '<tr>' +
      '<td>' + fmtTime(r.at) + '</td>' +
      '<td><span class="badge ' + badge + '">' + esc(label) + '</span></td>' +
      '<td>' + esc(r.kind) + (r.retried ? ' · retried' : '') + '</td>' +
      '<td>' + esc(r.model || '—') + '</td>' +
      '<td>' + (r.stream ? 'yes' : 'no') + '</td>' +
      '<td>' + fmtDur(r.durationMs) + '</td>' +
      '<td>' + fmtBytes(r.bytesUp) + '</td>' +
      '<td>' + fmtBytes(r.bytesDown) + '</td>' +
      '</tr>';
  });
  reqHtml += '</tbody>';
  $('requests').innerHTML = reqHtml;

  $('raw').textContent = JSON.stringify(p, null, 2);
  $('footer').textContent = 'zen-tor-proxy v' + p.version + ' · dashboard unauthenticated · refresh 2s';
}

function poll() {
  fetch('/api/dashboard', { cache: 'no-store' })
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(render)
    .catch(function (err) {
      setStatus('offline', 'offline');
      $('footer').textContent = 'dashboard unreachable: ' + err.message;
    });
}

setInterval(function () {
  $('clock').textContent = new Date().toLocaleTimeString();
}, 1000);
setInterval(poll, 2000);
poll();
</script>
</body>
</html>
`;
