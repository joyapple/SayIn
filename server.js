/**
 * SayIn · 手机写字板 → 电脑
 * 功能：手机输入法打字/语音识别 → 点"发送"→ 文字推到所有 desk 客户端
 * 支持应用切换、自动粘贴、回车发送、设置持久化、历史持久化
 *
 * @author  joyapple
 * @license Apache-2.0
 */
import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import os from 'os';
import { spawn, execFile, spawnSync } from 'child_process';
import * as crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isMac = process.platform === 'darwin';

const HTTP_PORT = 8000;
const HTTPS_PORT = 8443;

// === 数据持久化 ===
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

// === 设置（持久化）===
const DEFAULT_SETTINGS = {
  autoPaste: false,        // 自动粘贴到光标
  appendMode: true,        // 追加模式
  enterAfterPaste: false,  // 粘贴后自动回车发送
  appWhitelist: [],        // 可切换软件白名单（空数组=显示全部）
  lastTargetApp: '',       // 上次选择的软件
  language: 'zh',          // 界面语言：zh | en
};

function loadSettings() {
  try {
    if (!fs.existsSync(SETTINGS_FILE)) return { ...DEFAULT_SETTINGS };
    const s = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    return { ...DEFAULT_SETTINGS, ...s };
  } catch { return { ...DEFAULT_SETTINGS }; }
}
let settings = loadSettings();
function saveSettings() {
  try { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2)); }
  catch (e) { console.log('[settings] 保存失败：', e.message); }
}

// === 历史记录持久化 ===
function loadHistory() {
  try {
    if (!fs.existsSync(HISTORY_FILE)) return [];
    return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
  } catch { return []; }
}
let historyCache = loadHistory();
function saveHistory() {
  try { fs.writeFileSync(HISTORY_FILE, JSON.stringify(historyCache, null, 2)); }
  catch (e) { console.log('[history] 保存失败：', e.message); }
}
function addToHistory(text, ts, from, targetApp) {
  const t = new Date(ts || Date.now()).toLocaleTimeString('zh-CN', { hour12: false });
  historyCache.unshift({ text, ts: ts || Date.now(), from: from || '手机', t, targetApp: targetApp || '' });
  if (historyCache.length > 200) historyCache = historyCache.slice(0, 200);
  saveHistory();
}

// === 剪贴板 / 自动粘贴（macOS）===
function copyToClipboard(text) {
  return new Promise(resolve => {
    if (!isMac) return resolve(false);
    try {
      const p = spawn('pbcopy', ['-Prefer', 'txt']);
      p.on('error', () => resolve(false));
      p.on('close', (code) => resolve(code === 0));
      p.stdin.on('error', () => {});
      p.stdin.write(text, 'utf8');
      p.stdin.end();
    } catch { resolve(false); }
  });
}

// 模拟按键（Cmd+V / 回车）
function sendKeys(keys) {
  return new Promise(resolve => {
    if (!isMac) return resolve(false);
    execFile('osascript', ['-e', `tell application "System Events" to keystroke "${keys}"`],
      (err) => { resolve(!err); });
  });
}
function doPasteAtCursor() {
  return new Promise(resolve => {
    if (!isMac) return resolve(false);
    execFile('osascript', ['-e', 'tell application "System Events" to keystroke "v" using command down'],
      (err) => {
        if (err) console.log('[paste] 自动粘贴失败（可能未给辅助功能权限）：', err.message.split('\n')[0]);
        resolve(!err);
      });
  });
}
function doEnter() {
  return new Promise(resolve => {
    if (!isMac) return resolve(false);
    execFile('osascript', ['-e', 'tell application "System Events" to keystroke return'],
      (err) => {
        if (err) console.log('[enter] 回车失败：', err.message.split('\n')[0]);
        resolve(!err);
      });
  });
}

// === 获取运行中应用列表 / 激活应用 ===
// 系统进程黑名单（用进程内部名匹配，稳定可靠）
const SYSTEM_PROCESSES = new Set([
  'Spotlight', 'Dock', 'ControlCenter', 'SystemUIServer', 'Finder',
  'Notification Center', 'loginwindow', 'universalAccessAuthWarn',
  'System Events', 'CoreServicesUIAgent', 'AirPlayUIAgent',
  'ScreenshotUI', 'com.apple.appkit.xpc.openAndSavePanelService',
  'iCloud', 'iCloudPreferences', 'ICTKFrameSwitcher',
  'CoreLocationAgent', 'WDGNotificationCenter', 'DataDetectorsSourceViewService',
  'Sharingd', 'rapportd', 'ClipboardReader', 'pvmodulekeeper',
  'Trustd', 'trustd', 'AKDaemon', 'AppleSpell', 'folderurlschemehandler',
  'MalwareRemovalTool', 'SafariBookmarksSyncAgent', 'SafariNotificationAgent',
  'PhotoAnalysisAgent', 'PhotosAgent', 'IntelligentLight',
  'com.apple.WebKit.Networking', 'com.apple.WebKit.WebContent',
  'com.apple.WebKit.Plugin.64', 'com.apple.appstoreagent',
  'CoreSimulatorBridge', 'VTDecoderXPCService',
  'screencaptureui', 'Wallpaper', 'WindowManager', 'FinderSync',
  'CoreServicesUIAgent', 'StoreKitAgent', 'Safari', 'Mail', 'Photos',
  'iCloud', 'iCloudHelper', 'nsurlsessiond', 'trustd',
]);

function getRunningApps() {
  return new Promise(resolve => {
    if (!isMac) return resolve([]);

    // 双路获取：lsappinfo（有显示名）+ ps（兜底）
    const lsPromise = new Promise(r => {
      execFile('lsappinfo', ['list'], { maxBuffer: 2 * 1024 * 1024 }, (err, stdout) => {
        if (err) return r([]);
        try {
          const lines = stdout.split('\n');
          const apps = new Map();
          let cur = null;
          for (const line of lines) {
            const hm = line.match(/^\s+\d+\)\s+"(.+)"\s+ASN:/);
            if (hm) { cur = { name: hm[1], bundleID: '', type: '' }; apps.set(cur.name, cur); continue; }
            if (!cur) continue;
            const bm = line.match(/bundleID="([^"]*)"/); if (bm) cur.bundleID = bm[1];
            const tm = line.match(/type="([^"]*)"/); if (tm) cur.type = tm[1];
          }
          // lsappinfo 过滤：Foreground + UIElement，排除系统
          const SKIP_WORDS = ['Helper', 'Renderer', 'Player', 'Dock Extra'];
          const result = [];
          for (const [, a] of apps) {
            if (a.type !== 'Foreground' && a.type !== 'UIElement') continue;
            if (a.bundleID.startsWith('com.apple.')) continue;
            if (SYSTEM_PROCESSES.has(a.name)) continue;
            if (SKIP_WORDS.some(w => a.name.includes(w))) continue;
            if (!a.name) continue;
            result.push(a.name);
          }
          r(result);
        } catch { r([]); }
      });
    });

    const psPromise = new Promise(r => {
      execFile('ps', ['-axo', 'pid,comm='], (err, stdout) => {
        if (err) return r([]);
        try {
          const result = [];
          const SKIP_PS = ['Helper', 'Renderer', 'Plugin', 'GPU', 'Monitor', 'Falemon', 'Lemon'];
          for (const line of stdout.split('\n')) {
            const m = line.trim().match(/^\d+\s+(.+)/);
            if (!m) continue;
            const comm = m[1];
            // 只要 /Applications/ 或 /System/Applications/ 下的主 app
            const isUserApp = comm.startsWith('/Applications/');
            const isSystemApp = comm.startsWith('/System/Applications/');
            if (!isUserApp && !isSystemApp) continue;
            if (!comm.includes('.app/Contents/MacOS/')) continue;
            // 排除子进程和后台进程
            if (SKIP_PS.some(s => comm.includes(s))) continue;
            // 从路径提取 .app 名
            const appMatch = comm.match(/\/(Applications|System\/Applications)\/([^/]+\.app)\//);
            let appName;
            if (appMatch) {
              appName = appMatch[2].replace(/\.app$/, '');
            } else {
              const parts = comm.split('/');
              appName = parts[parts.length - 1];
            }
            if (!appName || SYSTEM_PROCESSES.has(appName)) continue;
            result.push(appName);
          }
          r([...new Set(result)]);
        } catch { r([]); }
      });
    });

    Promise.all([lsPromise, psPromise]).then(([lsApps, psApps]) => {
      // lsappinfo 优先（有中文显示名），ps 补充
      const existing = new Set(lsApps.map(n => n.toLowerCase()));
      const merged = [...lsApps];
      for (const name of psApps) {
        if (!existing.has(name.toLowerCase())) {
          merged.push(name);
          existing.add(name.toLowerCase());
        }
      }
      // 去重：有主应用时移除子进程（如 WeChat 存在则去掉 WeChatAppEx）
      const FINAL_SKIP = [
        ['WeChatAppEx', 'WeChat'],
      ];
      for (const [child, parent] of FINAL_SKIP) {
        if (merged.includes(parent)) {
          const idx = merged.indexOf(child);
          if (idx !== -1) merged.splice(idx, 1);
        }
      }
      resolve(merged.sort((a, b) => a.localeCompare(b)));
    });
  });
}

function activateApp(name) {
  return new Promise(resolve => {
    if (!isMac || !name) return resolve(false);
    // 优先用 open -a（零权限），再兜底 osascript
    execFile('open', ['-a', name], (err) => {
      if (!err) { console.log(`[app] 已激活"${name}"`); return resolve(true); }
      // 兜底：osascript（需要自动化权限）
      const safeName = name.replace(/"/g, '\\"');
      execFile('osascript', ['-e',
        `tell application "System Events"
          try
            set frontmost of (first process whose displayed name is "${safeName}") to true
          on error
            set frontmost of (first process whose name is "${safeName}") to true
          end try
        end tell`],
        (err2) => {
          if (err2) console.log(`[app] 激活"${name}"失败：`, err2.message.split('\n')[0]);
          else console.log(`[app] 已激活"${name}"`);
          resolve(!err2);
        });
    });
  });
}

// === 1. 自签证书（首次运行自动生成）===
const certsDir = path.join(__dirname, 'certs');
if (!fs.existsSync(certsDir)) fs.mkdirSync(certsDir, { recursive: true });
const certPath = path.join(certsDir, 'cert.pem');
const keyPath = path.join(certsDir, 'key.pem');
if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
  console.log('[cert] 生成自签证书…');
  const ips = getLanIps();
  const san = ['localhost', '127.0.0.1', ...ips].map(ip => `IP:${ip}`).join(',');
  const sanFile = path.join(certsDir, 'san.cnf');
  fs.writeFileSync(sanFile, `[v3]\nsubjectAltName=${san}\nextendedKeyUsage=serverAuth\n`);
  const { status } = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048',
    '-keyout', keyPath, '-out', certPath, '-days', '3650', '-nodes',
    '-subj', '/CN=SayIn',
    '-extfile', sanFile, '-extensions', 'v3'], { stdio: 'inherit' });
  if (status !== 0) { console.error('[cert] 证书生成失败，请安装 openssl'); process.exit(1); }
  console.log('[cert] 证书已生成');
}

const credentials = { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };

// === 2. 静态文件服务 ===
const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.pem': 'application/x-x509-ca-cert',
};

function serveStatic(req, res) {
  let reqPath = decodeURIComponent(req.url.split('?')[0]);
  if (reqPath === '/') reqPath = '/index.html';
  if (reqPath === '/desk') reqPath = '/desk.html';
  if (reqPath === '/settings') reqPath = '/settings.html';
  if (reqPath === '/landing') reqPath = '/landing.html';
  const filePath = path.join(PUBLIC_DIR, reqPath);
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
  if (!fs.existsSync(filePath)) { res.writeHead(404); return res.end('Not Found'); }
  const data = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache, no-store, must-revalidate' });
  res.end(data);
}

// 证书下载（作为 iOS 描述文件 .mobileconfig）
function serveCert(req, res) {
  const certBuf = fs.readFileSync(certPath);
  const certBase64 = certBuf.toString('base64').match(/.{1,76}/g).join('\n');
  const uuid = crypto.randomUUID();
  const mc = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>PayloadContent</key><array><dict>
    <key>PayloadCertificateFileName</key><string>SayIn.pem</string>
    <key>PayloadContent</key><data>
${certBase64}
    </data>
    <key>PayloadDescription</key><string>信任 SayIn 的自签证书</string>
    <key>PayloadDisplayName</key><string>SayIn</string>
    <key>PayloadIdentifier</key><string>com.sayit.cert</string>
    <key>PayloadType</key><string>com.apple.security.root</string>
    <key>PayloadUUID</key><string>${uuid}</string>
    <key>PayloadVersion</key><integer>1</integer>
  </dict></array>
  <key>PayloadDisplayName</key><string>SayIn 证书</string>
  <key>PayloadIdentifier</key><string>com.sayit</string>
  <key>PayloadType</key><string>Configuration</string>
  <key>PayloadUUID</key><string>${crypto.randomUUID()}</string>
  <key>PayloadVersion</key><integer>1</integer>
  <key>PayloadRemovalDisallowed</key><false/>
</dict></plist>`;
  res.writeHead(200, {
    'Content-Type': 'application/x-apple-aspen-config',
    'Content-Disposition': 'attachment; filename="sayit.mobileconfig"',
  });
  res.end(mc);
}

// 读取请求 body
function readBody(req) {
  return new Promise((rs, rj) => {
    let d = ''; req.on('data', c => d += c); req.on('end', () => rs(d)); req.on('error', rj);
  });
}

// 构造 HTTP(S) 请求处理函数
function makeApp() {
  return async (req, res) => {
    const { pathname, searchParams } = new URL(req.url, 'http://x');
    const method = req.method.toUpperCase();

    // CORS
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': '*',
    };
    if (method === 'OPTIONS') { res.writeHead(204, corsHeaders); return res.end(); }

    // /ip
    if (pathname === '/ip') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(getBestIp());
    }

    // /settings：浏览器直接访问返回 HTML 页面，fetch 请求返回 JSON
    if (pathname === '/settings') {
      const accept = req.headers.accept || '';
      // 浏览器直接访问（Accept 含 text/html）→ 返回设置页面
      if (accept.includes('text/html')) {
        req.url = '/settings.html';
        return serveStatic(req, res);
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...corsHeaders });
      if (method === 'GET') return res.end(JSON.stringify({ ok: true, settings }));
      if (method === 'POST') {
        try {
          const j = JSON.parse(await readBody(req) || '{}');
          settings = { ...settings, ...j };
          saveSettings();
          // 广播设置变更给 desk
          deskClients.forEach(d => { try { d.send(JSON.stringify({ type: 'settings', settings })); } catch {} });
          return res.end(JSON.stringify({ ok: true, settings }));
        } catch (e) { return res.end(JSON.stringify({ ok: false, error: e.message })); }
      }
      res.writeHead(405); return res.end(JSON.stringify({ ok: false }));
    }

    // /apps：获取运行中应用（应用白名单过滤）
    if (pathname === '/apps') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...corsHeaders });
      const all = await getRunningApps();
      // 如果设置了白名单且非空，只返回白名单内的应用（且当前正在运行的）
      let apps;
      if (settings.appWhitelist && settings.appWhitelist.length) {
        apps = settings.appWhitelist.filter(a => all.includes(a));
        // 白名单里没运行的也显示出来（带标记），方便用户知道有哪些可选
        const notRunning = settings.appWhitelist.filter(a => !all.includes(a));
        return res.end(JSON.stringify({ ok: true, apps, notRunning, all }));
      }
      return res.end(JSON.stringify({ ok: true, apps: all, notRunning: [], all }));
    }

    // /app/activate：激活指定应用
    if (pathname === '/app/activate') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...corsHeaders });
      const name = searchParams.get('name');
      if (!name) { res.writeHead(400); return res.end(JSON.stringify({ ok: false, error: 'missing name' })); }
      const ok = await activateApp(name);
      if (ok) { settings.lastTargetApp = name; saveSettings(); }
      return res.end(JSON.stringify({ ok, name }));
    }

    // /history
    if (pathname === '/history') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...corsHeaders });
      if (method === 'GET') return res.end(JSON.stringify({ ok: true, history: historyCache }));
      if (method === 'POST') {
        try {
          const j = JSON.parse(await readBody(req) || '{}');
          if (j.clear) { historyCache = []; saveHistory(); return res.end(JSON.stringify({ ok: true, cleared: true })); }
          res.writeHead(400); return res.end(JSON.stringify({ ok: false }));
        } catch (e) { return res.end(JSON.stringify({ ok: false, error: e.message })); }
      }
      res.writeHead(405); return res.end(JSON.stringify({ ok: false }));
    }

    // /paste：手动触发粘贴+回车
    if (pathname === '/paste') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...corsHeaders });
      if (method === 'POST') {
        const ok = await doPasteAtCursor();
        let enterOk = false;
        if (ok && settings.enterAfterPaste) {
          await new Promise(r => setTimeout(r, 120));
          enterOk = await doEnter();
        }
        return res.end(JSON.stringify({ ok, enterOk, enterAfterPaste: settings.enterAfterPaste }));
      }
      res.writeHead(405); return res.end(JSON.stringify({ ok: false }));
    }

    // /cert
    if (pathname === '/cert') return serveCert(req, res);

    // 静态文件
    serveStatic(req, res);
  };
}

// === 3. WebSocket 路由 ===
const deskClients = new Set();

function attachWSS(srv) {
  const wssText = new WebSocketServer({ noServer: true });
  const wssDesk = new WebSocketServer({ noServer: true });

  srv.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url, 'http://x');
    if (pathname === '/text') wssText.handleUpgrade(req, socket, head, ws => wssText.emit('connection', ws, req));
    else if (pathname === '/desk') wssDesk.handleUpgrade(req, socket, head, ws => wssDesk.emit('connection', ws, req));
    else socket.destroy();
  });

  // 手机端：接收文字 → 广播给 desk
  wssText.on('connection', (ws, req) => {
    const ip = req.socket.remoteAddress;
    console.log(`\n[ws/text] 手机端连接：${ip}`);
    ws.on('message', async (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'text' && typeof msg.text === 'string') {
          const txt = msg.text.trim();
          if (!txt) return;
          // 用户明确传了 targetApp（哪怕是空字符串=仅发到接收窗口），就用用户传的；只有不传字段时才用 lastTargetApp 兜底
          const targetApp = msg.hasOwnProperty('targetApp') ? (msg.targetApp || '') : (settings.lastTargetApp || '');
          console.log(`[text] 收到(${txt.length}字)：${txt.length > 60 ? txt.slice(0, 60) + '…' : txt}${targetApp ? ' → ' + targetApp : ''}`);
          // 给手机回执
          try { ws.send(JSON.stringify({ type: 'text_ok', ts: msg.ts })); } catch {}
          // ① 写入系统剪贴板
          await copyToClipboard(txt);
          // ② 持久化到历史
          addToHistory(txt, msg.ts, ip, targetApp);
          // ③ 广播给所有 desk
          const payload = JSON.stringify({ type: 'text', text: txt, ts: msg.ts || Date.now(), from: ip, targetApp });
          deskClients.forEach(d => { try { d.send(payload); } catch {} });
          // ④ 如果指定了目标应用，先激活该应用
          if (targetApp) {
            await activateApp(targetApp);
            await new Promise(r => setTimeout(r, 200));
          }
          // ⑤ 自动粘贴 + 回车
          if (settings.autoPaste) {
            const pasteOk = await doPasteAtCursor();
            if (pasteOk && settings.enterAfterPaste) {
              await new Promise(r => setTimeout(r, 150));
              const enterOk = await doEnter();
              deskClients.forEach(d => { try { d.send(JSON.stringify({ type: 'paste_done', ok: pasteOk, enterOk, ts: Date.now() })); } catch {} });
            } else {
              deskClients.forEach(d => { try { d.send(JSON.stringify({ type: 'paste_done', ok: pasteOk, ts: Date.now() })); } catch {} });
            }
          }
        } else if (msg.type === 'ping') {
          try { ws.send(JSON.stringify({ type: 'pong' })); } catch {}
        }
      } catch {}
    });
    ws.on('close', () => console.log(`[ws/text] 手机断开：${ip}`));
    ws.on('error', () => {});
    try { ws.send(JSON.stringify({ type: 'hello', mode: 'text', settings })); } catch {}
  });

  // desk 端：订阅文字
  wssDesk.on('connection', (ws, req) => {
    deskClients.add(ws);
    console.log(`[ws/desk] 电脑端窗口已连接：${req.socket.remoteAddress}，共 ${deskClients.size} 个`);
    ws.on('close', () => { deskClients.delete(ws); console.log(`[ws/desk] 断开，剩余 ${deskClients.size} 个`); });
    ws.on('error', () => {});
    try { ws.send(JSON.stringify({ type: 'hello', deskCount: deskClients.size, settings })); } catch {}
  });
}

// === 4. 工具函数 ===
function getLanIps() {
  const ips = [];
  for (const [, list] of Object.entries(os.networkInterfaces())) {
    for (const it of (list || [])) {
      if (it.family === 'IPv4' && !it.internal && it.address.startsWith('192.')) ips.push(it.address);
    }
  }
  return ips;
}
function getBestIp() {
  const ips = getLanIps();
  if (ips.length) return ips[0];
  for (const [, list] of Object.entries(os.networkInterfaces())) {
    for (const it of (list || [])) {
      if (it.family === 'IPv4' && !it.internal) return it.address;
    }
  }
  return '127.0.0.1';
}

// 打印启动信息
function printStart() {
  const ip = getBestIp();
  const httpUrl = `http://${ip}:${HTTP_PORT}`;
  const httpsUrl = `https://${ip}:${HTTPS_PORT}`;
  const deskLocal = `http://localhost:${HTTP_PORT}/desk`;
  const settingsLocal = `http://localhost:${HTTP_PORT}/settings`;
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║                       ✦  SayIn  已启动  ✦                       ║');
  console.log('║                  手机写字板 → 电脑 · 优雅输入                    ║');
  console.log('╠══════════════════════════════════════════════════════════════════╣');
  console.log(`║  💻 电脑接收窗口：${deskLocal.padEnd(40)}║`);
  console.log(`║  ⚙️  设置页面：    ${settingsLocal.padEnd(40)}║`);
  console.log(`║  📱 手机入口：     ${httpUrl.padEnd(40)}║`);
  console.log(`║  🔒 手机(HTTPS)：  ${httpsUrl.padEnd(40)}║`);
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  console.log('');
}

// === 5. 启动 ===
const httpsServer = https.createServer(credentials, makeApp());
const httpServer = http.createServer(makeApp());

attachWSS(httpsServer);
attachWSS(httpServer);

httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {});
httpServer.listen(HTTP_PORT, '0.0.0.0', () => {
  printStart();
});
