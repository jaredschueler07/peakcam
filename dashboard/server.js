const express = require('express');
const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const os = require('os');

// ── Load .env.local ───────────────────────────────────────────────────────────
function loadEnvFile(filePath) {
  const env = {};
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx < 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
      env[key] = val;
    }
  } catch (_) {}
  return env;
}

const localEnv = loadEnvFile(path.join(__dirname, '../.env.local'));
const COO_TOKEN = localEnv.SLACK_BOT_TOKEN_COO || '';

// ── Claude sessions ───────────────────────────────────────────────────────────
const sessions = new Map();       // pid → { pid, prompt, cwd, startTime, output[], exitCode, lastOutputTime }
const children = new Map();       // pid → child process (for stdin interaction)
const sessionSSEClients = new Map(); // pid → Set of SSE response objects

const app = express();
const PORT = process.env.PORT || 3333;

const LOG_PATH = path.join(__dirname, '../agents/loop.log');
const AGENTS_JSON = path.join(__dirname, '../agents/agents.json');
const SPRINT_JSON = path.join(__dirname, 'sprint.json');

// Agent color palette (visible on dark bg)
const AGENT_COLORS = {
  engineering:  '#a78bfa',
  product:      '#f472b6',
  marketing:    '#fbbf24',
  operations:   '#60C8FF',
  finance:      '#60a5fa',
  data:         '#c084fc',
  productivity: '#34d399',
  sales:        '#4ade80',
  coo:          '#fb923c',
};

let agentsConfig = {};
try {
  agentsConfig = JSON.parse(fs.readFileSync(AGENTS_JSON, 'utf8')).agents;
} catch (e) {
  console.warn('Could not load agents.json:', e.message);
}

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ── Helpers ──────────────────────────────────────────────────────────────────

const LINE_RE = /^\[(\d{2}:\d{2}:\d{2})\] (?:\[(\w+)\] )?(.+)$/;

function parseLine(line) {
  const m = line.match(LINE_RE);
  if (!m) return null;
  const [, time, agent, message] = m;
  return { time, agent: agent || null, message: message.slice(0, 300), type: classifyMessage(message) };
}

function classifyMessage(msg) {
  const l = msg.toLowerCase();
  if (l.includes('poll error') || l.includes('error:') || l.includes('failed')) return 'error';
  if (l.includes('processing message')) return 'processing';
  if (l.includes('replied in thread'))  return 'reply';
  if (l.includes('handed off'))         return 'handoff';
  if (l.includes('online as'))          return 'online';
  if (l.includes('stored') && l.includes('memor')) return 'memory';
  if (l.includes('shutting down') || l.includes('stopped') || l.includes('agents active') || l.includes('starting poll')) return 'system';
  if (l.includes('loaded') && l.includes('skill')) return 'system';
  return 'info';
}

function timeToMinutes(timeStr) {
  // Convert HH:MM:SS to minutes-since-midnight
  const [h, m, s] = timeStr.split(':').map(Number);
  return h * 60 + m + (s || 0) / 60;
}

function parseFullLog() {
  try {
    const content = fs.readFileSync(LOG_PATH, 'utf8');
    const lines = content.split('\n').filter(l => l.trim());
    const parsed = lines.map(parseLine).filter(Boolean);
    return {
      lines: parsed.slice(-300),
      agents: buildAgentStats(parsed),
      channels: buildChannelSummary(parsed),
      errorRate: calcErrorRate(parsed),
      lastPollTime: parsed.length ? parsed[parsed.length - 1].time : null,
    };
  } catch (e) {
    return { lines: [], agents: {}, channels: {}, errorRate: 0, lastPollTime: null };
  }
}

function buildAgentStats(parsed) {
  const stats = {};
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;

  for (const key of Object.keys(agentsConfig)) {
    stats[key] = { messageCount: 0, replyCount: 0, errorCount: 0, handoffCount: 0, lastActive: null, status: 'offline' };
  }

  // Find the last session start to determine if loop is live
  let lastSessionStart = -1;
  for (let i = parsed.length - 1; i >= 0; i--) {
    if (parsed[i].message.includes('agents active') && parsed[i].message.includes('Starting poll')) {
      lastSessionStart = i;
      break;
    }
  }
  // Check for shutdown after last start
  let loopIsLive = false;
  if (lastSessionStart >= 0) {
    loopIsLive = true;
    for (let i = lastSessionStart; i < parsed.length; i++) {
      if (parsed[i].type === 'system' && (parsed[i].message.includes('Shutting') || parsed[i].message.includes('stopped'))) {
        loopIsLive = false;
      }
    }
  }

  // Process only entries from the last session
  const sessionEntries = lastSessionStart >= 0 ? parsed.slice(lastSessionStart) : parsed;

  for (const entry of sessionEntries) {
    if (!entry.agent) continue;
    const key = entry.agent;
    if (!stats[key]) stats[key] = { messageCount: 0, replyCount: 0, errorCount: 0, handoffCount: 0, lastActive: null, status: 'offline' };

    if (entry.type === 'processing') stats[key].messageCount++;
    if (entry.type === 'reply')      stats[key].replyCount++;
    if (entry.type === 'error')      stats[key].errorCount++;
    if (entry.type === 'handoff')    stats[key].handoffCount++;
    if (entry.time) stats[key].lastActive = entry.time;
  }

  // Determine status
  for (const key of Object.keys(stats)) {
    if (stats[key].errorCount > 0 && loopIsLive) {
      stats[key].status = 'error';
    } else if (stats[key].lastActive && loopIsLive) {
      const agentMinutes = timeToMinutes(stats[key].lastActive);
      const diff = Math.abs(nowMinutes - agentMinutes);
      // Account for midnight rollover
      const adjustedDiff = diff > 720 ? 1440 - diff : diff;
      stats[key].status = adjustedDiff <= 30 ? 'active' : 'idle';
    } else if (loopIsLive) {
      stats[key].status = 'idle';
    } else {
      stats[key].status = 'offline';
    }
  }

  return stats;
}

function buildChannelSummary(parsed) {
  const channels = {};
  const sessionLines = getSessionLines(parsed);

  for (const entry of sessionLines) {
    if (!entry.agent) continue;
    const agentCfg = agentsConfig[entry.agent];
    const channel = agentCfg?.channel_name || `#peakcam-${entry.agent}`;

    if (!channels[channel]) channels[channel] = { agent: entry.agent, messages: [] };

    if (entry.type === 'processing' || entry.type === 'reply' || entry.type === 'handoff') {
      channels[channel].messages.push({ time: entry.time, type: entry.type, text: entry.message });
      if (channels[channel].messages.length > 5) channels[channel].messages.shift();
    }
  }

  return channels;
}

function getSessionLines(parsed) {
  let lastStart = -1;
  for (let i = parsed.length - 1; i >= 0; i--) {
    if (parsed[i].message.includes('agents active') && parsed[i].message.includes('Starting poll')) {
      lastStart = i;
      break;
    }
  }
  return lastStart >= 0 ? parsed.slice(lastStart) : parsed;
}

function calcErrorRate(parsed) {
  const session = getSessionLines(parsed);
  if (!session.length) return 0;
  const errors = session.filter(e => e.type === 'error').length;
  return Math.round((errors / session.length) * 100);
}

function getSystemHealth() {
  let loopRunning = false;
  let pid = null;
  let loopUptime = null;

  try {
    const result = execSync('pgrep -f "loop.mjs"', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    pid = result.split('\n')[0];
    loopRunning = !!pid;
    if (pid) {
      try {
        const etimes = execSync(`ps -p ${pid} -o etime=`, { encoding: 'utf8' }).trim();
        loopUptime = etimes;
      } catch (_) {}
    }
  } catch (_) {}

  let logSize = 0;
  let logSizeHuman = '0 B';
  try {
    const stat = fs.statSync(LOG_PATH);
    logSize = stat.size;
    logSizeHuman = logSize < 1024 ? `${logSize} B` : logSize < 1024 * 1024 ? `${(logSize / 1024).toFixed(1)} KB` : `${(logSize / 1024 / 1024).toFixed(2)} MB`;
  } catch (_) {}

  // Format time in server's local timezone so it matches log timestamps
  const now = new Date();
  const localTimeStr = now.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  return {
    loopRunning,
    pid,
    loopUptime,
    logSize,
    logSizeHuman,
    timestamp: now.toISOString(),
    localTimeStr,
  };
}

// ── Routes ───────────────────────────────────────────────────────────────────

// SSE endpoint — streams log updates in real-time
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  // Send initial full state
  const state = parseFullLog();
  const health = getSystemHealth();
  res.write(`data: ${JSON.stringify({ type: 'init', ...state, health, agentColors: AGENT_COLORS })}\n\n`);

  let logSize = 0;
  try { logSize = fs.statSync(LOG_PATH).size; } catch (_) {}

  // Poll for new content every 2s
  const interval = setInterval(() => {
    try {
      const stat = fs.statSync(LOG_PATH);

      if (stat.size !== logSize) {
        let newContent = '';
        if (stat.size > logSize) {
          const fd = fs.openSync(LOG_PATH, 'r');
          const buf = Buffer.alloc(stat.size - logSize);
          fs.readSync(fd, buf, 0, buf.length, logSize);
          fs.closeSync(fd);
          newContent = buf.toString('utf8');
        }
        logSize = stat.size;

        const newLines = newContent.split('\n').filter(l => l.trim()).map(parseLine).filter(Boolean);

        // Re-parse full log for updated agent stats
        const fullState = parseFullLog();
        const health = getSystemHealth();

        res.write(`data: ${JSON.stringify({ type: 'update', newLines, agents: fullState.agents, channels: fullState.channels, errorRate: fullState.errorRate, lastPollTime: fullState.lastPollTime, health })}\n\n`);
      } else {
        // Health-only ping every ~10s (5 intervals)
        if (!res._healthTick) res._healthTick = 0;
        res._healthTick++;
        if (res._healthTick % 5 === 0) {
          const health = getSystemHealth();
          res.write(`data: ${JSON.stringify({ type: 'health', health })}\n\n`);
        }
      }
    } catch (e) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: e.message })}\n\n`);
    }
  }, 2000);

  req.on('close', () => clearInterval(interval));
});

// Config data for frontend
app.get('/api/config', (req, res) => {
  res.json({ agents: agentsConfig, colors: AGENT_COLORS });
});

// Sprint tracker
app.get('/api/sprint', (req, res) => {
  try {
    res.json(JSON.parse(fs.readFileSync(SPRINT_JSON, 'utf8')));
  } catch (e) {
    res.json({ sprint: 2, title: 'Sprint 2', items: [] });
  }
});

app.put('/api/sprint/item/:id', (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(SPRINT_JSON, 'utf8'));
    const item = data.items.find(i => i.id === req.params.id);
    if (item && req.body.status) item.status = req.body.status;
    fs.writeFileSync(SPRINT_JSON, JSON.stringify(data, null, 2));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Slack Post ────────────────────────────────────────────────────────────────

app.post('/api/slack/post', async (req, res) => {
  const { channel, message } = req.body;
  if (!channel || !message) return res.status(400).json({ error: 'channel and message required' });
  if (!COO_TOKEN) return res.status(500).json({ error: 'COO token not configured' });

  try {
    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${COO_TOKEN}`,
      },
      body: JSON.stringify({ channel, text: `📋 ${message}` }),
    });
    const data = await response.json();
    if (!data.ok) return res.status(400).json({ error: data.error });
    res.json({ ok: true, ts: data.ts });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Claude Session Management ──────────────────────────────────────────────────

app.post('/api/claude/start', (req, res) => {
  const { prompt, cwd: cwdParam = '/Users/maestro_admin/peakcam/peakcam' } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt required' });

  const child = spawn('claude', ['--dangerously-skip-permissions', '-p', prompt], {
    cwd: cwdParam,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // Close stdin immediately — we're using -p for the prompt, not piped input.
  // Without this, claude emits "no stdin data received" and may hang.
  child.stdin.end();

  const session = {
    pid: child.pid,
    prompt: prompt.slice(0, 300),
    cwd: cwdParam,
    startTime: new Date().toISOString(),
    output: [],
    exitCode: null,
    lastOutputTime: null,
  };

  const appendOutput = (line) => {
    session.output.push(line);
    session.lastOutputTime = Date.now();
    if (session.output.length > 500) session.output = session.output.slice(-500);
    // Check for permission prompts in output stream
    detectPermission(child.pid, null, line);
    // Push to any SSE clients watching this session
    const clients = sessionSSEClients.get(child.pid);
    if (clients && clients.size > 0) {
      const payload = `data: ${JSON.stringify({ line })}\n\n`;
      for (const clientRes of clients) {
        try { clientRes.write(payload); } catch (_) {}
      }
    }
  };

  child.stdout.on('data', chunk => {
    chunk.toString().split('\n').forEach(l => l && appendOutput(l));
  });

  child.stderr.on('data', chunk => {
    chunk.toString().split('\n').forEach(l => {
      if (!l) return;
      // Suppress the benign "no stdin data received" warning that appears when
      // stdin is closed immediately (expected behavior with -p flag).
      if (l.includes('no stdin data received')) return;
      appendOutput(`[stderr] ${l}`);
    });
  });

  child.on('exit', (code) => {
    session.exitCode = code ?? 0;
    appendOutput(`[process exited with code ${session.exitCode}]`);
    children.delete(child.pid);
    // Notify SSE clients of exit
    const clients = sessionSSEClients.get(child.pid);
    if (clients) {
      const payload = `data: ${JSON.stringify({ type: 'exit', exitCode: session.exitCode })}\n\n`;
      for (const clientRes of clients) {
        try { clientRes.write(payload); } catch (_) {}
      }
    }
    setTimeout(() => {
      sessions.delete(child.pid);
      sessionSSEClients.delete(child.pid);
    }, 20 * 60 * 1000);
  });

  child.on('error', (err) => {
    appendOutput(`[spawn error] ${err.message}`);
    session.exitCode = -1;
    children.delete(child.pid);
  });

  children.set(child.pid, child);
  sessions.set(child.pid, session);
  res.json({ ok: true, pid: child.pid });
});

app.get('/api/claude/sessions', (req, res) => {
  const list = Array.from(sessions.values()).map(s => ({
    pid: s.pid,
    prompt: s.prompt,
    cwd: s.cwd,
    startTime: s.startTime,
    exitCode: s.exitCode,
    outputLines: s.output.length,
    lastLine: s.output[s.output.length - 1] || '',
    lastOutputTime: s.lastOutputTime,
  }));
  res.json(list);
});

app.get('/api/claude/output/:pid', (req, res) => {
  const session = sessions.get(parseInt(req.params.pid));
  if (!session) return res.status(404).json({ error: 'session not found' });
  const tail = parseInt(req.query.tail) || 60;
  res.json({ pid: session.pid, output: session.output.slice(-tail), exitCode: session.exitCode });
});

app.delete('/api/claude/session/:pid', (req, res) => {
  const pid = parseInt(req.params.pid);
  const session = sessions.get(pid);
  if (!session) return res.status(404).json({ error: 'session not found' });
  try { process.kill(pid, 'SIGTERM'); } catch (_) {}
  children.delete(pid);
  sessions.delete(pid);
  res.json({ ok: true });
});

// SSE stream for a specific session — sends history then live lines
app.get('/api/claude/session/:pid/stream', (req, res) => {
  const pid = parseInt(req.params.pid);
  const session = sessions.get(pid);
  if (!session) return res.status(404).json({ error: 'session not found' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  // Send full history first
  res.write(`data: ${JSON.stringify({ type: 'history', lines: session.output })}\n\n`);

  // Register as SSE client
  if (!sessionSSEClients.has(pid)) sessionSSEClients.set(pid, new Set());
  sessionSSEClients.get(pid).add(res);

  req.on('close', () => {
    const clients = sessionSSEClients.get(pid);
    if (clients) clients.delete(res);
  });
});

// Send input to a session's stdin
app.post('/api/claude/session/:pid/input', (req, res) => {
  const pid = parseInt(req.params.pid);
  const child = children.get(pid);
  if (!child) return res.status(404).json({ error: 'session not found or not interactive' });

  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });

  try {
    child.stdin.write(text + '\n');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Dispatch Session Management ───────────────────────────────────────────

const DISPATCH_SESSIONS_JSON  = path.join(__dirname, 'sessions.json');
const CLAUDE_SESSIONS_DIR     = path.join(os.homedir(), '.claude', 'sessions');
const LOCAL_AGENT_SESSIONS_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'local-agent-mode-sessions');

function readClaudeSessionFiles() {
  const result = [];
  const seen = new Set();

  // Read from ~/.claude/sessions/
  try {
    const files = fs.readdirSync(CLAUDE_SESSIONS_DIR).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(CLAUDE_SESSIONS_DIR, file), 'utf8'));
        if (data.sessionId && !seen.has(data.sessionId)) {
          seen.add(data.sessionId);
          result.push({ ...data, _source: 'claude-sessions' });
        }
      } catch (_) {}
    }
  } catch (_) {}

  // Read from ~/Library/Application Support/Claude/local-agent-mode-sessions/
  try {
    const files = fs.readdirSync(LOCAL_AGENT_SESSIONS_DIR).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(LOCAL_AGENT_SESSIONS_DIR, file), 'utf8'));
        const sid = data.sessionId || data.id || data.session_id;
        if (sid && !seen.has(sid)) {
          seen.add(sid);
          result.push({ sessionId: sid, pid: data.pid || null, cwd: data.cwd || null, startedAt: data.startedAt || data.created_at || null, _source: 'local-agent' });
        }
      } catch (_) {}
    }
  } catch (_) {}

  return result;
}

function isPidRunning(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (_) { return false; }
}

// List all discoverable dispatch sessions
app.get('/api/dispatch/sessions', (req, res) => {
  const claudeSessions = readClaudeSessionFiles();

  let registered = [];
  try { registered = JSON.parse(fs.readFileSync(DISPATCH_SESSIONS_JSON, 'utf8')); } catch (_) {}

  const registeredById = {};
  for (const r of registered) registeredById[r.sessionId] = r;

  const result = claudeSessions.map(s => {
    const reg = registeredById[s.sessionId] || {};
    const running = isPidRunning(s.pid);
    return {
      sessionId: s.sessionId,
      pid: s.pid,
      cwd: s.cwd || reg.cwd || null,
      startedAt: s.startedAt,
      status: running ? 'running' : 'idle',
      name: reg.name || null,
      source: 'claude-sessions',
    };
  });

  // Add manually registered sessions not found in ~/.claude/sessions/
  for (const r of registered) {
    if (!result.find(s => s.sessionId === r.sessionId)) {
      result.push({
        sessionId: r.sessionId,
        pid: null,
        cwd: r.cwd || null,
        startedAt: r.registeredAt || null,
        status: 'unknown',
        name: r.name || null,
        source: 'registered',
      });
    }
  }

  res.json(result);
});

// Send a message to a session via claude --resume -p
app.post('/api/dispatch/message', (req, res) => {
  const { session_id, message } = req.body;
  if (!session_id || !message) return res.status(400).json({ error: 'session_id and message required' });

  const child = spawn('claude', [
    '--resume', session_id,
    '--dangerously-skip-permissions',
    '-p', message,
  ], {
    cwd: '/Users/maestro_admin/peakcam/peakcam',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdin.end();

  const outputChunks = [];
  child.stdout.on('data', chunk => outputChunks.push(chunk.toString()));
  child.stderr.on('data', chunk => {
    const s = chunk.toString();
    if (!s.includes('no stdin data received')) outputChunks.push(`[stderr] ${s}`);
  });

  const timeout = setTimeout(() => {
    try { child.kill('SIGTERM'); } catch (_) {}
    res.json({ ok: false, error: 'timeout after 5 minutes', output: outputChunks.join('') });
  }, 5 * 60 * 1000);

  child.on('exit', (code) => {
    clearTimeout(timeout);
    if (!res.headersSent) {
      res.json({ ok: code === 0, output: outputChunks.join(''), exitCode: code });
    }
  });

  child.on('error', (err) => {
    clearTimeout(timeout);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  });
});

// Register a session ID manually in sessions.json
app.post('/api/dispatch/register', (req, res) => {
  const { sessionId, name, cwd } = req.body;
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });

  let sessions = [];
  try { sessions = JSON.parse(fs.readFileSync(DISPATCH_SESSIONS_JSON, 'utf8')); } catch (_) {}

  const idx = sessions.findIndex(s => s.sessionId === sessionId);
  const entry = { sessionId, name: name || null, cwd: cwd || null, registeredAt: new Date().toISOString() };
  if (idx >= 0) sessions[idx] = entry;
  else sessions.push(entry);

  fs.writeFileSync(DISPATCH_SESSIONS_JSON, JSON.stringify(sessions, null, 2));
  res.json({ ok: true });
});

// Unregister a session from sessions.json
app.delete('/api/dispatch/session/:id', (req, res) => {
  let sessions = [];
  try { sessions = JSON.parse(fs.readFileSync(DISPATCH_SESSIONS_JSON, 'utf8')); } catch (_) {}
  sessions = sessions.filter(s => s.sessionId !== req.params.id);
  fs.writeFileSync(DISPATCH_SESSIONS_JSON, JSON.stringify(sessions, null, 2));
  res.json({ ok: true });
});

// Discover external claude processes not started by this dashboard
app.get('/api/claude/discover', (req, res) => {
  try {
    const psResult = execSync('ps aux | grep claude | grep -v grep', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const lines = psResult.trim().split('\n').filter(Boolean);
    const seen = new Set();
    const external = [];
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      const pid = parseInt(parts[1]);
      if (isNaN(pid) || seen.has(pid)) continue;
      seen.add(pid);
      if (sessions.has(pid)) continue; // already tracked by dashboard
      const cmd = parts.slice(10).join(' ');
      // Only include actual claude CLI / Claude Code app processes
      const isClaude = /claude.app\/Contents\/MacOS\/claude/.test(cmd) || /^\s*claude\b/.test(cmd);
      const isHelper = cmd.includes('disclaimer') || cmd.includes('Contents/Helpers');
      if (!isClaude || isHelper) continue;
      if (cmd.includes('dashboard/server.js')) continue;
      external.push({ pid, cmd: cmd.slice(0, 200), external: true });
    }
    res.json(external);
  } catch (_) {
    res.json([]);
  }
});

// ── Permission Approval System ────────────────────────────────────────────────
//
// Surfaces Claude Code permission prompts in the dashboard UI so they can be
// approved or denied remotely (e.g. from a phone browser).
//
// Detection:   Scans captured stdout/stderr of dashboard-managed sessions for
//              permission prompt patterns. External sessions (started outside
//              the dashboard) cannot have their output intercepted on macOS
//              without a TTY wrapper, but their PID is known so approval can
//              still be attempted via the TTY write method below.
//
// Approval:    Method 1 — write 'y\n' / 'n\n' to the child process stdin
//              (works for sessions started by this dashboard without -p flag).
//              Method 2 — write to the process's controlling TTY device
//              (works on macOS when dashboard and Claude share the same user;
//              the TTY path is resolved via `ps -p PID -o tty=`).
//
// Limitations: External sessions write permission prompts to their terminal
//              (TTY), which we cannot read from another process on macOS
//              without DTrace/dtrace (requires SIP off) or a wrapper script.
//              Workaround: run Claude inside tmux and set up logging, or start
//              sessions via the dashboard "interactive" mode (no -p flag).

const permissionQueue = new Map(); // id → permission object
let permIdCounter = 0;

function genPermId() {
  return `perm_${Date.now()}_${++permIdCounter}`;
}

// Patterns that strongly indicate a permission prompt line
const PERM_TRIGGER_RE = [
  { re: /allow claude to (?:use|run|execute|call)\s+([^\?]+)\?/i, cap: 1 },
  { re: /allow tool:\s*(.+)/i, cap: 1 },
  { re: /do you want to (?:allow|proceed)/i, cap: null },
  { re: /\(y\/n(?:\/always)?(?:\/never)?\)/i, cap: null },
  { re: /approve this action/i, cap: null },
  { re: /press enter to allow/i, cap: null },
];

// Patterns to extract tool/command from recent context
const TOOL_EXTRACT_RE = [
  /tool:\s*(\w+)/i,
  /(?:use|run|execute|call)\s+([A-Z][a-zA-Z]+)/,
  /allow claude to (?:use|run)\s+(\w+)/i,
];
const CMD_EXTRACT_RE = [
  /(?:bash|command|cmd):\s*(.+)/i,
  /running:\s*(.+)/i,
  /execute:\s*(.+)/i,
];

// Per-session rolling line buffers (for multi-line context)
const permLineBufs  = new Map(); // pid → string[]
const permLastHit   = new Map(); // pid → timestamp (debounce)

function detectPermission(pid, sessionId, rawLine) {
  // Strip ANSI escape codes
  const line = rawLine.replace(/\x1b\[[0-9;]*[mGKHFJA-Z]/g, '')
                      .replace(/\x1b[()][A-Z0-9]/g, '')
                      .trim();
  if (!line) return;

  if (!permLineBufs.has(pid)) permLineBufs.set(pid, []);
  const buf = permLineBufs.get(pid);
  buf.push(line);
  if (buf.length > 30) buf.splice(0, buf.length - 30);

  // Check if this line matches any permission trigger
  let triggered = false;
  let toolName   = null;

  for (const { re, cap } of PERM_TRIGGER_RE) {
    const m = line.match(re);
    if (m) {
      triggered = true;
      if (cap && m[cap]) toolName = m[cap].trim().replace(/\?$/, '');
      break;
    }
  }
  if (!triggered) return;

  // Debounce: skip if triggered recently for this session
  const lastHit = permLastHit.get(pid) || 0;
  if (Date.now() - lastHit < 8000) return;

  // Skip if session already has a pending permission
  for (const p of permissionQueue.values()) {
    if (p.pid === pid && p.status === 'pending') return;
  }

  permLastHit.set(pid, Date.now());

  // Extract tool name and command from recent buffer context
  const context = buf.slice(-15).join('\n');
  if (!toolName) {
    for (const re of TOOL_EXTRACT_RE) {
      const m = context.match(re);
      if (m) { toolName = m[1]; break; }
    }
  }
  let command = null;
  for (const re of CMD_EXTRACT_RE) {
    const m = context.match(re);
    if (m) { command = m[1].trim().slice(0, 300); break; }
  }

  const id = genPermId();
  const perm = {
    id,
    pid,
    sessionId: sessionId || null,
    toolName:   (toolName || 'Unknown Tool').slice(0, 80),
    command:    command,
    promptText: context.slice(-400),
    timestamp:  Date.now(),
    status:     'pending',
    resolvedAt: null,
    method:     null,
  };

  permissionQueue.set(id, perm);
  console.log(`[permissions] Queued: ${id}  tool=${perm.toolName}  pid=${pid}`);

  // Auto-expire after 10 minutes if not resolved
  setTimeout(() => {
    const p = permissionQueue.get(id);
    if (p && p.status === 'pending') p.status = 'expired';
  }, 10 * 60 * 1000);
}

async function resolvePermission(permId, approved) {
  const perm = permissionQueue.get(permId);
  if (!perm)                      return { ok: false, error: 'Permission not found' };
  if (perm.status !== 'pending')  return { ok: false, error: `Already ${perm.status}` };

  perm.status    = approved ? 'approved' : 'denied';
  perm.resolvedAt = Date.now();

  const response = approved ? 'y\n' : 'n\n';

  // ── Method 1: stdin of a dashboard-managed child process ─────────────────
  const child = children.get(perm.pid);
  if (child && child.stdin && !child.stdin.destroyed) {
    try {
      child.stdin.write(response);
      perm.method = 'stdin';
      console.log(`[permissions] Resolved ${permId} via stdin`);
      return { ok: true, method: 'stdin' };
    } catch (e) {
      console.warn('[permissions] stdin write failed:', e.message);
    }
  }

  // ── Method 2: macOS — write to the process's controlling TTY ─────────────
  // On macOS, `ps -p PID -o tty=` returns the TTY name (e.g. "s001").
  // The TTY device is /dev/ttys001 and is writable by the owning user.
  // This sends the keypress as if the user typed it in the terminal.
  try {
    const alive = (() => { try { process.kill(perm.pid, 0); return true; } catch (_) { return false; } })();
    if (!alive) {
      return { ok: false, error: 'Process is no longer running' };
    }

    const ttyRaw = execSync(
      `ps -p ${perm.pid} -o tty=`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();

    if (ttyRaw && ttyRaw !== '?' && ttyRaw !== '??') {
      // macOS TTY names look like "s001"; device path is /dev/ttys001
      const ttyPath = ttyRaw.startsWith('/')     ? ttyRaw
                    : ttyRaw.startsWith('ttys')  ? `/dev/${ttyRaw}`
                    : `/dev/tty${ttyRaw}`;
      try {
        fs.writeFileSync(ttyPath, response);
        perm.method = `tty:${ttyPath}`;
        console.log(`[permissions] Resolved ${permId} via ${ttyPath}`);
        return { ok: true, method: `tty:${ttyPath}` };
      } catch (e) {
        console.warn(`[permissions] TTY write to ${ttyPath} failed:`, e.message);
        return {
          ok: false,
          error: `TTY write failed: ${e.message}`,
          suggestion: 'Ensure the dashboard runs as the same user as Claude and has tty group access.',
        };
      }
    }
  } catch (e) {
    console.warn('[permissions] TTY lookup failed:', e.message);
  }

  return {
    ok: false,
    error: 'Could not reach process stdin or TTY. See server logs.',
    suggestion: 'For external sessions, start Claude via tmux + script logging, or use "New Code Task" from the dashboard (interactive mode).',
  };
}

// Watch ~/.claude/sessions/ for new external sessions
function watchExternalSessions() {
  try {
    fs.watch(CLAUDE_SESSIONS_DIR, { persistent: false }, (event, filename) => {
      if (filename && filename.endsWith('.json')) {
        console.log(`[permissions] External session change detected: ${filename}`);
        // We can't intercept TTY output of external sessions on macOS, but
        // the user can manually trigger approval via /api/permissions (inject
        // a pending perm) or the TTY write will be attempted on approve.
      }
    });
  } catch (_) {} // directory may not exist
}

watchExternalSessions();

// GET  /api/permissions          → list recent permission requests
// POST /api/permissions/:id/approve
// POST /api/permissions/:id/deny
// POST /api/permissions/inject   → manually inject a pending request (for external sessions)

app.get('/api/permissions', (req, res) => {
  const cutoff = Date.now() - 30 * 60 * 1000; // keep last 30 min
  const list = Array.from(permissionQueue.values())
    .filter(p => p.status === 'pending' || p.timestamp > cutoff)
    .sort((a, b) => {
      if (a.status === 'pending' && b.status !== 'pending') return -1;
      if (b.status === 'pending' && a.status !== 'pending') return  1;
      return b.timestamp - a.timestamp;
    })
    .slice(0, 30);
  res.json(list);
});

app.post('/api/permissions/:id/approve', async (req, res) => {
  res.json(await resolvePermission(req.params.id, true));
});

app.post('/api/permissions/:id/deny', async (req, res) => {
  res.json(await resolvePermission(req.params.id, false));
});

// Inject a manual permission request (use when an external session has a prompt
// waiting but the dashboard can't detect it automatically)
app.post('/api/permissions/inject', (req, res) => {
  const { pid, sessionId, toolName, command } = req.body;
  if (!pid) return res.status(400).json({ error: 'pid required' });

  const id = genPermId();
  const perm = {
    id,
    pid:        parseInt(pid),
    sessionId:  sessionId || null,
    toolName:   (toolName || 'Manual Request').slice(0, 80),
    command:    command || null,
    promptText: command || 'Manually injected permission request',
    timestamp:  Date.now(),
    status:     'pending',
    resolvedAt: null,
    method:     null,
  };
  permissionQueue.set(id, perm);
  setTimeout(() => { const p = permissionQueue.get(id); if (p && p.status === 'pending') p.status = 'expired'; }, 10 * 60 * 1000);
  console.log(`[permissions] Manual inject: ${id}  pid=${pid}  tool=${toolName}`);
  res.json({ ok: true, id });
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, '0.0.0.0', () => {
  const interfaces = os.networkInterfaces();
  let networkIP = 'localhost';
  for (const ifaces of Object.values(interfaces)) {
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) {
        networkIP = iface.address;
        break;
      }
    }
  }

  console.log('\n  ╔══════════════════════════════════════╗');
  console.log('  ║   PeakCam Ops Dashboard              ║');
  console.log('  ╚══════════════════════════════════════╝');
  console.log(`\n  Local:   http://localhost:${PORT}`);
  console.log(`  Network: http://${networkIP}:${PORT}\n`);
});
