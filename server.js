import express from 'express';
import fs from 'fs';
import path from 'path';
import net from 'net';
import multer from 'multer';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.dirname(__filename);
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const RESOURCE_PATH = path.join(ROOT, 'resources.json');
const MODEL_CATALOG_PATH = path.join(ROOT, 'modelos.json');
const MODEL_CONFIG_PATH = path.join(ROOT, 'model-config.json');
const HISTORY_PATH = path.join(ROOT, 'data', 'history.json');

const jsonCache = new Map();
function readJson(file, fallback = {}) {
  try {
    const stat = fs.statSync(file);
    const cached = jsonCache.get(file);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.value;
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    jsonCache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, value });
    return value;
  } catch { return fallback; }
}
function invalidateJson(file) { if (file) jsonCache.delete(file); else jsonCache.clear(); }
function readResources() { return readJson(RESOURCE_PATH, {}); }
function readCatalog() { return readJson(MODEL_CATALOG_PATH, { schemaVersion: 1, recursos: {} }); }
function catalogError() {
  try {
    const parsed = JSON.parse(fs.readFileSync(MODEL_CATALOG_PATH, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || !parsed.recursos || typeof parsed.recursos !== 'object') return 'modelos.json não possui a estrutura esperada (campo recursos).';
    return null;
  } catch (e) { return `modelos.json inválido: ${e.message}`; }
}
function preferredDefaultVariant(id) {
  const item = readCatalog().recursos?.[id] || {};
  const variants = item.variants || [];
  if (item.preferUncensored) {
    const preferred = variants.find(v => v.uncensored === true && !v.custom);
    if (preferred) return preferred.id;
  }
  return item.defaultVariant || variants[0]?.id || '';
}
function readModelConfig() {
  const cat = readCatalog().recursos || {};
  const fallback = {};
  for (const id of Object.keys(cat)) fallback[id] = { variant: preferredDefaultVariant(id) };
  return readJson(MODEL_CONFIG_PATH, fallback);
}
function writeModelConfig(value) { fs.writeFileSync(MODEL_CONFIG_PATH, JSON.stringify(value, null, 2), 'utf8'); invalidateJson(MODEL_CONFIG_PATH); clearResourceCaches(); }
function variantsFor(id) { return readCatalog().recursos?.[id]?.variants || []; }
function defaultVariantFor(id) { return preferredDefaultVariant(id); }
function variantFor(id) {
  const selected = readModelConfig()[id]?.variant || defaultVariantFor(id);
  return variantsFor(id).find(v => v.id === selected) || variantsFor(id).find(v => v.id === defaultVariantFor(id)) || variantsFor(id)[0] || null;
}
function selectedFor(id) { return readModelConfig()[id] || { variant: defaultVariantFor(id) }; }
function selectedValue(id, key, fallback = '') {
  const sel = selectedFor(id);
  const variant = variantFor(id) || {};
  return sel[key] || variant[key] || fallback;
}
function normalizeModelUrl(value) {
  try {
    const u = new URL(String(value || '').trim());
    if (u.username || u.password) return null;
    if (u.protocol === 'https:') return u.href;
    // HTTP sem TLS fica restrito ao próprio computador para permitir servidores locais.
    if (u.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(u.hostname.toLowerCase())) return u.href;
    return null;
  } catch { return null; }
}
function safeLeafName(value, extRe) {
  const name = String(value || '').trim();
  if (!name || name !== path.basename(name) || /[\\/]/.test(name) || name === '.' || name === '..') return false;
  return extRe ? extRe.test(name) : true;
}
function validateModelSelection(id, candidate = {}) {
  const variants = variantsFor(id);
  const variantId = String(candidate.variant || defaultVariantFor(id));
  const variant = variants.find(v => v.id === variantId);
  if (!variant) throw new Error(`Variante de modelo inválida para ${id}. Se o modelos.json foi editado, reabra Recursos IA e escolha uma variante existente.`);
  if (!variant.custom) return { variant: variant.id };

  const out = { variant: variant.id };
  const requireUrlFile = (urlKey, fileKey, extRe, label) => {
    const url = normalizeModelUrl(candidate[urlKey]);
    const file = String(candidate[fileKey] || '').trim();
    if (!url) throw new Error(`${label}: use uma URL HTTPS válida. HTTP é aceito somente em localhost/127.0.0.1.`);
    if (!safeLeafName(file, extRe)) throw new Error(`${label}: informe apenas o nome do arquivo local com a extensão correta, sem pastas.`);
    out[urlKey] = url; out[fileKey] = file;
  };
  if (id === 'chat') {
    requireUrlFile('url', 'filename', /\.gguf$/i, 'Modelo de Chat');
  } else if (id === 'image') {
    requireUrlFile('diffusionUrl', 'diffusionFilename', /\.gguf$/i, 'Denoiser');
    requireUrlFile('encoderUrl', 'encoderFilename', /\.gguf$/i, 'Encoder');
    requireUrlFile('mmprojUrl', 'mmprojFilename', /\.gguf$/i, 'Projetor visual');
    requireUrlFile('vaeUrl', 'vaeFilename', /\.safetensors$/i, 'VAE');
  } else if (id === 'videoAI') {
    const repo = String(candidate.repo || '').trim();
    const folder = String(candidate.folder || '').trim();
    if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(repo)) throw new Error('Vídeo IA: informe o repo_id no formato organizacao/modelo.');
    if (!safeLeafName(folder, null) || !/^[A-Za-z0-9._ -]+$/.test(folder)) throw new Error('Vídeo IA: informe um nome de pasta local simples, sem barras ou caminhos relativos.');
    out.repo = repo; out.folder = folder;
  }
  return out;
}
function effectiveSelection(id, incoming = null) {
  const current = selectedFor(id);
  return validateModelSelection(id, { ...current, ...(incoming || {}) });
}
function modelPaths() {
  return {
    chat: path.join('models/shared', selectedValue('chat', 'filename', 'chat.gguf')),
    diffusion: path.join('models/image/diffusion', selectedValue('image', 'diffusionFilename', 'diffusion.gguf')),
    encoder: path.join('models/shared', selectedValue('image', 'encoderFilename', selectedValue('chat', 'filename', 'encoder.gguf'))),
    mmproj: path.join('models/shared', selectedValue('image', 'mmprojFilename', 'mmproj.gguf')),
    vae: path.join('models/image/vae', selectedValue('image', 'vaeFilename', 'vae.safetensors')),
    videoFolder: path.join('models/video', selectedValue('videoAI', 'folder', 'LTX-Video')),
    videoMarker: path.join('models/video', selectedValue('videoAI', 'folder', 'LTX-Video'), '.gerador-video-installed.json')
  };
}

for (const d of ['outputs', 'uploads', 'temp', 'runtime', 'data', 'models/shared', 'models/image/diffusion', 'models/image/vae', 'models/video']) {
  fs.mkdirSync(path.join(ROOT, d), { recursive: true });
}
function cleanTransientDir(name) {
  const dir = path.join(ROOT, name);
  try {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name === '.keep') continue;
      const full = path.join(dir, ent.name);
      try { fs.rmSync(full, { recursive: true, force: true }); } catch {}
    }
  } catch {}
}
// Ao iniciar não existe job ativo: restos de uploads/temp vêm apenas de encerramentos anteriores.
cleanTransientDir('uploads');
cleanTransientDir('temp');

function parseHistoryBackup(file) {
  try { const v = JSON.parse(fs.readFileSync(file, 'utf8')); return Array.isArray(v?.messages) ? v : null; }
  catch { return null; }
}
function readHistoryBackup() {
  const temp = `${HISTORY_PATH}.tmp`;
  const primary = parseHistoryBackup(HISTORY_PATH), pending = parseHistoryBackup(temp);
  const score = value => [Number(value?.revision || 0), Number(value?.updatedAt || 0)];
  let best = primary || pending || { updatedAt: 0, revision: 0, messages: [] };
  if (primary && pending) { const a=score(primary),b=score(pending); if (b[0]>a[0] || (b[0]===a[0] && b[1]>a[1])) best=pending; }
  if (pending) {
    try {
      if (best === pending) { if (fs.existsSync(HISTORY_PATH)) fs.rmSync(HISTORY_PATH, { force: true }); fs.renameSync(temp, HISTORY_PATH); }
      else fs.rmSync(temp, { force: true });
    } catch {}
  }
  return best;
}
function writeHistoryBackup(messages = [], revision = Date.now()) {
  const clean = Array.isArray(messages) ? messages.slice(-800) : [];
  const payload = { schemaVersion: 2, updatedAt: Date.now(), revision: Number(revision) || Date.now(), messages: clean };
  const temp = `${HISTORY_PATH}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(payload), 'utf8');
  fs.renameSync(temp, HISTORY_PATH);
  return payload;
}

const app = express();
app.disable('x-powered-by');

const LOCAL_MUTATION_HEADER = 'x-gerador-local';
const ALLOWED_LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);
const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
function parseLocalUrl(value) {
  try {
    const u = new URL(String(value || ''));
    return ALLOWED_LOCAL_HOSTS.has(u.hostname.toLowerCase()) ? u : null;
  } catch { return null; }
}
function requestHostAllowed(req) {
  try {
    const u = new URL(`http://${String(req.headers.host || '')}`);
    if (!ALLOWED_LOCAL_HOSTS.has(u.hostname.toLowerCase())) return false;
    const requestedPort = Number(u.port || 80);
    const localPort = Number(req.socket?.localPort || 0);
    return !localPort || requestedPort === localPort;
  } catch { return false; }
}
function sensitiveLocalRequest(req) { return req.path.startsWith('/api') || req.path.startsWith('/outputs'); }
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");

  // Impede DNS rebinding: este servidor só deve responder quando o Host também é local.
  if (!requestHostAllowed(req)) return res.status(403).json({ ok: false, errorCode: 'LOCAL_HOST_REQUIRED', error: 'Acesso recusado: o servidor aceita apenas endereços locais.' });

  if (sensitiveLocalRequest(req)) {
    const fetchSite = String(req.get('sec-fetch-site') || '').toLowerCase();
    if (fetchSite === 'cross-site') return res.status(403).json({ ok: false, errorCode: 'CROSS_SITE_BLOCKED', error: 'Requisição externa bloqueada pelo servidor local.' });
    const origin = req.get('origin');
    if (origin) {
      const u = parseLocalUrl(origin);
      const originPort = u ? Number(u.port || 80) : 0;
      if (!u || (req.socket?.localPort && originPort !== Number(req.socket.localPort))) {
        return res.status(403).json({ ok: false, errorCode: 'ORIGIN_BLOCKED', error: 'Origem externa bloqueada pelo servidor local.' });
      }
    }
  }

  if (req.path.startsWith('/api') && MUTATION_METHODS.has(req.method) && req.get(LOCAL_MUTATION_HEADER) !== '1') {
    return res.status(403).json({ ok: false, errorCode: 'LOCAL_ACTION_REQUIRED', error: 'Ação local recusada por segurança.' });
  }
  next();
});
app.use(express.json({ limit: '8mb' }));
app.use(express.static(path.join(ROOT, 'public'), { dotfiles: 'ignore', fallthrough: true }));

// Somente resultados finais podem ser servidos. Sidecars .meta.json e outros arquivos ficam privados.
app.get('/outputs/:filename', (req, res) => {
  const raw = String(req.params.filename || '');
  if (!safeLeafName(raw, /\.(?:png|mp4)$/i)) return res.status(404).send('Arquivo de saída não encontrado.');
  const full = path.join(ROOT, 'outputs', raw);
  if (!fs.existsSync(full)) return res.status(404).send('Arquivo de saída não encontrado.');
  const stat = fs.lstatSync(full);
  if (!stat.isFile() || stat.isSymbolicLink()) return res.status(404).send('Arquivo de saída não encontrado.');
  res.setHeader('Cache-Control', 'private, max-age=3600, immutable');
  return res.sendFile(full);
});

const IMAGE_UPLOAD_TYPES = new Map([
  ['image/png', '.png'], ['image/jpeg', '.jpg'], ['image/webp', '.webp'], ['image/gif', '.gif'], ['image/bmp', '.bmp']
]);
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(ROOT, 'uploads')),
  filename: (req, file, cb) => cb(null, `upload_${Date.now()}_${Math.random().toString(36).slice(2, 10)}${IMAGE_UPLOAD_TYPES.get(String(file.mimetype || '').toLowerCase()) || '.img'}`)
});
const upload = multer({
  storage,
  limits: { fileSize: 60 * 1024 * 1024, files: 8 },
  fileFilter: (req, file, cb) => {
    if (IMAGE_UPLOAD_TYPES.has(String(file.mimetype || '').toLowerCase())) return cb(null, true);
    const err = new Error('Formato de imagem não aceito. Use PNG, JPEG, WebP, GIF ou BMP.');
    err.code = 'INVALID_IMAGE_TYPE';
    return cb(err);
  }
});
function validUploadedImage(file) {
  try {
    if (!file?.path || !IMAGE_UPLOAD_TYPES.has(String(file.mimetype || '').toLowerCase())) return false;
    const fd = fs.openSync(file.path, 'r');
    const b = Buffer.alloc(16); const n = fs.readSync(fd, b, 0, b.length, 0); fs.closeSync(fd);
    if (n < 2) return false;
    const mime = String(file.mimetype || '').toLowerCase();
    if (mime === 'image/png') return n >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
    if (mime === 'image/jpeg') return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    if (mime === 'image/webp') return n >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP';
    if (mime === 'image/gif') return n >= 6 && ['GIF87a','GIF89a'].includes(b.toString('ascii', 0, 6));
    if (mime === 'image/bmp') return b[0] === 0x42 && b[1] === 0x4d;
    return false;
  } catch { return false; }
}

let generation = { id: null, running: false, kind: null, startedAt: null, log: [], process: null, cancelRequested: false, outputFilename: null };
let chatBusy = 0;
let installer = { running: false, resource: null, action: null, progress: 0, message: '', log: [], process: null, error: null, cancelRequested: false };
let chatProc = null;
let chatLog = [];

function local(p) {
  const full = path.resolve(ROOT, String(p || ''));
  const rootPrefix = ROOT.endsWith(path.sep) ? ROOT : `${ROOT}${path.sep}`;
  if (full !== ROOT && !full.startsWith(rootPrefix)) {
    const e = new Error('Caminho fora da pasta do projeto foi bloqueado por segurança.');
    e.code = 'UNSAFE_PATH';
    throw e;
  }
  return full;
}
function pushLog(target, chunk, max = 500) {
  const lines = String(chunk).replace(/\r/g, '').split('\n').filter(Boolean);
  target.push(...lines);
  if (target.length > max) target.splice(0, target.length - max);
}
function terminateProcessTree(child) {
  if (!child || !child.pid) return;
  try {
    if (process.platform === 'win32') {
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, detached: true, stdio: 'ignore' });
      killer.once('error', () => { try { child.kill('SIGTERM'); } catch {} });
      killer.unref();
    } else child.kill('SIGTERM');
  } catch { try { child.kill('SIGTERM'); } catch {} }
}
function requestGenerationCancel(reason = 'Cancelamento solicitado pelo usuário.') {
  if (!generation.running) return false;
  generation.cancelRequested = true;
  if (!generation.log.some(line => String(line).includes(reason))) pushLog(generation.log, reason);
  terminateProcessTree(generation.process);
  return true;
}
function assertGenerationActive() {
  if (generation.cancelRequested) {
    const e = new Error('Cancelamento solicitado pelo usuário.');
    e.code = 'CANCELLED';
    throw e;
  }
}
function aiBusy() { return generation.running || chatBusy > 0; }
let shuttingDown = false;
function stopChildProcesses() {
  if (generation.running) {
    generation.cancelRequested = true;
    terminateProcessTree(generation.process);
  }
  terminateProcessTree(installer.process);
  terminateProcessTree(chatProc);
}
function gracefulShutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  stopChildProcesses();
  setTimeout(() => process.exit(code), 320);
}
function makeLineCollector(target, onLine = null, max = 500) {
  let buffer = '';
  const emit = line => {
    const clean = String(line || '').trimEnd();
    if (!clean) return;
    target.push(clean);
    if (target.length > max) target.splice(0, target.length - max);
    if (onLine) onLine(clean);
  };
  return {
    write(chunk) {
      buffer += String(chunk);
      const parts = buffer.split(/\r\n|\n|\r/);
      buffer = parts.pop() || '';
      for (const line of parts) emit(line);
    },
    flush() { if (buffer) emit(buffer); buffer = ''; }
  };
}
function existsFile(p) { try { return fs.existsSync(local(p)) && fs.statSync(local(p)).size > 1024; } catch { return false; } }
function readPrefix(file, length) {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(length);
    const read = fs.readSync(fd, buf, 0, length, 0);
    fs.closeSync(fd);
    return read === length ? buf : null;
  } catch { return null; }
}
function expectedSizeOk(abs, expectedGB, kind = 'model') {
  try {
    const size = fs.statSync(abs).size;
    if (!expectedGB || Number(expectedGB) <= 0) return size > 1024;
    const ratio = size / (Number(expectedGB) * 1e9);
    return kind === 'safetensors' ? ratio >= 0.94 && ratio <= 1.12 : ratio >= 0.985 && ratio <= 1.02;
  } catch { return false; }
}
function validGguf(rel, expectedGB = 0) {
  const abs = local(rel);
  if (!expectedSizeOk(abs, expectedGB, 'gguf')) return false;
  return readPrefix(abs, 4)?.toString('ascii') === 'GGUF';
}
function validSafetensors(rel, expectedGB = 0) {
  const abs = local(rel);
  if (!expectedSizeOk(abs, expectedGB, 'safetensors')) return false;
  try {
    const fd = fs.openSync(abs, 'r');
    const head = Buffer.alloc(9);
    const got = fs.readSync(fd, head, 0, 9, 0);
    const size = fs.fstatSync(fd).size;
    fs.closeSync(fd);
    if (got !== 9) return false;
    const headerLen = Number(head.readBigUInt64LE(0));
    return headerLen >= 2 && headerLen <= 100 * 1024 * 1024 && headerLen + 8 < size && head[8] === 123;
  } catch { return false; }
}
function completionMarkerMatches(rel, expectedUrl) {
  try {
    const marker = `${local(rel)}.complete`;
    if (!fs.existsSync(marker)) return false;
    const raw = fs.readFileSync(marker, 'utf8').trim();
    if (!raw || raw === 'ok') return false;
    const meta = JSON.parse(raw);
    return String(meta.url || '') === String(expectedUrl || '');
  } catch { return false; }
}
function validPeExecutable(abs) {
  try {
    if (!abs || !fs.existsSync(abs) || fs.statSync(abs).size < 65536) return false;
    const p = readPrefix(abs, 2);
    return !!p && p[0] === 0x4d && p[1] === 0x5a;
  } catch { return false; }
}
function findRec(dir, name, depth = 0, skipDirs = null) {
  if (depth > 8 || !fs.existsSync(dir)) return null;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isFile() && ent.name.toLowerCase() === name.toLowerCase()) return full;
  }
  for (const ent of entries) {
    if (!ent.isDirectory() || skipDirs?.has(ent.name.toLowerCase())) continue;
    const found = findRec(path.join(dir, ent.name), name, depth + 1, skipDirs);
    if (found) return found;
  }
  return null;
}
function findCmd(name) {
  for (const base of (process.env.PATH || '').split(path.delimiter)) {
    if (!base) continue;
    const file = path.join(base, name);
    if (fs.existsSync(file)) return file;
  }
  return null;
}
const runtimeHints = {
  'llama-server.exe': [path.join(ROOT, 'runtime', 'llama')],
  'sd-cli.exe': [path.join(ROOT, 'runtime', 'sd')],
  'ffmpeg.exe': [path.join(ROOT, 'runtime', 'ffmpeg')]
};
const runtimeCache = new Map();
function findRuntime(name) {
  const key = String(name || '').toLowerCase(), now = Date.now(), cached = runtimeCache.get(key);
  if (cached) {
    const ttl = cached.path ? 5000 : 60000;
    if (now - cached.at < ttl) {
      if (!cached.path) return null;
      if (validPeExecutable(cached.path)) return cached.path;
    }
  }
  let found = null;
  for (const dir of runtimeHints[key] || []) {
    const candidate = findRec(dir, name);
    if (candidate && validPeExecutable(candidate)) { found = candidate; break; }
  }
  if (!found) {
    const candidate = findCmd(name);
    if (candidate && validPeExecutable(candidate)) found = candidate;
  }
  if (!found) {
    // Compatibilidade com estruturas antigas sem atravessar ambientes Python gigantes.
    const skip = new Set(['video-python', 'site-packages', 'node_modules', '__pycache__', '.git']);
    const candidate = findRec(path.join(ROOT, 'runtime'), name, 0, skip);
    if (candidate && validPeExecutable(candidate)) found = candidate;
  }
  runtimeCache.set(key, { path: found, at: now });
  return found;
}
let videoScanCache = { key: '', at: 0, ready: false, pipelineDir: null };
function clearResourceCaches(){ runtimeCache.clear(); videoScanCache = { key: '', at: 0, ready: false, pipelineDir: null }; }
function cleanup(files = []) { for (const f of files) { try { if (f?.path && fs.existsSync(f.path)) fs.unlinkSync(f.path); } catch {} } }
function validateGeneratedOutput(file, type) {
  try {
    const stat = fs.statSync(file);
    if (stat.size < (type === 'video' ? 4096 : 1024)) return false;
    const prefix = readPrefix(file, Math.min(type === 'video' ? 32 : 8, stat.size));
    if (!prefix) return false;
    if (type === 'image') return prefix.length >= 8 && prefix.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
    if (type === 'video') return prefix.toString('ascii').includes('ftyp');
    return true;
  } catch { return false; }
}
function normalizeDim(v, fallback, max = 1536) {
  let n = Number(v); if (!Number.isFinite(n)) n = fallback;
  n = Math.max(256, Math.min(max, Math.round(n)));
  return Math.max(256, Math.round(n / 32) * 32);
}
function normalizeNumber(v, fallback, min, max, round = false) {
  let n = Number(v);
  if (!Number.isFinite(n)) n = Number(fallback);
  n = Math.max(min, Math.min(max, n));
  return round ? Math.round(n) : n;
}
function outputUrl(name) { return `/outputs/${encodeURIComponent(name)}`; }
function outputMetaPath(name) { return path.join(ROOT, 'outputs', `${path.basename(String(name||''))}.meta.json`); }
function writeOutputMetadata(name, meta = {}) { try { fs.writeFileSync(outputMetaPath(name), JSON.stringify({ schemaVersion: 1, filename: name, createdAt: Date.now(), ...meta }, null, 2), 'utf8'); } catch (e) { console.warn('Metadados do resultado não puderam ser salvos:', e.message); } }
function readOutputMetadata(name) { try { const v=JSON.parse(fs.readFileSync(outputMetaPath(name),'utf8')); return v&&typeof v==='object'?v:{}; } catch { return {}; } }
function randSeed() { return String(Math.floor(Math.random() * 2147483646) + 1); }
function normalizeSeed(v) {
  const raw = String(v ?? '').trim();
  return /^-?\d{1,20}$/.test(raw) ? raw : randSeed();
}

function scanVideoFolder(relFolder) {
  const abs = local(relFolder), now = Date.now(), key = abs.toLowerCase();
  if (videoScanCache.key === key && now - videoScanCache.at < 10000) return videoScanCache;
  let ready = false, pipelineDir = abs, modelIndex = null, weightCount = 0, weightBytes = 0;
  try {
    if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
      const stack = [abs];
      while (stack.length) {
        const dir = stack.pop();
        for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, ent.name);
          if (ent.isDirectory()) {
            if (!ent.name.startsWith('.') && ent.name.toLowerCase() !== '__pycache__') stack.push(full);
            continue;
          }
          const n = ent.name.toLowerCase();
          if (!modelIndex && n === 'model_index.json') modelIndex = full;
          if (n.endsWith('.safetensors') || n.endsWith('.bin')) {
            try { const size = fs.statSync(full).size; if (size > 1024 * 1024) { weightCount++; weightBytes += size; } } catch {}
          }
        }
      }
      if (modelIndex) pipelineDir = path.dirname(modelIndex);
      ready = !!modelIndex && weightCount > 0 && weightBytes > 10 * 1024 * 1024;
    }
  } catch { ready = false; pipelineDir = abs; modelIndex = null; weightCount = 0; weightBytes = 0; }
  videoScanCache = { key, at: now, ready, pipelineDir, modelIndex, weightCount, weightBytes };
  return videoScanCache;
}
function videoModelFolderReady(relFolder) { return scanVideoFolder(relFolder).ready; }
function findVideoPipelineDir(relFolder) { return scanVideoFolder(relFolder).pipelineDir || local(relFolder); }

function resourceStatus(id, resources = readResources(), compact = false) {
  const r = resources[id];
  if (!r) return null;
  const p = modelPaths();
  const missing = [];
  const sel = selectedFor(id);
  const variant = variantFor(id) || {};
  const pickNumber = key => Number(sel[key] || variant[key] || 0);
  if (id === 'chat') {
    const fileOk = validGguf(p.chat, pickNumber('sizeGB'));
    const markerOk = !variant.custom || completionMarkerMatches(p.chat, sel.url);
    if (!fileOk || !markerOk) missing.push(`${p.chat} (GGUF ausente, incompleto, inválido ou diferente da URL selecionada)`);
  }
  if (id === 'image') {
    const custom = !!variant.custom;
    const diffOk = validGguf(p.diffusion, pickNumber('diffusionSizeGB')) && (!custom || completionMarkerMatches(p.diffusion, sel.diffusionUrl));
    const encOk = validGguf(p.encoder, pickNumber('encoderSizeGB')) && (!custom || completionMarkerMatches(p.encoder, sel.encoderUrl));
    const mmOk = validGguf(p.mmproj, pickNumber('mmprojSizeGB')) && (!custom || completionMarkerMatches(p.mmproj, sel.mmprojUrl));
    const vaeOk = validSafetensors(p.vae, pickNumber('vaeSizeGB')) && (!custom || completionMarkerMatches(p.vae, sel.vaeUrl));
    if (!diffOk) missing.push(`${p.diffusion} (denoiser GGUF ausente, incompleto ou inválido)`);
    if (!encOk) missing.push(`${p.encoder} (encoder GGUF ausente, incompleto ou inválido)`);
    if (!mmOk) missing.push(`${p.mmproj} (projetor GGUF ausente, incompleto ou inválido)`);
    if (!vaeOk) missing.push(`${p.vae} (VAE safetensors ausente, incompleto ou inválido)`);
  }

  let components = null;
  if (id === 'videoAI') {
    const pythonExeReady = existsFile('runtime/video-python/Scripts/python.exe');
    const pythonEnvMarker = local('runtime/video-python/.gerador-video-env.json');
    const pythonReady = pythonExeReady && fs.existsSync(pythonEnvMarker);
    const videoScan = scanVideoFolder(p.videoFolder);
    const expectedRepo = String(sel.repo || variant.repo || '');
    let modelMarkerReady = false;
    try {
      const marker = JSON.parse(fs.readFileSync(local(p.videoMarker), 'utf8'));
      modelMarkerReady = !!expectedRepo && String(marker.repo || '') === expectedRepo;
    } catch {}
    const modelReady = videoScan.ready && modelMarkerReady;
    const pipelineDir = videoScan.pipelineDir;
    const modelIndexReady = !!videoScan.modelIndex;
    const ffmpegReady = !!findRuntime('ffmpeg.exe');
    components = { pythonReady, pythonExeReady, modelReady, modelMarkerReady, modelIndexReady, weightCount: videoScan.weightCount, ffmpegReady, pipelineDir: path.relative(ROOT, pipelineDir || local(p.videoFolder)).split(path.sep).join('/') };
    if (!pythonReady) missing.push('ambiente Python de vídeo não validado');
    if (!modelReady) missing.push(`${p.videoFolder} (modelo de vídeo incompleto ou diferente do repositório selecionado)`);
    // FFmpeg externo é complementar: o runner já instala imageio-ffmpeg no ambiente Python.
  }

  for (const cmd of r.requiredCommands || []) if (!findRuntime(cmd)) missing.push(cmd);
  if (compact) return { id, label: r.label, installed: missing.length === 0 };
  const catalogItem = readCatalog().recursos?.[id] || {};
  return {
    ...r,
    id,
    installed: missing.length === 0,
    missing,
    components,
    selected: selectedFor(id),
    defaultVariant: catalogItem.defaultVariant || '',
    variants: catalogItem.variants || []
  };
}
function allResources(compact = false) {
  const resources = readResources();
  return Object.fromEntries(Object.keys(resources).map(id => [id, resourceStatus(id, resources, compact)]));
}

function classifyGenerationError(rawMessage = '', log = [], context = {}) {
  const text = [...(Array.isArray(log) ? log : []), String(rawMessage || '')].join('\n');
  const lower = text.toLowerCase();
  const result = {
    errorCode: 'GENERATION_FAILED',
    errorTitle: 'Falha na geração',
    error: 'O motor de geração terminou antes de criar o resultado.',
    suggestions: ['Abra o log técnico para ver os detalhes do backend.'],
    technical: String(rawMessage || 'Erro desconhecido.')
  };

  const alloc = text.match(/Device memory allocation of size\s+(\d+)/i);
  const budgets = [...text.matchAll(/need\s+([\d.]+)\s+MB device[^\n]*?available\s+([\d.]+)\s+MB device/gi)];
  const budget = budgets.at(-1) || null;
  const gpuMemoryPattern = /erroroutofdevicememory|outofdevicememory|failed to allocate vulkan|alloc_tensor_range: failed to allocate vulkan|device memory allocation|cannot make enough memory available|failed during workspace capacity check|insufficient memory for prefix caching/i;
  if (gpuMemoryPattern.test(text)) {
    const mb = alloc ? Math.round(Number(alloc[1]) / 1024 / 1024) : null;
    const need = budget ? Math.round(Number(budget[1])) : null;
    const available = budget ? Math.round(Number(budget[2])) : null;
    const diff = selectedValue('image', 'diffusionFilename', 'modelo atual');
    const enc = selectedValue('image', 'encoderFilename', 'encoder atual');
    const detail = need && available ? ` O cálculo precisava de cerca de ${need} MB no dispositivo, mas havia aproximadamente ${available} MB disponíveis.` : '';
    return {
      errorCode: 'GPU_OUT_OF_MEMORY',
      errorTitle: 'Memória da GPU insuficiente',
      error: `O modelo carregou, mas o Vulkan não conseguiu reservar${mb ? ` mais cerca de ${mb} MB` : ' memória suficiente'} para concluir o cálculo.${detail}`,
      suggestions: [
        `Modelo atual: ${diff}.`,
        `Encoder atual: ${enc}.`,
        'O aplicativo pode tentar novamente automaticamente com resolução menor sem perder prompt ou imagens.',
        'Feche aplicativos que estejam usando a GPU se o erro continuar.',
        'Q4_K continua sendo a variante padrão recomendada para menor consumo de memória.'
      ],
      technical: String(rawMessage || 'Vulkan sem memória disponível.')
    };
  }
  if (/std::bad_alloc|cannot allocate memory|out of memory|not enough memory/i.test(lower)) {
    return {
      errorCode: 'SYSTEM_OUT_OF_MEMORY',
      errorTitle: 'Memória RAM insuficiente',
      error: 'O processo ficou sem memória RAM disponível durante a geração.',
      suggestions: ['Feche aplicativos pesados.', 'Tente uma quantização menor ou resolução menor.', 'Reiniciar o aplicativo pode liberar memória mantida por outros processos.'],
      technical: String(rawMessage || 'Memória RAM insuficiente.')
    };
  }
  if (/sem criar uma imagem png válida|sem criar um mp4 válido|corrupt|invalid.*(png|mp4)|moov atom not found/i.test(lower)) {
    return {
      errorCode: 'INVALID_OUTPUT',
      errorTitle: 'Resultado incompleto ou inválido',
      error: 'O motor terminou, mas o arquivo final não ficou válido. O arquivo parcial foi descartado automaticamente.',
      suggestions: ['Tente novamente.', 'Se o problema repetir, abra o log técnico e confira o backend ou use Reparar / aplicar em Recursos IA.'],
      technical: String(rawMessage || 'Arquivo de saída inválido.')
    };
  }
  if (/runtime_missing|backend de imagem .*não foi encontrado|ffmpeg .*não foi encontrado|backend de chat .*não foi encontrado|sd-cli\.exe.*(não foi encontrado|not found)|ffmpeg\.exe.*(não foi encontrado|not found)/i.test(lower)) {
    return {
      errorCode: 'RUNTIME_MISSING',
      errorTitle: 'Componente do motor não encontrado',
      error: 'Um executável necessário para esta operação não está disponível ou está inválido.',
      suggestions: ['Abra Recursos IA e use Reparar / aplicar no recurso correspondente.', 'Se o problema continuar, execute DIAGNOSTICO.bat e confira o componente indicado como ausente.'],
      technical: String(rawMessage || 'Componente do runtime ausente.')
    };
  }
  if (/enospc|no space left|disk full|not enough space|espaço.*insuficiente|espaco.*insuficiente/i.test(lower)) {
    return {
      errorCode: 'DISK_FULL',
      errorTitle: 'Espaço em disco insuficiente',
      error: 'Não há espaço livre suficiente para concluir e salvar o resultado.',
      suggestions: ['Libere espaço na unidade onde o projeto está instalado.', 'Apague saídas antigas da Galeria se não forem mais necessárias e tente novamente.'],
      technical: String(rawMessage || 'Disco sem espaço suficiente.')
    };
  }
  if (/no such file|cannot open.*file|failed to open.*file|arquivo.*não encontrado|not found/i.test(lower)) {
    return {
      errorCode: 'MODEL_FILE_MISSING',
      errorTitle: 'Arquivo do modelo não encontrado',
      error: 'Um arquivo necessário para este recurso não foi localizado.',
      suggestions: ['Abra Recursos IA e use Reparar / aplicar no recurso.', 'Confira os caminhos e URLs em modelos.json se você alterou o catálogo manualmente.'],
      technical: String(rawMessage || 'Arquivo ausente.')
    };
  }
  if (/failed to load.*model|invalid.*gguf|unsupported.*model|tensor.*mismatch|architecture.*unsupported/i.test(lower)) {
    return {
      errorCode: 'MODEL_INCOMPATIBLE',
      errorTitle: 'Modelo incompatível ou inválido',
      error: 'O backend não conseguiu carregar esse modelo com a configuração atual.',
      suggestions: ['Confirme se o arquivo escolhido é compatível com este motor.', 'Use uma das variantes conhecidas em Recursos IA ou corrija o modelos.json.', 'Se o download foi interrompido, use Reparar / aplicar.'],
      technical: String(rawMessage || 'Falha ao carregar modelo.')
    };
  }
  if (/vulkan|vk::|ggml_vulkan/i.test(text) && /fail|error/i.test(lower)) {
    const detail = (Array.isArray(log) ? log : []).map(x => String(x).trim()).reverse().find(x => /(ggml_vulkan|vk::|vulkan|\[e\]).*(fail|error)|failed.*(vulkan|backend|compute|buffer)/i.test(x));
    return {
      errorCode: 'VULKAN_ERROR',
      errorTitle: 'Falha no backend Vulkan',
      error: detail ? `O backend Vulkan falhou. Detalhe detectado: ${detail.slice(0, 220)}` : 'A geração falhou dentro do backend gráfico Vulkan.',
      suggestions: ['Confira se o modelo selecionado está instalado corretamente em Recursos IA.', 'Atualize o driver gráfico.', 'Feche outros aplicativos que usam a GPU.', 'Abra o log técnico para ver a linha exata que causou a falha.'],
      technical: String(rawMessage || 'Falha Vulkan.')
    };
  }
  if (/killed|cancelamento solicitado|cancelled|canceled/i.test(lower)) {
    return {
      errorCode: 'CANCELLED',
      errorTitle: 'Geração cancelada',
      error: 'A geração foi interrompida antes de terminar.',
      suggestions: [],
      technical: String(rawMessage || 'Cancelado.')
    };
  }
  if (context.mode === 'video' && /python|torch|diffusers|transformers/i.test(lower)) {
    return {
      errorCode: 'VIDEO_RUNTIME_ERROR',
      errorTitle: 'Falha no motor de vídeo IA',
      error: 'O ambiente Python ou uma biblioteca do motor de vídeo apresentou erro.',
      suggestions: ['Abra Recursos IA e use Reparar / aplicar em Vídeo IA.', 'Confira o log técnico para identificar a biblioteca ou modelo que falhou.'],
      technical: String(rawMessage || 'Falha no motor de vídeo.')
    };
  }
  return result;
}

function classifyInstallerError(log = [], code = 1) {
  const text = (Array.isArray(log) ? log : []).join('\n');
  const lower = text.toLowerCase();
  if (/could not resolve host|failed to connect|timed out|connection.*failed|http.*(403|404|500)/i.test(text)) {
    return 'Falha de conexão ou download. Verifique a internet e, se for um link de modelo, confira o modelos.json.';
  }
  if (/no space left|disk full|espaço.*insuficiente|espaco.*insuficiente|not enough space/i.test(lower)) {
    return 'Espaço em disco insuficiente para concluir a instalação.';
  }
  if (/nao encontrei.*windows|não encontrei.*windows|llama-server\.exe nao foi encontrado|sd-cli\.exe nao foi encontrado/i.test(lower)) {
    return 'Não foi possível localizar um backend Windows compatível. Abra o log para ver qual release foi encontrada.';
  }
  if (/python 3\.11|pip install|torch|diffusers|transformers/i.test(lower) && /falha|error|failed/i.test(lower)) {
    return 'Falha ao preparar o ambiente de Vídeo IA. Use Reparar / aplicar e confira o log para identificar a dependência Python que falhou.';
  }
  const meaningful = (Array.isArray(log) ? log : []).map(x => String(x).trim()).filter(Boolean).reverse().find(x => !/^\s*at\s/i.test(x) && !/^\s*\+/.test(x) && !/^\s*~/.test(x));
  return meaningful ? `Instalação falhou: ${meaningful.slice(0, 260)}` : `Instalação terminou com código ${code}. Abra o log para mais detalhes.`;
}

function spawnTracked(exe, args, { cwd = path.dirname(exe), target = generation.log, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    try { assertGenerationActive(); } catch (e) { reject(e); return; }
    const p = spawn(exe, args, { cwd, windowsHide: true, env });
    generation.process = p;
    const outLines = makeLineCollector(target);
    const errLines = makeLineCollector(target);
    let settled = false;
    const finish = (err = null) => {
      if (settled) return;
      settled = true;
      outLines.flush(); errLines.flush();
      if (generation.process === p) generation.process = null;
      if (generation.cancelRequested) return reject(Object.assign(new Error('Cancelamento solicitado pelo usuário.'), { code: 'CANCELLED' }));
      err ? reject(err) : resolve();
    };
    p.stdout?.on('data', d => outLines.write(d));
    p.stderr?.on('data', d => errLines.write(d));
    p.once('error', e => finish(e));
    p.once('close', code => finish(code === 0 ? null : new Error(`Processo terminou com código ${code}.`)));
  });
}

function requireRuntime(command, label) {
  const found = findRuntime(command);
  if (found) return found;
  const e = new Error(`${label} não foi encontrado ou está inválido. Abra Recursos IA e use Reparar / aplicar.`);
  e.code = 'RUNTIME_MISSING';
  throw e;
}
function getSd() { return requireRuntime('sd-cli.exe', 'O backend de imagem (sd-cli.exe)'); }
function getFfmpeg() { return requireRuntime('ffmpeg.exe', 'O FFmpeg'); }
function getLlama() { return requireRuntime('llama-server.exe', 'O backend de Chat (llama-server.exe)'); }
function buildImageArgs({ prompt, width, height, seed, refs = [], out }) {
  const p = modelPaths();
  const args = [
    '--diffusion-model', local(p.diffusion),
    '--vae', local(p.vae),
    '--llm', local(p.encoder),
    '-p', prompt,
    '--steps', String(cfg.defaults.image.steps),
    '--cfg-scale', String(cfg.defaults.image.cfg),
    '--sampling-method', cfg.defaults.image.sampler,
    '--sigmas', cfg.defaults.image.sigmas,
    '--seed', seed,
    '-W', String(width),
    '-H', String(height),
    '-o', out,
    '--offload-to-cpu',
    '--flash-attn', 'off,diffusion=on'
  ];
  if (refs.length) {
    args.push('--llm_vision', local(p.mmproj));
    for (const r of refs) args.push('-r', r);
  }
  return args;
}
function motionFilter(w, h, fps, duration, style = 'cinematic') {
  const frames = fps * duration;
  const common = `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`;
  if (style === 'pan') return `${common},zoompan=z='1.06':x='(iw-iw/zoom)*on/${Math.max(1, frames - 1)}':y='ih/2-(ih/zoom/2)+2*sin(on/11)':d=${frames}:s=${w}x${h}:fps=${fps},eq=saturation=1.06:contrast=1.03,format=yuv420p`;
  return `${common},zoompan=z='min(zoom+0.0018,1.09)':x='iw/2-(iw/zoom/2)+2*sin(on/10)':y='ih/2-(ih/zoom/2)+2*cos(on/13)':d=${frames}:s=${w}x${h}:fps=${fps},eq=saturation=1.07:contrast=1.04,format=yuv420p`;
}

async function ensureChatServer() {
  if (!resourceStatus('chat')?.installed) throw new Error('Chat local ainda não está instalado.');
  try { const r = await fetch(`http://127.0.0.1:${cfg.chatPort}/health`); if (r.ok) return; } catch {}
  if (!chatProc) {
    const exe = getLlama();
    if (!exe) throw new Error('llama-server.exe não encontrado. Repare o recurso Chat.');
    chatLog = [];
    chatProc = spawn(exe, ['-m', local(modelPaths().chat), '--host', '127.0.0.1', '--port', String(cfg.chatPort), '-c', '4096', '-ngl', '99'], { cwd: path.dirname(exe), windowsHide: true });
    chatProc.stdout?.on('data', d => pushLog(chatLog, d));
    chatProc.stderr?.on('data', d => pushLog(chatLog, d));
    chatProc.once('close', (code, signal) => {
      pushLog(chatLog, `llama-server encerrou${code != null ? ` com código ${code}` : ''}${signal ? ` (${signal})` : ''}.`);
      chatProc = null;
    });
    chatProc.once('error', e => { pushLog(chatLog, `Falha ao iniciar llama-server: ${e.message}`); });
  }
  const limit = Date.now() + 180000;
  while (Date.now() < limit) {
    await new Promise(r => setTimeout(r, 1200));
    try { const r = await fetch(`http://127.0.0.1:${cfg.chatPort}/health`); if (r.ok) return; } catch {}
    if (!chatProc) {
      const tail = chatLog.slice(-8).join(' | ');
      throw new Error(`O backend de Chat encerrou durante a inicialização.${tail ? ` Detalhes: ${tail.slice(0, 700)}` : ''}`);
    }
  }
  throw new Error('O modelo de chat não ficou pronto em até 3 minutos. Abra Recursos IA > Chat e confira o log do runtime.');
}

app.get('/api/ping', (req, res) => res.json({ ok: true, app: 'GeradorImagensIALocal', version: '2.7.9' }));
app.post('/api/shutdown', (req, res) => { res.json({ ok: true }); gracefulShutdown(0); });
app.get('/modelos.json', (req, res) => res.sendFile(MODEL_CATALOG_PATH));
app.get('/api/model-catalog', (req, res) => { const error = catalogError(); if (error) return res.status(400).json({ ok: false, error }); res.json({ ok: true, catalog: readCatalog(), config: readModelConfig() }); });
app.get('/api/model-config', (req, res) => res.json({ ok: true, config: readModelConfig(), resources: readResources(), catalog: readCatalog() }));
app.post('/api/model-config/:id', (req, res) => {
  const id = req.params.id;
  const catalogProblem = catalogError();
  if (catalogProblem) return res.status(400).json({ ok: false, error: catalogProblem });
  if (aiBusy() || installer.running) return res.status(409).json({ ok: false, error: 'Aguarde a operação atual terminar antes de trocar a configuração de modelo.' });
  if (!readResources()[id]) return res.status(404).json({ ok: false, error: 'Recurso desconhecido.' });
  try {
    const normalized = effectiveSelection(id, req.body || {});
    const mc = readModelConfig();
    mc[id] = normalized;
    writeModelConfig(mc);
    if (id === 'chat' && chatProc) { terminateProcessTree(chatProc); chatProc = null; chatLog = []; }
    res.json({ ok: true, config: normalized });
  } catch (e) { return res.status(400).json({ ok: false, error: e.message }); }
});
app.post('/api/open-modelos', (req, res) => {
  try {
    if (process.platform === 'win32') spawn('notepad.exe', [MODEL_CATALOG_PATH], { detached: true, windowsHide: false }).unref();
    return res.json({ ok: true });
  } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
});
app.get('/api/resources', (req, res) => {
  const compact = req.query.compact === '1';
  const visibleResources = allResources(compact);
  const p = modelPaths();
  res.json({
    ok: true,
    catalogError: catalogError(),
    resources: visibleResources,
    installer: { ...installer, process: undefined, log: compact ? [] : installer.log.slice(-120) },
    runtime: compact ? {} : {
      chat: { running: !!chatProc, model: path.basename(p.chat || ''), mode: 'persistent' },
      image: { running: false, model: path.basename(p.diffusion || ''), encoder: path.basename(p.encoder || ''), mode: 'ondemand' },
      videoAI: { running: false, model: path.basename(p.videoFolder || ''), mode: 'ondemand', ready: videoModelFolderReady(p.videoFolder) }
    },
    chat: compact ? undefined : { running: !!chatProc, log: chatLog.slice(-80) }
  });
});
app.get('/api/install-progress', (req, res) => res.json({ ...installer, process: undefined, log: installer.log.slice(-120) }));

app.post('/api/resources/chat/load', async (req, res) => {
  try {
    if (generation.running || installer.running || chatBusy > 0) return res.status(409).json({ ok: false, error: 'Aguarde a operação atual terminar antes de alterar o Chat.' });
    await ensureChatServer();
    return res.json({ ok: true, running: !!chatProc, model: path.basename(modelPaths().chat || '') });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});
app.post('/api/resources/chat/unload', (req, res) => {
  try {
    if (generation.running || installer.running || chatBusy > 0) return res.status(409).json({ ok: false, error: 'Aguarde a operação atual terminar antes de descarregar o Chat.' });
    if (chatProc) terminateProcessTree(chatProc)
    chatProc = null;
    chatLog = [];
    return res.json({ ok: true, running: false });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});
app.post('/api/resources/:id/:action', (req, res) => {
  const resources = readResources();
  const { id, action } = req.params;
  const catalogProblem = catalogError();
  if (catalogProblem) return res.status(400).json({ ok: false, error: catalogProblem });
  if (!resources[id]) return res.status(404).json({ ok: false, error: 'Recurso desconhecido.' });
  if (!['install', 'repair', 'remove'].includes(action)) return res.status(400).json({ ok: false, error: 'Ação inválida.' });
  if (aiBusy()) return res.status(409).json({ ok: false, error: 'Aguarde a geração ou resposta atual terminar antes de alterar Recursos IA.' });
  if (installer.running) return res.status(409).json({ ok: false, error: `Já existe uma instalação em andamento: ${installer.resource}.` });

  let normalizedSelection;
  try { normalizedSelection = effectiveSelection(id, req.body && Object.keys(req.body).length ? req.body : null); }
  catch (e) { return res.status(400).json({ ok: false, error: e.message }); }
  const mc = readModelConfig();
  mc[id] = normalizedSelection;
  writeModelConfig(mc);
  if (id === 'chat' && chatProc) { terminateProcessTree(chatProc); chatProc = null; chatLog = []; }

  installer = { running: true, resource: id, action, progress: 1, message: 'Iniciando…', log: [], process: null, error: null, cancelRequested: false };
  const sel = normalizedSelection;
  const variant = variantFor(id) || {};
  const pick = key => String(sel[key] || variant[key] || '');
  const env = {
    ...process.env,
    QSL_VARIANT: String(sel.variant || variant.id || ''),
    QSL_URL: pick('url'),
    QSL_FILENAME: pick('filename'),
    QSL_DIFFUSION_URL: pick('diffusionUrl'),
    QSL_DIFFUSION_FILENAME: pick('diffusionFilename'),
    QSL_ENCODER_URL: pick('encoderUrl'),
    QSL_ENCODER_FILENAME: pick('encoderFilename'),
    QSL_MMPROJ_URL: pick('mmprojUrl'),
    QSL_MMPROJ_FILENAME: pick('mmprojFilename'),
    QSL_VAE_URL: pick('vaeUrl'),
    QSL_VAE_FILENAME: pick('vaeFilename'),
    QSL_VIDEO_REPO: pick('repo'),
    QSL_VIDEO_FOLDER: pick('folder') || 'LTX-Video',
    QSL_SIZE_GB: pick('sizeGB'),
    QSL_DIFFUSION_SIZE_GB: pick('diffusionSizeGB'),
    QSL_ENCODER_SIZE_GB: pick('encoderSizeGB'),
    QSL_MMPROJ_SIZE_GB: pick('mmprojSizeGB'),
    QSL_VAE_SIZE_GB: pick('vaeSizeGB'),
    QSL_CHAT_FILENAME: selectedValue('chat', 'filename', ''),
    QSL_IMAGE_ENCODER_FILENAME: selectedValue('image', 'encoderFilename', ''),
    QSL_APP_VERSION: String(readJson(path.join(ROOT, 'package.json'), {}).version || '')
  };
  let ps;
  try {
    ps = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'scripts', 'resources.ps1'), '-Resource', resources[id].installScript || id, '-Action', action], { cwd: ROOT, windowsHide: true, env });
  } catch (e) {
    installer.running = false;
    installer.error = `Não foi possível iniciar o PowerShell do instalador: ${e.message}`;
    installer.message = installer.error;
    return res.status(500).json({ ok: false, error: installer.error });
  }
  installer.process = ps;
  let installerSettled = false;
  const handleInstallerLine = line => {
    const m = line.match(/^\[PROGRESS\s+(\d+)\]\s*(.*)$/);
    if (m) {
      installer.progress = Math.max(0, Math.min(100, Number(m[1])));
      installer.message = m[2] || installer.message;
    }
  };
  const installerOut = makeLineCollector(installer.log, handleInstallerLine);
  const installerErr = makeLineCollector(installer.log, handleInstallerLine);
  ps.stdout.on('data', d => installerOut.write(d));
  ps.stderr.on('data', d => installerErr.write(d));
  const settleInstaller = (code = null, startupError = null) => {
    if (installerSettled) return;
    installerSettled = true;
    installerOut.flush(); installerErr.flush();
    installer.running = false;
    installer.process = null;
    clearResourceCaches();
    if (installer.cancelRequested) {
      installer.error = null;
      installer.message = 'Instalação cancelada.';
    } else if (startupError) {
      installer.error = `Não foi possível iniciar o instalador: ${startupError.message}`;
      installer.message = installer.error;
    } else if (code === 0) {
      installer.progress = 100;
      installer.message = action === 'remove' ? 'Recurso removido.' : 'Concluído.';
    } else {
      installer.error = classifyInstallerError(installer.log, code);
      installer.message = installer.error;
    }
  };
  ps.once('close', code => settleInstaller(code));
  ps.once('error', e => settleInstaller(null, e));
  res.json({ ok: true });
});
app.post('/api/resources/cancel', (req, res) => {
  if (!installer.process) return res.json({ ok: true });
  try {
    installer.cancelRequested = true;
    installer.message = 'Cancelando instalação e processos auxiliares…';
    terminateProcessTree(installer.process);
    return res.json({ ok: true });
  } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/chat', async (req, res) => {
  if (generation.running || installer.running || chatBusy > 0) return res.status(409).json({ ok: false, error: installer.running ? 'Aguarde a instalação atual terminar.' : 'Já existe uma operação de IA em andamento.' });
  chatBusy++;
  try {
    const prompt = String(req.body.prompt || '').trim();
    if (!prompt) return res.status(400).json({ ok: false, error: 'Digite uma mensagem.' });
    if (prompt.length > 12000) return res.status(413).json({ ok: false, error: 'A mensagem é longa demais. Reduza para até 12.000 caracteres.' });
    await ensureChatServer();
    const messages = Array.isArray(req.body.messages)
      ? req.body.messages.slice(-20).map(m => ({
          role: ['system', 'user', 'assistant'].includes(String(m?.role || '')) ? String(m.role) : 'user',
          content: String(m?.content || '').slice(0, 12000)
        })).filter(m => m.content.trim())
      : [];
    const last = messages.at(-1);
    if (!(last?.role === 'user' && String(last?.content || '').trim() === prompt)) messages.push({ role: 'user', content: prompt });
    const r = await fetch(`http://127.0.0.1:${cfg.chatPort}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'local', messages, temperature: Math.max(0, Math.min(2, Number(req.body.temperature ?? 0.7) || 0.7)), max_tokens: 1024, stream: false })
    });
    const text = await r.text();
    if (!r.ok) throw new Error(text.slice(0, 500));
    let data;
    try { data = JSON.parse(text); }
    catch { const invalid = new Error('O backend de Chat devolveu uma resposta inválida.'); invalid.code = 'CHAT_INVALID_RESPONSE'; throw invalid; }
    res.json({ ok: true, content: data.choices?.[0]?.message?.content ?? '' });
  } catch (e) {
    const text = [...chatLog.slice(-40), String(e.message || e)].join('\n');
    const lower = text.toLowerCase();
    let error = 'O Chat local encontrou um erro e não conseguiu responder.';
    let errorCode = 'CHAT_FAILED';
    let suggestions = ['Tente novamente.', 'Se o problema continuar, abra Recursos IA > Chat e use Reparar / aplicar.'];
    if (/out of memory|bad_alloc|cannot allocate|erroroutofdevicememory/i.test(lower)) {
      errorCode = 'CHAT_OUT_OF_MEMORY'; error = 'O modelo de Chat ficou sem memória disponível.';
      suggestions = ['Feche aplicativos pesados.', 'Descarregue outros recursos e tente novamente.', 'Considere usar uma variante menor do Chat.'];
    } else if (/encerrou durante a inicialização|failed to load|invalid.*gguf|unsupported.*model/i.test(lower)) {
      errorCode = 'CHAT_MODEL_ERROR'; error = 'O backend de Chat não conseguiu carregar o modelo atual.';
      suggestions = ['Abra Recursos IA > Chat e use Reparar / aplicar.', 'Confira a variante selecionada e o log do Chat.'];
    } else if (e?.code === 'CHAT_INVALID_RESPONSE' || /resposta inválida/i.test(lower)) {
      errorCode = 'CHAT_INVALID_RESPONSE'; error = 'O backend de Chat respondeu em um formato inválido.';
      suggestions = ['Tente novamente; o backend será reiniciado.', 'Se repetir, use Reparar / aplicar em Recursos IA > Chat.'];
    } else if (/econnrefused|fetch failed|socket|connection/i.test(lower)) {
      errorCode = 'CHAT_CONNECTION_ERROR'; error = 'O servidor interno do Chat não respondeu corretamente.';
      suggestions = ['Tente novamente; o backend será reiniciado se necessário.', 'Se repetir, descarregue e carregue novamente o Chat em Recursos IA.'];
    }
    if (['CHAT_CONNECTION_ERROR','CHAT_INVALID_RESPONSE','CHAT_MODEL_ERROR'].includes(errorCode) && chatProc) { terminateProcessTree(chatProc); chatProc = null; }
    res.status(500).json({ ok: false, errorCode, error, suggestions, log: chatLog.slice(-80), technical: String(e.message || e) });
  }
  finally { chatBusy = Math.max(0, chatBusy - 1); }
});

app.get('/api/history', (req, res) => {
  const data = readHistoryBackup();
  res.json({ ok: true, updatedAt: Number(data.updatedAt || 0), revision: Number(data.revision || 0), messages: data.messages || [] });
});
function saveHistoryRequest(req, res) {
  try {
    const messages = Array.isArray(req.body?.messages) ? req.body.messages : null;
    if (!messages) return res.status(400).json({ ok: false, error: 'Histórico inválido.' });
    const revision = Number(req.body?.revision || 0) || Date.now();
    const current = readHistoryBackup();
    if (Number(current.revision || 0) > revision) return res.json({ ok: true, ignored: true, updatedAt: current.updatedAt, revision: current.revision, count: current.messages.length });
    const saved = writeHistoryBackup(messages, revision);
    res.json({ ok: true, updatedAt: saved.updatedAt, revision: saved.revision, count: saved.messages.length });
  } catch (e) { res.status(500).json({ ok: false, error: `Não foi possível salvar o histórico: ${e.message}` }); }
}
app.put('/api/history', saveHistoryRequest);
app.post('/api/history', saveHistoryRequest);
app.delete('/api/history', (req, res) => {
  try { const revision = Math.max(Date.now(), Number(req.body?.revision || 0) || 0); const saved = writeHistoryBackup([], revision); res.json({ ok: true, updatedAt: saved.updatedAt, revision: saved.revision }); }
  catch (e) { res.status(500).json({ ok: false, error: `Não foi possível limpar o histórico: ${e.message}` }); }
});

app.get('/api/outputs/index', (req, res) => {
  const dir = path.join(ROOT, 'outputs');
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      if (!ent.isFile() || !/\.(?:png|mp4)\.meta\.json$/i.test(ent.name)) continue;
      const mediaName = ent.name.replace(/\.meta\.json$/i, '');
      if (!fs.existsSync(path.join(dir, mediaName))) { try { fs.unlinkSync(path.join(dir, ent.name)); } catch {} }
    }
    const files = [];
    for (const ent of entries) {
      if (!ent.isFile() || !/\.(png|mp4)$/i.test(ent.name)) continue;
      if (generation.running && generation.outputFilename === ent.name) continue;
      const full = path.join(dir, ent.name), type = /\.mp4$/i.test(ent.name) ? 'video' : 'image';
      if (!validateGeneratedOutput(full, type)) {
        // Restos incompletos de uma geração interrompida não devem voltar para a Galeria.
        if (/^(?:qwen_|ltx_|video_)/i.test(ent.name)) {
          try { fs.unlinkSync(full); } catch {}
          try { const meta = outputMetaPath(ent.name); if (fs.existsSync(meta)) fs.unlinkSync(meta); } catch {}
        }
        continue;
      }
      const stat = fs.statSync(full), meta = readOutputMetadata(ent.name);
      files.push({ ...meta, filename: ent.name, type, size: stat.size, modifiedAt: stat.mtimeMs });
    }
    files.sort((a,b) => b.modifiedAt - a.modifiedAt);
    res.json({ ok: true, files });
  } catch (e) {
    res.status(500).json({ ok: false, error: `Não foi possível ler a pasta outputs: ${e.message}` });
  }
});

app.delete('/api/output/:filename', (req, res) => {
  const name = String(req.params.filename || '');
  if (!safeLeafName(name, /\.(?:png|mp4)$/i)) return res.status(400).json({ ok: false, error: 'Arquivo de saída inválido.' });
  const full = path.join(ROOT, 'outputs', name);
  try { if (fs.existsSync(full)) fs.unlinkSync(full); const meta=outputMetaPath(name); if(fs.existsSync(meta))fs.unlinkSync(meta); return res.json({ ok: true }); }
  catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
});
app.get('/api/progress', (req, res) => res.json({ id: generation.id, running: generation.running, kind: generation.kind, startedAt: generation.startedAt, cancelRequested: !!generation.cancelRequested, log: generation.log.slice(-120) }));
app.post('/api/cancel', (req, res) => {
  const requestedId = String(req.body?.id || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
  if (!generation.running) return res.json({ ok: true, active: false });
  if (!requestedId || requestedId !== generation.id) return res.status(409).json({ ok: false, error: 'Esta geração já mudou ou terminou; o cancelamento antigo foi ignorado.', activeId: generation.id });
  try { requestGenerationCancel(); return res.json({ ok: true, active: true, id: generation.id }); }
  catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/generate', upload.array('images', 8), async (req, res) => {
  const files = req.files || [];
  if (files.some(file => !validUploadedImage(file))) { cleanup(files); return res.status(415).json({ ok: false, errorCode: 'INVALID_IMAGE_SIGNATURE', error: 'Uma das imagens não corresponde ao formato declarado ou está corrompida.' }); }
  if (generation.running || chatBusy > 0) { cleanup(files); return res.status(409).json({ ok: false, error: 'Já existe uma operação de IA em andamento.' }); }
  if (installer.running) { cleanup(files); return res.status(409).json({ ok: false, error: 'Aguarde a instalação atual terminar antes de gerar.' }); }
  const mode = String(req.body.mode || 'image');
  if (!['image', 'edit', 'merge', 'video'].includes(mode)) { cleanup(files); return res.status(400).json({ ok: false, error: 'Modo de geração inválido.' }); }
  const engine = String(req.body.videoEngine || 'light');
  if (mode === 'video' && !['light', 'standard', 'ai'].includes(engine)) { cleanup(files); return res.status(400).json({ ok: false, error: 'Motor de vídeo inválido.' }); }
  const prompt = String(req.body.prompt || '').trim();
  if (!prompt && !(mode === 'video' && files.length > 0)) { cleanup(files); return res.status(400).json({ ok: false, error: 'Digite um prompt para continuar.' }); }
  if (prompt.length > 12000) { cleanup(files); return res.status(413).json({ ok: false, error: 'O prompt é longo demais. Reduza para até 12.000 caracteres.' }); }
  const seed = normalizeSeed(req.body.seed);
  const w = normalizeDim(req.body.width, cfg.defaults.image.width);
  const h = normalizeDim(req.body.height, cfg.defaults.image.height);
  const duration = normalizeNumber(req.body.duration, cfg.defaults.video.duration, 2, 20, true);
  const fps = normalizeNumber(req.body.fps, cfg.defaults.video.fps, 12, 60, true);
  const clientJobId = String(req.body.clientJobId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) || `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  if (['image', 'edit', 'merge'].includes(mode) && !resourceStatus('image')?.installed) { cleanup(files); return res.status(400).json({ ok: false, error: 'Ative o recurso Qwen Image primeiro.' }); }
  if (mode === 'edit' && files.length < 1) { cleanup(files); return res.status(400).json({ ok: false, error: 'Envie uma imagem para editar.' }); }
  if (mode === 'merge' && files.length < 2) { cleanup(files); return res.status(400).json({ ok: false, error: 'Envie ao menos duas imagens.' }); }
  if (mode === 'video' && engine === 'ai' && !resourceStatus('videoAI')?.installed) { cleanup(files); return res.status(400).json({ ok: false, error: 'Ative o recurso Vídeo IA primeiro.' }); }
  if (mode === 'video' && engine !== 'ai' && !resourceStatus('videoLight')?.installed) { cleanup(files); return res.status(400).json({ ok: false, error: 'Ative o recurso Vídeo leve primeiro.' }); }

  generation = { id: clientJobId, running: true, kind: mode, startedAt: new Date().toISOString(), log: [`Modo: ${mode}`, `Seed: ${seed}`], process: null, cancelRequested: false, outputFilename: null };
  let outputPath = null;
  let keepOutput = false;
  const tempPaths = [];
  try {
    if (['image', 'edit', 'merge'].includes(mode)) {
      const name = `qwen_${mode}_${Date.now()}_${seed}.png`;
      const out = path.join(ROOT, 'outputs', name);
      outputPath = out; generation.outputFilename = name;
      pushLog(generation.log, 'Iniciando Qwen Image…');
      await spawnTracked(getSd(), buildImageArgs({ prompt, width: w, height: h, seed, refs: files.map(f => f.path), out }));
      assertGenerationActive();
      if (!validateGeneratedOutput(out, 'image')) throw new Error('O backend terminou sem criar uma imagem PNG válida.');
      writeOutputMetadata(name,{type:'image',mode,prompt,seed,width:w,height:h});
      keepOutput = true;
      return res.json({ ok: true, type: 'image', mode, url: outputUrl(name), filename: name, seed, width: w, height: h, prompt });
    }
    if (mode === 'video' && engine === 'ai') {
      const py = local('runtime/video-python/Scripts/python.exe');
      const runner = local('scripts/video_runner.py');
      const name = `ltx_${Date.now()}_${seed}.mp4`;
      const out = path.join(ROOT, 'outputs', name);
      outputPath = out; generation.outputFilename = name;
      const args = [runner, '--model', findVideoPipelineDir(modelPaths().videoFolder), '--prompt', prompt, '--output', out, '--width', String(w), '--height', String(h), '--duration', String(duration), '--fps', String(fps), '--seed', seed];
      if (files[0]) args.push('--image', files[0].path);
      pushLog(generation.log, files[0] ? 'Iniciando LTX image-to-video…' : 'Iniciando LTX text-to-video…');
      await spawnTracked(py, args, { cwd: ROOT });
      assertGenerationActive();
      if (!validateGeneratedOutput(out, 'video')) throw new Error('O motor de vídeo terminou sem criar um MP4 válido.');
      writeOutputMetadata(name,{type:'video',mode,prompt,seed,width:w,height:h,duration,fps,videoEngine:'ai'});
      keepOutput = true;
      return res.json({ ok: true, type: 'video', mode, url: outputUrl(name), filename: name, seed, width: w, height: h, duration, fps, prompt, videoEngine: 'ai' });
    }
    if (mode === 'video') {
      const ff = getFfmpeg();
      let source = files[0]?.path || null;
      if (!source) {
        if (!resourceStatus('image')?.installed) throw new Error('Para vídeo sem imagem enviada, ative também Qwen Image.');
        const temp = path.join(ROOT, 'temp', `video_source_${Date.now()}.png`);
        tempPaths.push(temp);
        pushLog(generation.log, 'Gerando imagem-base…');
        await spawnTracked(getSd(), buildImageArgs({ prompt, width: w, height: h, seed, refs: [], out: temp }));
        assertGenerationActive();
        source = temp;
      }
      const name = `video_${Date.now()}_${seed}.mp4`;
      const out = path.join(ROOT, 'outputs', name);
      outputPath = out; generation.outputFilename = name;
      pushLog(generation.log, 'Montando vídeo…');
      const vf = motionFilter(w, h, fps, duration, req.body.motion || 'cinematic');
      await spawnTracked(ff, ['-y', '-loop', '1', '-i', source, '-vf', vf, '-t', String(duration), '-an', '-c:v', 'libx264', '-preset', engine === 'light' ? 'veryfast' : 'fast', '-crf', engine === 'light' ? '24' : '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], { cwd: ROOT });
      assertGenerationActive();
      if (!validateGeneratedOutput(out, 'video')) throw new Error('O motor de vídeo terminou sem criar um MP4 válido.');
      writeOutputMetadata(name,{type:'video',mode,prompt,seed,width:w,height:h,duration,fps,videoEngine:engine,motion:req.body.motion||'cinematic'});
      keepOutput = true;
      return res.json({ ok: true, type: 'video', mode, url: outputUrl(name), filename: name, seed, width: w, height: h, duration, fps, prompt, videoEngine: engine });
    }
    throw new Error('Modo inválido.');
  } catch (e) {
    pushLog(generation.log, e.stack || e.message);
    const friendly = classifyGenerationError(e.message, generation.log, { mode, engine });
    return res.status(500).json({ ok: false, ...friendly, log: generation.log.slice(-120) });
  } finally {
    generation.running = false;
    generation.kind = null;
    generation.startedAt = null;
    generation.process = null;
    generation.outputFilename = null;
    cleanup(files);
    for (const temp of tempPaths) { try { if (fs.existsSync(temp)) fs.unlinkSync(temp); } catch {} }
    if (!keepOutput && outputPath) { try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch {} }
  }
});

app.use('/api', (req, res) => res.status(404).json({ ok: false, errorCode: 'API_NOT_FOUND', error: 'Endpoint local não encontrado.' }));
app.use('/outputs', (req, res) => res.status(404).send('Arquivo de saída não encontrado.'));

app.use((err, req, res, next) => {
  if (!err) return next();
  cleanup(req.files || []);
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ ok: false, errorCode: 'UPLOAD_TOO_LARGE', error: 'Uma das imagens ultrapassa o limite de 60 MB.', suggestions: ['Reduza o tamanho do arquivo e tente novamente.'] });
    if (err.code === 'LIMIT_FILE_COUNT') return res.status(413).json({ ok: false, errorCode: 'TOO_MANY_FILES', error: 'Foram enviadas imagens demais. O limite por operação é 8 arquivos.' });
    return res.status(400).json({ ok: false, errorCode: 'UPLOAD_ERROR', error: `Falha no upload: ${err.message}` });
  }
  if (err?.code === 'INVALID_IMAGE_TYPE') return res.status(415).json({ ok: false, errorCode: 'INVALID_IMAGE_TYPE', error: err.message });
  if (err instanceof SyntaxError && 'body' in err) return res.status(400).json({ ok: false, errorCode: 'INVALID_JSON', error: 'A requisição contém JSON inválido.' });
  console.error('Erro HTTP não tratado:', err);
  return res.status(500).json({ ok: false, errorCode: 'SERVER_ERROR', error: 'O servidor encontrou um erro inesperado. Tente novamente e consulte o diagnóstico se o problema continuar.' });
});

app.get(/.*/, (req, res) => res.sendFile(path.join(ROOT, 'public', 'index.html')));

async function portFree(p) {
  return await new Promise(resolve => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(p, '127.0.0.1');
  });
}
async function start() {
  let port = Number(process.env.QWEN_PORT || cfg.port);
  while (port <= cfg.portMax && !(await portFree(port))) port++;
  if (port > cfg.portMax) { console.error(`Gerador de Imagens IA Local: nenhuma porta livre entre ${cfg.port} e ${cfg.portMax}.`); process.exit(1); }
  const server = app.listen(port, '127.0.0.1', () => {
    // Reaplica o tamanho solicitado pelo ABRIR.bat quando o Node assume o terminal.
    // CSI 8 funciona em Windows Terminal; o window.ps1 cobre Console Host classico.
    if (process.stdout.isTTY) {
      const cols = Math.max(40, Number(process.env.GERADOR_WINDOW_COLS || 64));
      const rows = Math.max(8, Number(process.env.GERADOR_WINDOW_ROWS || 12));
      process.stdout.write(`\x1b[8;${rows};${cols}t`);
    }
    const green = '\x1b[92m';
    const cyan = '\x1b[96m';
    const dark = '\x1b[90m';
    const reset = '\x1b[0m';
    if (process.stdout.isTTY) console.clear();
    console.log('');
    console.log(`  ${cyan}Gerador de Imagens IA Local${reset}`);
    console.log(`  Tutorial: ${green}https://youtu.be/YQbrUucNrRE${reset}`);
    console.log(`  ${dark}----------------------------------------------------------${reset}`);
    console.log('   Servidor local ativo.');
    console.log(`   Aplicativo: ${green}http://127.0.0.1:${port}${reset}`);
    console.log('');
    console.log('   Fechar esta janela encerra o servidor.');
    if (process.env.GERADOR_OPEN_BROWSER === '1') {
      const url = `http://127.0.0.1:${port}`;
      const detach = (child) => {
        if (child && typeof child.unref === 'function') child.unref();
      };
      try {
        // No Windows, o Explorer encaminha a URL ao navegador padrao sem abrir
        // uma segunda janela de console. E mais confiavel que depender apenas
        // de Start-Process/ExecutionPolicy do PowerShell.
        const opener = spawn('explorer.exe', [url], {
          windowsHide: true,
          detached: true,
          stdio: 'ignore'
        });
        let fallbackStarted = false;
        const fallback = () => {
          if (fallbackStarted) return;
          fallbackStarted = true;
          try {
            const ps = spawn('powershell.exe', [
              '-NoProfile', '-WindowStyle', 'Hidden', '-Command',
              `Start-Process '${url}'`
            ], { windowsHide: true, detached: true, stdio: 'ignore' });
            detach(ps);
          } catch {}
        };
        opener.once('error', fallback);
        detach(opener);
      } catch {
        try {
          const ps = spawn('powershell.exe', [
            '-NoProfile', '-WindowStyle', 'Hidden', '-Command',
            `Start-Process '${url}'`
          ], { windowsHide: true, detached: true, stdio: 'ignore' });
          detach(ps);
        } catch {}
      }
    }
  });
  server.on('error', e => { console.error(e.code === 'EADDRINUSE' ? 'A porta foi ocupada antes da inicialização. Abra novamente o ABRIR.bat.' : e.message); process.exit(1); });
}
process.once('SIGINT', () => gracefulShutdown(0));
process.once('SIGTERM', () => gracefulShutdown(0));
start();
