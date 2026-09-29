// SharedWish - main.js (Firebase Firestore edition)
const AUTH_STORAGE_KEY = 'sharedwish_auth';
let _fbConfig = null;
function fbConfig() { if (!_fbConfig) _fbConfig = window.SHAREDWISH_FIREBASE_CONFIG || {}; return _fbConfig; }
function projectId() { return fbConfig().projectId || ''; }
function fsBase() { return 'https://firestore.googleapis.com/v1/projects/' + projectId() + '/databases/(default)/documents'; }
let authSession = null;

async function getAuthSession() {
  if (!authSession) {
    try { authSession = JSON.parse(sessionStorage.getItem(AUTH_STORAGE_KEY) || 'null'); } catch(e) { authSession = null; }
  }
  if (!authSession) throw new Error('Sesi akun berakhir. Silakan login kembali.');
  if (authSession.expiresAt > Date.now() + 60000) return authSession;
  const cfg = fbConfig();
  const response = await fetch('https://securetoken.googleapis.com/v1/token?key=' + encodeURIComponent(cfg.apiKey || ''), {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: authSession.refreshToken })
  });
  const result = await response.json();
  if (!response.ok) throw new Error('Sesi akun berakhir. Silakan login kembali.');
  authSession.idToken = result.id_token;
  authSession.refreshToken = result.refresh_token || authSession.refreshToken;
  authSession.expiresAt = Date.now() + (Number(result.expires_in) || 3600) * 1000;
  sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(authSession));
  return authSession;
}

function toFirestore(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) out[k] = { nullValue: null };
    else if (typeof v === 'boolean') out[k] = { booleanValue: v };
    else if (typeof v === 'number') out[k] = { doubleValue: v };
    else out[k] = { stringValue: String(v) };
  }
  return out;
}
function fromFirestore(fields) {
  if (!fields) return {};
  const out = {};
  for (const [k, v] of Object.entries(fields)) {
    if ('stringValue' in v) out[k] = v.stringValue;
    else if ('booleanValue' in v) out[k] = v.booleanValue;
    else if ('doubleValue' in v) out[k] = v.doubleValue;
    else if ('integerValue' in v) out[k] = Number(v.integerValue);
    else out[k] = null;
  }
  return out;
}

async function fsGet(path) {
  const session = await getAuthSession();
  const res = await fetch(fsBase() + '/' + path, { headers: { Authorization: 'Bearer ' + session.idToken } });
  if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error((err.error && err.error.message) || 'Firestore GET gagal'); }
  return res.json();
}
async function fsSet(path, fields) {
  const session = await getAuthSession();
  const res = await fetch(fsBase() + '/' + path, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + session.idToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: toFirestore(fields) })
  });
  if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error((err.error && err.error.message) || 'Firestore SET gagal'); }
  return res.json();
}
async function fsDelete(path) {
  const session = await getAuthSession();
  const res = await fetch(fsBase() + '/' + path, {
    method: 'DELETE', headers: { Authorization: 'Bearer ' + session.idToken }
  });
  if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error((err.error && err.error.message) || 'Firestore DELETE gagal'); }
}
async function fsList(collPath) {
  const session = await getAuthSession();
  const res = await fetch(fsBase() + '/' + collPath + '?pageSize=500', {
    headers: { Authorization: 'Bearer ' + session.idToken }
  });
  if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error((err.error && err.error.message) || 'Firestore LIST gagal'); }
  const data = await res.json();
  return (data.documents || []).map(d => ({ id: d.name.split('/').pop(), ...fromFirestore(d.fields) }));
}

async function fsQueryMySecrets(roomId, uid) {
  const session = await getAuthSession();
  const res = await fetch(fsBase() + '/rooms/' + roomId + ':runQuery', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + session.idToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'secrets' }],
        where: { fieldFilter: { field: { fieldPath: 'creatorId' }, op: 'EQUAL', value: { stringValue: uid } } }
      }
    })
  });
  if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error((err.error && err.error.message) || 'Query gagal'); }
  const data = await res.json();
  return data.map(d => d.document ? { id: d.document.name.split('/').pop(), ...fromFirestore(d.document.fields) } : null).filter(Boolean);
}

const STATUS_LABEL = { idea: 'Ide', planned: 'Direncanakan', preparing: 'Dipersiapkan', done: 'Selesai' };
const STATUS_ICON  = { idea: 'lightbulb', planned: 'event_note', preparing: 'schedule', done: 'check_circle' };
function icon(name, small) {
  return '<span class="icon' + (small ? ' small' : '') + '" aria-hidden="true">' + name + '</span>';
}
function statusMarkup(s) { return icon(STATUS_ICON[s] || 'circle', true) + ' ' + (STATUS_LABEL[s] || s); }

let state = { currentRoom: null, currentUser: null, rooms: {} };
let editingId = null;
let profileName = '', profileId = '', previousNames = [];

function loadState() { try { const r = localStorage.getItem('sharedwish'); if (r) state = JSON.parse(r); } catch(e) {} }
function saveState() { try { localStorage.setItem('sharedwish', JSON.stringify(state)); } catch(e) {} }
function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}
function switchAuthTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(button => button.classList.remove('active'));
  document.querySelectorAll('.auth-form').forEach(form => form.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  document.getElementById('form-' + tab).classList.add('active');
}
function currentRoomObj() {
  const room = state.rooms[state.currentRoom];
  if (!room || typeof room !== 'object') return null;
  ['members','wishlist','events','secrets','memories'].forEach(k => { if (!Array.isArray(room[k])) room[k] = []; });
  return room;
}
function logout() {
  sessionStorage.removeItem(AUTH_STORAGE_KEY);
  state.currentRoom = null; state.currentUser = null; saveState();
  location.replace('index.html');
}
function leaveRoom() {
  state.currentRoom = null;
  state.currentUser = null;
  saveState();
  show('screen-login');
}

function roomPath(roomId)           { return 'rooms/' + roomId; }
function collPath(roomId, sheet)    { return 'rooms/' + roomId + '/' + sheet.toLowerCase(); }
function docPath(roomId, sheet, id) { return collPath(roomId, sheet) + '/' + id; }

async function createRoom() {
  const roomName = document.getElementById('in-newroomname').value.trim();
  const roomPin = document.getElementById('in-newroompin').value.trim();
  const userName = profileName;
  if (!roomName) { alert('Isi nama room dulu ya.'); return; }
  const roomId = genRoomId(roomName);
  const btn = document.getElementById('btn-create'); btn.disabled = true; btn.textContent = 'Membuat room...';
  try {
    const session = await getAuthSession();
    await fsSet(roomPath(roomId), { roomName, roomPin, createdBy: session.uid, createdAt: new Date().toISOString() });
    const memberId = 'M' + Date.now();
    await fsSet(docPath(roomId, 'members', memberId), { id: memberId, name: userName, profileId: session.uid });
    state.rooms[roomId] = { name: roomName, memberId, members: [userName], wishlist: [] };
    state.currentRoom = roomId; state.currentUser = userName;
    saveState(); goRoom();
    alert('Room dibuat! Room ID: ' + roomId + '\nBagikan Room ID ke pasanganmu.');
  } catch(err) { alert('Gagal membuat room: ' + err.message); }
  finally { btn.disabled = false; btn.textContent = 'Buat Room Baru'; }
}

async function joinRoom() {
  const roomId = document.getElementById('in-roomid').value.trim().toUpperCase();
  const inputPin = document.getElementById('in-pin').value.trim();
  const userName = profileName;
  if (!roomId) { alert('Isi Room ID dulu ya.'); return; }
  const btn = document.getElementById('btn-join'); btn.disabled = true; btn.textContent = 'Menghubungkan...';
  try {
    const session = await getAuthSession();
    const roomDoc = await fsGet(roomPath(roomId)).catch(() => null);
    if (!roomDoc || !roomDoc.fields) throw new Error('Room ID tidak ditemukan.');
    const roomData = fromFirestore(roomDoc.fields);
    if (roomData.roomPin && roomData.roomPin !== inputPin) {
      throw new Error('PIN Room salah!');
    }
    const members = await fsList(collPath(roomId, 'members'));
    let member = members.find(m => m.profileId === session.uid);
    if (!member) {
      const nameTaken = members.find(m => m.name && m.name.toLowerCase() === userName.toLowerCase());
      if (nameTaken && nameTaken.profileId && nameTaken.profileId !== session.uid)
        throw new Error('Nama sudah dipakai anggota lain di room.');
      if (nameTaken) {
        await fsSet(docPath(roomId, 'members', nameTaken.id), { id: nameTaken.id, name: userName, profileId: session.uid });
        member = { ...nameTaken, profileId: session.uid };
      } else {
        const memberId = 'M' + Date.now();
        await fsSet(docPath(roomId, 'members', memberId), { id: memberId, name: userName, profileId: session.uid });
        member = { id: memberId, name: userName, profileId: session.uid };
      }
    }
    const old = state.rooms[roomId] || {};
    state.rooms[roomId] = { ...old, name: roomData.roomName || roomId, memberId: member.id, members: [] };
    state.currentRoom = roomId; state.currentUser = member.name;
    saveState(); await syncRoom(); goRoom();
  } catch(err) { alert('Gagal masuk: ' + err.message); }
  finally { btn.disabled = false; btn.textContent = 'Masuk'; }
}

function genRoomId(name) {
  const base = (name || 'ROOM').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'ROOM';
  return base + Math.random().toString(36).slice(2, 7).toUpperCase();
}

async function syncRoom() {
  const room = currentRoomObj(); if (!room) return;
  const note = document.getElementById('sync-note');
  if (note) note.textContent = 'Menyinkronkan...';
  const roomId = state.currentRoom;
  try {
    const session = await getAuthSession();
    const [wishlist, events, memories, members, mySecrets] = await Promise.all([
      fsList(collPath(roomId, 'wishlist')),
      fsList(collPath(roomId, 'events')),
      fsList(collPath(roomId, 'memories')),
      fsList(collPath(roomId, 'members')),
      fsQueryMySecrets(roomId, session.uid),
    ]);
    room.wishlist  = wishlist;
    room.events    = events;
    room.memories  = memories;
    room.secrets   = mySecrets;
    room.members   = members.map(m => m.name);
    const myMember = members.find(m => m.profileId === session.uid);
    if (myMember) { state.currentUser = myMember.name; room.memberId = myMember.id; }
    try { const rd = await fsGet(roomPath(roomId)); const rv = fromFirestore(rd.fields); if (rv.roomName) room.name = rv.roomName; } catch(e) {}
    saveState(); if (note) note.textContent = '';
  } catch(err) {
    if (/Sesi akun berakhir/.test(err.message)) { logout(); return; }
    if (note) note.textContent = 'Gagal sinkron (' + err.message + ') - menampilkan data tersimpan terakhir.';
  }
}

function escapeHtml(s) {
  return (s || '').toString().replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function goRoom(skip) {
  const room = currentRoomObj(); if (!room) { show('screen-login'); return; }
  document.getElementById('room-name').textContent = room.name;
  const memberNames = [state.currentUser, ...room.members.filter(n => String(n).toLowerCase() !== String(state.currentUser).toLowerCase())];
  const profilePhoto = localStorage.getItem('sharedwish_profile_photo_' + profileId) || '';
  document.getElementById('room-members').innerHTML = memberNames.map((name, i) => {
    const current = i === 0;
    const avatar = current && profilePhoto
      ? '<img src="' + escapeHtml(profilePhoto) + '" alt="" style="width:22px;height:22px;border-radius:50%;object-fit:cover;">'
      : icon('person', true);
    return (current
      ? '<a class="member-chip current" href="index.html" aria-label="Buka profil ' + escapeHtml(name) + '">'
      : '<span class="member-chip">') + avatar + escapeHtml(name) + (current ? '</a>' : '</span>');
  }).join('');
  document.getElementById('room-id-badge').textContent = 'Room ID: ' + state.currentRoom;
  const c = { idea: 0, planned: 0, preparing: 0, done: 0 };
  room.wishlist.forEach(w => c[w.status] = (c[w.status] || 0) + 1);
  document.getElementById('room-stats').innerHTML =
    '<div class="stat"><b>' + room.wishlist.length + '</b><span>Total</span></div>' +
    '<div class="stat"><b>' + (c.planned + c.preparing) + '</b><span>Berjalan</span></div>' +
    '<div class="stat"><b>' + c.done + '</b><span>Selesai</span></div>';
  renderProgress(room, c); renderBanners(room);
  show('screen-room');
  if (skip !== true) syncRoom().then(() => { if (document.getElementById('screen-room').classList.contains('active')) goRoom(true); });
}

async function goWishlist() { show('screen-wishlist'); renderWishlist(); await syncRoom(); renderWishlist(); }

function renderWishlist() {
  const room = currentRoomObj();
  const list = document.getElementById('wishlist-list');
  if (!room.wishlist.length) { list.innerHTML = '<div class="empty">Belum ada wishlist.<br>Ketuk + untuk menambah hal yang ingin kalian lakukan bersama.</div>'; return; }
  const order = { idea: 0, planned: 1, preparing: 2, done: 3 };
  const sorted = [...room.wishlist].sort((a, b) => order[a.status] - order[b.status]);
  list.innerHTML = sorted.map(w =>
    '<div class="card wish-item" onclick="openModal(\'' + w.id + '\')">' +
    '<div><div class="wish-title">' + escapeHtml(w.title) + '</div>' +
    '<div class="wish-meta">' + escapeHtml(w.category) + ' \xb7 ' + escapeHtml(w.priority) +
    (w.target ? ' \xb7 ' + w.target : '') + ' \xb7 oleh ' + escapeHtml(w.creator) + '</div></div>' +
    wishSide(w) + '</div>'
  ).join('');
}

function openModal(id) {
  editingId = id || null;
  const room = currentRoomObj();
  const del = document.getElementById('btn-delete');
  if (editingId) {
    const w = room.wishlist.find(x => x.id === editingId);
    document.getElementById('modal-title').textContent = 'Edit Wishlist';
    document.getElementById('f-title').value    = w.title;
    document.getElementById('f-desc').value     = w.description || '';
    document.getElementById('f-category').value = w.category;
    document.getElementById('f-priority').value = w.priority;
    document.getElementById('f-status').value   = w.status;
    document.getElementById('f-target').value   = d10(w.target);
    del.style.display = 'block';
  } else {
    document.getElementById('modal-title').textContent = 'Tambah Wishlist';
    document.getElementById('f-title').value    = '';
    document.getElementById('f-desc').value     = '';
    document.getElementById('f-category').value = 'Umum';
    document.getElementById('f-priority').value = 'Sedang';
    document.getElementById('f-status').value   = 'idea';
    document.getElementById('f-target').value   = '';
    del.style.display = 'none';
  }
  updateMemBtn();
  document.getElementById('modal-back').classList.add('active');
}
function closeModal() { document.getElementById('modal-back').classList.remove('active'); editingId = null; }

async function saveWish() {
  const title = document.getElementById('f-title').value.trim();
  if (!title) { alert('Judul wajib diisi.'); return; }
  const data = {
    title,
    description: document.getElementById('f-desc').value.trim(),
    category:    document.getElementById('f-category').value,
    priority:    document.getElementById('f-priority').value,
    status:      document.getElementById('f-status').value,
    target:      document.getElementById('f-target').value,
  };
  const btn = document.getElementById('btn-save'); btn.disabled = true; btn.textContent = 'Menyimpan...';
  try {
    const prev = editingId && currentRoomObj().wishlist.find(x => x.id === editingId);
    const wasDone = !!prev && prev.status === 'done';
    const session = await getAuthSession();
    const id = editingId || ('W' + Date.now());
    await fsSet(docPath(state.currentRoom, 'wishlist', id), { ...data, id, creator: state.currentUser, creatorId: session.uid });
    closeModal(); await syncRoom(); renderWishlist();
    if (data.status === 'done' && !wasDone && confirm('Selesai! Simpan sebagai Memory sekarang?')) memWish(id);
  } catch(err) { alert('Gagal menyimpan: ' + err.message); }
  finally { btn.disabled = false; btn.textContent = 'Simpan'; }
}

async function deleteWish() {
  if (!editingId || !confirm('Hapus wishlist ini?')) return;
  try { await fsDelete(docPath(state.currentRoom, 'wishlist', editingId)); closeModal(); await syncRoom(); renderWishlist(); }
  catch(err) { alert('Gagal menghapus: ' + err.message); }
}

const ENT = {
  events: {
    sheet: 'events', title: 'Event', icon: 'event',
    fields: [['title','Nama acara','text'],['date','Tanggal','date'],['time','Jam','time'],
             ['location','Lokasi','text'],['notes','Catatan','textarea'],
             ['reminder','Reminder','select',[['none','Tanpa reminder'],['0','Pada hari H'],['1','H-1 (sehari sebelum)'],['3','H-3'],['7','H-7']]]]
  },
  secrets: {
    sheet: 'secrets', title: 'Secret Wishlist', icon: 'lock',
    sub: 'Hanya kamu yang melihat ini di aplikasi',
    fields: [['title','Judul','text'],['description','Deskripsi','textarea']]
  },
  memories: {
    sheet: 'memories', title: 'Memory', icon: 'photo_camera',
    sub: 'Arsip pengalaman kalian',
    fields: [['title','Judul kenangan','text'],['date','Tanggal kejadian','date'],
             ['note','Cerita','textarea'],['image','Link foto (Google Drive / URL)','text']]
  }
};
let entKey = null, entEditId = null, entRef = null;
const d10 = v => (v || '').toString().slice(0, 10);
function daysUntil(ds) { const d = new Date(d10(ds)+'T00:00:00'), t = new Date(); t.setHours(0,0,0,0); return Math.round((d-t)/864e5); }
function reminderList(room) {
  return (room.events||[]).filter(e=>e.date&&e.reminder!==''&&e.reminder!=='none'&&e.reminder!==undefined).map(e=>{
    const dl=daysUntil(e.date); if(dl<0||dl>+e.reminder) return null;
    const txt=dl===0?'Hari ini \u2014 '+e.title+(e.time?' pukul '+e.time:''):dl===1?'Besok \u2014 '+e.title:dl+' hari lagi \u2014 '+e.title;
    return {id:e.id,txt};
  }).filter(Boolean);
}
function renderBanners(room) {
  const list = reminderList(room);
  document.getElementById('banners').innerHTML = list.map(r=>'<div class="banner">'+icon('notifications',true)+' '+escapeHtml(r.txt)+'</div>').join('');
  if ('Notification' in window && Notification.permission === 'granted') {
    const today = new Date().toDateString();
    list.forEach(r=>{try{const k='sw_n_'+r.id+'_'+today;if(!localStorage.getItem(k)){localStorage.setItem(k,1);new Notification('SharedWish',{body:r.txt});}}catch(e){}});
  }
}
function enableNotif() {
  if (!('Notification' in window)) { alert('Browser ini tidak mendukung notifikasi.'); return; }
  Notification.requestPermission().then(p => { if(p==='granted'){alert('Notifikasi aktif.');renderBanners(currentRoomObj());}else alert('Izin notifikasi ditolak.'); });
}
function fieldHtml(f, v) {
  const [k,l,t,o] = f, val = escapeHtml(v||'');
  const inp = t==='textarea'?'<textarea id="e-'+k+'" rows="2">'+val+'</textarea>'
    :t==='select'?'<select id="e-'+k+'">'+o.map(([a,b])=>'<option value="'+a+'"'+(String(v)===a?' selected':'')+'>'+b+'</option>').join('')+'</select>'
    :'<input id="e-'+k+'" type="'+t+'" value="'+val+'">';
  return '<label class="lb">'+l+'</label>'+inp;
}
function entRows() { return currentRoomObj()[entKey] || []; }
function goEntity(k) {
  entKey = k; const c = ENT[k];
  document.getElementById('ent-title').innerHTML = icon(c.icon)+' '+c.title;
  document.getElementById('ent-sub').textContent = c.sub||'';
  document.getElementById('ent-fab').style.display = k==='memories'?'none':'flex';
  show('screen-entity'); renderEnt();
  syncRoom().then(()=>{ if(entKey===k) renderEnt(); });
}
function renderEnt() {
  let rows = [...entRows()];
  if(entKey==='events')   rows.sort((a,b)=>(d10(a.date)+(a.time||'')).localeCompare(d10(b.date)+(b.time||'')));
  if(entKey==='memories') rows.sort((a,b)=>d10(b.date).localeCompare(d10(a.date)));
  const el = document.getElementById('ent-list');
  if(!rows.length){el.innerHTML=entKey==='memories'?'<div class="empty">Belum ada memory.<br>Tandai wishlist sebagai selesai, atau buka event yang sudah lewat, lalu pilih "Jadikan Memory".</div>':'<div class="empty">Belum ada data. Ketuk + untuk menambah.</div>';return;}
  if(entKey==='memories'){el.innerHTML=rows.map(memCard).join('');return;}
  el.innerHTML=rows.map(r=>{
    let meta='',extra='';
    if(entKey==='events'){const dl=r.date?daysUntil(r.date):null;meta=[d10(r.date),r.time,r.location].filter(Boolean).join(' \xb7 ');extra=evSide(r,dl);if(r.notes)meta+='<br>'+escapeHtml(r.notes);}
    if(entKey==='secrets') meta=escapeHtml(r.description);
    return '<div class="card wish-item" onclick="openEnt(\''+r.id+'\')"><div><div class="wish-title">'+escapeHtml(r.title)+'</div><div class="wish-meta">'+meta+'</div></div>'+extra+'</div>';
  }).join('');
}
function findMem(type,id){return (currentRoomObj().memories||[]).find(m=>m.ref_type===type&&m.ref_id===id);}
function refLabel(m){
  if(!m.ref_type||!m.ref_id) return '';
  const r=currentRoomObj(),list=m.ref_type==='wishlist'?r.wishlist:(r.events||[]);
  const src=list.find(x=>x.id===m.ref_id);
  return src?(m.ref_type==='wishlist'?'Wishlist: ':'Event: ')+src.title:'';
}
function memoryFrom(type,id,title,date){
  const m=findMem(type,id);
  if(type==='wishlist')closeModal();else closeEnt();
  goEntity('memories');
  if(m)openEnt(m.id);else openEnt(null,{title,date:d10(date)||d10(new Date().toISOString()),ref_type:type,ref_id:id});
}
function updateMemBtn(){
  const b=document.getElementById('btn-mem');b.style.display='none';
  const w=editingId&&currentRoomObj().wishlist.find(x=>x.id===editingId);
  if(!w||w.status!=='done')return;
  b.innerHTML=icon('photo_camera',true)+' '+(findMem('wishlist',w.id)?'Lihat Memory':'Simpan sebagai Memory');
  b.style.display='inline-block';
}
function memWish(id){const w=currentRoomObj().wishlist.find(x=>x.id===(id||editingId));if(w)memoryFrom('wishlist',w.id,w.title,w.target);}
function memEvt(id){const e=(currentRoomObj().events||[]).find(x=>x.id===id);if(e)memoryFrom('events',id,e.title,e.date);}
function openEnt(id,pre){
  entEditId=id||null;entRef=pre&&pre.ref_id?{ref_type:pre.ref_type,ref_id:pre.ref_id}:null;
  const c=ENT[entKey];
  const row=id?entRows().find(x=>x.id===id):(pre||{reminder:'1'});
  document.getElementById('ent-mtitle').textContent=(id?'Edit ':'Tambah ')+c.title.replace(/^\S+\s/,'');
  document.getElementById('ent-fields').innerHTML=c.fields.map(f=>fieldHtml(f,f[2]==='date'?d10(row[f[0]]):row[f[0]])).join('');
  let extra='';
  if(entKey==='events'&&id){const m=findMem('events',id);if(m||daysUntil(row.date)<=0)extra='<button class="btn-sm" style="margin-bottom:12px" onclick="memEvt(\''+id+'\')">'+icon('photo_camera',true)+' '+(m?'Lihat Memory':'Simpan sebagai Memory')+'</button>';}
  if(entKey==='memories'){const rl=refLabel(row);if(rl)extra='<p class="badge">'+icon('link',true)+' '+escapeHtml(rl)+'</p>';}
  document.getElementById('ent-extra').innerHTML=extra;
  document.getElementById('ent-del').style.display=id?'block':'none';
  document.getElementById('ent-modal').classList.add('active');
}
function closeEnt(){document.getElementById('ent-modal').classList.remove('active');entEditId=null;}
async function saveEnt(){
  const c=ENT[entKey],data={};
  c.fields.forEach(f=>data[f[0]]=document.getElementById('e-'+f[0]).value.trim());
  if(!data.title){alert('Judul wajib diisi.');return;}
  if(entKey==='events'&&!data.date){alert('Tanggal acara wajib diisi.');return;}
  const btn=document.getElementById('ent-save');btn.disabled=true;btn.textContent='Menyimpan...';
  try{
    const session=await getAuthSession();
    const id=entEditId||('X'+Date.now());
    data.id=id;
    if(!entEditId&&entRef)Object.assign(data,entRef);
    await fsSet(docPath(state.currentRoom,c.sheet,id),{...data,creator:state.currentUser,creatorId:session.uid});
    closeEnt();await syncRoom();renderEnt();
  }catch(err){alert('Gagal menyimpan: '+err.message);}
  finally{btn.disabled=false;btn.textContent='Simpan';}
}
async function delEnt(){
  if(!entEditId||!confirm('Hapus data ini?'))return;
  try{await fsDelete(docPath(state.currentRoom,ENT[entKey].sheet,entEditId));closeEnt();await syncRoom();renderEnt();}
  catch(err){alert('Gagal menghapus: '+err.message);}
}
function wishSide(w){
  const pill='<span class="status-pill">'+statusMarkup(w.status)+'</span>';
  const btn=w.status==='done'
    ?'<button class="btn-sm" onclick="event.stopPropagation();memWish(\''+w.id+'\')">'+icon('photo_camera',true)+' '+(findMem('wishlist',w.id)?'Lihat Memory':'Jadikan Memory')+'</button>'
    :'<button class="btn-sm" onclick="event.stopPropagation();completeWish(\''+w.id+'\')">'+icon('check',true)+' Tandai selesai</button>';
  return '<div class="side">'+pill+btn+'</div>';
}
async function completeWish(id){
  const w=currentRoomObj().wishlist.find(x=>x.id===id);if(!w)return;
  if(!confirm('Tandai "'+w.title+'" sudah selesai dilakukan?'))return;
  try{
    const session=await getAuthSession();
    await fsSet(docPath(state.currentRoom,'wishlist',id),{...w,status:'done',creator:w.creator||state.currentUser,creatorId:w.creatorId||session.uid});
    await syncRoom();renderWishlist();
    if(confirm('Selesai! Simpan sebagai Memory sekarang?'))memWish(id);
  }catch(err){alert('Gagal memperbarui status: '+err.message);}
}
function evSide(r,dl){
  if(dl===null)return '';
  const pill='<span class="status-pill">'+(dl<0?'Lewat':dl===0?'Hari ini':dl+' hari lagi')+'</span>';
  const has=findMem('events',r.id);
  const btn=(has||dl<=0)?'<button class="btn-sm" onclick="event.stopPropagation();memEvt(\''+r.id+'\')">'+icon('photo_camera',true)+' '+(has?'Lihat Memory':'Jadikan Memory')+'</button>':'';
  return '<div class="side">'+pill+btn+'</div>';
}
function imgUrl(u){u=u||'';const g=u.match(/drive\.google\.com\/file\/d\//)+u.match(/([\w-]+)/);}
function imgUrl(u){
  u=u||'';
  const m=u.match(/drive\.google\.com\/file\/d\/([-\w]+)/)||(/drive\.google\.com/.test(u)?u.match(/[?&]id=([-\w]+)/):null);
  if(m)return 'https://drive.google.com/thumbnail?id='+m[1]+'&sz=w800';
  return /^https?:\/\//.test(u)?u:'';
}
function longDate(ds){const t=d10(ds);return t?new Date(t+'T00:00:00').toLocaleDateString('id-ID',{day:'numeric',month:'long',year:'numeric'}):'';}
function memCard(m){
  const img=imgUrl(m.image),rl=refLabel(m);
  return '<div class="card mem" onclick="openEnt(\''+m.id+'\')">'+
    (img?'<img src="'+escapeHtml(img)+'" alt="" onerror="this.style.display=\'none\'">':'')+
    '<div class="wish-title" style="font-size:17px">'+escapeHtml(m.title)+'</div>'+
    '<div class="wish-meta">'+longDate(m.date)+(rl?' \xb7 '+icon('link',true)+' '+escapeHtml(rl):'')+'</div>'+
    (m.note?'<p class="story">\u201c'+escapeHtml(m.note)+'\u201d</p>':'')+
    '</div>';
}
function renderProgress(room,c){
  const t=room.wishlist.length||1;
  const seg=[['idea',.3],['planned',.55],['preparing',.8],['done',1]];
  document.getElementById('progress').innerHTML=
    '<b>'+icon('monitoring',true)+' Progress wishlist</b>'+
    '<div class="bar">'+seg.map(([k,o])=>'<i style="width:'+(c[k]||0)/t*100+'%;opacity:'+o+'"></i>').join('')+'</div>'+
    '<span class="badge">'+Object.keys(STATUS_LABEL).map(k=>icon(STATUS_ICON[k],true)+' '+STATUS_LABEL[k]+' '+(c[k]||0)).join(' \xb7 ')+'</span>'+
    '<div class="badge" style="margin-top:6px">'+icon('event',true)+' '+(room.events||[]).length+' event \xb7 '+icon('photo_camera',true)+' '+(room.memories||[]).length+' memory \xb7 '+icon('lock',true)+' '+(room.secrets||[]).length+' secret</div>';
}
function shareRoom(){
  const room=currentRoomObj(),id=state.currentRoom;
  const url=location.protocol.startsWith('http')&&!/^(127\.|localhost)/.test(location.hostname)?new URL('index.html',location.href).href+'?room='+id:'';
  const text='Gabung ke room "'+room.name+'" di SharedWish.\nRoom ID: '+id+(url?'\nLink: '+url:'');
  if(navigator.share)navigator.share({text}).catch(()=>{});
  else if(navigator.clipboard)navigator.clipboard.writeText(text).then(()=>alert('Undangan disalin:\n\n'+text));
  else prompt('Salin undangan:',text);
}
function download(name,mime,content){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([content],{type:mime}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
function exportJson(){const r=currentRoomObj();download('sharedwish-'+state.currentRoom+'.json','application/json',JSON.stringify({room:r.name,roomId:state.currentRoom,members:r.members,wishlist:r.wishlist,events:r.events||[],memories:r.memories||[],secret_saya:r.secrets||[]},null,2));}
function exportCsv(){
  const r=currentRoomObj(),q=v=>'"'+String(v==null?'':v).replace(/"/g,'""')+'"';
  const L=[['tipe','judul','tanggal','status/reminder','catatan','pembuat']];
  r.wishlist.forEach(w=>L.push(['wishlist',w.title,d10(w.target),w.status,w.description,w.creator]));
  (r.events||[]).forEach(e=>L.push(['event',e.title,(d10(e.date)+' '+(e.time||'')).trim(),e.reminder,e.notes,e.creator]));
  (r.memories||[]).forEach(m=>L.push(['memory',m.title,d10(m.date),'',m.note,m.creator]));
  download('sharedwish-'+state.currentRoom+'.csv','text/csv;charset=utf-8','\ufeff'+L.map(x=>x.map(q).join(',')).join('\n'));
}
const qRoom=new URLSearchParams(location.search).get('room');
async function startApp(){
  try{authSession=JSON.parse(sessionStorage.getItem(AUTH_STORAGE_KEY)||'null');}catch(e){authSession=null;}
  if(!authSession){location.replace('index.html'+location.search);return;}
  try{authSession=await getAuthSession();}
  catch(error){sessionStorage.removeItem(AUTH_STORAGE_KEY);location.replace('index.html'+location.search);return;}
  profileId=authSession.uid;
  const nameKey='sharedwish_profile_'+profileId;
  profileName=(localStorage.getItem(nameKey)||authSession.displayName||authSession.username||'').trim();
  try{previousNames=JSON.parse(localStorage.getItem('sharedwish_profile_previous_names_'+profileId)||'[]');if(!Array.isArray(previousNames))previousNames=[];}catch(e){previousNames=[];}
  document.getElementById('login-profile-name').textContent=profileName;
  const profilePhoto=localStorage.getItem('sharedwish_profile_photo_'+profileId);
  if(profilePhoto){document.getElementById('login-profile-photo').src=profilePhoto;document.getElementById('login-profile-photo').style.display='block';document.getElementById('login-profile-placeholder').style.display='none';}
  if(qRoom)document.getElementById('in-roomid').value=qRoom.toUpperCase();
  loadState();
  if(state.accountUid!==profileId||(qRoom&&state.currentRoom!==qRoom.toUpperCase())){state.currentRoom=null;state.currentUser=null;}
  state.accountUid=profileId;
  saveState();
  if(state.currentRoom&&state.rooms[state.currentRoom])goRoom();
  else show('screen-login');
}
startApp();
