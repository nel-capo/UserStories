(function(){
    'use strict';
  
    const $  = (sel, el=document) => el.querySelector(sel);
    const $$ = (sel, el=document) => Array.from(el.querySelectorAll(sel));
    const statusOrder   = ['Under Review','Ready for testing','Failed QC','Passed QC'];
    const priorityOrder = ['Low','Medium','High'];
  
    // State
    let stories = [];
    let commentsByStory = {};
    let mentions = [];
    let auditByStory = {};
    let currentDetailId = null;
    let currentUser = null;
    let sortKey = null, sortDir = 1;
    let fsActive = false;
  
    // Els
    const els = {
      headerNotify: $('#notify'),
      notifyBtn: $('#notifyBtn'),
      notifyDot: $('#notifyDot'),
      notifyList: $('#notifyList'),
  
      // Summary / filters
      summaryCards: $('#summaryCards'),
      seg: { review: $('#seg-review'), ready: $('#seg-ready'), failed: $('#seg-failed'), passed: $('#seg-passed') },
  
      // Dynamic filter builder
      filterBuilder: $('#filterBuilder'),
      addFilterSelect: $('#addFilterSelect'),
      addFilterBtn: $('#addFilterBtn'),
      filtersWrap: $('#filtersWrap'),
      clearFilters: $('#clearFilters'),
  
      // Create form
      createPanel: $('#createPanel'),
      createForm: $('#createForm'),
      regressionItem: $('#regressionItem'),
      reportedDate: $('#reportedDate'),
      priority: $('#priority'),
      status: $('#status'),
      reportedBy: $('#reportedBy'),
      owner: $('#owner'),
      personas: $('#personas'),
      loe: $('#loe'),
      description: $('#description'),
      testScript: $('#testScript'),
      acceptance: $('#acceptance'),
      comments: $('#comments'),
      testerComments: $('#testerComments'),
  
      // List/table
      listPanel: $('#listPanel'),
      tbody: $('#tbody'),
      emptyState: $('#emptyState'),
      tableWrap: $('#tableWrap'),
      tableScroll: $('#tableScroll'),
      hoverLeft: $('#tableScroll .hover-zone.left'),
      hoverRight: $('#tableScroll .hover-zone.right'),
      rowCount: $('#rowCount'),
      sortField: $('#sortField'),
      sortDirBtn: $('#sortDirBtn'),
      fsBtn: $('#fsTableBtn'),
      fsDetailPane: $('#fsDetailPane'),
  
      // Detail view (also used inside FS)
      summaryPanel: $('#summaryPanel'),
      detailView: $('#detailView'),
      detailTitle: $('#detailTitle'),
      detailBody: $('#detailBody'),
      backToList: $('#backToList'),
      detailDelete: $('#detailDelete'),
  
      // Comments
      commentsPanel: $('#commentsPanel'),
      commentsThread: $('#commentsThread'),
      commentForm: $('#commentForm'),
      commentAuthor: $('#commentAuthor'),
      commentText: $('#commentText'),
      commentParentId: $('#commentParentId'),
      cancelReplyBtn: $('#cancelReplyBtn'),
  
      // Toasts
      toastWrap: $('#toastWrap'),
    };
  
    // ----- Utility -----
    function showToast(msg, type='success'){
      const t = document.createElement('div');
      t.className = 'toast ' + type;
      t.textContent = msg;
      els.toastWrap.appendChild(t);
      setTimeout(()=>{ t.remove(); }, 3200);
    }
    function escapeHtml(s){
      return String(s||'')
        .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
        .replaceAll('"','&quot;').replaceAll("'",'&#039;');
    }
    function textToHtml(s){ return escapeHtml(s).replace(/\n/g, '<br>'); }
    function formatDate(d){ if(!d) return ''; try{const dt=new Date(d);return dt.toLocaleDateString(undefined,{year:'numeric',month:'short',day:'2-digit'});}catch{return d;} }
    function priClass(p){ const v=String(p||'').toLowerCase(); if(v.startsWith('h'))return 'high'; if(v.startsWith('m'))return 'medium'; return 'low'; }
    function statusClass(s){ const v=String(s||'').toLowerCase(); if(v.startsWith('passed'))return 'pqc'; if(v.startsWith('failed'))return 'fqc'; if(v.startsWith('ready'))return 'rft'; return 'ur'; }
    function isFs(){ return document.fullscreenElement === els.listPanel; }
    function saveStoriesMerged(){
      const server = (CroweStorage.loadStories() || []).map(normalizeStory);
      const byId = new Map(server.map(s => [s.id, s]));
      stories.forEach(s => byId.set(s.id, s)); // your edits win
      const merged = Array.from(byId.values());
      CroweStorage.saveStories(merged);
    }
    
    // ----- Model -----
    function normalizeStory(st){
      return {
        id: st.id || CroweStorage.uuid(),
        regressionItem: Number(st.regressionItem ?? 0),
        description: String(st.description ?? ''),
        testScript: String(st.testScript ?? ''),
        acceptance: String(st.acceptance ?? ''),
        comments: String(st.comments ?? ''),
        testerComments: String(st.testerComments ?? ''),
        personas: String(st.personas ?? ''),
        reportedBy: String(st.reportedBy ?? ''),
        reportedDate: st.reportedDate || new Date().toISOString().slice(0,10),
        priority: st.priority || 'Medium',
        status: st.status || 'Under Review',
        owner: String(st.owner ?? ''),
        loe: (st.loe===''||st.loe==null) ? '' : Number(st.loe),
        createdAt: st.createdAt || Date.now(),
        updatedAt: st.updatedAt || Date.now(),
        lastEditedBy: st.lastEditedBy || null
      };
    }
    function validationErrors(st){
      const e=[];
      if (!st.regressionItem && st.regressionItem!==0) e.push('Regression Item # is required.');
      if (isNaN(Number(st.regressionItem))) e.push('Regression Item # must be a number.');
      if (!st.description.trim()) e.push('Description is required.');
      if (!st.acceptance.trim()) e.push('Acceptance Criteria is required.');
      if (!st.reportedBy.trim()) e.push('Reported By is required.');
      if (!st.owner.trim()) e.push('Crowe Owner is required.');
      if (!st.reportedDate) e.push('Reported Date is required.');
      if (!st.priority) e.push('Priority is required.');
      if (!st.status) e.push('Status is required.');
      return e;
    }
  
    // ----- Storage wrappers -----
    function loadAll(){
      stories        = (CroweStorage.loadStories() || []).map(normalizeStory);
      commentsByStory= CroweStorage.loadComments() || {};
      mentions       = CroweStorage.loadMentions() || [];
      auditByStory   = CroweStorage.loadAudit() || {};
    }
    function saveStories(){ CroweStorage.saveStories(stories); }
    function saveComments(){ CroweStorage.saveComments(commentsByStory); }
    function saveMentions(){ CroweStorage.saveMentions(mentions); }
    function saveAudit(){ CroweStorage.saveAudit(auditByStory); }
  
    // ----- Mentions & Audit -----
    function allUsers(){ return window.CroweUsers.listUsers(); }
    function displayName(u){ return u ? `${u.firstName} ${u.lastName}` : 'Unknown'; }
    function extractMentions(text){
      const users = allUsers();
      const tokens = new Set();
      const re = /@([\w.\-%+@]+)\b/g;
      let m; while((m=re.exec(text||''))){ tokens.add(m[1].toLowerCase()); }
      const targets = [];
      tokens.forEach(tok=>{
        // match by email
        let matched = users.find(u=> u.email.toLowerCase()===tok);
        if (!matched){
          // match by first name or "firstlast" collapsed
          matched = users.find(u=> u.firstName.toLowerCase()===tok || (u.firstName+u.lastName).toLowerCase()===tok);
        }
        if (matched) targets.push(matched);
      });
      return targets;
    }
    function addMention({story, field, value, actor, targets}){
      const snippet = String(value||'').slice(0,140);
      const reg = story.regressionItem;
      const ts  = Date.now();
      targets.forEach(t=>{
        mentions.unshift({
          id: CroweStorage.uuid(),
          storyId: story.id,
          reg,
          field,
          value: snippet,
          actorId: actor.id,
          actorName: displayName(actor),
          targetId: t.id,
          targetName: displayName(t),
          ts,
          unread: true
        });
      });
      mentions = mentions.slice(0,500); // keep a cap
      saveMentions();
      updateNotifyUI();
    }
    function addAudit({storyId, field, oldVal, newVal, userId}){
      const list = (auditByStory[storyId] ||= []);
      list.unshift({ id:CroweStorage.uuid(), ts:Date.now(), field, oldVal, newVal, userId });
      auditByStory[storyId] = list.slice(0,200);
      saveAudit();
    }
  
    // ----- Summary / counts -----
    function buildSummary(){
      const c = { total: stories.length, review:0, ready:0, failed:0, passed:0 };
      stories.forEach(s=>{
        const v=s.status.toLowerCase();
        if (v.startsWith('under')) c.review++;
        else if (v.startsWith('ready')) c.ready++;
        else if (v.startsWith('failed')) c.failed++;
        else if (v.startsWith('passed')) c.passed++;
      });
      const mk=(label,num,val)=>`
        <div class="card">
          <h3>${label}</h3>
          <div class="num">${num}</div>
          <button type="button" data-filter-status="${val||''}">Filter list</button>
        </div>`;
      els.summaryCards.innerHTML = [
        mk('Under Review', c.review, 'Under Review'),
        mk('Ready for testing', c.ready, 'Ready for testing'),
        mk('Failed QC', c.failed, 'Failed QC'),
        mk('Passed QC', c.passed, 'Passed QC'),
        mk('Total', c.total, '')
      ].join('');
      const total = Math.max(c.total,1);
      $('#seg-review').style.width=(c.review/total*100).toFixed(2)+'%';
      $('#seg-ready').style.width =(c.ready /total*100).toFixed(2)+'%';
      $('#seg-failed').style.width=(c.failed/total*100).toFixed(2)+'%';
      $('#seg-passed').style.width=(c.passed/total*100).toFixed(2)+'%';
      $$('#summaryCards button').forEach(b=>{
        b.addEventListener('click', ()=>{
          // Quick helper: set a single status filter row
          setSingleFilter('status', b.getAttribute('data-filter-status')||'');
        });
      });
    }
  
    // ----- Dynamic Filters -----
    const filterableFields = [
      {key:'regressionItem', label:'Regression #', type:'number'},
      {key:'reportedDate',   label:'Reported Date', type:'date'},
      {key:'priority',       label:'Priority',  type:'pick', values: ()=>['Low','Medium','High']},
      {key:'status',         label:'Status',    type:'pick', values: ()=>['Under Review','Ready for testing','Failed QC','Passed QC']},
      {key:'owner',          label:'Owner',     type:'pick', values: distinctOf('owner')},
      {key:'reportedBy',     label:'Reported By', type:'pick', values: distinctOf('reportedBy')},
      {key:'personas',       label:'Personas',  type:'pick', values: distinctOf('personas')},
      {key:'loe',            label:'LOE',       type:'number'},
      {key:'description',    label:'Description contains', type:'text'},
      {key:'testScript',     label:'Test Script contains', type:'text'},
      {key:'acceptance',     label:'Acceptance contains', type:'text'},
      {key:'comments',       label:'Crowe Comments contains', type:'text'},
      {key:'testerComments', label:'Tester Comments contains', type:'text'}
    ];
    let activeFilters = []; // [{field:'status', value:'Under Review'}, ...]
  
    function distinctOf(field){
      return ()=> Array.from(new Set(stories.map(s=> String(s[field]||'').trim()).filter(Boolean))).sort();
    }
    function renderAddFilterOptions(){
      const used = new Set(activeFilters.map(f=>f.field));
      els.addFilterSelect.innerHTML = `<option value="">Add filter…</option>` + filterableFields
        .filter(f=> !used.has(f.key))
        .map(f=> `<option value="${f.key}">${f.label}</option>`).join('');
    }
    function addFilter(fieldKey, value=''){
      if (!fieldKey) return;
      if (activeFilters.find(f=>f.field===fieldKey)) return;
      activeFilters.push({field: fieldKey, value});
      renderFilters();
    }
    function removeFilter(fieldKey){
      activeFilters = activeFilters.filter(f=>f.field!==fieldKey);
      renderFilters();
    }
    function setSingleFilter(fieldKey, value){
      activeFilters = value ? [{field:fieldKey, value}] : [];
      renderFilters();
    }
    function renderFilters(){
      els.filtersWrap.innerHTML = activeFilters.map(f=>{
        const def = filterableFields.find(x=>x.key===f.field);
        const id  = `f_${f.field}`;
        let control = '';
        if (def.type==='pick'){
          const vals = def.values();
          control = `<select id="${id}" data-field="${def.key}">` +
            `<option value="">—</option>` +
            vals.map(v=> `<option${v===f.value?' selected':''}>${escapeHtml(v)}</option>`).join('') +
            `</select>`;
        }else if (def.type==='number'){
          control = `<input id="${id}" data-field="${def.key}" type="number" step="0.5" value="${escapeHtml(f.value)}">`;
        }else if (def.type==='date'){
          control = `<input id="${id}" data-field="${def.key}" type="date" value="${escapeHtml(f.value)}">`;
        }else{
          control = `<input id="${id}" data-field="${def.key}" type="text" placeholder="contains…" value="${escapeHtml(f.value)}">`;
        }
        return `
          <div class="filter-row" data-f="${def.key}">
            <strong style="min-width:160px">${escapeHtml(def.label)}</strong>
            ${control}
            <button type="button" class="btn remove" data-remove="${def.key}">✕</button>
          </div>`;
      }).join('');
      // wire control change
      els.filtersWrap.querySelectorAll('[data-field]').forEach(inp=>{
        inp.addEventListener('input', ()=>{
          const field = inp.getAttribute('data-field');
          const f = activeFilters.find(x=>x.field===field);
          if (f){ f.value = inp.value; renderList(); }
        });
      });
      els.filtersWrap.querySelectorAll('[data-remove]').forEach(btn=>{
        btn.addEventListener('click', ()=> removeFilter(btn.getAttribute('data-remove')));
      });
      renderAddFilterOptions();
      renderList();
    }
    function passFilters(st){
      for (const f of activeFilters){
        const def = filterableFields.find(x=>x.key===f.field); if (!def) continue;
        const val = f.value;
        if (def.type==='text'){
          const hay = String(st[f.field]||'').toLowerCase();
          if (!hay.includes(String(val||'').toLowerCase())) return false;
        } else if (def.type==='number'){
          if (String(val||'')==='') continue;
          if (Number(st[f.field]) !== Number(val)) return false;
        } else if (def.type==='date'){
          if (String(val||'')==='') continue;
          if (String(st[f.field]) !== String(val)) return false;
        } else { // pick
          if (String(val||'')==='' ) continue;
          if (String(st[f.field]) !== String(val)) return false;
        }
      }
      return true;
    }
  
    // ----- Sorting -----
    function sortStories(list){
      if (!sortKey) return list;
      const key=sortKey, dir=sortDir;
      const cmp=(a,b)=>{
        let va=a[key], vb=b[key];
        if (key==='reportedDate'){ va=+new Date(va); vb=+new Date(vb); }
        else if (key==='priority'){ va=priorityOrder.indexOf(a.priority); vb=priorityOrder.indexOf(b.priority); }
        else if (key==='status'){ va=statusOrder.indexOf(a.status); vb=statusOrder.indexOf(b.status); }
        else if (key==='loe'){ va=a.loe===''? -Infinity:Number(a.loe); vb=b.loe===''? -Infinity:Number(b.loe); }
        else if (key==='createdAt' || key==='updatedAt'){ va=Number(a[key]); vb=Number(b[key]); }
        else { va = String(va||'').toLowerCase(); vb = String(vb||'').toLowerCase(); }
        return (va>vb?1:va<vb?-1:0)*dir;
      };
      return list.slice().sort(cmp);
    }
    function reflectSortUI(){
      if (!els.sortField) return;
      els.sortField.value = sortKey || '';
      els.sortDirBtn.textContent = sortDir===1 ? '▲ Asc' : '▼ Desc';
    }
  
    // ----- List rendering -----
    function cellHtml(text){ return `<div class="scrollbox">${textToHtml(text)}</div>`; }
    function renderList(){
      const filtered = stories.filter(passFilters);
      const list = sortStories(filtered);
      els.rowCount.textContent = `${list.length} item${list.length!==1?'s':''}`;
      els.emptyState.style.display = list.length? 'none' : 'block';
      els.tbody.innerHTML = list.map(st=>{
        const pri = `<span class="pill ${priClass(st.priority)}">${st.priority}</span>`;
        const stat = `<span class="pill ${statusClass(st.status)}">${st.status}</span>`;
        const loe  = st.loe===''? '<span class="muted">—</span>' : `<span class="mono">${st.loe}</span>`;
        return `<tr class="row" data-id="${st.id}">
          <td class="mono">${st.regressionItem}</td>
          <td class="nowrap">${formatDate(st.reportedDate)}</td>
          <td class="col-desc">${cellHtml(st.description)}</td>
          <td class="col-acc">${cellHtml(st.acceptance)}</td>
          <td class="col-test">${cellHtml(st.testScript)}</td>
          <td>${pri}</td>
          <td>${stat}</td>
          <td>${escapeHtml(st.owner)}</td>
          <td>${escapeHtml(st.reportedBy)}</td>
          <td>${escapeHtml(st.personas)}</td>
          <td>${loe}</td>
          <td class="col-comments">${cellHtml(st.comments)}</td>
          <td class="actions-col">
            <button class="btn" data-action="duplicate" title="Duplicate">⎘</button>
            <button class="btn danger" data-action="delete" title="Delete">🗑️</button>
          </td>
        </tr>`;
      }).join('');
  
      // Row actions
      $$('#tbody .row').forEach(tr=>{
        tr.addEventListener('click', (e)=>{
          const btn = e.target.closest('button');
          const id = tr.getAttribute('data-id');
          if (btn){
            const action = btn.getAttribute('data-action');
            if (action==='delete') confirmDelete(id);
            else if (action==='duplicate') duplicateStory(id);
            return;
          }
          showDetail(id); // open detail page
        });
      });
      updateScrollHints();
    }
    function renderAll(){ buildSummary(); renderFilters(); }
  
    // ----- Detail + Inline editing -----
    function kv(k,controlHtml){ return `<div class="kv"><div class="k">${k}</div><div class="v">${controlHtml}</div></div>`; }
    function sel(field,current,opts){ return `<select data-field="${field}">${opts.map(o=>`<option${o===current?' selected':''}>${o}</option>`).join('')}</select>`; }
    function buildDetailForm(st){
      return [
        kv('Description',        `<textarea id="description2" class="longtext detail-long" data-field="description">${escapeHtml(st.description)}</textarea>`),
        kv('Test Script',        `<textarea id="testScript2"class="longtext detail-long" data-field="testScript">${escapeHtml(st.testScript)}</textarea>`),
        kv('Acceptance Criteria',`<textarea id="acceptance2" class="longtext detail-long" data-field="acceptance">${escapeHtml(st.acceptance)}</textarea>`),
        kv('Crowe Comments',     `<textarea id="comments2" class="longtext detail-long" data-field="comments">${escapeHtml(st.comments)}</textarea>`),
        kv('Tester Comments',    `<textarea id="testerComments2" class="longtext detail-long" data-field="testerComments">${escapeHtml(st.testerComments||'')}</textarea>`),
        kv('Regression Item #',  `<input type="number" min="0" class="mono" data-field="regressionItem" value="${escapeHtml(st.regressionItem)}">`),
        kv('Reported Date',      `<input type="date" data-field="reportedDate" value="${escapeHtml(st.reportedDate)}">`),
        kv('Priority',           sel('priority', st.priority, ['Low','Medium','High'])),
        kv('Status',             sel('status', st.status, ['Under Review','Ready for testing','Failed QC','Passed QC'])),
        kv('Crowe Owner',        `<input type="text" data-field="owner" value="${escapeHtml(st.owner)}">`),
        kv('Reported By',        `<input type="text" data-field="reportedBy" value="${escapeHtml(st.reportedBy)}">`),
        kv('Relevant Personas',  `<input type="text" data-field="personas" value="${escapeHtml(st.personas)}">`),
        kv('LOE',                `<input type="number" step="0.5" min="0" data-field="loe" value="${st.loe===''?'':escapeHtml(st.loe)}">`),
        kv('Created',            `<span class="muted">${new Date(st.createdAt).toLocaleString()}</span>`),
        kv('Last Updated',       `<span class="muted" id="detailUpdated">${new Date(st.updatedAt).toLocaleString()}</span>`),
        kv('Last Edited By',     `<span class="muted" id="detailEditor">${escapeHtml(st.lastEditedBy? displayName(CroweUsers.getUserById(st.lastEditedBy)):'—')}</span>`),
      ].join('');
    }
    function debounce(fn, wait=1600){ let t=null; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), wait); }; }
      function wireDetailInline(id, container){
        container.querySelectorAll('textarea.longtext').forEach(el => attachMentionAutocomplete(el));
        const saveInline = debounce((field, value)=>{
        const story = stories.find(x=>x.id===id); if (!story) return;
  
        const oldVal = story[field];
        // Apply locally
        if (field==='regressionItem'){
          const num = Number(value);
          if (Number.isNaN(num)){ showToast('Regression Item # must be a number.','error'); renderDetail(id); return; }
          const dup = stories.find(x=>x.id!==id && x.regressionItem===num);
          if (dup){ showToast(`Regression Item # ${num} already exists.`,'error'); renderDetail(id); return; }
          story.regressionItem = num;
        } else if (field==='loe'){
          story.loe = (value===''||value==null) ? '' : Number(value);
        } else if (field==='reportedDate'){
          story.reportedDate = String(value);
        } else {
          story[field] = String(value);
        }
  
        // Validate requireds when applicable
        const errs = validationErrors(story);
        if (errs.length){ showToast(errs[0],'error'); renderDetail(id); return; }
  
        // Audit + editor
        story.updatedAt = Date.now();
        story.lastEditedBy = currentUser?.id || null;
        addAudit({storyId: id, field, oldVal, newVal: story[field], userId: currentUser?.id || null});
  
        // Mentions from the new value (if any)
        const targets = extractMentions(String(value||''));
        if (targets.length){
          addMention({story, field, value, actor: currentUser, targets});
        }
  
        saveStoriesMerged(); buildSummary(); renderList();
        // Reflect header + meta
        els.detailTitle.textContent = `User Story — Reg. #${story.regressionItem}`;
        const upd = container.querySelector('#detailUpdated'); if (upd) upd.textContent=new Date(story.updatedAt).toLocaleString();
        const ed  = container.querySelector('#detailEditor'); if (ed) ed.textContent = story.lastEditedBy? displayName(CroweUsers.getUserById(story.lastEditedBy)):'—';
      }, 1650);
  
      container.querySelectorAll('[data-field]').forEach(control=>{
        const field = control.getAttribute('data-field');
        const ev = control.tagName==='SELECT' ? 'change' : 'input';
        control.addEventListener(ev, ()=> saveInline(field, control.value));
      });
        // In your detail renderer (after injecting the form HTML), run:
        container.querySelectorAll('textarea.longtext').forEach(el => attachMentionAutocomplete(el));
    }
    function renderDetailBody(id, container){
      const st = stories.find(x=>x.id===id); if (!st) return;
      container.innerHTML = buildDetailForm(st);
      container.querySelectorAll('textarea.longtext').forEach(el => attachMentionAutocomplete(el));
      wireDetailInline(id, container);
      if (container === els.detailBody){ renderCommentsThread(id); }
    }
    function renderDetail(id){
      if (!id){ return; }
      const st = stories.find(x=>x.id===id); if (!st) return;
      els.detailTitle.textContent = `User Story — Reg. #${st.regressionItem}`;
      renderDetailBody(id, els.detailBody);
    }
    function showDetail(id){
      if (!id){
        currentDetailId = null;
        if (isFs()){
          els.detailTitle.textContent='User Story';
          els.detailBody.innerHTML=`<div class="muted">Select a row on the left to view details.</div>`;
        } else {
          els.detailView.style.display='none';
          els.summaryPanel.style.display='';
          els.createPanel.style.display='';
        }
        return;
      }
      currentDetailId = id;
      if (isFs()){
        els.detailView.style.display='block';
        renderDetail(id);
      } else {
        els.detailView.style.display='block';
        els.createPanel.style.display='none';
        renderDetail(id);
      }
    }
  
    // ----- Comments (threaded, @mentions, default author) -----
    function commentObj({storyId, parentId=null, authorName, authorId, text}){
      return { id: CroweStorage.uuid(), storyId, parentId, authorName, authorId, text: String(text||''), ts: Date.now() };
    }
    function getStoryComments(storyId){ return (commentsByStory[storyId] || []).slice().sort((a,b)=> a.ts-b.ts); }
    function addComment(storyId, parentId, text){
      if (!text || !String(text).trim()){ showToast('Comment cannot be empty','error'); return; }
      const c = commentObj({storyId, parentId, authorName: displayName(currentUser), authorId: currentUser?.id || null, text});
      (commentsByStory[storyId] ||= []).push(c);
      saveComments();
      // Mentions in comment
      const story = stories.find(s=>s.id===storyId);
      const targets = extractMentions(text);
      if (targets.length){
        addMention({story, field:'comment', value:text, actor: currentUser, targets});
      }
      renderCommentsThread(storyId);
    }
    function resetReplyUI(){
      els.commentParentId.value=''; $('#replyingBadge')?.remove();
    }
    function renderCommentsThread(storyId){
      const list = getStoryComments(storyId);
      const kids = {};
      list.forEach(c=>{ (kids[c.parentId||'root'] ||= []).push(c); });
      function block(c){
        const replies = (kids[c.id]||[]).map(block).join('');
        return `
          <div class="comment-item" data-cid="${c.id}">
            <div class="comment-header">
              <strong>${escapeHtml(c.authorName||'Anonymous')}</strong>
              <span class="comment-meta">• ${new Date(c.ts).toLocaleString()}</span>
            </div>
            <div class="comment-body">${textToHtml(c.text)}</div>
            <div class="comment-actions">
              <button type="button" class="btn ghost" data-reply="${c.id}">Reply</button>
            </div>
            <div class="reply-group">${replies}</div>
          </div>`;
      }
      const roots = kids['root'] || [];
      els.commentsThread.innerHTML = roots.map(block).join('') || `<div class="muted">No comments yet. Be the first to comment.</div>`;
      els.commentsThread.querySelectorAll('[data-reply]').forEach(btn=>{
        btn.addEventListener('click', ()=>{
          els.commentParentId.value = btn.getAttribute('data-reply');
          resetReplyUI();
          const badge = document.createElement('span');
          badge.id='replyingBadge'; badge.className='replying-badge'; badge.textContent='Replying to a comment…';
          els.commentText.insertAdjacentElement('beforebegin', badge);
          els.commentText.focus();
        });
      });
    }
  
    // ----- Notifications -----
    function updateNotifyUI(){
      const mineUnread = mentions.filter(m=> m.targetId===currentUser?.id && m.unread);
      els.notifyDot.textContent = String(mineUnread.length);
      els.notifyDot.style.display = mineUnread.length ? 'block' : 'none';
  
      const list = mentions.slice(0,40).map(m=>{
        const you = m.targetId===currentUser?.id ? ' (you)' : '';
        return `<div class="notify-item" data-mid="${m.id}">
          <div><strong>@${escapeHtml(m.targetName)}</strong>${you} tagged by <strong>${escapeHtml(m.actorName)}</strong></div>
          <div class="meta">Reg #${m.reg} • ${escapeHtml(m.field)} → <span title="${escapeHtml(m.value)}">${escapeHtml(m.value)}</span> • ${new Date(m.ts).toLocaleString()}</div>
        </div>`;
      }).join('') || `<div class="notify-item">No recent @tags.</div>`;
      els.notifyList.innerHTML = `
        <div style="padding:10px 12px; border-bottom:1px solid #eee; font-weight:700; color:#032d60">Recent @tags</div>
        ${list}
        <div style="padding:8px; text-align:right"><button class="btn" id="markReadBtn" type="button">Mark mine read</button></div>
      `;
      $('#markReadBtn')?.addEventListener('click', ()=>{
        mentions.forEach(m=>{ if (m.targetId===currentUser?.id) m.unread=false; });
        saveMentions(); updateNotifyUI();
      });
    }
  
    // ----- Hover scroll & FS -----
    function initHoverScroll(){
      let raf = null;
      const speed = 12;
      function start(dir){
        if (raf) cancelAnimationFrame(raf);
        const step = ()=>{
          els.tableWrap.scrollLeft += dir * speed;
          raf = requestAnimationFrame(step);
          updateScrollHints();
        };
        raf = requestAnimationFrame(step);
      }
      function stop(){ if (raf) cancelAnimationFrame(raf); raf=null; }
      els.hoverLeft.addEventListener('mouseenter', ()=> start(-1));
      els.hoverRight.addEventListener('mouseenter', ()=> start(1));
      els.hoverLeft.addEventListener('mouseleave', stop);
      els.hoverRight.addEventListener('mouseleave', stop);
      els.tableWrap.addEventListener('scroll', updateScrollHints);
      updateScrollHints();
    }
    function updateScrollHints(){
      const el = els.tableWrap;
      const max = el.scrollWidth - el.clientWidth;
      els.hoverLeft.style.display = el.scrollLeft>0 ? 'block' : 'none';
      els.hoverRight.style.display = el.scrollLeft < max ? 'block' : 'none';
    }
    function toggleFullscreen(){
      const el = els.listPanel;
      const d = document;
      if (!d.fullscreenElement){
        (el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen).call(el);
      }else{
        (d.exitFullscreen || d.webkitExitFullscreen || d.msExitFullscreen).call(d);
      }
    }
    function onFsChange(){
      fsActive = isFs();
      els.fsBtn.textContent = fsActive ? 'Exit Full Screen' : 'Full Screen';
      if (fsActive){
        if (!els.fsDetailPane.contains(els.detailView)){ els.fsDetailPane.appendChild(els.detailView); }
        els.detailView.style.display='block';
        if (currentDetailId){ renderDetailBody(currentDetailId, els.detailBody); }
        else { els.detailTitle.textContent='User Story'; els.detailBody.innerHTML='<div class="muted">Select a row on the left to view details.</div>'; }
      }else{
        const main = document.querySelector('main.container');
        main.appendChild(els.detailView);
        if (!currentDetailId) els.detailView.style.display='none';
      }
    }
  
    // ----- CRUD -----
    function onCreateSubmit(e){
      e.preventDefault();
      const st = normalizeStory({
        regressionItem: els.regressionItem.value,
        description: els.description.value,
        testScript: els.testScript.value,
        acceptance: els.acceptance.value,
        comments: 'None',
        testerComments: 'None',
        personas: els.personas.value,
        reportedBy: els.reportedBy.value || displayName(currentUser),
        reportedDate: els.reportedDate.value,
        priority: els.priority.value,
        status: els.status.value,
        owner: els.owner.value,
        loe: els.loe.value,
        lastEditedBy: currentUser?.id || null
      });
      const errs = validationErrors(st);
      const dup = stories.find(x=>x.regressionItem===st.regressionItem);
      if (dup) errs.push(`Regression Item # ${st.regressionItem} already exists (ID ${dup.id.slice(0,8)}…).`);
      if (errs.length){ showToast(errs[0],'error'); return; }
      stories.push(st); saveStoriesMerged(); renderAll();
      els.createForm.reset(); setTodayDefaults();
      showToast('User story added');
    }
    function confirmDelete(id){
      const st = stories.find(x=>x.id===id); if (!st) return;
      const ok = confirm(`Delete story Reg. #${st.regressionItem}? This cannot be undone.`);
      if (ok){ deleteStoryById(id); showToast('Deleted','success'); }
    }
    function deleteStoryById(id){
      const idx = stories.findIndex(x => x.id === id);
      if (idx !== -1) {
        stories.splice(idx, 1);         
        CroweStorage.deleteStory(id);    
        renderAll();
        if (currentDetailId === id) showDetail(null);
        showToast('Deleted', 'success');
      }
    }
    
    function duplicateStory(id){
      const st = stories.find(x=>x.id===id); if (!st) return;
      const copy = normalizeStory({...st, id: CroweStorage.uuid(), regressionItem: st.regressionItem + 1, createdAt: Date.now(), updatedAt: Date.now(), lastEditedBy: currentUser?.id || null});
      stories.push(copy); saveStoriesMerged(); renderAll();
      showToast('Duplicated');
    }
  
    // ----- CSV -----
    function csvEscape(v){ return `"${String(v??'').replaceAll('"','""')}"`; }
    function exportCsv(){
      const headers = ['id','regressionItem','description','testScript','acceptance','comments','testerComments','personas','reportedBy','reportedDate','priority','status','owner','loe','createdAt','updatedAt','lastEditedBy'];
      const rows = stories.map(s=> headers.map(h=> s[h]===undefined ? '' : s[h]));
      const csv = [headers.join(','), ...rows.map(r=> r.map(csvEscape).join(','))].join('\n');
      const blob = new Blob([csv], {type:'text/csv'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'crowe-user-stories.csv'; a.click();
      URL.revokeObjectURL(url);
    }
    function parseCSV(text){
      const out=[]; let i=0, field='', row=[], inQ=false;
      function pushField(){ row.push(field); field=''; }
      function pushRow(){ out.push(row); row=[]; }
      while(i<text.length){
        const c=text[i++];
        if (inQ){
          if (c==='"' && text[i]==='"'){ field+='"'; i++; }
          else if (c==='"'){ inQ=false; }
          else field+=c;
        }else{
          if (c===','){ pushField(); }
          else if (c==='\n'){ pushField(); pushRow(); }
          else if (c==='\r'){ }
          else if (c==='"'){ inQ=true; }
          else field+=c;
        }
      }
      if (field!=='' || text.endsWith(',')) pushField();
      if (row.length) pushRow();
      if (out.length && out[out.length-1].length===1 && out[out.length-1][0]==='') out.pop();
      return out;
    }
    function importCsvFile(file){
      file.text().then(text=>{
        const rows = parseCSV(text);
        if (!rows.length) throw new Error('Empty CSV');
        const header = rows[0].map(h=>h.trim().toLowerCase());
        const idx = (name)=> header.indexOf(name.toLowerCase());
        const get = (r, name)=> { const i = idx(name); return i>=0 ? r[i] : ''; };
        const mapped = rows.slice(1).map(r=> normalizeStory({
          id: get(r,'id') || undefined,
          regressionItem: get(r,'regressionitem'),
          description: get(r,'description'),
          testScript: get(r,'testscript'),
          acceptance: get(r,'acceptance'),
          comments: get(r,'comments'),
          testerComments: get(r,'testercomments'),
          personas: get(r,'personas'),
          reportedBy: get(r,'reportedby'),
          reportedDate: get(r,'reporteddate'),
          priority: get(r,'priority'),
          status: get(r,'status'),
          owner: get(r,'owner'),
          loe: get(r,'loe'),
          createdAt: Number(get(r,'createdat')) || undefined,
          updatedAt: Number(get(r,'updatedat')) || undefined,
          lastEditedBy: get(r,'lasteditedby') || null
        }));
        stories = mapped;saveStoriesMerged(); saveStories(); renderAll();
        showToast('Imported CSV');
      }).catch(err=>{
        console.error(err);
        showToast('Import failed: '+err.message, 'error');
      }).finally(()=>{ $('#importCsv').value=''; });
    }
  
    // ----- Wireup -----
    function setTodayDefaults(){
      els.reportedDate.value = new Date().toISOString().slice(0,10);
      els.priority.value = 'Medium';
      els.status.value = 'Under Review';
      els.reportedBy.placeholder = displayName(currentUser||{firstName:'',lastName:''});
    }
    function wireEvents(){
      // Create + CSV
      els.createForm.addEventListener('submit', onCreateSubmit);
      $('#exportCsv').addEventListener('click', exportCsv);
      $('#importCsv')?.addEventListener('change', (e)=>{ const f=e.target.files?.[0]; if (f) importCsvFile(f); });
  
      // Sorting
      document.querySelector('thead').addEventListener('click', (e)=>{
        const btn = e.target.closest('button[data-sort]'); if (!btn) return;
        const key = btn.getAttribute('data-sort');
        if (sortKey===key) sortDir = -sortDir; else { sortKey = key; sortDir = 1; }
        reflectSortUI(); renderList();
      });
      els.sortField?.addEventListener('change', ()=>{ sortKey = els.sortField.value || null; renderList(); });
      els.sortDirBtn?.addEventListener('click', ()=>{ sortDir = -sortDir; reflectSortUI(); renderList(); });
  
      // Filters
      els.addFilterBtn.addEventListener('click', ()=> addFilter(els.addFilterSelect.value));
      els.addFilterSelect.addEventListener('change', ()=> addFilter(els.addFilterSelect.value));
      els.clearFilters?.addEventListener('click', ()=>{ activeFilters=[]; renderFilters(); });
  
      // Detail controls
      els.backToList?.addEventListener('click', ()=> showDetail(null));
      els.detailDelete?.addEventListener('click', ()=>{ if (currentDetailId) confirmDelete(currentDetailId); });
  
      // Comments
      els.commentForm?.addEventListener('submit', (e)=>{
        e.preventDefault();
        if (!currentDetailId) return;
        addComment(currentDetailId, els.commentParentId.value || null, els.commentText.value);
        els.commentText.value=''; resetReplyUI();
      });
      els.cancelReplyBtn?.addEventListener('click', (e)=>{ e.preventDefault(); resetReplyUI(); });
  
      // Hover scroll
      initHoverScroll();
  
      // Fullscreen
      els.fsBtn?.addEventListener('click', toggleFullscreen);
      document.addEventListener('fullscreenchange', onFsChange);
  
      // Notifications
      els.notifyBtn.addEventListener('click', ()=>{
        els.headerNotify.classList.toggle('open');
        if (!els.headerNotify.classList.contains('open')) return;
        updateNotifyUI();
      });
      document.addEventListener('click', (e)=>{
        if (!els.headerNotify.contains(e.target) && e.target!==els.notifyBtn){
          els.headerNotify.classList.remove('open');
        }
      });
    }
    // Keep local state in sync with CroweStorage's realtime cache
    function hydrateFromStorage(){
      stories         = (CroweStorage.loadStories() || []).map(normalizeStory);
      commentsByStory = CroweStorage.loadComments() || {};
      mentions        = CroweStorage.loadMentions() || [];
      auditByStory    = CroweStorage.loadAudit() || {};
    }

    // Initial data is ready (localStorage or Supabase)
    window.addEventListener('CroweStorage:ready', () => {
      hydrateFromStorage();
      setTodayDefaults();
      renderAll();
      reflectSortUI();
      updateNotifyUI();
    });

    // Per-table realtime updates push into our local arrays and re-render
    window.addEventListener('CroweStorage:stories', () => {
      stories = (CroweStorage.loadStories() || []).map(normalizeStory);
      buildSummary();
      renderList();
      if (currentDetailId) renderDetail(currentDetailId);
    });

    window.addEventListener('CroweStorage:comments', () => {
      commentsByStory = CroweStorage.loadComments() || {};
      if (currentDetailId) renderCommentsThread(currentDetailId);
    });

    window.addEventListener('CroweStorage:mentions', () => {
      mentions = CroweStorage.loadMentions() || [];
      updateNotifyUI();
    });

    window.addEventListener('CroweStorage:audit', () => {
      auditByStory = CroweStorage.loadAudit() || {};
    });

    // ----- Boot -----
    function boot(user){
      currentUser = user;
      loadAll();
      hydrateFromStorage();
      setTodayDefaults();
      renderAll();
      reflectSortUI();
      wireEvents();
      updateNotifyUI();
    }
  
    document.addEventListener('user-ready', (e)=> boot(e.detail));
    // If device.js already resolved earlier, also try immediate ready()
    if (window.DeviceAPI && DeviceAPI.ready){ DeviceAPI.ready().then(u=>{}); }
  })();
  // === @mention autocomplete (put this in app.js) ===
function attachMentionAutocomplete(textarea){
    // Inject minimal CSS once
    if (!document.getElementById('mention-style')){
      const st = document.createElement('style');
      st.id = 'mention-style';
      st.textContent = `
        .mention-menu{position:absolute; z-index:9999; background:#fff; border:1px solid #d9d9d9; border-radius:8px; box-shadow:0 6px 18px rgba(0,0,0,.12); overflow:auto; max-height:240px; min-width:240px; font-size:14px}
        .mention-item{display:flex; align-items:center; gap:8px; padding:8px 10px; cursor:pointer}
        .mention-item:hover, .mention-item.active{background:#eef4ff}
        .mention-item .meta{color:#5f6a7d; font-size:12px}
        .mention-empty{padding:10px; color:#5f6a7d}
      `;
      document.head.appendChild(st);
    }
  
    const menu = document.createElement('div');
    menu.className = 'mention-menu';
    menu.style.display = 'none';
    document.body.appendChild(menu);
  
    let activeIndex = 0;
    let triggerPos  = -1; // index of '@' to replace
    let candidates   = [];
  
    const users = () => (window.CroweUsers ? CroweUsers.listUsers() : [])
      .map(u => ({ id:u.id, name:`${u.firstName} ${u.lastName}`, email:u.email }));
  
    function findTrigger(){
      const val = textarea.value;
      const pos = textarea.selectionStart || 0;
      const left = val.slice(0, pos);
      // Match last "@query" token (start of line or whitespace before @)
      const m = left.match(/(^|\s)@([\w.\-%+@]{0,50})$/);
      if (!m) return null;
      const query = m[2] || '';
      const atIndex = left.lastIndexOf('@');
      return { query, atIndex };
    }
  
    function filterUsers(query){
      const q = query.toLowerCase();
      return users()
        .filter(u => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
        .slice(0, 8);
    }
  
    function renderMenu(){
      if (!candidates.length){
        menu.innerHTML = `<div class="mention-empty">No matches</div>`;
        activeIndex = 0;
        return;
      }
      menu.innerHTML = candidates.map((u,i)=>`
        <div class="mention-item ${i===activeIndex?'active':''}" data-idx="${i}">
          <div>
            <div><strong>${escapeHtml(u.name)}</strong></div>
            <div class="meta">@${escapeHtml(u.email)}</div>
          </div>
        </div>
      `).join('');
      // mouse interactions
      menu.querySelectorAll('.mention-item').forEach(el=>{
        el.addEventListener('mouseenter', ()=>{ activeIndex = Number(el.dataset.idx); highlight(); });
        el.addEventListener('mousedown', (e)=>{ e.preventDefault(); choose(activeIndex); });
      });
    }
  
    function positionMenu(){
      const r = textarea.getBoundingClientRect();
      // Simple, reliable placement: just under the textarea near the caret line (approx)
      menu.style.left = (r.left + window.scrollX + 10) + 'px';
      menu.style.top  = (r.bottom + window.scrollY - 6) + 'px';
      menu.style.minWidth = Math.min(Math.max(r.width * 0.5, 240), 420) + 'px';
    }
  
    function openMenu(){
      positionMenu();
      renderMenu();
      menu.style.display = 'block';
    }
    function closeMenu(){
      menu.style.display = 'none';
      activeIndex = 0;
      candidates = [];
      triggerPos = -1;
    }
    function highlight(){
      menu.querySelectorAll('.mention-item').forEach((el,i)=>{
        el.classList.toggle('active', i===activeIndex);
      });
    }
  
    function choose(i){
      if (!candidates[i] || triggerPos<0) return;
      const u = candidates[i];
      const val = textarea.value;
      const caret = textarea.selectionStart || 0;
      // Replace from '@' to caret with @email + space
      const before = val.slice(0, triggerPos);
      const after  = val.slice(caret);
      const insert = '@' + u.email + ' ';
      textarea.value = before + insert + after;
      const newPos = (before + insert).length;
      textarea.setSelectionRange(newPos, newPos);
      textarea.focus();
      closeMenu();
      // fire input to trigger autosave / mention processing
      textarea.dispatchEvent(new Event('input', {bubbles:true}));
    }
  
    function onInput(){
      const t = findTrigger();
      if (!t){ closeMenu(); return; }
      triggerPos = t.atIndex;
      candidates = filterUsers(t.query);
      activeIndex = 0;
      if (!candidates.length){ closeMenu(); return; }
      openMenu();
    }
  
    function onKeyDown(e){
      if (menu.style.display==='none') return;
      if (e.key==='ArrowDown'){ e.preventDefault(); activeIndex = (activeIndex+1) % Math.max(1,candidates.length); highlight(); }
      else if (e.key==='ArrowUp'){ e.preventDefault(); activeIndex = (activeIndex-1 + candidates.length) % Math.max(1,candidates.length); highlight(); }
      else if (e.key==='Enter' || e.key==='Tab'){ e.preventDefault(); choose(activeIndex); }
      else if (e.key==='Escape'){ e.preventDefault(); closeMenu(); }
    }
  
    function onBlur(){
      // Delay close to allow click
      setTimeout(()=> closeMenu(), 120);
    }
  
    function onScrollOrResize(){
      if (menu.style.display!=='none') positionMenu();
    }
  
    // helpers
    function escapeHtml(s){ return String(s||'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;'); }
  
    textarea.addEventListener('input', onInput);
    textarea.addEventListener('keydown', onKeyDown);
    textarea.addEventListener('blur', onBlur);
    textarea.addEventListener('focus', onInput);
    textarea.addEventListener('scroll', onScrollOrResize);
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
  }

  

  // Create form long-text fields:
['#description','#testScript','#acceptance','#comments','#testerComments', '#description2','#testScript2','#acceptance2','#comments2','#testerComments2']
.forEach(sel => { const el = document.querySelector(sel); if (el) attachMentionAutocomplete(el); });



// For comments box:
const cmt = document.getElementById('commentText');
if (cmt) attachMentionAutocomplete(cmt);

