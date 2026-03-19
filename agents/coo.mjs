#!/usr/bin/env node

/**
 * PeakCam COO — Command-line toolkit for the orchestrator agent (Jeffrey)
 *
 * Usage:
 *   node agents/coo.mjs status                    # Overview of all channels
 *   node agents/coo.mjs read <agent|channel_id>    # Read recent messages from a channel
 *   node agents/coo.mjs read <agent> --thread <ts> # Read a specific thread
 *   node agents/coo.mjs post <agent|channel_id> "message"  # Post to a channel
 *   node agents/coo.mjs post --broadcast "message"          # Post to #all-peakcam
 *   node agents/coo.mjs thread <agent|channel_id> <thread_ts> "message"  # Reply in thread
 *   node agents/coo.mjs directive <agent> "instruction"     # @mention an agent with a task
 *   node agents/coo.mjs digest                     # Generate a digest of all recent activity
 *
 * Requires .env.local with SLACK_BOT_TOKEN_COO
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Load env ──────────────────────────────────────────────
const envPath = resolve(__dirname, '..', '.env.local');
try {
  const envFile = readFileSync(envPath, 'utf-8');
  for (const line of envFile.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
} catch {}

const config = JSON.parse(readFileSync(resolve(__dirname, 'agents.json'), 'utf-8'));
const TOKEN = process.env.SLACK_BOT_TOKEN_COO;

if (!TOKEN) {
  console.error('Missing SLACK_BOT_TOKEN_COO in .env.local');
  console.error('\nTo set up:');
  console.error('1. Go to https://api.slack.com/apps');
  console.error('2. Create New App → From manifest → paste agents/manifests/coo.yaml');
  console.error('3. Install to workspace');
  console.error('4. Copy Bot User OAuth Token → add to .env.local as SLACK_BOT_TOKEN_COO=xoxb-...');
  process.exit(1);
}

// ── Slack API ─────────────────────────────────────────────
async function slack(method, params = {}, isGet = false) {
  let resp;
  if (isGet) {
    const qs = new URLSearchParams(params).toString();
    resp = await fetch(`https://slack.com/api/${method}?${qs}`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` },
    });
  } else {
    resp = await fetch(`https://slack.com/api/${method}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    });
  }

  if (resp.status === 429) {
    const wait = parseInt(resp.headers.get('Retry-After') || '5', 10);
    console.error(`Rate limited, waiting ${wait}s...`);
    await new Promise(r => setTimeout(r, wait * 1000));
    return slack(method, params, isGet);
  }

  return resp.json();
}

// ── Resolve channel ───────────────────────────────────────
function resolveChannel(input) {
  if (!input) return null;
  // Direct channel ID
  if (input.startsWith('C')) return input;
  // Agent name
  const agent = config.agents[input.toLowerCase()];
  if (agent?.channel) return agent.channel;
  // Broadcast
  if (input === 'broadcast' || input === 'all') return config.broadcast_channel.id;
  return null;
}

function agentNameForChannel(channelId) {
  for (const [key, agent] of Object.entries(config.agents)) {
    if (agent.channel === channelId) return agent.name;
  }
  if (channelId === config.broadcast_channel.id) return config.broadcast_channel.name;
  return channelId;
}

// ── Get bot user IDs for all agents (to label messages) ──
async function getAgentBotIds() {
  const ids = {};
  for (const [key, agent] of Object.entries(config.agents)) {
    const token = process.env[agent.token_env];
    if (!token) continue;
    try {
      const data = await slack('auth.test', {}, false);
      // We can only auth.test our own token, so we'll rely on bot_id in messages
    } catch {}
  }
  return ids;
}

// ── Format message for terminal ───────────────────────────
function formatMsg(msg, indent = '') {
  const time = new Date(parseFloat(msg.ts) * 1000).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  const who = msg.bot_id ? `[bot]` : `<@${msg.user}>`;
  const text = (msg.text || '').slice(0, 500);
  const thread = msg.thread_ts && msg.thread_ts !== msg.ts ? ` (thread ${msg.thread_ts})` : '';
  const replies = msg.reply_count ? ` [${msg.reply_count} replies]` : '';
  return `${indent}${time} ${who}${thread}${replies}\n${indent}  ${text}\n`;
}

// ── Commands ──────────────────────────────────────────────

async function cmdStatus() {
  console.log('\n  PeakCam Team — Channel Status\n');

  const channels = [
    ...Object.entries(config.agents)
      .filter(([k, a]) => a.channel)
      .map(([k, a]) => ({ key: k, id: a.channel, name: a.channel_name, agentName: a.name })),
    { key: 'broadcast', id: config.broadcast_channel.id, name: config.broadcast_channel.name, agentName: 'All' },
  ];

  for (const ch of channels) {
    const data = await slack('conversations.history', {
      channel: ch.id, limit: '5',
    }, true);

    if (!data.ok) {
      console.log(`  ${ch.name} — error: ${data.error}`);
      continue;
    }

    const msgs = data.messages || [];
    const recent = msgs.length > 0
      ? new Date(parseFloat(msgs[0].ts) * 1000).toLocaleString()
      : 'no messages';

    console.log(`  ${ch.name} (${ch.agentName})`);
    console.log(`    Last activity: ${recent}`);
    console.log(`    Recent messages: ${msgs.length}`);

    // Show last message preview
    if (msgs.length > 0) {
      const last = msgs[0];
      const preview = (last.text || '').slice(0, 120).replace(/\n/g, ' ');
      console.log(`    Latest: ${preview}`);
    }
    console.log('');

    await new Promise(r => setTimeout(r, 300)); // rate limit courtesy
  }
}

async function cmdRead(target, options = {}) {
  const channelId = resolveChannel(target);
  if (!channelId) {
    console.error(`Unknown channel/agent: ${target}`);
    console.error('Available:', Object.keys(config.agents).join(', '), '+ broadcast');
    process.exit(1);
  }

  if (options.thread) {
    // Read a specific thread
    const data = await slack('conversations.replies', {
      channel: channelId, ts: options.thread, limit: '30',
    }, true);

    if (!data.ok) {
      console.error(`Error: ${data.error}`);
      process.exit(1);
    }

    console.log(`\n  Thread in ${agentNameForChannel(channelId)} (${options.thread}):\n`);
    for (const msg of data.messages || []) {
      console.log(formatMsg(msg, '  '));
    }
  } else {
    // Read recent channel messages
    const limit = options.limit || '15';
    const data = await slack('conversations.history', {
      channel: channelId, limit,
    }, true);

    if (!data.ok) {
      console.error(`Error: ${data.error}`);
      process.exit(1);
    }

    const msgs = (data.messages || []).reverse();
    console.log(`\n  ${agentNameForChannel(channelId)} — last ${msgs.length} messages:\n`);
    for (const msg of msgs) {
      console.log(formatMsg(msg, '  '));
    }
  }
}

async function cmdPost(target, message) {
  const channelId = resolveChannel(target);
  if (!channelId) {
    console.error(`Unknown channel/agent: ${target}`);
    process.exit(1);
  }

  const data = await slack('chat.postMessage', {
    channel: channelId,
    text: message,
    unfurl_links: false,
  });

  if (data.ok) {
    console.log(`Posted to ${agentNameForChannel(channelId)} (ts: ${data.ts})`);
  } else {
    console.error(`Failed: ${data.error}`);
    if (data.error === 'not_in_channel') {
      console.error('Run: node agents/join-channels.mjs (or /invite @PeakCam COO in the channel)');
    }
  }
}

async function cmdThread(target, threadTs, message) {
  const channelId = resolveChannel(target);
  if (!channelId) {
    console.error(`Unknown channel/agent: ${target}`);
    process.exit(1);
  }

  const data = await slack('chat.postMessage', {
    channel: channelId,
    thread_ts: threadTs,
    text: message,
    unfurl_links: false,
  });

  if (data.ok) {
    console.log(`Replied in thread ${threadTs} (${agentNameForChannel(channelId)})`);
  } else {
    console.error(`Failed: ${data.error}`);
  }
}

async function cmdDirective(agentKey, instruction) {
  const agent = config.agents[agentKey.toLowerCase()];
  if (!agent || !agent.channel) {
    console.error(`Unknown agent: ${agentKey}`);
    console.error('Available:', Object.keys(config.agents).filter(k => config.agents[k].channel).join(', '));
    process.exit(1);
  }

  // Get COO's bot user ID to format the @mention properly
  const auth = await slack('auth.test');
  if (!auth.ok) {
    console.error('Failed to authenticate COO bot');
    process.exit(1);
  }

  // Get the target agent's bot user ID
  const targetToken = process.env[agent.token_env];
  if (!targetToken) {
    // Post without @mention
    await cmdPost(agentKey, `*COO Directive:* ${instruction}`);
    return;
  }

  // Post a directive that the agent loop will pick up (since it responds to any non-bot message)
  // We post as COO, which is a bot — but the loop filters out bot messages.
  // So we use a workaround: post with a fake user-like message
  // Actually, let's just post it — the agent can be configured to listen to COO.
  const data = await slack('chat.postMessage', {
    channel: agent.channel,
    text: `📋 *COO Directive*\n\n${instruction}\n\n_Please acknowledge and proceed._`,
    unfurl_links: false,
  });

  if (data.ok) {
    console.log(`Directive sent to ${agent.name} (ts: ${data.ts})`);
    console.log('Note: The agent loop filters bot messages by default.');
    console.log('To have agents respond to COO directives, update loop.mjs to whitelist the COO bot_id.');
  } else {
    console.error(`Failed: ${data.error}`);
  }
}

async function cmdDigest() {
  console.log('\n  ═══════════════════════════════════════');
  console.log('  PeakCam Team Digest');
  console.log('  ═══════════════════════════════════════\n');

  const since = ((Date.now() - 24 * 60 * 60 * 1000) / 1000).toFixed(6);

  for (const [key, agent] of Object.entries(config.agents)) {
    if (!agent.channel) continue;

    const data = await slack('conversations.history', {
      channel: agent.channel, oldest: since, limit: '100',
    }, true);

    if (!data.ok) {
      console.log(`  ${agent.name}: error (${data.error})\n`);
      continue;
    }

    const msgs = (data.messages || []).reverse();
    const threads = msgs.filter(m => m.reply_count > 0).length;
    const botMsgs = msgs.filter(m => m.bot_id).length;
    const userMsgs = msgs.length - botMsgs;

    console.log(`  ${agent.emoji} ${agent.name} (${agent.channel_name})`);
    console.log(`    Messages: ${msgs.length} total (${userMsgs} human, ${botMsgs} bot)`);
    console.log(`    Threads: ${threads}`);

    if (msgs.length > 0) {
      // Show last 3 message previews
      const recent = msgs.slice(-3);
      for (const msg of recent) {
        const time = new Date(parseFloat(msg.ts) * 1000).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        const who = msg.bot_id ? '🤖' : '👤';
        const preview = (msg.text || '').slice(0, 100).replace(/\n/g, ' ');
        console.log(`    ${who} ${time}: ${preview}`);
      }
    } else {
      console.log('    No activity in last 24h');
    }
    console.log('');

    await new Promise(r => setTimeout(r, 300));
  }
}

// ── CLI Router ────────────────────────────────────────────

const [command, ...rest] = process.argv.slice(2);

switch (command) {
  case 'status':
    await cmdStatus();
    break;

  case 'read': {
    const target = rest[0];
    const threadIdx = rest.indexOf('--thread');
    const options = {};
    if (threadIdx !== -1) options.thread = rest[threadIdx + 1];
    const limitIdx = rest.indexOf('--limit');
    if (limitIdx !== -1) options.limit = rest[limitIdx + 1];
    await cmdRead(target, options);
    break;
  }

  case 'post': {
    const target = rest[0] === '--broadcast' ? 'broadcast' : rest[0];
    const msg = rest[0] === '--broadcast' ? rest.slice(1).join(' ') : rest.slice(1).join(' ');
    await cmdPost(target, msg);
    break;
  }

  case 'thread': {
    const [target, threadTs, ...msgParts] = rest;
    await cmdThread(target, threadTs, msgParts.join(' '));
    break;
  }

  case 'directive': {
    const [agent, ...msgParts] = rest;
    await cmdDirective(agent, msgParts.join(' '));
    break;
  }

  case 'digest':
    await cmdDigest();
    break;

  default:
    console.log(`
  PeakCam COO Toolkit

  Usage:
    node agents/coo.mjs status                           # Channel overview
    node agents/coo.mjs read <agent>                     # Read recent messages
    node agents/coo.mjs read <agent> --thread <ts>       # Read a thread
    node agents/coo.mjs post <agent> "message"           # Post to a channel
    node agents/coo.mjs post --broadcast "message"       # Post to #all-peakcam
    node agents/coo.mjs thread <agent> <ts> "message"    # Reply in a thread
    node agents/coo.mjs directive <agent> "instruction"  # Send a directive
    node agents/coo.mjs digest                           # 24h activity digest

  Agents: ${Object.keys(config.agents).filter(k => config.agents[k].channel).join(', ')}
    `);
}
