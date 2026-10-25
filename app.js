(() => {
  const tg = window.Telegram && window.Telegram.WebApp;
  if (tg) { tg.ready(); tg.expand(); try { tg.setHeaderColor('#000000'); tg.setBackgroundColor('#000000'); } catch {} }
  const initData = tg?.initData || '';
  const tgUser = tg?.initDataUnsafe?.user;
  const adminLink = document.getElementById('admin-dashboard-link');
  if (adminLink && String(tgUser?.username || '').replace(/^@/, '').toLowerCase() === 'mohammadn313666') adminLink.hidden = false;
  const startParam = tg?.initDataUnsafe?.start_param || '';
  const demoId = tgUser?.id ? String(tgUser.id) : (localStorage.getItem('null_demo_id') || '100001');
  if (!tgUser && !localStorage.getItem('null_demo_id')) localStorage.setItem('null_demo_id', demoId);
  let state = null, busy = false, selectedLeague = 'bronze';
  const openedTasks = new Set();
  // TON Connect UI: real wallet connection only; no transaction is sent by connecting.
  let tonConnectUI = null;
  try {
    if (window.TON_CONNECT_UI && location.protocol === 'https:') {
      tonConnectUI = new window.TON_CONNECT_UI.TonConnectUI({ manifestUrl: `${location.origin}/tonconnect-manifest.json` });
      tonConnectUI.onStatusChange(wallet => {
        const address = wallet?.account?.address || '';
        const short = address ? `${address.slice(0, 7)}…${address.slice(-6)}` : 'NOT CONNECTED';
        const status = $('wallet-status');
        const addressEl = $('wallet-address');
        const button = $('wallet-connect');
        if (status) status.textContent = address ? 'Tonkeeper connected. No transaction has been sent.' : 'Connect your TON wallet securely with TON Connect.';
        if (addressEl) addressEl.textContent = short;
        if (button) button.textContent = address ? 'DISCONNECT' : 'CONNECT';
      });
    }
  } catch (e) { console.warn('TON Connect setup failed', e); }
  const $ = id => document.getElementById(id);
  // Compact coin formatting: 999 -> 999, 1,000 -> 1K, 1,100 -> 1.1K.
  // Keep whole values free of decimal places and use K/M/B/T for large balances.
  const fmt = value => {
    const n = Math.floor(Number(value) || 0);
    if (Math.abs(n) < 1000) return String(n);
    const units = [
      { value: 1e33, suffix: 'Dc' },
      { value: 1e30, suffix: 'No' },
      { value: 1e27, suffix: 'Oc' },
      { value: 1e24, suffix: 'Sp' },
      { value: 1e21, suffix: 'Sx' },
      { value: 1e18, suffix: 'Qi' },
      { value: 1e15, suffix: 'Qa' },
      { value: 1e12, suffix: 'T' },
      { value: 1e9, suffix: 'B' },
      { value: 1e6, suffix: 'M' },
      { value: 1e3, suffix: 'K' }
    ];
    for (const unit of units) {
      if (Math.abs(n) >= unit.value) {
        const scaled = n / unit.value;
        const rounded = Math.round(scaled * 10) / 10;
        const label = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
        return `${label}${unit.suffix}`;
      }
    }
    return String(n);
  };
  const headers = { 'Content-Type':'application/json', 'X-Telegram-Init-Data':initData, 'X-Null-Demo-Id': demoId };
  function toast(msg) { const el=$('toast'); el.textContent=msg; el.classList.add('show'); clearTimeout(toast.timer); toast.timer=setTimeout(()=>el.classList.remove('show'),2300); }
  async function api(url, body = null) {
    const opts = { method:body===null?'GET':'POST', headers };
    if (body!==null) opts.body=JSON.stringify({...body, demoId, demoName:tgUser ? [tgUser.first_name,tgUser.last_name].filter(Boolean).join(' ') : 'Demo Player', startParam});
    const r=await fetch(url,opts); const data=await r.json();
    if(!r.ok) { if(data.user && state) state.user=data.user; throw new Error(data.error||'Request failed'); }
    return data;
  }
  async function refresh() { try { state=await api('/api/state'); render(); } catch(e) { toast(e.message); } }
  const LEAGUES = [
    {id:'bronze',name:'Bronze',min:1,max:99999,color:'#cd8b55',next:100000},
    {id:'silver',name:'Silver',min:100000,max:999999,color:'#c7d0dc',next:1000000},
    {id:'gold',name:'Gold',min:1000000,max:9999999,color:'#f4c44e',next:10000000},
    {id:'crystal',name:'Crystal',min:10000000,max:99999999,color:'#bd79ff',next:100000000},
    {id:'legendary',name:'Legendary',min:100000000,max:null,color:'#79c5ff',next:null}
  ];
  function leagueFor(coins) { const n=Math.max(0,Number(coins)||0); return [...LEAGUES].reverse().find(l=>n>=l.min)||LEAGUES[0]; }
  function renderLeague(league) {
    const l=LEAGUES.find(x=>x.id===league?.id)||leagueFor(state?.user?.coins||0);
    const card=$('league-card'); if(!card)return;
    card.className=`league-card ${l.id}`; card.style.setProperty('--league-color',l.color);
    $('league-name').textContent=`${l.name} League`;
    $('league-cup').innerHTML=`<svg class="league-trophy" viewBox="0 0 64 64" aria-hidden="true"><path d="M18 8h28v11c0 13-6 21-14 21S18 32 18 19V8Zm-8 4h8v8c0 8 4 13 9 15-11 0-17-7-17-18v-5Zm44 0h-8v8c0 8-4 13-9 15 11 0 17-7 17-18v-5ZM28 40h8v8h10v8H18v-8h10v-8Z" fill="currentColor"/></svg>`;
    $('league-range').textContent=l.max===null?'100,000,000+ NULL':`${fmt(l.id==='bronze'?1:l.min)}–${fmt(l.max)} NULL`;
    const coins=Math.max(0,Number(state?.user?.coins)||0);
    const progress=l.max===null?100:Math.max(0,Math.min(100,((coins-l.min)/(l.next-l.min))*100));
    $('league-progress-bar').style.width=`${progress}%`;
    $('league-next').textContent=`Entry reward: +${fmt(l.reward||({bronze:1000,silver:10000,gold:100000,crystal:500000,legendary:1000000}[l.id]||0))} NULL (once) · `+(l.next===null?'MAX LEAGUE · YOU ARE LEGENDARY':`${fmt(Math.max(0,l.next-coins))} NULL to ${LEAGUES[LEAGUES.findIndex(x=>x.id===l.id)+1]?.name||'next league'}`);
  }
  function renderSquads() {
    if(!state)return;
    const panel=$('squad-panel'); if(!panel)return;
    const squad=state.squad;
    if(squad) {
      panel.innerHTML=`<div class="squad-active"><div class="squad-banner"><div class="squad-icon">♟</div><div><div class="league-kicker">YOUR SQUAD</div><h3>${escapeHtml(squad.name)}</h3><p>${squad.memberCount} member${squad.memberCount===1?'':'s'} · ${fmt(squad.totalCoins)} NULL total</p></div><span class="squad-badge">GROUP</span></div><div class="squad-member-list">${(squad.members||[]).map(m=>`<div class="squad-member"><span class="rank">#${m.rank}</span><span>${escapeHtml(m.name)}</span><b>${fmt(m.coins)} NULL</b></div>`).join('')}</div><button class="primary-button leave-squad" id="leave-squad">LEAVE SQUAD</button></div>`;
    } else {
      const options=(state.squadLeaderboard||[]).map(sq=>`<div class="squad-option"><div><b>${escapeHtml(sq.name)}</b><small>${sq.memberCount} members · ${fmt(sq.totalCoins)} NULL</small></div><button class="join-squad" data-squad-id="${escapeHtml(sq.id)}">JOIN</button></div>`).join('');
      panel.innerHTML=`<div class="squad-empty"><div class="squad-icon">♟</div><h3>Join a Squad</h3><p>Create a group with friends or join an existing squad to climb together.</p><input id="squad-name" maxlength="24" placeholder="Squad name (3–24 characters)" autocomplete="off"><button class="primary-button" id="create-squad">CREATE SQUAD</button><div class="squad-divider">OR JOIN A SQUAD</div><div id="squad-options" class="squad-options">${options||'<p class="muted">No squads yet. Create the first one!</p>'}</div></div>`;
    }
    const board=$('squad-leaderboard'); if(board) board.innerHTML=(state.squadLeaderboard||[]).map((sq,i)=>`<div class="leader-row"><span class="rank">#${i+1}</span><span class="leader-name">${escapeHtml(sq.name)} <small class="squad-count">${sq.memberCount} members</small></span><span class="leader-coins">${fmt(sq.totalCoins)} NULL</span></div>`).join('')||'<div class="leader-row">No squads yet</div>';
  }
  function render() {
    if(!state)return; const u=state.user;
    $('coins').textContent=fmt(u.coins); renderLeague(state.league || u.league || leagueFor(u.coins)); renderSquads();
    const pool=state.miningPool||{mined:0,cap:5e15,full:false};
    const poolMined=Math.max(0,Number(pool.mined)||0), poolCap=Math.max(1,Number(pool.cap)||5e15);
    $('wnull-pool-count').textContent=`${fmt(poolMined)} / ${fmt(poolCap)}`;
    $('wnull-pool-bar').style.width=`${Math.min(100,Math.max(0,poolMined/poolCap*100))}%`;
    $('wnull-pool-percent').textContent=pool.full||poolMined>=poolCap?'POOL FULL · MINING STOPPED':`${(poolMined/poolCap*100).toFixed(6)}% MINED`;
    $('wnull-pool-balance').textContent=fmt(u.wnull||0);
    $('wnull-pool-status').textContent=(u.autoLevel>0 && !(pool.full||poolMined>=poolCap))?'AUTO MINING · ONLINE / OFFLINE':'AUTO MINING '+((pool.full||poolMined>=poolCap)?'ENDED':'INACTIVE');
    $('tap-level-label').textContent=`TAP POWER · LVL ${u.tapLevel}`;
    const refillSeconds = u.energyRefillAt ? Math.max(0, Math.ceil((u.energyRefillAt-Date.now())/1000)) : 0; $('energy-label').textContent=u.energyRefillAt && u.energy < u.maxEnergy ? `ENERGY ${fmt(u.energy)}/${fmt(u.maxEnergy)} · FULL IN ${refillSeconds}s` : `ENERGY ${fmt(u.energy)}/${fmt(u.maxEnergy)}`; $('energy-bar').style.width=`${Math.max(0,Math.min(100,u.energy/u.maxEnergy*100))}%`; $('coin-button').disabled = u.energy <= 0;
    const energyLeft=Math.max(0,(u.dailyBoostUses||3)-(u.dailyEnergyUses||0)), turboLeft=Math.max(0,(u.dailyBoostUses||3)-(u.dailyTurboUses||0));
    $('energy-boost-count').textContent=`${energyLeft} LEFT TODAY`; $('turbo-boost-count').textContent=`${turboLeft} LEFT TODAY`;
    $('energy-boost').disabled=energyLeft<=0 || (u.energy>=u.maxEnergy && !u.energyRefillAt);
    const turboSeconds=u.turboUntil?Math.max(0,Math.ceil((u.turboUntil-Date.now())/1000)):0;
    $('turbo-boost').disabled=turboLeft<=0 || turboSeconds>0;
    $('turbo-status').textContent=turboSeconds>0?`TURBO ACTIVE · 10× TAP · ${turboSeconds}s`:'';
    $('stat-power').textContent=`+${u.tapPower}`; $('stat-auto').textContent=u.autoLevel?`${({1:5,2:7,3:10})[u.autoLevel]}×`:'OFF'; $('stat-referrals').textContent=fmt(state.referralCount);
    const tapNext=u.tapLevel+1, energyNext=u.energyLevel+1, autoNext=u.autoLevel+1;
    $('tap-upgrade-level').textContent=`LEVEL ${u.tapLevel} / 10`; $('tap-upgrade-cost').textContent=u.tapLevel>=10?'MAX LEVEL':`${fmt((tapNext-1)*25)} NULL`;
    $('energy-upgrade-level').textContent=`LEVEL ${u.energyLevel} / 10`; $('energy-upgrade-cost').textContent=u.energyLevel>=10?'MAX LEVEL':`${fmt((energyNext-1)*25)} NULL`;
    $('auto-upgrade-level').textContent=`LEVEL ${u.autoLevel} / 3`; $('auto-title').textContent=u.autoLevel>=3?'Auto Tap · MAX':'Auto Tap · Level '+Math.max(1,autoNext);
    $('auto-description').textContent=u.autoLevel===0?'Activate automatic coin earning.':u.autoLevel===1?'Auto earn at 5× your tap power per second online and offline (within storage limit).':u.autoLevel===2?'Auto earn at 7× your tap power per second online and offline (within storage limit).':'Auto earn at 10× your tap power per second online and offline (within storage limit).';
    const autoCosts={1:20000,2:50000,3:100000}; $('auto-upgrade-cost').textContent=u.autoLevel>=3?'MAX LEVEL':`${fmt(autoCosts[autoNext])} NULL`;
    $('buy-tap').disabled=u.tapLevel>=10 || u.coins<(tapNext-1)*25; $('buy-tap').textContent=u.tapLevel>=10?'MAX':'UPGRADE';
    $('buy-energy').disabled=u.energyLevel>=10 || u.coins<(energyNext-1)*25; $('buy-energy').textContent=u.energyLevel>=10?'MAX':'UPGRADE';
    $('buy-auto').disabled=u.autoLevel>=3 || u.coins<(autoCosts[autoNext]||Infinity); $('buy-auto').textContent=u.autoLevel>=3?'MAX':u.autoLevel===0?'UNLOCK':'UPGRADE';
    const storageLevel=Number(u.storageLevel||1), storageCfg=state.storageLevels||{1:{hours:4,cost:0},2:{hours:6,cost:100000},3:{hours:8,cost:200000},4:{hours:12,cost:500000},5:{hours:24,cost:1000000}};
    const storageNext=storageLevel+1; $('storage-title').textContent=storageLevel>=5?'Storage · MAX':'Storage · Level '+storageLevel; $('storage-description').textContent=`Offline Auto Tap can accumulate for up to ${u.storageHours||storageCfg[storageLevel]?.hours||4} hours.`; $('storage-level-label').textContent=`LEVEL ${storageLevel} / 5`; $('storage-cost').textContent=storageLevel>=5?'MAX LEVEL':`${fmt(storageCfg[storageNext]?.cost||0)} NULL`; $('buy-storage').disabled=storageLevel>=5 || u.coins<(storageCfg[storageNext]?.cost||Infinity); $('buy-storage').textContent=storageLevel>=5?'MAX':'UPGRADE';
    $('swap-wnull-balance').textContent=fmt(u.wnull||0); $('swap-null-balance').textContent=fmt(u.coins); $('swap-rate').textContent=`1 WNull = ${Number(state.wnullSwapRate||1).toLocaleString('en-US',{maximumFractionDigits:8})} NULL`;
    $('referral-link').textContent=state.referralLink; $('referral-count').textContent=fmt(state.referralCount);
    $('task-list').innerHTML=state.tasks.map(t=>{const done=u.completedTasks.includes(t.id);const sym=t.platform==='Telegram'?'➤':t.platform==='Instagram'?'◎':t.platform==='X'?'𝕏':t.platform==='YouTube'?'▶':'✦';const opened=openedTasks.has(t.id);return `<article class="task-card"><div class="task-symbol">${sym}</div><div class="task-copy"><h3>${escapeHtml(t.title)}</h3><p>${escapeHtml(t.description)}</p><div class="task-reward">+${fmt(t.reward)} NULL</div></div><button class="task-action ${done?'done':''}" data-task="${escapeHtml(t.id)}" ${done?'disabled':''}>${done?'CLAIMED':t.id==='daily'?'CLAIM':opened?'CLAIM':'OPEN'}</button></article>`}).join('');
    const boards=state.leagueBoards||{}; const board=boards[selectedLeague]||{top100:[],userRank:null,total:0};
    $('leaderboard').innerHTML=(board.top100||[]).map(p=>`<div class="leader-row"><span class="rank">#${p.rank}</span><span class="leader-name">${escapeHtml(p.name)}</span><span class="leader-coins">${fmt(p.coins)} NULL</span></div>`).join('') || '<div class="leader-row">No players in this league yet</div>';
    $('my-league-rank').textContent=board.userRank ? `Your rank in ${selectedLeague}: #${board.userRank} · ${board.total} players` : `Your rank in ${selectedLeague}: Not in this league`;
    document.querySelectorAll('.league-tab').forEach(tab=>tab.classList.toggle('active',tab.dataset.league===selectedLeague));
    $('connection').textContent=initData?'TELEGRAM CONNECTED':'BROWSER DEMO';
  }
  function escapeHtml(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  async function act(url,body,success){if(busy)return;busy=true;try{const d=await api(url,body);if(d.user)state.user=d.user;await refresh();if(success)toast(success);else if(d.gained)toast(`+${fmt(d.gained)} NULL`);}catch(e){toast(e.message);await refresh();}finally{busy=false;}}
  const coinButton = $('coin-button');
  const activePointers = new Set();
  let queuedTaps = 0;
  let tapFlushTimer = null;
  let tapProcessing = false;

  async function flushTapQueue() {
    if (tapProcessing) return;
    tapProcessing = true;
    try {
      while (queuedTaps > 0) {
        const taps = Math.min(20, queuedTaps);
        queuedTaps -= taps;
        try {
          const data = await api('/api/tap', { taps });
          if (data.user && state) state.user = data.user;
          await refresh();
          if (data.gained) toast(`+${fmt(data.gained)} NULL`);
        } catch (err) {
          queuedTaps = 0;
          toast(err.message || 'Tap failed. Please try again.');
          await refresh();
          break;
        }
      }
    } finally {
      tapProcessing = false;
      if (queuedTaps > 0) flushTapQueue();
    }
  }

  coinButton.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (!state || state.user.energy <= 0) return;
    if (activePointers.has(e.pointerId)) return;
    if (activePointers.size >= 4) return;
    activePointers.add(e.pointerId);

    const f = document.createElement('div');
    f.className = 'tap-float';
    f.textContent = `+${state.user.tapPower * (state.user.turboUntil > Date.now() ? 10 : 1)}`;
    f.style.left = `${e.clientX - 10}px`;
    f.style.top = `${e.clientY - 15}px`;
    document.body.appendChild(f);
    setTimeout(() => f.remove(), 700);

    queuedTaps += 1;
    if (tapFlushTimer) clearTimeout(tapFlushTimer);
    tapFlushTimer = setTimeout(() => {
      tapFlushTimer = null;
      flushTapQueue();
    }, 35);
  });

  const releaseCoinPointer = e => activePointers.delete(e.pointerId);
  coinButton.addEventListener('pointerup', releaseCoinPointer);
  coinButton.addEventListener('pointercancel', releaseCoinPointer);
  coinButton.addEventListener('lostpointercapture', releaseCoinPointer);
  $('energy-boost').addEventListener('click',()=>act('/api/boost',{kind:'energy'},'Energy fully restored!'));
  $('turbo-boost').addEventListener('click',()=>act('/api/boost',{kind:'turbo'},'Turbo active: 10× tap rewards for 30 seconds!'));
  $('buy-tap').addEventListener('click',()=>act('/api/upgrade',{kind:'tap'},'Tap power upgraded!'));
  $('buy-energy').addEventListener('click',()=>act('/api/upgrade',{kind:'energy'},'Energy capacity upgraded!'));
  $('buy-auto').addEventListener('click',()=>act('/api/upgrade',{kind:'auto'},'Auto Tap upgraded!'));
  $('buy-storage').addEventListener('click',()=>act('/api/upgrade',{kind:'storage'},'Storage upgraded!'));
  document.querySelectorAll('.league-tab').forEach(btn=>btn.addEventListener('click',()=>{selectedLeague=btn.dataset.league;render();}));
  $('swap-amount').addEventListener('input',()=>{ const amount=Number($('swap-amount').value||0); const rate=Number(state?.wnullSwapRate||1); $('swap-rate').textContent=`1 WNull = ${rate.toLocaleString('en-US',{maximumFractionDigits:8})} NULL · You receive ${Math.max(0,amount*rate).toLocaleString('en-US',{maximumFractionDigits:8})} NULL`; });
  $('swap-max').addEventListener('click',()=>{ $('swap-amount').value=Number(state?.user?.wnull||0); $('swap-amount').dispatchEvent(new Event('input')); });
  $('swap-submit').addEventListener('click',()=>{const amount=Number($('swap-amount').value||0); if(!Number.isFinite(amount)||amount<1000000){toast('Minimum swap is 1,000,000 WNull.');return;} act('/api/swap',{amount},'WNull converted to NULL in the game ledger.');});
  $('task-list').addEventListener('click', async e => {
    const btn = e.target.closest('[data-task]');
    if (!btn || !state) return;
    const task = state.tasks.find(t => t.id === btn.dataset.task);
    if (!task || btn.disabled) return;
    // Open the configured social page from the user gesture, then claim immediately.
    if (task.url) window.open(task.url, '_blank', 'noopener,noreferrer');
    const label = task.id === 'daily'
      ? 'Daily reward claimed!'
      : task.id.startsWith('league_')
        ? `+${fmt(task.reward)} NULL league reward claimed!`
        : `+${fmt(task.reward)} NULL claimed!`;
    await act('/api/task/claim', { taskId: task.id }, label);
  });
  $('squad-panel')?.addEventListener('click', async e => {
    const create=e.target.closest('#create-squad');
    const join=e.target.closest('[data-squad-id]');
    const leave=e.target.closest('#leave-squad');
    if(create) { const name=$('squad-name')?.value?.trim()||''; if(name.length<3){toast('Squad name must be at least 3 characters.');return;} await act('/api/squad/create',{name},'Squad created!'); return; }
    if(join) { await act('/api/squad/join',{squadId:join.dataset.squadId},'Joined squad!'); return; }
    if(leave) { if(confirm('Leave this squad?')) await act('/api/squad/leave',{},'You left the squad.'); }
  });
  $('wallet-connect')?.addEventListener('click', async () => {
    if (!tonConnectUI) { toast('Wallet connection needs the live HTTPS site and tonconnect manifest.'); return; }
    try {
      if (tonConnectUI.wallet) await tonConnectUI.disconnect();
      else await tonConnectUI.openModal();
    } catch (e) { toast('Wallet connection cancelled or failed.'); }
  });
  $('copy-referral').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(state.referralLink);toast('Invite link copied!');}catch{toast('Copy is unavailable in this browser.');}});
  document.querySelectorAll('.nav-item').forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll('.nav-item').forEach(x=>x.classList.toggle('active',x===btn));document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===`view-${btn.dataset.view}`));}));
  refresh(); setInterval(refresh,1000);
})();
