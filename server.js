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

function readJson(file, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function readResources() { return readJson(RESOURCE_PATH, {}); }
function readCatalog() { return readJson(MODEL_CATALOG_PATH, { schemaVersion: 1, recursos: {} }); }
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
function writeModelConfig(value) { fs.writeFileSync(MODEL_CONFIG_PATH, JSON.stringify(value, null, 2), 'utf8'); }
function variantsFor(id) { return readCatalog().recursos?.[id]?.variants || []; }
function defaultVariantFor(id) { return preferredDefaultVariant(id); }
function variantFor(id) {
  const selected = readModelConfig()[id]?.variant || defaultVariantFor(id);
  return variantsFor(id).find(v => v.id === selected) || variantsFor(id)[0] || null;
}
function selectedFor(id) { return readModelConfig()[id] || { variant: defaultVariantFor(id) }; }
function selectedValue(id, key, fallback = '') {
  const sel = selectedFor(id);
  const variant = variantFor(id) || {};
  return sel[key] || variant[key] || fallback;
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

for (const d of ['outputs', 'uploads', 'temp', 'runtime', 'models/shared', 'models/image/diffusion', 'models/image/vae', 'models/video']) {
  fs.mkdirSync(path.join(ROOT, d), { recursive: true });
}

const app = express();
app.use(express.json({ limit: '4mb' }));
app.use(express.static(path.join(ROOT, 'public')));
app.use('/outputs', express.static(path.join(ROOT, 'outputs')));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(ROOT, 'uploads')),
  filename: (req, file, cb) => cb(null, `upload_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${path.extname(file.originalname || '').toLowerCase() || '.png'}`)
});
const upload = multer({
  storage,
  limits: { fileSize: 60 * 1024 * 1024, files: 8 },
  fileFilter: (req, file, cb) => cb(null, /^image\//i.test(file.mimetype || ''))
});

let generation = { running: false, kind: null, startedAt: null, log: [], process: null };
let installer = { running: false, resource: null, action: null, progress: 0, message: '', log: [], process: null, error: null };
let chatProc = null;
let chatLog = [];

function local(p) { return path.isAbsolute(p) ? p : path.join(ROOT, p); }
function pushLog(target, chunk, max = 500) {
  const lines = String(chunk).replace(/\r/g, '').split('\n').filter(Boolean);
  target.push(...lines);
  if (target.length > max) target.splice(0, target.length - max);
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
function findRec(dir, name, depth = 0) {
  if (depth > 8 || !fs.existsSync(dir)) return null;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isFile() && ent.name.toLowerCase() === name.toLowerCase()) return full;
  }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const found = findRec(path.join(dir, ent.name), name, depth + 1);
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
function findRuntime(name) { return findRec(path.join(ROOT, 'runtime'), name) || findCmd(name); }
function cleanup(files = []) { for (const f of files) { try { if (f?.path && fs.existsSync(f.path)) fs.unlinkSync(f.path); } catch {} } }
function normalizeDim(v, fallback, max = 1536) {
  let n = Number(v); if (!Number.isFinite(n)) n = fallback;
  n = Math.max(256, Math.min(max, Math.round(n)));
  return Math.max(256, Math.round(n / 32) * 32);
}
function outputUrl(name) { return `/outputs/${encodeURIComponent(name)}`; }
function randSeed() { return String(Math.floor(Math.random() * 2147483646) + 1); }

function videoModelFolderReady(relFolder) {
  const abs = local(relFolder);
  try {
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) return false;
    // Um pipeline Diffusers válido na raiz é prova direta de que o modelo está presente.
    // Isso cobre exatamente o layout oficial do LTX-Video.
    if (fs.existsSync(path.join(abs, 'model_index.json'))) return true;
    if (fs.existsSync(path.join(abs, '.gerador-video-installed.json'))) return true;
    // Compatibilidade com instalações anteriores/customizadas: reconhece uma pasta
    // que já contenha arquivos reais, mesmo se o model_index estiver em subpasta.
    let meaningful = 0;
    const stack = [abs];
    while (stack.length && meaningful < 3) {
      const dir = stack.pop();
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) { if (!ent.name.startsWith('.')) stack.push(full); continue; }
        const n = ent.name.toLowerCase();
        if (n === 'model_index.json' || n.endsWith('.safetensors') || n.endsWith('.bin') || n.endsWith('.json')) meaningful++;
        if (meaningful >= 3) break;
      }
    }
    return meaningful >= 3;
  } catch { return false; }
}

function findVideoPipelineDir(relFolder) {
  const abs = local(relFolder);
  try {
    if (!fs.existsSync(abs)) return abs;
    const direct = path.join(abs, 'model_index.json');
    if (fs.existsSync(direct)) return abs;
    const stack = [abs];
    while (stack.length) {
      const dir = stack.pop();
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!ent.isDirectory() || ent.name.startsWith('.')) continue;
        const child = path.join(dir, ent.name);
        if (fs.existsSync(path.join(child, 'model_index.json'))) return child;
        stack.push(child);
      }
    }
  } catch {}
  return abs;
}

function resourceStatus(id) {
  const resources = readResources();
  const r = resources[id];
  if (!r) return null;
  const p = modelPaths();
  const missing = [];
  let files = [];
  if (id === 'chat') files = [p.chat];
  if (id === 'image') files = [p.diffusion, p.encoder, p.mmproj, p.vae];
  for (const f of files) if (!existsFile(f)) missing.push(f);

  let components = null;
  if (id === 'videoAI') {
    const pythonReady = existsFile('runtime/video-python/Scripts/python.exe');
    const modelReady = videoModelFolderReady(p.videoFolder);
    const pipelineDir = findVideoPipelineDir(p.videoFolder);
    const modelIndexReady = !!pipelineDir && fs.existsSync(path.join(pipelineDir, 'model_index.json'));
    const ffmpegReady = !!findRuntime('ffmpeg.exe');
    components = { pythonReady, modelReady, modelIndexReady, ffmpegReady, pipelineDir: path.relative(ROOT, pipelineDir || local(p.videoFolder)).split(path.sep).join('/') };
    if (!pythonReady) missing.push('runtime/video-python/Scripts/python.exe');
    if (!modelReady) missing.push(`${p.videoFolder} (modelo de vídeo incompleto)`);
    // FFmpeg externo é complementar: o runner já instala imageio-ffmpeg no ambiente Python.
  }

  for (const cmd of r.requiredCommands || []) if (!findRuntime(cmd)) missing.push(cmd);
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
function allResources() {
  const resources = readResources();
  return Object.fromEntries(Object.keys(resources).map(id => [id, resourceStatus(id)]));
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
  if (/no space left|disk full|espaço.*insuficiente|not enough space/i.test(lower)) {
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
    const p = spawn(exe, args, { cwd, windowsHide: true, env });
    generation.process = p;
    const outLines = makeLineCollector(target);
    const errLines = makeLineCollector(target);
    p.stdout?.on('data', d => outLines.write(d));
    p.stderr?.on('data', d => errLines.write(d));
    p.once('error', reject);
    p.once('close', code => {
      outLines.flush(); errLines.flush();
      generation.process = null;
      code === 0 ? resolve() : reject(new Error(`Processo terminou com código ${code}.`));
    });
  });
}

function getSd() { return findRuntime('sd-cli.exe'); }
function getFfmpeg() { return findRuntime('ffmpeg.exe'); }
function getLlama() { return findRuntime('llama-server.exe'); }
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
    chatProc.once('close', () => { chatProc = null; });
  }
  const limit = Date.now() + 180000;
  while (Date.now() < limit) {
    await new Promise(r => setTimeout(r, 1200));
    try { const r = await fetch(`http://127.0.0.1:${cfg.chatPort}/health`); if (r.ok) return; } catch {}
  }
  throw new Error('O modelo de chat não ficou pronto a tempo. Confira Recursos IA > Chat.');
}

app.get('/api/ping', (req, res) => res.json({ ok: true, app: 'GeradorImagensIALocal', version: '2.5.1' }));
app.post('/api/shutdown', (req, res) => { res.json({ ok: true }); setTimeout(() => { try { chatProc?.kill('SIGTERM'); } catch {} process.exit(0); }, 250); });
app.get('/modelos.json', (req, res) => res.sendFile(MODEL_CATALOG_PATH));
app.get('/api/model-catalog', (req, res) => res.json({ ok: true, catalog: readCatalog(), config: readModelConfig() }));
app.get('/api/model-config', (req, res) => res.json({ ok: true, config: readModelConfig(), resources: readResources(), catalog: readCatalog() }));
app.post('/api/model-config/:id', (req, res) => {
  const id = req.params.id;
  if (!readResources()[id]) return res.status(404).json({ ok: false, error: 'Recurso desconhecido.' });
  const mc = readModelConfig();
  mc[id] = { ...(mc[id] || {}), ...(req.body || {}) };
  writeModelConfig(mc);
  if (id === 'chat' && chatProc) { try { chatProc.kill('SIGTERM'); } catch {} chatProc = null; chatLog = []; }
  res.json({ ok: true, config: mc[id] });
});
app.post('/api/open-modelos', (req, res) => {
  try {
    if (process.platform === 'win32') spawn('notepad.exe', [MODEL_CATALOG_PATH], { detached: true, windowsHide: false }).unref();
    return res.json({ ok: true, path: MODEL_CATALOG_PATH });
  } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
});
app.get('/api/resources', (req, res) => res.json({
  ok: true,
  resources: allResources(),
  catalog: readCatalog(),
  installer: { ...installer, process: undefined },
  runtime: {
    chat: { running: !!chatProc, model: path.basename(modelPaths().chat || ''), mode: 'persistent' },
    image: { running: false, model: path.basename(modelPaths().diffusion || ''), encoder: path.basename(modelPaths().encoder || ''), mode: 'ondemand' },
    videoAI: { running: false, model: path.basename(modelPaths().videoFolder || ''), mode: 'ondemand', ready: videoModelFolderReady(modelPaths().videoFolder) }
  },
  chat: { running: !!chatProc, log: chatLog.slice(-80) }
}));
app.get('/api/install-progress', (req, res) => res.json({ ...installer, process: undefined, log: installer.log.slice(-120) }));

app.post('/api/resources/chat/load', async (req, res) => {
  try {
    await ensureChatServer();
    return res.json({ ok: true, running: !!chatProc, model: path.basename(modelPaths().chat || '') });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});
app.post('/api/resources/chat/unload', (req, res) => {
  try {
    if (chatProc) { try { chatProc.kill('SIGTERM'); } catch {} }
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
  if (!resources[id]) return res.status(404).json({ ok: false, error: 'Recurso desconhecido.' });
  if (!['install', 'repair', 'remove'].includes(action)) return res.status(400).json({ ok: false, error: 'Ação inválida.' });
  if (installer.running) return res.status(409).json({ ok: false, error: `Já existe uma instalação em andamento: ${installer.resource}.` });

  if (req.body && Object.keys(req.body).length) {
    const mc = readModelConfig();
    mc[id] = { ...(mc[id] || {}), ...req.body };
    writeModelConfig(mc);
  }
  if (id === 'chat' && chatProc) { try { chatProc.kill('SIGTERM'); } catch {} chatProc = null; chatLog = []; }

  installer = { running: true, resource: id, action, progress: 1, message: 'Iniciando…', log: [], process: null, error: null };
  const sel = selectedFor(id);
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
    QSL_IMAGE_ENCODER_FILENAME: selectedValue('image', 'encoderFilename', '')
  };
  const ps = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'scripts', 'resources.ps1'), '-Resource', resources[id].installScript || id, '-Action', action], { cwd: ROOT, windowsHide: true, env });
  installer.process = ps;
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
  ps.once('close', code => {
    installerOut.flush(); installerErr.flush();
    installer.running = false;
    installer.process = null;
    if (code === 0) {
      installer.progress = 100;
      installer.message = action === 'remove' ? 'Recurso removido.' : 'Concluído.';
    } else {
      installer.error = classifyInstallerError(installer.log, code);
      installer.message = installer.error;
    }
  });
  ps.once('error', e => { installer.running = false; installer.process = null; installer.error = e.message; installer.message = e.message; });
  res.json({ ok: true });
});
app.post('/api/resources/cancel', (req, res) => {
  if (!installer.process) return res.json({ ok: true });
  try { installer.process.kill('SIGTERM'); installer.message = 'Cancelamento solicitado…'; return res.json({ ok: true }); }
  catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/chat', async (req, res) => {
  try {
    const prompt = String(req.body.prompt || '').trim();
    if (!prompt) return res.status(400).json({ ok: false, error: 'Digite uma mensagem.' });
    await ensureChatServer();
    const messages = Array.isArray(req.body.messages) ? req.body.messages.slice(-20) : [];
    const last = messages.at(-1);
    if (!(last?.role === 'user' && String(last?.content || '').trim() === prompt)) messages.push({ role: 'user', content: prompt });
    const r = await fetch(`http://127.0.0.1:${cfg.chatPort}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'local', messages, temperature: Number(req.body.temperature ?? 0.7), max_tokens: Number(req.body.max_tokens ?? 1024), stream: false })
    });
    const text = await r.text();
    if (!r.ok) throw new Error(text.slice(0, 500));
    const data = JSON.parse(text);
    res.json({ ok: true, content: data.choices?.[0]?.message?.content ?? '' });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.delete('/api/output/:filename', (req, res) => {
  const name = path.basename(String(req.params.filename || ''));
  if (!name) return res.status(400).json({ ok: false, error: 'Arquivo inválido.' });
  const full = path.join(ROOT, 'outputs', name);
  try { if (fs.existsSync(full)) fs.unlinkSync(full); return res.json({ ok: true }); }
  catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
});
app.get('/api/progress', (req, res) => res.json({ running: generation.running, kind: generation.kind, startedAt: generation.startedAt, log: generation.log.slice(-120) }));
app.post('/api/cancel', (req, res) => {
  if (!generation.process) return res.json({ ok: true });
  try { generation.process.kill('SIGTERM'); pushLog(generation.log, 'Cancelamento solicitado pelo usuário.'); return res.json({ ok: true }); }
  catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/generate', upload.array('images', 8), async (req, res) => {
  const files = req.files || [];
  if (generation.running) { cleanup(files); return res.status(409).json({ ok: false, error: 'Já existe uma geração em andamento.' }); }
  const mode = String(req.body.mode || 'image');
  const engine = String(req.body.videoEngine || 'light');
  const prompt = String(req.body.prompt || '').trim();
  const seed = String(req.body.seed || randSeed());
  const w = normalizeDim(req.body.width, cfg.defaults.image.width);
  const h = normalizeDim(req.body.height, cfg.defaults.image.height);
  const duration = Math.max(2, Math.min(20, Number(req.body.duration || cfg.defaults.video.duration)));
  const fps = Math.max(12, Math.min(60, Number(req.body.fps || cfg.defaults.video.fps)));

  if (['image', 'edit', 'merge'].includes(mode) && !resourceStatus('image')?.installed) { cleanup(files); return res.status(400).json({ ok: false, error: 'Ative o recurso Qwen Image primeiro.' }); }
  if (mode === 'edit' && files.length < 1) { cleanup(files); return res.status(400).json({ ok: false, error: 'Envie uma imagem para editar.' }); }
  if (mode === 'merge' && files.length < 2) { cleanup(files); return res.status(400).json({ ok: false, error: 'Envie ao menos duas imagens.' }); }
  if (mode === 'video' && engine === 'ai' && !resourceStatus('videoAI')?.installed) { cleanup(files); return res.status(400).json({ ok: false, error: 'Ative o recurso Vídeo IA primeiro.' }); }
  if (mode === 'video' && engine !== 'ai' && !resourceStatus('videoLight')?.installed) { cleanup(files); return res.status(400).json({ ok: false, error: 'Ative o recurso Vídeo leve primeiro.' }); }

  generation = { running: true, kind: mode, startedAt: new Date().toISOString(), log: [`Modo: ${mode}`, `Seed: ${seed}`], process: null };
  try {
    if (['image', 'edit', 'merge'].includes(mode)) {
      const name = `qwen_${mode}_${Date.now()}_${seed}.png`;
      const out = path.join(ROOT, 'outputs', name);
      pushLog(generation.log, 'Iniciando Qwen Image…');
      await spawnTracked(getSd(), buildImageArgs({ prompt, width: w, height: h, seed, refs: files.map(f => f.path), out }));
      if (!fs.existsSync(out)) throw new Error('O backend não criou a imagem.');
      return res.json({ ok: true, type: 'image', mode, url: outputUrl(name), filename: name, seed, width: w, height: h, prompt });
    }
    if (mode === 'video' && engine === 'ai') {
      const py = local('runtime/video-python/Scripts/python.exe');
      const runner = local('scripts/video_runner.py');
      const name = `ltx_${Date.now()}_${seed}.mp4`;
      const out = path.join(ROOT, 'outputs', name);
      const args = [runner, '--model', findVideoPipelineDir(modelPaths().videoFolder), '--prompt', prompt, '--output', out, '--width', String(w), '--height', String(h), '--duration', String(duration), '--fps', String(fps), '--seed', seed];
      if (files[0]) args.push('--image', files[0].path);
      pushLog(generation.log, files[0] ? 'Iniciando LTX image-to-video…' : 'Iniciando LTX text-to-video…');
      await spawnTracked(py, args, { cwd: ROOT });
      if (!fs.existsSync(out)) throw new Error('O motor de vídeo não criou o arquivo.');
      return res.json({ ok: true, type: 'video', mode, url: outputUrl(name), filename: name, seed, width: w, height: h, duration, fps, prompt, videoEngine: 'ai' });
    }
    if (mode === 'video') {
      const ff = getFfmpeg();
      let source = files[0]?.path || null;
      let temp = null;
      if (!source) {
        if (!resourceStatus('image')?.installed) throw new Error('Para vídeo sem imagem enviada, ative também Qwen Image.');
        temp = path.join(ROOT, 'temp', `video_source_${Date.now()}.png`);
        pushLog(generation.log, 'Gerando imagem-base…');
        await spawnTracked(getSd(), buildImageArgs({ prompt, width: w, height: h, seed, refs: [], out: temp }));
        source = temp;
      }
      const name = `video_${Date.now()}_${seed}.mp4`;
      const out = path.join(ROOT, 'outputs', name);
      pushLog(generation.log, 'Montando vídeo…');
      const vf = motionFilter(w, h, fps, duration, req.body.motion || 'cinematic');
      await spawnTracked(ff, ['-y', '-loop', '1', '-i', source, '-vf', vf, '-t', String(duration), '-an', '-c:v', 'libx264', '-preset', engine === 'light' ? 'veryfast' : 'fast', '-crf', engine === 'light' ? '24' : '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], { cwd: ROOT });
      if (temp && fs.existsSync(temp)) fs.unlinkSync(temp);
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
    cleanup(files);
  }
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
    console.log('Gerador de Imagens IA Local');
    console.log(`Acesse: http://127.0.0.1:${port}`);
    console.log('Feche esta janela para encerrar o servidor.');
  });
  server.on('error', e => { console.error(e.code === 'EADDRINUSE' ? 'A porta foi ocupada antes da inicialização. Abra novamente o ABRIR.bat.' : e.message); process.exit(1); });
}
start();
