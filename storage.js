src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2">

(function (w) {
  'use strict';

  // ================== EDIT THESE TWO VALUES ==================
  const SUPABASE_URL = 'https://zulunzihcfhmnewxvynh.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp1bHVuemloY2ZobW5ld3h2eW5oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc2ODk1MDksImV4cCI6MjA3MzI2NTUwOX0.EP_vzLfDHtqOQYHyLZ0oC-TOzQZAfQeHKMxcM6huWhA';
  // ===========================================================

  // Table names
  const TBL_STORIES  = 'stories';
  const TBL_COMMENTS = 'comments';
  const TBL_MENTIONS = 'mentions';
  const TBL_AUDIT    = 'audit';

  // Keep the same keys (unchanged)
  const STORIES_KEY  = 'crowe-user-stories-v3';
  const COMMENTS_KEY = 'crowe-user-story-comments-v2'; // { [storyId]: Comment[] }
  const MENTIONS_KEY = 'crowe-mentions-v1';
  const AUDIT_KEY    = 'crowe-audit-v1';               // { [storyId]: AuditEntry[] }

  // Local fallback (only used if Supabase isn't configured)
  let STORAGE_OK = true;
  try {
    const t = '__crowe_test__';
    localStorage.setItem(t, '1');
    localStorage.removeItem(t);
  } catch (e) {
    STORAGE_OK = false;
    console.warn('Local storage unavailable:', e);
  }

  function uuid() {
    if (w.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  // In-memory cache so callers can keep using synchronous load*() like before.
  const cache = {
    stories: [],
    commentsByStoryId: {}, // { [storyId]: Comment[] }
    mentions: [],
    auditByStoryId: {}      // { [storyId]: Audit[] }
  };

  // Utility for dispatching DOM events so your UI can react to Realtime
  function emit(name, detail) {
    try { w.dispatchEvent(new CustomEvent(name, { detail })); } catch (_) {}
  }

  // ---------- Supabase client ----------
  let supabase = null;
  let SUPABASE_READY = false;

  if (SUPABASE_URL && SUPABASE_ANON_KEY && w.supabase && w.supabase.createClient) {
    supabase = w.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
      realtime: { params: { eventsPerSecond: 5 } }
    });
  }

  async function bootstrap() {
    if (!supabase) {
      console.warn('[CroweStorage] Supabase not configured. Falling back to localStorage only.');
      // hydrate cache from localStorage so existing UI still works
      hydrateFromLocal();
      emit('CroweStorage:ready', { source: 'local' });
      return;
    }
    await Promise.all([
      refreshStories(),
      refreshComments(),
      refreshMentions(),
      refreshAudit()
    ]);
    setupRealtime();
    SUPABASE_READY = true;
    emit('CroweStorage:ready', { source: 'supabase' });
  }

  // ---------- LocalStorage fallback (only used if no Supabase) ----------
  function lsLoad(key, fallback) {
    if (!STORAGE_OK) return fallback;
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) ?? fallback) : fallback;
    } catch (e) {
      console.error('Load failed:', e);
      return fallback;
    }
  }
  function lsSave(key, value) {
    if (!STORAGE_OK) return;
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { console.error('Save failed:', e); }
  }
  function hydrateFromLocal() {
    cache.stories = lsLoad(STORIES_KEY, []);
    cache.commentsByStoryId = lsLoad(COMMENTS_KEY, {});
    cache.mentions = lsLoad(MENTIONS_KEY, []);
    cache.auditByStoryId = lsLoad(AUDIT_KEY, {});
  }

  // ---------- Fetchers (initial load / manual refresh) ----------
  async function refreshStories() {
    const { data, error } = await supabase
      .from(TBL_STORIES)
      .select('*')
      .order('updated_at_ms', { ascending: false });
    if (error) { console.error('[CroweStorage] stories fetch error', error); return; }
    cache.stories = data || [];
    emit('CroweStorage:stories', { type: 'sync', rows: cache.stories });
  }

  async function refreshComments() {
    const { data, error } = await supabase
      .from(TBL_COMMENTS)
      .select('*')
      .order('ts', { ascending: true });
    if (error) { console.error('[CroweStorage] comments fetch error', error); return; }
    const map = {};
    (data || []).forEach(c => {
      (map[c.story_id] ||= []).push(c);
    });
    cache.commentsByStoryId = map;
    emit('CroweStorage:comments', { type: 'sync', map });
  }

  async function refreshMentions() {
    const { data, error } = await supabase
      .from(TBL_MENTIONS)
      .select('*')
      .order('ts', { ascending: false });
    if (error) { console.error('[CroweStorage] mentions fetch error', error); return; }
    cache.mentions = data || [];
    emit('CroweStorage:mentions', { type: 'sync', rows: cache.mentions });
  }

  async function refreshAudit() {
    const { data, error } = await supabase
      .from(TBL_AUDIT)
      .select('*')
      .order('ts', { ascending: true });
    if (error) { console.error('[CroweStorage] audit fetch error', error); return; }
    const map = {};
    (data || []).forEach(a => {
      (map[a.story_id] ||= []).push(a);
    });
    cache.auditByStoryId = map;
    emit('CroweStorage:audit', { type: 'sync', map });
  }

  // ---------- Realtime ----------
  function setupRealtime() {
    const ch = supabase.channel('crowe-realtime');

    ch.on('postgres_changes', { event: '*', schema: 'public', table: TBL_STORIES }, (payload) => {
      const row = payload.new || payload.old;
      if (!row) return;
      if (payload.eventType === 'DELETE') {
        cache.stories = cache.stories.filter(s => s.id !== row.id);
        emit('CroweStorage:stories', { type: 'delete', row });
      } else {
        // INSERT or UPDATE: replace/insert
        const idx = cache.stories.findIndex(s => s.id === row.id);
        if (idx >= 0) cache.stories[idx] = payload.new;
        else cache.stories.unshift(payload.new);
        emit('CroweStorage:stories', { type: payload.eventType.toLowerCase(), row: payload.new });
      }
    });

    ch.on('postgres_changes', { event: '*', schema: 'public', table: TBL_COMMENTS }, (payload) => {
      const row = payload.new || payload.old;
      if (!row) return;
      const sid = row.story_id;
      cache.commentsByStoryId[sid] ||= [];
      if (payload.eventType === 'DELETE') {
        cache.commentsByStoryId[sid] = cache.commentsByStoryId[sid].filter(c => c.id !== row.id);
      } else {
        const list = cache.commentsByStoryId[sid];
        const idx = list.findIndex(c => c.id === row.id);
        if (idx >= 0) list[idx] = payload.new;
        else list.push(payload.new);
      }
      emit('CroweStorage:comments', { type: payload.eventType.toLowerCase(), row: payload.new || payload.old });
    });

    ch.on('postgres_changes', { event: '*', schema: 'public', table: TBL_MENTIONS }, (payload) => {
      const row = payload.new || payload.old;
      if (!row) return;
      if (payload.eventType === 'DELETE') {
        cache.mentions = cache.mentions.filter(m => m.id !== row.id);
      } else {
        const idx = cache.mentions.findIndex(m => m.id === row.id);
        if (idx >= 0) cache.mentions[idx] = payload.new;
        else cache.mentions.unshift(payload.new);
      }
      emit('CroweStorage:mentions', { type: payload.eventType.toLowerCase(), row: payload.new || payload.old });
    });

    ch.on('postgres_changes', { event: '*', schema: 'public', table: TBL_AUDIT }, (payload) => {
      const row = payload.new || payload.old;
      if (!row) return;
      const sid = row.story_id;
      cache.auditByStoryId[sid] ||= [];
      if (payload.eventType === 'DELETE') {
        cache.auditByStoryId[sid] = cache.auditByStoryId[sid].filter(a => a.id !== row.id);
      } else {
        const list = cache.auditByStoryId[sid];
        const idx = list.findIndex(a => a.id === row.id);
        if (idx >= 0) list[idx] = payload.new;
        else list.push(payload.new);
      }
      emit('CroweStorage:audit', { type: payload.eventType.toLowerCase(), row: payload.new || payload.old });
    });

    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log('[CroweStorage] Realtime subscribed');
      }
    });
  }

  // ---------- Upsert/Delete helpers implementing "full replace" semantics ----------
  async function deleteStory(id){
    // optimistic cache update for snappy UI
    cache.stories = cache.stories.filter(s => s.id !== id);
    emit('CroweStorage:stories', { type: 'delete', row: { id } });

    if (!supabase) { lsSave(STORIES_KEY, cache.stories); return; }

    const { error } = await supabase.from(TBL_STORIES).delete().eq('id', id);
    if (error) {
      console.error('[CroweStorage] delete story error', error);
      // Re-sync to correct the cache if delete failed
      await refreshStories();
    }
  }
  async function syncTable(table, newRows, idField = 'id') {
    // Upsert everything
    if (newRows.length) {
      const { error: upErr } = await supabase.from(table).upsert(newRows, { onConflict: idField });
      if (upErr) console.error(`[CroweStorage] upsert error for ${table}`, upErr);
    }

    // Find and delete rows that are no longer present
    const existingIds = new Set(
      (await supabase.from(table).select(idField)).data?.map(r => r[idField]) || []
    );
    const keepIds = new Set(newRows.map(r => r[idField]));
    const toDelete = [...existingIds].filter(id => !keepIds.has(id));
    if (toDelete.length) {
      const { error: delErr } = await supabase.from(table).delete().in(idField, toDelete);
      if (delErr) console.error(`[CroweStorage] delete error for ${table}`, delErr);
    }
  }

  // ---------- Public API (unchanged names) ----------
  // NOTE: load*() remain synchronous (return current cache immediately).
  // save*() will:
  //   1) update cache immediately for snappy UI
  //   2) write to Supabase in the background
  //   3) Realtime will reconcile across tabs/clients
  

  const CroweStorage = {
    ok: !!supabase, // true when Supabase client is configured
    uuid,
    keys: { STORIES_KEY, COMMENTS_KEY, MENTIONS_KEY, AUDIT_KEY },

    // Stories
    loadStories() { return cache.stories; },
    saveStories(stories) {
      // Optimistic cache update
      cache.stories = Array.isArray(stories) ? [...stories] : [];
      emit('CroweStorage:stories', { type: 'sync', rows: cache.stories });

      if (!supabase) { lsSave(STORIES_KEY, cache.stories); return; }

      // Normalize: ensure id + timestamps exist
      const now = Date.now();
      const rows = cache.stories.map(s => ({
        id: s.id || uuid(),
        regressionItem: s.regressionItem ?? '',
        description: s.description ?? '',
        testScript: s.testScript ?? '',
        acceptance: s.acceptance ?? '',
        comments: s.comments ?? '',
        testerComments: s.testerComments ?? '',
        personas: s.personas ?? '',
        reportedBy: s.reportedBy ?? '',
        reportedDate: s.reportedDate ?? null,
        priority: s.priority ?? null,
        status: s.status ?? null,
        owner: s.owner ?? null,
        loe: s.loe ?? null,
        created_at_ms: s.created_at_ms ?? now,
        updated_at_ms: now,
        lastEditedBy: s.lastEditedBy ?? null
      }));

      (async () => {
        await syncTable(TBL_STORIES, rows, 'id');
        // Refresh for authoritative order after server write
        await refreshStories();
      })();
    },
    
    // Comments per story: { [storyId]: Comment[] }
    loadComments() { return cache.commentsByStoryId; },
    deleteStory,
    saveComments(map) {
      cache.commentsByStoryId = map && typeof map === 'object' ? { ...map } : {};
      emit('CroweStorage:comments', { type: 'sync', map: cache.commentsByStoryId });

      if (!supabase) { lsSave(COMMENTS_KEY, cache.commentsByStoryId); return; }

      const now = Date.now();
      const flat = [];
      for (const [story_id, list] of Object.entries(cache.commentsByStoryId)) {
        (list || []).forEach(c => {
          flat.push({
            id: c.id || uuid(),
            story_id,
            parent_id: c.parent_id ?? null,
            author_name: c.author_name ?? null,
            author_id: c.author_id ?? null,
            text: c.text ?? '',
            ts: c.ts ?? now
          });
        });
      }

      (async () => {
        await syncTable(TBL_COMMENTS, flat, 'id');
        await refreshComments();
      })();
    },

    // Mentions list
    loadMentions() { return cache.mentions; },
    saveMentions(list) {
      cache.mentions = Array.isArray(list) ? [...list] : [];
      emit('CroweStorage:mentions', { type: 'sync', rows: cache.mentions });

      if (!supabase) { lsSave(MENTIONS_KEY, cache.mentions); return; }

      const now = Date.now();
      const rows = cache.mentions.map(m => ({
        id: m.id || uuid(),
        story_id: m.story_id,
        reg: m.reg,
        field: m.field,
        value: m.value,
        actor_id: m.actor_id ?? null,
        actor_name: m.actor_name ?? null,
        target_id: m.target_id ?? null,
        target_name: m.target_name ?? null,
        ts: m.ts ?? now,
        unread: typeof m.unread === 'boolean' ? m.unread : true
      }));

      (async () => {
        await syncTable(TBL_MENTIONS, rows, 'id');
        await refreshMentions();
      })();
    },

    // Audit by story: { [storyId]: AuditEntry[] }
    loadAudit() { return cache.auditByStoryId; },
    saveAudit(map) {
      cache.auditByStoryId = map && typeof map === 'object' ? { ...map } : {};
      emit('CroweStorage:audit', { type: 'sync', map: cache.auditByStoryId });

      if (!supabase) { lsSave(AUDIT_KEY, cache.auditByStoryId); return; }

      const now = Date.now();
      const flat = [];
      for (const [story_id, list] of Object.entries(cache.auditByStoryId)) {
        (list || []).forEach(a => {
          flat.push({
            id: a.id || uuid(),
            story_id,
            ts: a.ts ?? now,
            field: a.field ?? '',
            old_val: a.old_val ?? null,
            new_val: a.new_val ?? null,
            user_id: a.user_id ?? null
          });
        });
      }

      (async () => {
        await syncTable(TBL_AUDIT, flat, 'id');
        await refreshAudit();
      })();
    }
  };

  // Expose
  w.CroweStorage = Object.freeze(CroweStorage);

  // Boot
  bootstrap();

})(window);

