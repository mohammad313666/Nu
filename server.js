'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 3000);
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const DEV_MODE = process.env.DEV_MODE === 'true';
const ADMIN_IDS = new Set((process.env.ADMIN_TELEGRAM_IDS || '').split(',').map(s => s.trim()).filter(Boolean));
const TELEGRAM_CHANNEL = process.env.TELEGRAM_CHANNEL || '';
const TELEGRAM_BOT_USERNAME = (process.env.TELEGRAM_BOT_USERNAME || '').replace(/^@/, '');
// Keep the TON Center secret server-side; never expose it to public/app.js.
const TONCENTER_API_KEY = process.env.TONCENTER_API_KEY || '';
const TONCENTER_BASE_URL = (process.env.TONCENTER_BASE_URL || 'https://toncenter.com/api/v2').replace(/\/$/, '');
const TELEGRAM_APP_SHORT_NAME = process.env.TELEGRAM_APP_SHORT_NAME || ''; 
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const SQLITE_FILE = process.env.DB_PATH || path.join(DATA_DIR, 'nulltap.sqlite');
fs.mkdirSync(path.dirname(SQLITE_FILE), { recursive: true });
const sql = new Database(SQLITE_FILE);
sql.pragma('journal_mode = WAL');
sql.exec('CREATE TABLE IF NOT EXISTS app_state (id INTEGER PRIMARY KEY CHECK (id = 1), state_json TEXT NOT NULL, updated_at INTEGER NOT NULL)');

const TAP_UPGRADE_COST = level => level >= 2 && level <= 10 ? (level - 1) * 25 : null;
const ENERGY_UPGRADE_COST = level => level >= 2 && level <= 10 ? (level - 1) * 25 : null;
const AUTO_COSTS = { 1: 20000, 2: 50000, 3: 100000 };
const REFERRAL_REWARD = 1000;
const DAILY_TASK_REWARD = 10000;
const WNULL_TO_NULL_RATE = Math.max(0, Number(process.env.WNULL_TO_NULL_RATE || 1));
const STORAGE_LEVELS = { 1:{hours:4,cost:0}, 2:{hours:6,cost:100000}, 3:{hours:8,cost:200000}, 4:{hours:12,cost:500000}, 5:{hours:24,cost:1000000} };
const LEAGUES = [
  {id:'bronze',name:'Bronze',min:1,max:99999,color:'#cd8b55',reward:1000},
  {id:'silver',name:'Silver',min:100000,max:999999,color:'#c7d0dc',reward:10000},
  {id:'gold',name:'Gold',min:1000000,max:9999999,color:'#f4c44e',reward:100000},
  {id:'crystal',name:'Crystal',min:10000000,max:99999999,color:'#bd79ff',reward:500000},
  {id:'legendary',name:'Legendary',min:100000000,max:null,color:'#79c5ff',reward:1000000}
];
const ENERGY_REFILL_DELAY_MS = 30 * 1000;
const AUTO_TAPS_PER_SECOND = 1;
const WNULL_POOL_CAP = 5e15; // 5Qa total WNull mining pool
const AUTO_MULTIPLIERS = { 1: 5, 2: 7, 3: 10 };
const DAILY_BOOST_USES = 3;
const TURBO_MULTIPLIER = 10;
const TURBO_DURATION_MS = 30 * 1000;
const TASKS = [
  { id: 'instagram', title: 'Follow NULL on Instagram', description: 'Open @nulltabbot on Instagram, then claim your reward.', platform: 'Instagram', url: 'https://www.instagram.com/nulltabbot/', reward: 100000, enabled: true },
  { id: 'x', title: 'Follow NULL on X', description: 'Open @nulltabbot on X, then claim your reward.', platform: 'X', url: 'https://x.com/nulltabbot', reward: 100000, enabled: true },
  { id: 'youtube', title: 'Subscribe to NULL on YouTube', description: 'Open @nulltabbot on YouTube, then claim your reward.', platform: 'YouTube', url: 'https://www.youtube.com/@nulltabbot', reward: 100000, enabled: true },
  { id: 'telegram', title: 'Join NULL Telegram channel', description: 'Open @nulltab on Telegram, then claim your reward.', platform: 'Telegram', url: 'https://t.me/nulltab', reward: 100000, enabled: true },
  ...LEAGUES.map(league => ({
    id: `league_${league.id}`,
    title: `Claim ${league.name} League reward`,
    description: `Reach ${league.min.toLocaleString('en-US')} NULL to unlock this league reward.`,
    platform: 'League',
    url: '',
    reward: league.reward,
    enabled: true
  })),
  { id: 'daily', title: 'Daily reward', description: 'Claim once per day. Resets at 00:00 UTC.', platform: 'Daily', url: '', reward: DAILY_TASK_REWARD, enabled: true }
];

function freshDb() { return { users: {}, referrals: [], tasks: TASKS, claims: [], squads: {}, miningPool: { mined: 0, cap: WNULL_POOL_CAP }, settings: { projectName: 'NULL', referralReward: REFERRAL_REWARD } }; }
function loadDb() {
  const row = sql.prepare('SELECT state_json FROM app_state WHERE id=1').get();
  if (row) { try { return JSON.parse(row.state_json); } catch {} }
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch { const d = freshDb(); return d; }
}
let db = loadDb();
if (!db.squads || typeof db.squads !== 'object') db.squads = {};
if (!db.miningPool || typeof db.miningPool !== 'object') db.miningPool = { mined: 0, cap: WNULL_POOL_CAP };
db.miningPool.cap = WNULL_POOL_CAP;
db.miningPool.mined = Math.max(0, Math.min(WNULL_POOL_CAP, Number(db.miningPool.mined) || 0));
if (!Array.isArray(db.swaps)) db.swaps = [];
for (const existingUser of Object.values(db.users || {})) {
  if (existingUser.squadId === undefined) existingUser.squadId = null;
  if (!Array.isArray(existingUser.completedTasks)) existingUser.completedTasks = [];
  if (!Array.isArray(existingUser.claimedLeagueRewards)) existingUser.claimedLeagueRewards = [];
  // Old versions auto-paid league rewards; mark those rewards claimed in the UI to prevent duplicate payment.
  for (const leagueId of existingUser.claimedLeagueRewards) {
    const taskId = `league_${leagueId}`;
    if (!existingUser.completedTasks.includes(taskId)) existingUser.completedTasks.push(taskId);
  }
}
// Keep built-in task definitions up to date, including the official social links.
if (!Array.isArray(db.tasks)) db.tasks = [];
if (!Array.isArray(db.claims)) db.claims = [];
for (const task of TASKS) {
  const existing = db.tasks.find(t => t.id === task.id);
  if (!existing) {
    db.tasks.push({ ...task });
  } else {
    existing.title = task.title;
    existing.description = task.description;
    existing.platform = task.platform;
    existing.reward = task.reward;
    existing.enabled = task.enabled;
    if (['instagram', 'x', 'youtube', 'telegram'].includes(task.id)) existing.url = task.url;
    else if (String(task.id).startsWith('league_')) existing.url = '';
  }
}
function saveDb() {
  const stateJson = JSON.stringify(db);
  sql.prepare('INSERT INTO app_state (id,state_json,updated_at) VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET state_json=excluded.state_json, updated_at=excluded.updated_at').run(stateJson, Date.now());
  // Human-readable backup for local development only; SQLite is the primary database.
  try { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); } catch {}
}
function now() { return Date.now(); }
function capacity(u) { return u.energyLevel * 1000; }
function dayKey(t = now()) { return new Date(t).toISOString().slice(0, 10); }
function resetDailyBoostsIfNeeded(u) {
  const today = dayKey();
  if (u.dailyBoostDate !== today) { u.dailyBoostDate = today; u.dailyEnergyUses = 0; u.dailyTurboUses = 0; }
}
function getLeague(coins) {
  const n = Math.max(0, Math.floor(Number(coins) || 0));
  const league = [...LEAGUES].reverse().find(x => n >= x.min) || LEAGUES[0];
  const index = LEAGUES.findIndex(x => x.id === league.id);
  return { ...league, next: LEAGUES[index + 1]?.min ?? null };
}
function grantLeagueRewards() {
  // League rewards are claimed manually through /api/task/claim.
  // Do not auto-credit them on taps, swaps, or state refreshes.
  return 0;
}
function playerLeagueRank(user) {
  const league = getLeague(user.coins).id;
  const peers = Object.values(db.users).filter(x => getLeague(x.coins).id === league).sort((a,b) => b.coins-a.coins || String(a.id).localeCompare(String(b.id)));
  return { leagueId:league, rank:peers.findIndex(x => String(x.id) === String(user.id)) + 1, total:peers.length };
}
function leagueBoards(currentUser) {
  return Object.fromEntries(LEAGUES.map(league => {
    const players = Object.values(db.users).filter(x => getLeague(x.coins).id === league.id).sort((a,b) => b.coins-a.coins || String(a.id).localeCompare(String(b.id)));
    const rank = players.findIndex(x => String(x.id) === String(currentUser.id)) + 1;
    return [league.id, { league:league.id, total:players.length, top100:players.slice(0,100).map((x,i)=>({rank:i+1,id:String(x.id),name:x.name,coins:Math.floor(x.coins)})), userRank:rank || null }];
  }));
}

function squadSummary(squadId) {
  if (!squadId || !db.squads[squadId]) return null;
  const squad = db.squads[squadId];
  const members = Object.values(db.users).filter(x => x.squadId === squadId);
  return { id:squad.id, name:squad.name, ownerId:squad.ownerId, memberCount:members.length, totalCoins:Math.floor(members.reduce((sum, x) => sum + (Number(x.coins)||0), 0)), members:members.sort((a,b) => b.coins-a.coins).slice(0,10).map((x,i)=>({rank:i+1,name:x.name,coins:Math.floor(x.coins)})) };
}
function safeUser(u) {
  resetDailyBoostsIfNeeded(u);
  const league = getLeague(u.coins);
  const squad = squadSummary(u.squadId || null);
  return { id: String(u.id), name: u.name || 'NULL Player', coins: Math.floor(u.coins), wnull: Number(u.wnull || 0), storageLevel: Number(u.storageLevel || 1), storageHours: STORAGE_LEVELS[Number(u.storageLevel || 1)]?.hours || 4, claimedLeagueRewards: u.claimedLeagueRewards || [], league, squadId:u.squadId || null, squadName:squad?.name || null, tapLevel: u.tapLevel, tapPower: u.tapLevel, energyLevel: u.energyLevel, energy: Math.floor(u.energy), maxEnergy: capacity(u), energyRefillAt: u.energyRefillAt || null, autoLevel: u.autoLevel, completedTasks: (u.completedTasks || []).filter(id => id !== 'daily' || u.lastDailyDate === dayKey()), createdAt: u.createdAt, dailyEnergyUses: u.dailyEnergyUses || 0, dailyTurboUses: u.dailyTurboUses || 0, dailyBoostUses: DAILY_BOOST_USES, turboUntil: u.turboUntil || null, turboMultiplier: TURBO_MULTIPLIER };
}
function ensureUser(id, name = 'NULL Player', startParam = '') {
  id = String(id);
  if (!db.users[id]) {
    db.users[id] = { id, name: String(name || 'NULL Player').slice(0, 80), coins: 0, wnull: 0, storageLevel: 1, claimedLeagueRewards: [], tapLevel: 1, energyLevel: 1, energy: 1000, energyRefillAt: null, autoLevel: 0, dailyBoostDate: dayKey(), dailyEnergyUses: 0, dailyTurboUses: 0, turboUntil: null, createdAt: now(), lastSeen: now(), lastTick: now(), completedTasks: [], lastDailyAt: 0, referredBy: null, squadId: null };
    const match = /^ref_(\d+)$/.exec(String(startParam || ''));
    if (match && match[1] !== id && db.users[match[1]]) {
      db.users[id].referredBy = match[1];
      db.referrals.push({ referrerId: match[1], referredId: id, paid: true, createdAt: now() });
      db.users[match[1]].coins += REFERRAL_REWARD;
    }
    saveDb();
  }
  const u = db.users[id];
  if (u.wnull === undefined) u.wnull = 0;
  if (u.storageLevel === undefined) u.storageLevel = 1;
  if (!Array.isArray(u.claimedLeagueRewards)) u.claimedLeagueRewards = [];
  if (u.dailyBoostDate === undefined) { u.dailyBoostDate = dayKey(); u.dailyEnergyUses = 0; u.dailyTurboUses = 0; u.turboUntil = null; }
  resetDailyBoostsIfNeeded(u);
  u.name = String(name || u.name || 'NULL Player').slice(0, 80);
  tickUser(u);
  u.lastSeen = now();
  return u;
}
function tickUser(u) {
  const t = now();
  const storage = STORAGE_LEVELS[Number(u.storageLevel || 1)] || STORAGE_LEVELS[1];
  const maxSeconds = storage.hours * 3600;
  const elapsed = Math.max(0, Math.min(maxSeconds, (t - (u.lastTick || t)) / 1000));
  if (u.energyRefillAt && t >= u.energyRefillAt) { u.energy = capacity(u); u.energyRefillAt = null; }
  if (u.autoLevel > 0) {
    const requestedEarned = elapsed * AUTO_TAPS_PER_SECOND * (AUTO_MULTIPLIERS[u.autoLevel] || 0) * u.tapLevel;
    const poolRemaining = Math.max(0, WNULL_POOL_CAP - Number(db.miningPool.mined || 0));
    // Auto mining stops when the shared WNull pool reaches 5Qa.
    const earned = Math.min(requestedEarned, poolRemaining);
    if (earned > 0) {
      u.coins += earned;
      u.wnull = Number(u.wnull || 0) + earned;
      db.miningPool.mined = Math.min(WNULL_POOL_CAP, Number(db.miningPool.mined || 0) + earned);
    }
    grantLeagueRewards(u, u.coins);
  }
  u.lastTick = t;
}

function parseCookies(req) { const out = {}; (req.headers.cookie || '').split(';').forEach(p => { const i = p.indexOf('='); if (i > -1) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); }); return out; }
function verifyTelegramInitData(initData) {
  if (!BOT_TOKEN || !initData) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash'); if (!hash) return null;
  params.delete('hash');
  const dataCheckString = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const calculated = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
  const a = Buffer.from(calculated, 'hex'), b = Buffer.from(hash, 'hex');
  if (a.length !== 32 || b.length !== 32 || !crypto.timingSafeEqual(a, b)) return null;
  const authDate = Number(params.get('auth_date') || 0);
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(authDate) || !authDate || authDate > nowSeconds + 30 || nowSeconds - authDate > 86400) return null;
  try {
    const user = JSON.parse(params.get('user') || 'null');
    if (!user || !Number.isSafeInteger(Number(user.id)) || Number(user.id) <= 0) return null;
    return user;
  } catch { return null; }
}
function json(res, status, obj) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); }
function readBody(req) { return new Promise((resolve, reject) => { let s = ''; req.on('data', c => { s += c; if (s.length > 1e6) reject(new Error('Body too large')); }); req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch { reject(new Error('Invalid JSON')); } }); req.on('error', reject); }); }
function isLocalBrowserRequest(req) {
  const address = String(req.socket && req.socket.remoteAddress || '').toLowerCase();
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address);
}
function getIdentity(req, body = {}) {
  const initData = req.headers['x-telegram-init-data'] || body.initData || '';
  const telegramUser = verifyTelegramInitData(initData);
  if (telegramUser) return { id: String(telegramUser.id), name: [telegramUser.first_name, telegramUser.last_name].filter(Boolean).join(' ') || telegramUser.username || 'NULL Player', startParam: new URLSearchParams(initData).get('start_param') || '', isLocalDemo: false };
  // Allow browser testing only from the same computer. Public/remote users still need valid Telegram auth.
  if (!DEV_MODE && !isLocalBrowserRequest(req)) return null;
  const demoId = String(body.demoId || req.headers['x-null-demo-id'] || parseCookies(req).null_demo || '100001');
  return { id: demoId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || '100001', name: body.demoName || 'Demo Player', startParam: body.startParam || '', isLocalDemo: isLocalBrowserRequest(req) };
}
async function telegramMemberStatus(userId) {
  if (!BOT_TOKEN || !TELEGRAM_CHANNEL) return null;
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/getChatMember?chat_id=${encodeURIComponent(TELEGRAM_CHANNEL)}&user_id=${encodeURIComponent(userId)}`;
  try { const r = await fetch(url); const d = await r.json(); return !!(d.ok && d.result && ['creator','administrator','member','restricted'].includes(d.result.status) && d.result.status !== 'restricted' ? d.result.is_member !== false : false); } catch { return false; }
}
async function handleApi(req, res, pathname) {
  // Public, read-only connectivity check. It never returns the API key.
  if (pathname === '/api/ton/status' && req.method === 'GET') {
    if (!TONCENTER_API_KEY) return json(res, 503, { ok:false, configured:false, network:'mainnet', message:'TON Center API key is not configured on the server.' });
    try {
      const response = await fetch(`${TONCENTER_BASE_URL}/getMasterchainInfo`, {
        headers: { 'X-API-Key': TONCENTER_API_KEY, 'Accept': 'application/json' },
        signal: AbortSignal.timeout(8000)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok !== true || !data.result) {
        const status = response.status === 401 ? 'invalid_key' : response.status === 403 ? 'network_not_allowed' : response.status === 429 ? 'rate_limited' : 'upstream_error';
        return json(res, 502, { ok:false, configured:true, network:'mainnet', status, message: status === 'invalid_key' ? 'TON Center rejected the API key.' : status === 'network_not_allowed' ? 'This API key is not permitted on mainnet.' : status === 'rate_limited' ? 'TON Center rate limit reached.' : 'TON Center request failed.' });
      }
      return json(res, 200, { ok:true, configured:true, connected:true, network:'mainnet', masterchainSeqno:data.result.last?.seqno ?? null, checkedAt:new Date().toISOString() });
    } catch (e) {
      return json(res, 502, { ok:false, configured:true, network:'mainnet', status:'connection_error', message:'Could not reach TON Center from the server.' });
    }
  }
  let body = {};
  if (req.method !== 'GET') { try { body = await readBody(req); } catch (e) { return json(res, 400, { error: e.message }); } }
  const identity = getIdentity(req, body);
  if (!identity) return json(res, 401, { error: 'Telegram authentication failed. Open the app from Telegram.' });
  const u = ensureUser(identity.id, identity.name, identity.startParam);

  if (pathname === '/api/state' && req.method === 'GET') {
    const league = getLeague(u.coins);
    const squad = squadSummary(u.squadId || null);
    const squadLeaderboard = Object.values(db.squads).map(sq => { const members = Object.values(db.users).filter(x => x.squadId === sq.id); return { id:sq.id, name:sq.name, memberCount:members.length, totalCoins:Math.floor(members.reduce((sum,x)=>sum+(Number(x.coins)||0),0)) }; }).sort((a,b)=>b.totalCoins-a.totalCoins).slice(0,10);
    const leaderboard = Object.values(db.users).sort((a,b) => b.coins - a.coins).slice(0, 20).map((x, i) => ({ rank:i+1, name:x.name, coins:Math.floor(x.coins) }));
    grantLeagueRewards(u, u.coins); saveDb();
    const allLeagueBoards = leagueBoards(u);
    const myRank = playerLeagueRank(u);
    return json(res, 200, { user:safeUser(u), miningPool:{ mined:Number(db.miningPool.mined || 0), cap:WNULL_POOL_CAP, remaining:Math.max(0,WNULL_POOL_CAP-Number(db.miningPool.mined || 0)), full:Number(db.miningPool.mined || 0)>=WNULL_POOL_CAP }, league:getLeague(u.coins), squad, squadLeaderboard, tasks:db.tasks.filter(t => t.enabled), leaderboard, leagueBoards:allLeagueBoards, myRank, storageLevels:STORAGE_LEVELS, wnullSwapRate:WNULL_TO_NULL_RATE, referralReward:REFERRAL_REWARD, referralCount:db.referrals.filter(r => r.referrerId === u.id).length, referralLink: TELEGRAM_BOT_USERNAME && TELEGRAM_APP_SHORT_NAME ? `https://t.me/${TELEGRAM_BOT_USERNAME}/${TELEGRAM_APP_SHORT_NAME}?startapp=ref_${u.id}` : TELEGRAM_BOT_USERNAME ? `https://t.me/${TELEGRAM_BOT_USERNAME}?start=ref_${u.id}` : `ref_${u.id}`, config:{ dailyTaskReward:DAILY_TASK_REWARD, leagueRewards:Object.fromEntries(LEAGUES.map(x=>[x.id,x.reward])), energyRefillDelaySeconds:30, dailyBoostUses:DAILY_BOOST_USES, turboMultiplier:TURBO_MULTIPLIER, turboDurationSeconds:TURBO_DURATION_MS/1000, autoTapsPerSecond:AUTO_TAPS_PER_SECOND, autoMultipliers:AUTO_MULTIPLIERS, tapUpgradeCosts:Object.fromEntries(Array.from({length:9},(_,i)=>[i+2,TAP_UPGRADE_COST(i+2)])), energyUpgradeCosts:Object.fromEntries(Array.from({length:9},(_,i)=>[i+2,ENERGY_UPGRADE_COST(i+2)])), autoCosts:AUTO_COSTS } });
  }
  if (pathname === '/api/tap' && req.method === 'POST') {
    const taps = Math.max(1, Math.min(20, Math.floor(Number(body.taps) || 1)));
    const energyCostPerTap = u.tapLevel;
    const affordable = Math.min(taps, Math.floor(u.energy / energyCostPerTap));
    if (affordable < 1) {
      // Avoid a deadlock when the remaining energy is less than the cost of one tap.
      u.energy = 0;
      if (!u.energyRefillAt) u.energyRefillAt = now() + ENERGY_REFILL_DELAY_MS;
      saveDb();
      const secondsLeft = Math.max(0, Math.ceil((u.energyRefillAt - now()) / 1000));
      return json(res, 400, { error: `Energy empty. Full refill in ${secondsLeft}s.`, user:safeUser(u) });
    }
    const energySpent = affordable * energyCostPerTap;
    const energyBefore = u.energy;
    u.energy -= energySpent;
    if (u.energy < capacity(u) && !u.energyRefillAt) u.energyRefillAt = now() + ENERGY_REFILL_DELAY_MS;
    const turboActive = Number(u.turboUntil || 0) > now();
    const gained = affordable * u.tapLevel * (turboActive ? TURBO_MULTIPLIER : 1);
    u.coins += gained;
    const poolRemaining = Math.max(0, WNULL_POOL_CAP - Number(db.miningPool.mined || 0));
    const wnullEarned = Math.min(gained, poolRemaining);
    if (wnullEarned > 0) {
      u.wnull = Number(u.wnull || 0) + wnullEarned;
      db.miningPool.mined = Math.min(WNULL_POOL_CAP, Number(db.miningPool.mined || 0) + wnullEarned);
    }
    if (u.energy <= 0) u.energy = 0;
    saveDb();
    return json(res, 200, { user:safeUser(u), gained, energySpent, turboActive });
  }
  if (pathname === '/api/boost' && req.method === 'POST') {
    resetDailyBoostsIfNeeded(u);
    const kind = String(body.kind || '');
    if (kind === 'energy') {
      if (u.dailyEnergyUses >= DAILY_BOOST_USES) return json(res, 400, { error:'Daily energy refills used up. Come back tomorrow.', user:safeUser(u) });
      if (u.energy >= capacity(u) && !u.energyRefillAt) return json(res, 400, { error:'Your energy is already full.', user:safeUser(u) });
      u.energy = capacity(u); u.energyRefillAt = null; u.dailyEnergyUses += 1; saveDb();
      return json(res, 200, { user:safeUser(u), message:'Energy fully restored.' });
    }
    if (kind === 'turbo') {
      if (u.dailyTurboUses >= DAILY_BOOST_USES) return json(res, 400, { error:'Daily Turbo uses used up. Come back tomorrow.', user:safeUser(u) });
      if (Number(u.turboUntil || 0) > now()) return json(res, 400, { error:'Turbo is already active.', user:safeUser(u) });
      u.dailyTurboUses += 1; u.turboUntil = now() + TURBO_DURATION_MS; saveDb();
      return json(res, 200, { user:safeUser(u), message:'Turbo activated: 10× tap rewards for 30 seconds.' });
    }
    return json(res, 400, { error:'Unknown boost.' });
  }
  if (pathname === '/api/upgrade' && req.method === 'POST') {
    const kind = String(body.kind || '');
    if (kind === 'tap') {
      if (u.tapLevel >= 10) return json(res, 400, { error:'Tap power is already max level.' });
      const next = u.tapLevel + 1, cost = TAP_UPGRADE_COST(next);
      if (u.coins < cost) return json(res, 400, { error:'Not enough NULL coins.', user:safeUser(u) });
      u.coins -= cost; u.tapLevel = next; saveDb(); return json(res, 200, { user:safeUser(u) });
    }
    if (kind === 'energy') {
      if (u.energyLevel >= 10) return json(res, 400, { error:'Energy is already max level.' });
      const next = u.energyLevel + 1, cost = ENERGY_UPGRADE_COST(next);
      if (u.coins < cost) return json(res, 400, { error:'Not enough NULL coins.', user:safeUser(u) });
      const oldCap = capacity(u); u.coins -= cost; u.energyLevel = next; if (u.energy > 0) u.energy = Math.min(capacity(u), u.energy + capacity(u) - oldCap); saveDb(); return json(res, 200, { user:safeUser(u) });
    }
    if (kind === 'auto') {
      if (u.autoLevel >= 3) return json(res, 400, { error:'Auto tap is already max level.' });
      const next = u.autoLevel + 1, cost = AUTO_COSTS[next];
      if (u.coins < cost) return json(res, 400, { error:'Not enough NULL coins.', user:safeUser(u) });
      u.coins -= cost; u.autoLevel = next; saveDb(); return json(res, 200, { user:safeUser(u) });
    }
    if (kind === 'storage') {
      const current = Number(u.storageLevel || 1);
      if (current >= 5) return json(res, 400, { error:'Storage is already at level 5.' });
      const next = current + 1, cost = STORAGE_LEVELS[next].cost;
      if (u.coins < cost) return json(res, 400, { error:'Not enough NULL coins.', user:safeUser(u) });
      u.coins -= cost; u.storageLevel = next; u.lastTick = now(); saveDb(); return json(res, 200, { user:safeUser(u), message:`Storage upgraded to level ${next} (${STORAGE_LEVELS[next].hours} hours).` });
    }
    return json(res, 400, { error:'Unknown upgrade.' });
  }
  if (pathname === '/api/squad/create' && req.method === 'POST') {
    if (u.squadId && db.squads[u.squadId]) return json(res, 400, { error:'Leave your current squad before creating another one.', user:safeUser(u) });
    const name = String(body.name || '').trim().replace(/\s+/g, ' ').slice(0, 24);
    if (name.length < 3) return json(res, 400, { error:'Squad name must be at least 3 characters.' });
    const duplicate = Object.values(db.squads).some(sq => sq.name.toLowerCase() === name.toLowerCase());
    if (duplicate) return json(res, 400, { error:'That squad name is already taken.' });
    const id = 'sq_' + crypto.randomBytes(5).toString('hex');
    db.squads[id] = { id, name, ownerId:u.id, createdAt:now() }; u.squadId = id; saveDb();
    return json(res, 200, { user:safeUser(u), squad:squadSummary(id), message:'Squad created!' });
  }
  if (pathname === '/api/squad/join' && req.method === 'POST') {
    if (u.squadId && db.squads[u.squadId]) return json(res, 400, { error:'Leave your current squad before joining another one.', user:safeUser(u) });
    const id = String(body.squadId || '').trim();
    if (!db.squads[id]) return json(res, 404, { error:'Squad not found.' });
    const memberCount = Object.values(db.users).filter(x => x.squadId === id).length;
    if (memberCount >= 50) return json(res, 400, { error:'This squad is full (50 members).' });
    u.squadId = id; saveDb(); return json(res, 200, { user:safeUser(u), squad:squadSummary(id), message:'Joined squad!' });
  }
  if (pathname === '/api/squad/leave' && req.method === 'POST') {
    if (!u.squadId) return json(res, 400, { error:'You are not in a squad.' });
    const oldId = u.squadId; u.squadId = null;
    const remaining = Object.values(db.users).filter(x => x.squadId === oldId);
    if (!remaining.length) delete db.squads[oldId];
    else if (db.squads[oldId] && db.squads[oldId].ownerId === u.id) db.squads[oldId].ownerId = remaining[0].id;
    saveDb(); return json(res, 200, { user:safeUser(u), message:'You left the squad.' });
  }
  if (pathname === '/api/task/claim' && req.method === 'POST') {
    const taskId = String(body.taskId || '');

    if (!Array.isArray(u.completedTasks)) u.completedTasks = [];
    if (!Array.isArray(u.claimedLeagueRewards)) u.claimedLeagueRewards = [];
    if (!Array.isArray(db.claims)) db.claims = [];

    // League rewards require the user's current NULL balance to meet the threshold.
    if (taskId.startsWith('league_')) {
      const league = LEAGUES.find(item => `league_${item.id}` === taskId);
      if (!league) return json(res, 404, { error: 'League task not found.' });
      if (Number(u.coins || 0) < league.min) {
        return json(res, 400, { error: `Reach ${league.min.toLocaleString('en-US')} NULL to claim this league reward.` });
      }
      if (u.claimedLeagueRewards.includes(league.id) || u.completedTasks.includes(taskId)) {
        return json(res, 400, { error: 'League reward already claimed.' });
      }

      const reward = Number(league.reward || 0);
      u.claimedLeagueRewards.push(league.id);
      u.completedTasks.push(taskId);
      u.coins = Number(u.coins || 0) + reward;
      db.claims.push({ userId: u.id, taskId, at: now(), reward });
      saveDb();
      return json(res, 200, { user: safeUser(u), gained: reward });
    }

    const task = db.tasks.find(t => t.id === taskId && t.enabled);
    if (!task) return json(res, 404, { error: 'Task not found or disabled.' });

    if (task.id !== 'daily' && u.completedTasks.includes(task.id)) {
      return json(res, 400, { error: 'Task already claimed.' });
    }

    if (task.id === 'daily') {
      if (u.lastDailyDate === dayKey()) {
        return json(res, 400, { error: 'Daily reward already claimed. Come back after 00:00 UTC.' });
      }
      u.lastDailyDate = dayKey();
      u.lastDailyAt = now();
    } else if (['telegram', 'instagram', 'x', 'youtube'].includes(task.id)) {
      // Social claims intentionally do not call platform verification APIs.
    } else {
      return json(res, 400, { error: 'Unknown task verification method.' });
    }

    const reward = Number(task.reward || 0);
    if (!Number.isFinite(reward) || reward < 0) {
      return json(res, 400, { error: 'Invalid task reward.' });
    }

    u.completedTasks.push(task.id);
    u.coins = Number(u.coins || 0) + reward;
    db.claims.push({ userId: u.id, taskId: task.id, at: now(), reward });
    saveDb();
    return json(res, 200, { user: safeUser(u), gained: reward });
  }
  if (pathname === '/api/swap' && req.method === 'POST') {
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount < 1000000) return json(res, 400, { error:'Minimum swap is 1,000,000 WNull.' });
    if (WNULL_TO_NULL_RATE <= 0) return json(res, 503, { error:'WNull swap rate is not configured.' });
    if (amount > Number(u.wnull || 0)) return json(res, 400, { error:'Not enough WNull.' });
    const result = amount * WNULL_TO_NULL_RATE;
    if (!Number.isFinite(result) || result <= 0) return json(res, 400, { error:'Invalid swap amount.' });
    // Internal in-game ledger swap only. This does not create an on-chain transaction.
    u.wnull = Number(u.wnull || 0) - amount; u.coins += result;
    if (!Array.isArray(db.swaps)) db.swaps = [];
    db.swaps.push({ userId:u.id, from:'WNull', to:'NULL', amount, received:result, rate:WNULL_TO_NULL_RATE, at:now(), type:'internal-ledger' });
    grantLeagueRewards(u, u.coins); saveDb();
    return json(res, 200, { user:safeUser(u), swapped:amount, received:result, rate:WNULL_TO_NULL_RATE, message:'Internal game swap complete; not an on-chain DEX transaction.' });
  }
  if (pathname === '/api/admin/tasks' && req.method === 'POST') {
    if (!ADMIN_IDS.has(u.id)) return json(res, 403, { error:'Admin access required.' });
    const t = body.task || {};
    if (!t.id || !t.title || !t.url) return json(res, 400, { error:'Task id, title and URL are required.' });
    const normalized = { id:String(t.id).replace(/[^a-z0-9_-]/gi,'').slice(0,40), title:String(t.title).slice(0,100), description:String(t.description||'').slice(0,250), platform:String(t.platform||'Other').slice(0,30), url:String(t.url).slice(0,500), reward:Math.max(0, Math.min(1000000, Math.floor(Number(t.reward)||0))), enabled:t.enabled !== false };
    const index = db.tasks.findIndex(x => x.id === normalized.id); if (index >= 0) db.tasks[index] = normalized; else db.tasks.push(normalized); saveDb(); return json(res, 200, { ok:true, tasks:db.tasks });
  }
  return json(res, 404, { error:'Not found' });
}
const MIME = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.svg':'image/svg+xml', '.json':'application/json; charset=utf-8', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg' };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/tonconnect-manifest.json') { const host = req.headers.host || 'localhost:3000'; const proto = String(req.headers['x-forwarded-proto'] || url.protocol.replace(':','') || 'https').split(',')[0].trim(); const base = `${proto}://${host}`; return json(res, 200, { url:base, name:'NullTap', iconUrl:`${base}/icon-180.png` }); }
  if (url.pathname.startsWith('/api/')) return handleApi(req, res, url.pathname).catch(e => { console.error(e); json(res, 500, { error:'Internal server error' }); });
  

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400);
    return res.end('Bad request');
  }

  const relativePath = pathname.replace(/^\/+/, '') || 'index.html';
  const normalized = path.normalize(relativePath);

  if (
    path.isAbsolute(normalized) ||
    normalized === '..' ||
    normalized.startsWith('..' + path.sep)
  ) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  const firstPart = normalized.split(path.sep)[0];
  if (
    ['node_modules', 'data', '.git'].includes(firstPart) ||
    ['server.js', 'package.json', 'package-lock.json', '.nvmrc', '.env'].includes(normalized) ||
    /\.(sqlite|db|jsonl)$/i.test(normalized)
  ) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  
if (req.method === 'GET' && req.url.split('?')[0] === '/nulltap-logo.jpg') {
  const logoPath = path.join(__dirname, 'nulltap-logo.jpg');

  if (!fs.existsSync(logoPath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Logo file not found');
  }

  res.writeHead(200, {
    'Content-Type': 'image/jpeg',
    'Content-Disposition': 'inline; filename="nulltap-logo.jpg"',
    'Cache-Control': 'no-cache'
  });

  return fs.createReadStream(logoPath).pipe(res);
}

  
  const candidates = [
    path.join(PUBLIC, normalized),
    path.join(ROOT, normalized)
  ];

  function tryFile(index) {
    if (index >= candidates.length) {
      res.writeHead(404);
      return res.end('Not found');
    }

    const file = candidates[index];

    fs.readFile(file, (err, data) => {
      if (err) {
        if (err.code === 'ENOENT' || err.code === 'ENOTDIR') {
          return tryFile(index + 1);
        }
        res.writeHead(500);
        return res.end('Internal server error');
      }

      const ext = path.extname(file).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': 'no-cache'
      });
      res.end(data);
    });
  }

  
tryFile(0);
});

process.on('SIGINT', () => {
  try {
    saveDb();
    sql.close();
  } finally {
    process.exit(0);
  }
});

process.on('SIGTERM', () => { try { saveDb(); sql.close(); } finally { process.exit(0); } });

// Telegram /start welcome message with NullTap logo and Play button
async function sendTelegramWelcome(chatId) {
  if (!BOT_TOKEN) return;

  const photoUrl = 'https://nulltap.onrender.com/nulltap-logo.jpg';
  const gameUrl = 'https://nulltap.onrender.com/';

  const welcomeText =
    '🎮 Welcome to NullTap!\n\n' +
    '💎 Tap to earn NULL tokens.\n' +
    '🚀 Complete tasks, invite friends, and earn rewards!\n\n' +
    'Start your NullTap journey now!';

  const response = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        photo: photoUrl,
        caption: welcomeText,
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '🎮 Play',
                web_app: { url: gameUrl }
              }
            ]
          ]
        }
      })
    }
  );

  const result = await response.json();
  if (!result.ok) {
    console.error('Telegram welcome message failed:', result.description);
  }
}

server.listen(PORT, '0.0.0.0', () => {
console.log(`NullTap running on port ${PORT}`);
});
