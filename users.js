
 src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2">


(function(w){
  'use strict';

  // ================== EDIT THESE TWO VALUES ==================
  const SUPABASE_URL = 'https://zulunzihcfhmnewxvynh.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp1bHVuemloY2ZobW5ld3h2eW5oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc2ODk1MDksImV4cCI6MjA3MzI2NTUwOX0.EP_vzLfDHtqOQYHyLZ0oC-TOzQZAfQeHKMxcM6huWhA';
  // ===========================================================

  // --- Table names ---
  const TBL_USERS = 'users';
  const TBL_DEVICE_MAP = 'device_map';

  // --- Local-only keys (device id stays local like before) ---
  const DEVICE_KEY  = 'crowe-device-id-v1';

  // --- Supabase client ---
  let supabase = null;
  if (SUPABASE_URL && SUPABASE_ANON_KEY && w.supabase?.createClient) {
    supabase = w.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
      realtime: { params: { eventsPerSecond: 5 } }
    });
  } else {
    console.warn('[CroweUsers] Supabase not configured or library missing. The module will still work, but won’t persist to a server.');
  }

  // --- Cache to keep API synchronous like before ---
  let usersCache = [];            // Array<{id, firstName, lastName, email, createdAt}>
  let deviceMapCache = {};        // { [deviceId]: userId }

  // --- Helpers ---
  function emit(name, detail){ try{ w.dispatchEvent(new CustomEvent(name, { detail })); }catch{} }

  function uuid(){
    if (w.crypto?.randomUUID) return crypto.randomUUID();
    return 'u-' + Math.random().toString(36).slice(2);
  }

  // device id (local, unchanged behavior)
  function getDeviceId(){
    try{
      let id = localStorage.getItem(DEVICE_KEY);
      if (!id){ id = 'dev-' + uuid(); localStorage.setItem(DEVICE_KEY, id); }
      return id;
    }catch{
      // fallback if localStorage blocked
      return 'dev-' + uuid();
    }
  }

  // normalize shapes used by your app
  function normalizeUser(u){
    return {
      id: u.id || uuid(),
      firstName: String(u.firstName ?? u.first_name ?? '').trim(),
      lastName:  String(u.lastName  ?? u.last_name  ?? '').trim(),
      email:     String(u.email ?? '').trim().toLowerCase(),
      createdAt: Number(u.createdAt ?? u.created_at_ms ?? Date.now())
    };
  }

  // --- Initial fetch / refreshers ---
  async function refreshUsers(){
    if (!supabase) return;
    const { data, error } = await supabase.from(TBL_USERS).select('*').order('created_at_ms', { ascending: true });
    if (error){ console.error('[CroweUsers] users fetch error', error); return; }
    usersCache = (data||[]).map(normalizeUser);
    emit('CroweUsers:users', usersCache);
  }

  async function refreshDeviceMap(){
    if (!supabase) return;
    const { data, error } = await supabase.from(TBL_DEVICE_MAP).select('*');
    if (error){ console.error('[CroweUsers] device_map fetch error', error); return; }
    const map = {};
    (data||[]).forEach(r => { map[String(r.device_id)] = r.user_id; });
    deviceMapCache = map;
    emit('CroweUsers:device-map', deviceMapCache);
  }

  // --- Realtime subscriptions ---
  function setupRealtime(){
    if (!supabase) return;
    const ch = supabase.channel('crowe-users-rt');

    ch.on('postgres_changes', { event: '*', schema: 'public', table: TBL_USERS }, payload => {
      const row = payload.new || payload.old; if (!row) return;
      const u = normalizeUser(payload.new || row);
      if (payload.eventType === 'DELETE'){
        usersCache = usersCache.filter(x => x.id !== row.id);
      } else {
        const i = usersCache.findIndex(x => x.id === u.id);
        if (i >= 0) usersCache[i] = u; else usersCache.push(u);
      }
      emit('CroweUsers:users', usersCache.slice());
    });

    ch.on('postgres_changes', { event: '*', schema: 'public', table: TBL_DEVICE_MAP }, payload => {
      const row = payload.new || payload.old; if (!row) return;
      if (payload.eventType === 'DELETE'){
        delete deviceMapCache[row.device_id];
      } else {
        deviceMapCache[row.device_id] = row.user_id;
      }
      emit('CroweUsers:device-map', { ...deviceMapCache });
    });

    ch.subscribe(status => { if (status === 'SUBSCRIBED') console.log('[CroweUsers] Realtime subscribed'); });
  }

  // --- Sync helpers (treat saveUsers/saveDeviceMap like “replace whole collection”) ---
  async function syncUsers(allUsers){
    if (!supabase) return;
    const rows = allUsers.map(u => ({
      id: u.id || uuid(),
      first_name: u.firstName.trim(),
      last_name:  u.lastName.trim(),
      email:      String(u.email).trim().toLowerCase(),
      created_at_ms: Number(u.createdAt ?? Date.now())
    }));
    // Upsert
    if (rows.length){
      const { error } = await supabase.from(TBL_USERS).upsert(rows, { onConflict: 'id' });
      if (error) console.error('[CroweUsers] users upsert error', error);
    }
    // Delete those not present
    const { data: existing, error: selErr } = await supabase.from(TBL_USERS).select('id');
    if (!selErr){
      const keep = new Set(rows.map(r => r.id));
      const toDel = (existing||[]).map(r => r.id).filter(id => !keep.has(id));
      if (toDel.length){
        const { error: delErr } = await supabase.from(TBL_USERS).delete().in('id', toDel);
        if (delErr) console.error('[CroweUsers] users delete error', delErr);
      }
    }
  }

  async function syncDeviceMap(mapObj){
    if (!supabase) return;
    const rows = Object.entries(mapObj).map(([device_id, user_id]) => ({
      device_id, user_id, mapped_at_ms: Date.now()
    }));
    // Upsert
    if (rows.length){
      const { error } = await supabase.from(TBL_DEVICE_MAP).upsert(rows, { onConflict: 'device_id' });
      if (error) console.error('[CroweUsers] device_map upsert error', error);
    }
    // Delete those not present
    const { data: existing, error: selErr } = await supabase.from(TBL_DEVICE_MAP).select('device_id');
    if (!selErr){
      const keep = new Set(rows.map(r => r.device_id));
      const toDel = (existing||[]).map(r => r.device_id).filter(id => !keep.has(id));
      if (toDel.length){
        const { error: delErr } = await supabase.from(TBL_DEVICE_MAP).delete().in('device_id', toDel);
        if (delErr) console.error('[CroweUsers] device_map delete error', delErr);
      }
    }
  }

  // --- Public API (same function names) ---
  // All functions remain synchronous for your app; writes happen async and then Realtime reconciles.
  function listUsers(){ return usersCache.slice(); }

  function saveUsers(users){
    usersCache = (Array.isArray(users) ? users : []).map(normalizeUser);
    if (supabase){ (async()=>{ await syncUsers(usersCache); await refreshUsers(); })(); }
  }

  function getDeviceMap(){ return { ...deviceMapCache }; }

  function saveDeviceMap(m){
    deviceMapCache = { ...(m || {}) };
    if (supabase){ (async()=>{ await syncDeviceMap(deviceMapCache); await refreshDeviceMap(); })(); }
  }

  function addUser({ firstName, lastName, email }){
    const clean = normalizeUser({ firstName, lastName, email, createdAt: Date.now() });
    // prevent dup by email (case-insensitive)
    const exists = usersCache.find(u => u.email === clean.email);
    if (exists) return exists;
    usersCache.push(clean);
    if (supabase){ (async()=>{ await syncUsers(usersCache); })(); }
    return clean;
  }

  function findUserByEmail(email){
    const e = String(email||'').trim().toLowerCase();
    return usersCache.find(u => u.email === e);
  }

  function getUserById(id){
    return usersCache.find(u => u.id === id);
  }

  function mapDeviceToUser(deviceId, userId){
    deviceMapCache[String(deviceId)] = userId;
    if (supabase){ (async()=>{ 
      const { error } = await supabase.from(TBL_DEVICE_MAP).upsert([{ device_id: String(deviceId), user_id: userId, mapped_at_ms: Date.now() }], { onConflict: 'device_id' });
      if (error) console.error('[CroweUsers] mapDeviceToUser upsert error', error);
    })();}
  }

  function userForDevice(deviceId){
    const uid = deviceMapCache[String(deviceId)];
    if (!uid) return null;
    return getUserById(uid) || null;
  }

  // Expose
  w.CroweUsers = Object.freeze({
    // same methods as before
    listUsers, saveUsers,
    getDeviceId, getDeviceMap, saveDeviceMap,
    addUser, findUserByEmail, userForDevice, mapDeviceToUser,
    getUserById
  });

  // Bootstrap
  (async function boot(){
    if (supabase){
      await Promise.all([refreshUsers(), refreshDeviceMap()]);
      setupRealtime();
    }
    emit('CroweUsers:ready', { source: supabase ? 'supabase' : 'local' });
  })();

})(window);
