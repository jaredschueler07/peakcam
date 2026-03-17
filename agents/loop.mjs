#!/usr/bin/env node

/**
 * PeakCam Agent Loop
 *
 * Runs all 8 PeakCam agents as a single process. Each agent:
 * - Polls its Slack channel for new messages mentioning the bot
 * - Builds a system prompt from its plugin skills
 * - Calls the Claude API for a response
 * - Posts the reply back to Slack in a thread
 * - Detects cross-agent handoffs and routes them
 *
 * Usage:
 *   node agents/loop.mjs                     # Run the loop
 *   node agents/loop.mjs --dry-run           # Log what would happen, don't send
 *   PEAKCAM_LOG_LEVEL=debug node agents/loop.mjs  # Verbose logging
 *
 * Requires .env.local with:
 *   ANTHROPIC_API_KEY, SLACK_BOT_TOKEN_* for each agent
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─────────────────────────────────────────────────────────────
// A. Environment & Config
// ─────────────────────────────────────────────────────────────

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
} catch { /* env vars may be set directly */ }

const config = JSON.parse(readFileSync(resolve(__dirname, 'agents.json'), 'utf-8'));
const DRY_RUN = process.argv.includes('--dry-run');
const LOG_LEVEL = process.env.PEAKCAM_LOG_LEVEL || 'info';
const POLL_INTERVAL = parseInt(process.env.PEAKCAM_POLL_INTERVAL || '5000', 10);
const CLAUDE_MODEL = process.env.PEAKCAM_CLAUDE_MODEL || 'claude-sonnet-4-20250514';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!ANTHROPIC_API_KEY) {
  console.error('Missing ANTHROPIC_API_KEY in .env.local');
  process.exit(1);
}

// Map agent keys to plugin directory names
const PLUGIN_DIR_MAP = {
  sales: 'sales',
  engineering: 'engineering',
  product: 'product-management',
  marketing: 'marketing',
  operations: 'operations',
  finance: 'finance',
  data: 'data',
  productivity: 'productivity',
};

// ─────────────────────────────────────────────────────────────
// B. Logging
// ─────────────────────────────────────────────────────────────

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel = LOG_LEVELS[LOG_LEVEL] ?? 1;

function log(level, agent, msg) {
  if (LOG_LEVELS[level] < currentLevel) return;
  const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
  const prefix = agent ? `[${ts}] [${agent}]` : `[${ts}]`;
  console[level === 'error' ? 'error' : 'log'](`${prefix} ${msg}`);
}

// ─────────────────────────────────────────────────────────────
// C. Slack API Helpers
// ─────────────────────────────────────────────────────────────

async function slackAPI(token, method, params = {}) {
  const isGet = ['conversations.history', 'conversations.replies'].includes(method);

  let resp;
  if (isGet) {
    const qs = new URLSearchParams(params).toString();
    resp = await fetch(`https://slack.com/api/${method}?${qs}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
  } else {
    resp = await fetch(`https://slack.com/api/${method}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    });
  }

  // Handle rate limiting
  if (resp.status === 429) {
    const retryAfter = parseInt(resp.headers.get('Retry-After') || '5', 10);
    log('warn', null, `Slack rate limited, waiting ${retryAfter}s`);
    await sleep(retryAfter * 1000);
    return slackAPI(token, method, params);
  }

  const data = await resp.json();
  if (!data.ok && data.error !== 'not_in_channel') {
    log('debug', null, `Slack API ${method}: ${data.error}`);
  }
  return data;
}

async function getBotUserId(token) {
  const data = await slackAPI(token, 'auth.test');
  if (!data.ok) throw new Error(`auth.test failed: ${data.error}`);
  return { userId: data.user_id, botId: data.bot_id };
}

async function getNewMessages(token, channel, oldest) {
  const data = await slackAPI(token, 'conversations.history', {
    channel,
    oldest,
    limit: '20',
    inclusive: 'false',
  });
  if (!data.ok) return [];
  // Filter out bot messages and subtypes (joins, topic changes, etc.)
  return (data.messages || [])
    .filter(m => !m.bot_id && !m.subtype)
    .reverse(); // chronological order
}

async function getThreadMessages(token, channel, threadTs) {
  const data = await slackAPI(token, 'conversations.replies', {
    channel,
    ts: threadTs,
    limit: '30',
  });
  if (!data.ok) return [];
  return data.messages || [];
}

async function postReply(token, channel, threadTs, text) {
  if (DRY_RUN) {
    log('info', null, `[DRY RUN] Would post to ${channel} (thread ${threadTs}): ${text.slice(0, 100)}...`);
    return { ok: true };
  }

  // Slack has a 4000 char limit per message
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= 4000) {
      chunks.push(remaining);
      break;
    }
    // Try to split at a newline near the limit
    let splitAt = remaining.lastIndexOf('\n', 4000);
    if (splitAt < 2000) splitAt = 4000;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }

  let result;
  for (const chunk of chunks) {
    result = await slackAPI(token, 'chat.postMessage', {
      channel,
      thread_ts: threadTs,
      text: chunk,
      unfurl_links: false,
    });
    if (!result.ok) {
      log('error', null, `Failed to post: ${result.error}`);
      return result;
    }
    if (chunks.length > 1) await sleep(500);
  }
  return result;
}

// ─────────────────────────────────────────────────────────────
// D. Plugin / Skill Loader
// ─────────────────────────────────────────────────────────────

const skillCache = {}; // agentKey -> { readme, skills: [{ name, description, content }] }

function loadAgentSkills(agentKey) {
  if (skillCache[agentKey]) return skillCache[agentKey];

  const pluginDir = PLUGIN_DIR_MAP[agentKey];
  const pluginPath = resolve(__dirname, 'plugins', pluginDir);

  // Load README
  let readme = '';
  const readmePath = join(pluginPath, 'README.md');
  if (existsSync(readmePath)) {
    readme = readFileSync(readmePath, 'utf-8');
    // Trim to the useful parts — cut everything after "## MCP Integrations" or "## Settings"
    const cutPoints = ['## MCP Integrations', '## Settings', '## Installation', '## Standalone + Supercharged'];
    for (const cut of cutPoints) {
      const idx = readme.indexOf(cut);
      if (idx > 0) readme = readme.slice(0, idx).trimEnd();
    }
  }

  // Load all skills
  const skills = [];
  const skillsDir = join(pluginPath, 'skills');
  if (existsSync(skillsDir)) {
    for (const skillName of readdirSync(skillsDir)) {
      const skillPath = join(skillsDir, skillName, 'SKILL.md');
      if (!existsSync(skillPath)) continue;
      const content = readFileSync(skillPath, 'utf-8');

      // Parse frontmatter description
      let description = '';
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (fmMatch) {
        const descMatch = fmMatch[1].match(/description:\s*(.+)/);
        if (descMatch) description = descMatch[1].trim();
      }

      skills.push({ name: skillName, description, content });
    }
  }

  skillCache[agentKey] = { readme, skills };
  return skillCache[agentKey];
}

function scoreSkillRelevance(skill, messageText) {
  const words = messageText.toLowerCase().split(/\s+/);
  const skillWords = `${skill.name} ${skill.description}`.toLowerCase();
  let score = 0;
  for (const word of words) {
    if (word.length < 3) continue;
    if (skillWords.includes(word)) score++;
  }
  // Boost for exact skill name match
  if (messageText.toLowerCase().includes(skill.name)) score += 5;
  return score;
}

function buildSystemPrompt(agentKey, messageText) {
  const agent = config.agents[agentKey];
  const { readme, skills } = loadAgentSkills(agentKey);

  // Build the list of other agents for handoff awareness
  const otherAgents = Object.entries(config.agents)
    .filter(([k]) => k !== agentKey)
    .map(([k, a]) => `- ${a.name} (${a.channel_name}): ${a.skills.slice(0, 3).join(', ')}`)
    .join('\n');

  // Score and select top skills
  const scored = skills
    .map(s => ({ ...s, score: scoreSkillRelevance(s, messageText) }))
    .sort((a, b) => b.score - a.score);

  const selectedSkills = scored.slice(0, 2).filter(s => s.score > 0);

  // Build skill index (always included, compact)
  const skillIndex = skills
    .map(s => `- **${s.name}**: ${s.description.slice(0, 100)}`)
    .join('\n');

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  let prompt = `You are ${agent.name}, an AI agent on the PeakCam team.
You respond in Slack. Format for Slack: use *bold*, _italic_, \`code\`, bullet points, and keep responses concise but thorough.
Today is ${today}.

## Your Identity
${readme}

## Your Available Skills
${skillIndex}

## Other PeakCam Agents
If a request is better handled by another agent, mention them by name and explain why. The user can then reach out to that agent's channel.
${otherAgents}

## Cross-Agent Handoff
If you determine another agent should handle part of a request, include exactly this pattern in your response:
[HANDOFF:agent_key] where agent_key is one of: ${Object.keys(config.agents).join(', ')}
followed by a brief message for that agent. The system will automatically route it.
`;

  // Append selected skills in full
  if (selectedSkills.length > 0) {
    prompt += '\n## Relevant Skill Details\n\n';
    for (const skill of selectedSkills) {
      prompt += `### ${skill.name}\n${skill.content}\n\n`;
    }
  }

  return prompt;
}

// ─────────────────────────────────────────────────────────────
// E. Claude API
// ─────────────────────────────────────────────────────────────

let lastClaudeCall = 0;
const MIN_CLAUDE_GAP = 1500; // ms between calls

async function callClaude(systemPrompt, messages) {
  // Rate limiting: ensure minimum gap between calls
  const now = Date.now();
  const gap = now - lastClaudeCall;
  if (gap < MIN_CLAUDE_GAP) {
    await sleep(MIN_CLAUDE_GAP - gap);
  }
  lastClaudeCall = Date.now();

  const body = {
    model: CLAUDE_MODEL,
    max_tokens: 2048,
    system: systemPrompt,
    messages,
  };

  log('debug', null, `Claude request: ${messages.length} messages, system prompt ${systemPrompt.length} chars`);

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (resp.status === 429 || resp.status === 529) {
    const retryAfter = parseInt(resp.headers.get('retry-after') || '10', 10);
    log('warn', null, `Claude API ${resp.status}, retrying in ${retryAfter}s`);
    await sleep(retryAfter * 1000);
    return callClaude(systemPrompt, messages);
  }

  if (!resp.ok) {
    const errBody = await resp.text();
    throw new Error(`Claude API ${resp.status}: ${errBody}`);
  }

  const data = await resp.json();
  const text = data.content
    ?.filter(c => c.type === 'text')
    .map(c => c.text)
    .join('\n');

  log('debug', null, `Claude response: ${text?.length || 0} chars, ${data.usage?.output_tokens || 0} tokens`);
  return text || '(No response generated)';
}

// ─────────────────────────────────────────────────────────────
// F. Thread → Claude Messages
// ─────────────────────────────────────────────────────────────

function threadToClaudeMessages(threadMessages, botUserId) {
  const claudeMessages = [];

  for (const msg of threadMessages) {
    const role = msg.user === botUserId || msg.bot_id ? 'assistant' : 'user';
    const text = msg.text || '';
    if (!text.trim()) continue;

    // Claude requires alternating roles — merge consecutive same-role messages
    if (claudeMessages.length > 0 && claudeMessages[claudeMessages.length - 1].role === role) {
      claudeMessages[claudeMessages.length - 1].content += '\n' + text;
    } else {
      claudeMessages.push({ role, content: text });
    }
  }

  // Ensure first message is from user
  if (claudeMessages.length > 0 && claudeMessages[0].role !== 'user') {
    claudeMessages.shift();
  }

  // Ensure last message is from user (Claude needs user message last)
  if (claudeMessages.length > 0 && claudeMessages[claudeMessages.length - 1].role !== 'user') {
    claudeMessages.pop();
  }

  return claudeMessages;
}

// ─────────────────────────────────────────────────────────────
// G. Cross-Agent Handoff
// ─────────────────────────────────────────────────────────────

function detectHandoff(responseText) {
  const handoffs = [];
  const pattern = /\[HANDOFF:(\w+)\]\s*(.*?)(?=\[HANDOFF:|\n\n|$)/gs;
  let match;
  while ((match = pattern.exec(responseText)) !== null) {
    const targetKey = match[1].toLowerCase();
    const message = match[2].trim();
    if (config.agents[targetKey]) {
      handoffs.push({ targetKey, message });
    }
  }
  return handoffs;
}

async function executeHandoff(sourceAgent, targetKey, message, originalUserText) {
  const target = config.agents[targetKey];
  const source = config.agents[sourceAgent];
  const targetToken = process.env[target.token_env];
  if (!targetToken) {
    log('warn', sourceAgent, `Cannot handoff to ${targetKey}: no token`);
    return;
  }

  const handoffText = `*Handoff from ${source.name}:*\n${message}\n\n*Original request:*\n> ${originalUserText}`;

  if (DRY_RUN) {
    log('info', sourceAgent, `[DRY RUN] Would handoff to ${targetKey}: ${handoffText.slice(0, 100)}...`);
    return;
  }

  // Post to the target agent's channel — the next poll cycle will pick it up
  // Use the SOURCE agent's token to post (as a referral message)
  const sourceToken = process.env[source.token_env];
  const result = await slackAPI(sourceToken, 'chat.postMessage', {
    channel: target.channel,
    text: handoffText,
    unfurl_links: false,
  });

  if (result.ok) {
    log('info', sourceAgent, `Handed off to ${targetKey} in ${target.channel_name}`);
  } else {
    log('error', sourceAgent, `Handoff failed: ${result.error}`);
  }
}

// ─────────────────────────────────────────────────────────────
// H. Message Processing
// ─────────────────────────────────────────────────────────────

async function processMessage(agentKey, msg, botUserId, token) {
  const agent = config.agents[agentKey];
  const channel = agent.channel;
  const threadTs = msg.thread_ts || msg.ts;

  log('info', agentKey, `Processing message from <@${msg.user}>: "${msg.text?.slice(0, 80)}..."`);

  try {
    // Get thread context if this is a threaded reply
    let claudeMessages;
    if (msg.thread_ts) {
      const thread = await getThreadMessages(token, channel, msg.thread_ts);
      claudeMessages = threadToClaudeMessages(thread, botUserId);
    } else {
      // Single message — strip the bot mention for cleaner input
      const cleanText = msg.text.replace(/<@[A-Z0-9]+>/g, '').trim();
      claudeMessages = [{ role: 'user', content: cleanText || msg.text }];
    }

    if (claudeMessages.length === 0) {
      log('debug', agentKey, 'No processable messages in thread');
      return;
    }

    // Build system prompt with skill matching based on latest user message
    const latestUserText = claudeMessages[claudeMessages.length - 1].content;
    const systemPrompt = buildSystemPrompt(agentKey, latestUserText);

    // Call Claude
    const response = await callClaude(systemPrompt, claudeMessages);

    // Strip handoff markers from the visible response
    const cleanResponse = response.replace(/\[HANDOFF:\w+\]\s*/g, '').trim();

    // Post reply
    await postReply(token, channel, threadTs, cleanResponse);
    log('info', agentKey, `Replied in thread ${threadTs}`);

    // Check for handoffs
    const handoffs = detectHandoff(response);
    for (const { targetKey, message } of handoffs) {
      await executeHandoff(agentKey, targetKey, message, latestUserText);
    }
  } catch (err) {
    log('error', agentKey, `Error processing message: ${err.message}`);
  }
}

// ─────────────────────────────────────────────────────────────
// I. Main Loop
// ─────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  console.log(`
  ╔═══════════════════════════════════════════════╗
  ║         PeakCam Agent Loop                    ║
  ║         ${Object.keys(config.agents).length} agents • polling every ${POLL_INTERVAL / 1000}s          ║
  ║         model: ${CLAUDE_MODEL}   ║
  ${DRY_RUN ? '║         ⚠️  DRY RUN MODE                       ║\n' : ''}╚═══════════════════════════════════════════════╝
  `);

  // Validate tokens and resolve bot user IDs
  const agentState = {};

  for (const [key, agent] of Object.entries(config.agents)) {
    const token = process.env[agent.token_env];
    if (!token) {
      log('warn', key, `No token found (${agent.token_env}) — skipping`);
      continue;
    }

    try {
      const { userId, botId } = await getBotUserId(token);
      agentState[key] = {
        token,
        botUserId: userId,
        botId,
        lastSeen: (Date.now() / 1000).toFixed(6), // Start from now
      };
      log('info', key, `Online as <@${userId}> in ${agent.channel_name}`);

      // Pre-load skills
      const { skills } = loadAgentSkills(key);
      log('info', key, `Loaded ${skills.length} skills`);
    } catch (err) {
      log('error', key, `Failed to initialize: ${err.message}`);
    }

    await sleep(200); // Stagger auth.test calls
  }

  const activeAgents = Object.keys(agentState);
  if (activeAgents.length === 0) {
    console.error('No agents could be initialized. Check your tokens.');
    process.exit(1);
  }

  log('info', null, `${activeAgents.length} agents active. Starting poll loop...`);

  // Graceful shutdown
  let running = true;
  process.on('SIGINT', () => {
    log('info', null, 'Shutting down...');
    running = false;
  });
  process.on('SIGTERM', () => {
    log('info', null, 'Shutting down...');
    running = false;
  });

  // Poll loop
  while (running) {
    for (const agentKey of activeAgents) {
      if (!running) break;

      const state = agentState[agentKey];
      const agent = config.agents[agentKey];

      try {
        const messages = await getNewMessages(state.token, agent.channel, state.lastSeen);

        for (const msg of messages) {
          // Update lastSeen regardless
          if (parseFloat(msg.ts) > parseFloat(state.lastSeen)) {
            state.lastSeen = msg.ts;
          }

          // Only respond if bot is mentioned or it's a reply in a thread the bot is in
          const mentionsBot = msg.text?.includes(`<@${state.botUserId}>`);
          const isThreadReply = !!msg.thread_ts;

          if (mentionsBot) {
            await processMessage(agentKey, msg, state.botUserId, state.token);
          } else if (isThreadReply) {
            // Check if bot has already replied in this thread
            const thread = await getThreadMessages(state.token, agent.channel, msg.thread_ts);
            const botInThread = thread.some(m => m.user === state.botUserId);
            if (botInThread) {
              await processMessage(agentKey, msg, state.botUserId, state.token);
            }
          }
        }
      } catch (err) {
        log('error', agentKey, `Poll error: ${err.message}`);
      }

      await sleep(250); // Stagger between agents
    }

    await sleep(POLL_INTERVAL);
  }

  log('info', null, 'Agent loop stopped.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
