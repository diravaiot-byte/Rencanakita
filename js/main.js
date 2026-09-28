const STATUS_LABEL={idea:'Ide',planned:'Direncanakan',preparing:'Dipersiapkan',done:'Selesai'};
const STATUS_ICON={idea:'lightbulb',planned:'event_note',preparing:'schedule',done:'check_circle'};
function icon(name,small=false){ return `<span class="icon${small?' small':''}" aria-hidden="true">${name}</span>`; }
function statusMarkup(status){ return `${icon(STATUS_ICON[status]||'circle',true)} ${STATUS_LABEL[status]||status}`; }
let state={currentRoom:null,currentUser:null,rooms:{}};
let editingId=null;
const AUTH_STORAGE_KEY='sharedwish_auth';
const FIREBASE_API_KEY=window.SHAREDWISH_FIREBASE_API_KEY||'';
let authSession=null,profileName='',profileId='',previousNames=[];

function loadState(){
  try{ const raw=localStorage.getItem('sharedwish'); if(raw) state=JSON.parse(raw); }
  catch(e){ console.warn('load failed',e); }
}
function saveState(){
  try{ localStorage.setItem('sharedwish', JSON.stringify(state)); }
  catch(e){ console.warn('save failed',e); }
}
function show(id){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}
function currentRoomObj(){
  const room=state.rooms[state.currentRoom];
  if(!room||typeof room!=='object') return null;
  ['members','wishlist','events','secrets','memories'].forEach(key=>{
    if(!Array.isArray(room[key])) room[key]=[];
  });
  return room;
}

function getApiUrl(force){
  let url=localStorage.getItem('sharedwish_apiurl')||window.SHAREDWISH_API_URL||'';
  if(url==='REPLACE_WITH_APPS_SCRIPT_WEB_APP_URL') url='';
  if(!url||force){
    url=prompt('Masukkan Apps Script Web App URL (hasil deploy backend):', url||'');
    if(url) localStorage.setItem('sharedwish_apiurl', url.trim());
  }
  return url;
}
function extractSheetId(input){
  const m=(input||'').match(/[-\w]{25,}/);
  return m?m[0]:(input||'').trim();
}
async function api(body,auth=true){
  const url=getApiUrl(); if(!url) throw new Error('Apps Script URL belum diatur');
  let session;
  try{session=await getAuthSession();}
  catch(error){
    if(/Sesi akun berakhir|Sesi pemulihan berakhir/.test(error.message)){
      sessionStorage.removeItem(AUTH_STORAGE_KEY);
      location.replace('index.html');
    }
    throw error;
  }
  body={...body,idToken:session.idToken,appToken:session.appToken};
  if(auth){ body={...body,roomId:state.currentRoom,name:state.currentUser,profileId:session.uid,previousNames}; }
  const res=await fetch(url,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(body)});
  const data=await res.json();
  if(data.error) throw new Error(data.error);
  return data;
}
const PIN_OK=v=>/^\d{4,8}$/.test(v);
function switchAuthTab(mode){
  document.getElementById('tab-join').classList.toggle('active',mode==='join');
  document.getElementById('tab-create').classList.toggle('active',mode==='create');
  document.getElementById('form-join').classList.toggle('active',mode==='join');
  document.getElementById('form-create').classList.toggle('active',mode==='create');
}
function genRoomId(name){
  const base=(name||'ROOM').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6)||'ROOM';
  return base+Math.random().toString(36).slice(2,7).toUpperCase();
}
async function joinRoom(){
  const roomId=document.getElementById('in-roomid').value.trim().toUpperCase();
  const userName=profileName;
  const pin=document.getElementById('in-pin').value.trim();
  if(!roomId){ alert('Isi Room ID dulu ya.'); return; }
  if(!PIN_OK(pin)){ alert('PIN harus 4–8 angka.'); return; }
  if(!getApiUrl()) return;
  const btn=document.getElementById('btn-join'); btn.disabled=true; btn.textContent='Menghubungkan...';
  try{
    const r=await api({action:'joinRoom',roomId,name:userName,pin,profileId,previousNames},false);
    const old=state.rooms[roomId]||{members:[],wishlist:[]};
    state.rooms[roomId]={...old,name:r.roomName||roomId,memberId:r.memberId,profileId:r.profileId||profileId};
    state.currentRoom=roomId; state.currentUser=r.name;
    saveState(); document.getElementById('in-pin').value='';
    await syncRoom(); goRoom();
  }catch(err){ alert('Gagal masuk: '+err.message); }
  finally{ btn.disabled=false; btn.textContent='Masuk'; }
}
async function createRoom(){
  const roomName=document.getElementById('in-newroomname').value.trim();
  const sheetInput=document.getElementById('in-sheeturl').value.trim();
  const userName=profileName;
  const pin=document.getElementById('in-newpin').value.trim();
  const createCode=document.getElementById('in-createcode').value.trim();
  if(!roomName||!sheetInput){ alert('Isi nama room dan link Spreadsheet dulu ya.'); return; }
  if(!PIN_OK(pin)){ alert('PIN harus 4–8 angka.'); return; }
  if(!getApiUrl()) return;
  const spreadsheetId=extractSheetId(sheetInput);
  const roomId=genRoomId(roomName);
  const btn=document.getElementById('btn-create'); btn.disabled=true; btn.textContent='Membuat room...';
  try{
    const r=await api({action:'createRoom',roomId,roomName,spreadsheetId,name:userName,pin,createCode,profileId},false);
    state.rooms[roomId]={name:roomName,memberId:r.memberId,profileId:r.profileId||profileId,members:[r.name],wishlist:[]};
    state.currentRoom=roomId; state.currentUser=r.name;
    saveState(); document.getElementById('in-newpin').value='';
    goRoom();
    alert('Room dibuat! Room ID: '+roomId+'\nBagikan Room ID ke pasanganmu. Saat pertama masuk, dia membuat PIN-nya sendiri.');
  }catch(err){ alert('Gagal membuat room: '+err.message); }
  finally{ btn.disabled=false; btn.textContent='Buat Room Baru'; }
}
function logout(){
  sessionStorage.removeItem(AUTH_STORAGE_KEY);
  state.currentRoom=null; state.currentUser=null; saveState();
  location.replace('index.html');
}

async function getAuthSession(){
  if(!authSession){
    try{authSession=JSON.parse(sessionStorage.getItem(AUTH_STORAGE_KEY)||'null');}catch(error){authSession=null;}
  }
  if(!authSession) throw new Error('Sesi akun berakhir. Silakan login kembali.');
  if(authSession.recoveryAuth){
    if(authSession.expiresAt>Date.now()) return authSession;
    throw new Error('Sesi pemulihan berakhir. Masuk kembali dengan kode pemulihan.');
  }
  if(!authSession.refreshToken) throw new Error('Sesi akun berakhir. Silakan login kembali.');
  if(authSession.expiresAt>Date.now()+60000) return authSession;
  const response=await fetch(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(FIREBASE_API_KEY)}`,{
    method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({grant_type:'refresh_token',refresh_token:authSession.refreshToken})
  });
  const result=await response.json();
  if(!response.ok) throw new Error('Sesi akun berakhir. Silakan login kembali.');
  authSession.idToken=result.id_token;
  authSession.refreshToken=result.refresh_token||authSession.refreshToken;
  authSession.expiresAt=Date.now()+(Number(result.expires_in)||3600)*1000;
  sessionStorage.setItem(AUTH_STORAGE_KEY,JSON.stringify(authSession));
  return authSession;
}

async function syncRoom(){
  const room=currentRoomObj();
  if(!room) return;
  const note=document.getElementById('sync-note');
  if(note) note.textContent='Menyinkronkan...';
  try{
    const r=await api({action:'sync'});
    if(Array.isArray(r.wishlist)) room.wishlist=r.wishlist;
    if(Array.isArray(r.events)) room.events=r.events;
    if(Array.isArray(r.secrets)) room.secrets=r.secrets;
    if(Array.isArray(r.memories)) room.memories=r.memories;
    if(Array.isArray(r.members)&&r.members.length) room.members=r.members.map(m=>m.name);
    if(r.roomName) room.name=r.roomName;
    if(r.memberId) room.memberId=r.memberId;
    if(r.name) state.currentUser=r.name;
    saveState();
    if(note) note.textContent='';
  }catch(err){
    if(/Sesi akun tidak valid|Sesi akun berakhir|Sesi pemulihan tidak valid/.test(err.message)){logout();return;}
    if(/Sesi pemulihan berakhir/.test(err.message)){location.replace('index.html');return;}
    if(/Sesi tidak valid|Room tidak ditemukan/.test(err.message)){
      state.currentRoom=null;state.currentUser=null;saveState();show('screen-login');
      alert('Masuk ke room dengan Room ID dan PIN untuk melanjutkan.');return;
    }
    if(/Sesi akun berakhir/.test(err.message)){logout();return;}
    if(note) note.textContent='Gagal sinkron ('+err.message+') — menampilkan data tersimpan terakhir.';
  }
}
function goRoom(skip){
  const room=currentRoomObj();
  if(!room){ show('screen-login'); return; }
  document.getElementById('room-name').textContent=room.name;
  const memberNames=[state.currentUser,...room.members.filter(name=>String(name).toLowerCase()!==String(state.currentUser).toLowerCase())];
  const profilePhoto=localStorage.getItem('sharedwish_profile_photo_'+profileId)||'';
  document.getElementById('room-members').innerHTML=memberNames.map((name,index)=>{
    const current=index===0;
    const avatar=current&&profilePhoto
      ?`<img src="${escapeHtml(profilePhoto)}" alt="" style="width:22px;height:22px;border-radius:50%;object-fit:cover;">`
      :icon('person',true);
    const content=`${avatar}${escapeHtml(name)}`;
    return current
      ?`<a class="member-chip current" href="index.html" aria-label="Buka profil ${escapeHtml(name)}">${content}</a>`
      :`<span class="member-chip">${content}</span>`;
  }).join('');
  document.getElementById('room-id-badge').textContent='Room ID: '+state.currentRoom;
  const c={idea:0,planned:0,preparing:0,done:0};
  room.wishlist.forEach(w=>c[w.status]=(c[w.status]||0)+1);
  document.getElementById('room-stats').innerHTML=`
    <div class="stat"><b>${room.wishlist.length}</b><span>Total</span></div>
    <div class="stat"><b>${c.planned+c.preparing}</b><span>Berjalan</span></div>
    <div class="stat"><b>${c.done}</b><span>Selesai</span></div>`;
  renderProgress(room,c); renderBanners(room);
  show('screen-room');
  if(skip!==true) syncRoom().then(()=>{ if(document.getElementById('screen-room').classList.contains('active')) goRoom(true); });
}
async function goWishlist(){
  show('screen-wishlist');
  renderWishlist();
  await syncRoom();
  renderWishlist();
}

function renderWishlist(){
  const room=currentRoomObj();
  const list=document.getElementById('wishlist-list');
  if(!room.wishlist.length){
    list.innerHTML='<div class="empty">Belum ada wishlist.<br>Ketuk + untuk menambah hal yang ingin kalian lakukan bersama.</div>';
    return;
  }
  const order={idea:0,planned:1,preparing:2,done:3};
  const sorted=[...room.wishlist].sort((a,b)=>order[a.status]-order[b.status]);
  list.innerHTML=sorted.map(w=>`
    <div class="card wish-item" onclick="openModal('${w.id}')">
      <div>
        <div class="wish-title">${escapeHtml(w.title)}</div>
        <div class="wish-meta">${escapeHtml(w.category)} · ${escapeHtml(w.priority)}${w.target?' · '+w.target:''} · oleh ${escapeHtml(w.creator)}</div>
      </div>
      ${wishSide(w)}
    </div>`).join('');
}
function escapeHtml(s){ return (s||'').toString().replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function openModal(id){
  editingId=id||null;
  const room=currentRoomObj();
  const del=document.getElementById('btn-delete');
  if(editingId){
    const w=room.wishlist.find(x=>x.id===editingId);
    document.getElementById('modal-title').textContent='Edit Wishlist';
    document.getElementById('f-title').value=w.title;
    document.getElementById('f-desc').value=w.description||'';
    document.getElementById('f-category').value=w.category;
    document.getElementById('f-priority').value=w.priority;
    document.getElementById('f-status').value=w.status;
    document.getElementById('f-target').value=d10(w.target);
    del.style.display='block';
  }else{
    document.getElementById('modal-title').textContent='Tambah Wishlist';
    document.getElementById('f-title').value='';
    document.getElementById('f-desc').value='';
    document.getElementById('f-category').value='Umum';
    document.getElementById('f-priority').value='Sedang';
    document.getElementById('f-status').value='idea';
    document.getElementById('f-target').value='';
    del.style.display='none';
  }
  updateMemBtn();
  document.getElementById('modal-back').classList.add('active');
}
function closeModal(){ document.getElementById('modal-back').classList.remove('active'); editingId=null; }

async function saveWish(){
  const title=document.getElementById('f-title').value.trim();
  if(!title){ alert('Judul wajib diisi.'); return; }
  const data={
    title,
    description:document.getElementById('f-desc').value.trim(),
    category:document.getElementById('f-category').value,
    priority:document.getElementById('f-priority').value,
    status:document.getElementById('f-status').value,
    target:document.getElementById('f-target').value,
  };
  const btn=document.getElementById('btn-save'); btn.disabled=true; btn.textContent='Menyimpan...';
  try{
    const prev=editingId&&currentRoomObj().wishlist.find(x=>x.id===editingId);
    const wasDone=!!prev&&prev.status==='done';
    if(editingId){ data.id=editingId; await api({action:'update',sheet:'Wishlist',data}); }
    else { data.id='W'+Date.now(); await api({action:'add',sheet:'Wishlist',data}); }
    closeModal(); await syncRoom(); renderWishlist();
    if(data.status==='done'&&!wasDone&&confirm('Selesai! Simpan sebagai Memory sekarang?')) memWish(data.id);
  }catch(err){ alert('Gagal menyimpan: '+err.message); }
  finally{ btn.disabled=false; btn.textContent='Simpan'; }
}
async function deleteWish(){
  if(!editingId||!confirm('Hapus wishlist ini?')) return;
  try{ await api({action:'delete',sheet:'Wishlist',id:editingId}); closeModal(); await syncRoom(); renderWishlist(); }
  catch(err){ alert('Gagal menghapus: '+err.message); }
}

/* ---------- V2: event & reminder ---------- */
const ENT={
 events:{sheet:'Events',title:'Event',icon:'event',fields:[['title','Nama acara','text'],['date','Tanggal','date'],['time','Jam','time'],['location','Lokasi','text'],['notes','Catatan','textarea'],['reminder','Reminder','select',[['none','Tanpa reminder'],['0','Pada hari H'],['1','H-1 (sehari sebelum)'],['3','H-3'],['7','H-7']]]]},
 secrets:{sheet:'Secrets',title:'Secret Wishlist',icon:'lock',sub:'Hanya kamu yang melihat ini di aplikasi',fields:[['title','Judul','text'],['description','Deskripsi','textarea']]},
 memories:{sheet:'Memories',title:'Memory',icon:'photo_camera',sub:'Arsip pengalaman kalian — lahir dari wishlist yang terwujud atau event yang sudah lewat',fields:[['title','Judul kenangan','text'],['date','Tanggal kejadian','date'],['note','Cerita — apa yang terjadi dan apa yang kalian rasakan?','textarea'],['image','Link foto (Google Drive / URL)','text']]}
};
let entKey=null, entEditId=null;
const d10=v=>(v||'').toString().slice(0,10);
function daysUntil(ds){ const d=new Date(d10(ds)+'T00:00:00'), t=new Date(); t.setHours(0,0,0,0); return Math.round((d-t)/864e5); }
function reminderList(room){
  return (room.events||[]).filter(e=>e.date&&e.reminder!==''&&e.reminder!=='none'&&e.reminder!==undefined).map(e=>{
    const dl=daysUntil(e.date); if(dl<0||dl>+e.reminder) return null;
    const txt=dl===0?`Hari ini — ${e.title}${e.time?' pukul '+e.time:''}`:dl===1?`Besok — ${e.title}`:`${dl} hari lagi — ${e.title}`;
    return {id:e.id,txt};
  }).filter(Boolean);
}
function renderBanners(room){
  const list=reminderList(room);
  document.getElementById('banners').innerHTML=list.map(r=>`<div class="banner">${icon('notifications',true)} ${escapeHtml(r.txt)}</div>`).join('');
  if('Notification' in window && Notification.permission==='granted'){
    const today=new Date().toDateString();
    list.forEach(r=>{ try{ const k='sw_n_'+r.id+'_'+today; if(!localStorage.getItem(k)){ localStorage.setItem(k,1); new Notification('SharedWish',{body:r.txt}); } }catch(e){} });
  }
}
function enableNotif(){
  if(!('Notification' in window)){ alert('Browser ini tidak mendukung notifikasi.'); return; }
  Notification.requestPermission().then(p=>{ if(p==='granted'){ alert('Notifikasi aktif. Pengingat muncul saat aplikasi dibuka.'); renderBanners(currentRoomObj()); } else alert('Izin notifikasi ditolak.'); });
}
function fieldHtml(f,v){
  const [k,l,t,o]=f, val=escapeHtml(v||'');
  const inp=t==='textarea'?`<textarea id="e-${k}" rows="2">${val}</textarea>`
    :t==='select'?`<select id="e-${k}">${o.map(([a,b])=>`<option value="${a}"${String(v)===a?' selected':''}>${b}</option>`).join('')}</select>`
    :`<input id="e-${k}" type="${t}" value="${val}">`;
  return `<label class="lb">${l}</label>${inp}`;
}
function entRows(){ return currentRoomObj()[entKey]||[]; }
function goEntity(k){
  entKey=k; const c=ENT[k];
  document.getElementById('ent-title').innerHTML=`${icon(c.icon)} ${c.title}`;
  document.getElementById('ent-sub').textContent=c.sub||'';
  document.getElementById('ent-fab').style.display=k==='memories'?'none':'flex';
  show('screen-entity'); renderEnt();
  syncRoom().then(()=>{ if(entKey===k) renderEnt(); });
}
function renderEnt(){
  let rows=[...entRows()];
  if(entKey==='events') rows.sort((a,b)=>(d10(a.date)+a.time).localeCompare(d10(b.date)+b.time));
  if(entKey==='memories') rows.sort((a,b)=>d10(b.date).localeCompare(d10(a.date)));
  const el=document.getElementById('ent-list');
  if(!rows.length){ el.innerHTML=entKey==='memories'?'<div class="empty">Belum ada memory.<br>Tandai wishlist sebagai selesai, atau buka event yang sudah lewat, lalu pilih “Jadikan Memory”.</div>':'<div class="empty">Belum ada data. Ketuk + untuk menambah.</div>'; return; }
  if(entKey==='memories'){ el.innerHTML=rows.map(memCard).join(''); return; }
  el.innerHTML=rows.map(r=>{
    let meta='', extra='';
    if(entKey==='events'){ const dl=r.date?daysUntil(r.date):null; meta=[d10(r.date),r.time,r.location].filter(Boolean).join(' · '); extra=evSide(r,dl); if(r.notes) meta+=`<br>${escapeHtml(r.notes)}`; }
    if(entKey==='secrets') meta=escapeHtml(r.description);
    if(entKey==='memories'){ meta=[d10(r.date)].filter(Boolean).join('')+(r.note?'<br>'+escapeHtml(r.note):''); {const rl=refLabel(r); if(rl) meta+='<br>'+icon('link',true)+' '+escapeHtml(rl);}
      if(/^https?:\/\//.test(r.image||'')) meta+=`<br><a href="${escapeHtml(r.image)}" target="_blank" rel="noopener">${icon('photo_camera',true)} Lihat foto</a>`; }
    return `<div class="card wish-item" onclick="openEnt('${r.id}')"><div><div class="wish-title">${escapeHtml(r.title)}</div><div class="wish-meta">${entKey==='events'?escapeHtml(meta).replace(/&lt;br&gt;/g,'<br>'):meta}</div></div>${extra}</div>`;
  }).join('');
}
let entRef=null;
function findMem(type,id){ return (currentRoomObj().memories||[]).find(m=>m.ref_type===type&&m.ref_id===id); }
function refLabel(m){
  if(!m.ref_type||!m.ref_id) return '';
  const r=currentRoomObj(), list=m.ref_type==='wishlist'?r.wishlist:(r.events||[]);
  const src=list.find(x=>x.id===m.ref_id);
  return src?(m.ref_type==='wishlist'?'Wishlist: ':'Event: ')+src.title:'';
}
function memoryFrom(type,id,title,date){
  const m=findMem(type,id);
  if(type==='wishlist') closeModal(); else closeEnt();
  goEntity('memories');
  if(m) openEnt(m.id); else openEnt(null,{title,date:d10(date)||d10(new Date().toISOString()),ref_type:type,ref_id:id});
}
function updateMemBtn(){
  const b=document.getElementById('btn-mem'); b.style.display='none';
  const w=editingId&&currentRoomObj().wishlist.find(x=>x.id===editingId);
  if(!w||w.status!=='done') return;
  b.innerHTML=`${icon('photo_camera',true)} ${findMem('wishlist',w.id)?'Lihat Memory':'Simpan sebagai Memory'}`;
  b.style.display='inline-block';
}
function memWish(id){ const w=currentRoomObj().wishlist.find(x=>x.id===(id||editingId)); if(w) memoryFrom('wishlist',w.id,w.title,w.target); }
function memEvt(id){ const e=(currentRoomObj().events||[]).find(x=>x.id===id); if(e) memoryFrom('events',id,e.title,e.date); }
function openEnt(id,pre){
  entEditId=id||null; entRef=pre&&pre.ref_id?{ref_type:pre.ref_type,ref_id:pre.ref_id}:null;
  const c=ENT[entKey];
  const row=id?entRows().find(x=>x.id===id):(pre||{reminder:'1'});
  document.getElementById('ent-mtitle').textContent=(id?'Edit ':'Tambah ')+c.title.replace(/^\S+\s/,'');
  document.getElementById('ent-fields').innerHTML=c.fields.map(f=>fieldHtml(f,f[2]==='date'?d10(row[f[0]]):row[f[0]])).join('');
  let extra='';
  if(entKey==='events'&&id){ const m=findMem('events',id); if(m||daysUntil(row.date)<=0) extra=`<button class="btn-sm" style="margin-bottom:12px" onclick="memEvt('${id}')">${icon('photo_camera',true)} ${m?'Lihat Memory':'Simpan sebagai Memory'}</button>`; }
  if(entKey==='memories'){ const rl=refLabel(row); if(rl) extra=`<p class="badge">${icon('link',true)} ${escapeHtml(rl)}</p>`; }
  document.getElementById('ent-extra').innerHTML=extra;
  document.getElementById('ent-del').style.display=id?'block':'none';
  document.getElementById('ent-modal').classList.add('active');
}
function closeEnt(){ document.getElementById('ent-modal').classList.remove('active'); entEditId=null; }
async function saveEnt(){
  const c=ENT[entKey], data={};
  c.fields.forEach(f=>data[f[0]]=document.getElementById('e-'+f[0]).value.trim());
  if(!data.title){ alert('Judul wajib diisi.'); return; }
  if(entKey==='events'&&!data.date){ alert('Tanggal acara wajib diisi.'); return; }
  const btn=document.getElementById('ent-save'); btn.disabled=true; btn.textContent='Menyimpan...';
  try{
    if(entEditId) data.id=entEditId; else { data.id='X'+Date.now(); if(entRef) Object.assign(data,entRef); }
    await api({action:entEditId?'update':'add',sheet:c.sheet,data});
    closeEnt(); await syncRoom(); renderEnt();
  }catch(err){ alert('Gagal menyimpan: '+err.message); }
  finally{ btn.disabled=false; btn.textContent='Simpan'; }
}
async function delEnt(){
  if(!entEditId||!confirm('Hapus data ini?')) return;
  try{ await api({action:'delete',sheet:ENT[entKey].sheet,id:entEditId}); closeEnt(); await syncRoom(); renderEnt(); }
  catch(err){ alert('Gagal menghapus: '+err.message); }
}

/* ---------- alur: selesai -> memory ---------- */
function wishSide(w){
  const pill=`<span class="status-pill">${statusMarkup(w.status)}</span>`;
  const btn=w.status==='done'
    ?`<button class="btn-sm" onclick="event.stopPropagation();memWish('${w.id}')">${icon('photo_camera',true)} ${findMem('wishlist',w.id)?'Lihat Memory':'Jadikan Memory'}</button>`
    :`<button class="btn-sm" onclick="event.stopPropagation();completeWish('${w.id}')">${icon('check',true)} Tandai selesai</button>`;
  return `<div class="side">${pill}${btn}</div>`;
}
async function completeWish(id){
  const w=currentRoomObj().wishlist.find(x=>x.id===id); if(!w) return;
  if(!confirm('Tandai "'+w.title+'" sudah selesai dilakukan?')) return;
  try{
    await api({action:'update',sheet:'Wishlist',data:{id,status:'done'}});
    await syncRoom(); renderWishlist();
    if(confirm('Selesai! Simpan sebagai Memory sekarang?')) memWish(id);
  }catch(err){ alert('Gagal memperbarui status: '+err.message); }
}
function evSide(r,dl){
  if(dl===null) return '';
  const pill=`<span class="status-pill">${dl<0?'Lewat':dl===0?'Hari ini':dl+' hari lagi'}</span>`;
  const has=findMem('events',r.id);
  const btn=(has||dl<=0)?`<button class="btn-sm" onclick="event.stopPropagation();memEvt('${r.id}')">${icon('photo_camera',true)} ${has?'Lihat Memory':'Jadikan Memory'}</button>`:'';
  return `<div class="side">${pill}${btn}</div>`;
}
function imgUrl(u){
  u=u||''; const g=u.match(/drive\.google\.com\/file\/d\/([\w-]+)/)||(/drive\.google\.com/.test(u)?u.match(/[?&]id=([\w-]+)/):null);
  if(g) return 'https://drive.google.com/thumbnail?id='+g[1]+'&sz=w800';
  return /^https?:\/\//.test(u)?u:'';
}
function longDate(ds){ const t=d10(ds); return t?new Date(t+'T00:00:00').toLocaleDateString('id-ID',{day:'numeric',month:'long',year:'numeric'}):''; }
function memCard(m){
  const img=imgUrl(m.image), rl=refLabel(m);
  return `<div class="card mem" onclick="openEnt('${m.id}')">${img?`<img src="${escapeHtml(img)}" alt="" onerror="this.style.display='none'">`:''}
    <div class="wish-title" style="font-size:17px">${escapeHtml(m.title)}</div>
    <div class="wish-meta">${longDate(m.date)}${rl?' · '+icon('link',true)+' '+escapeHtml(rl):''}</div>
    ${m.note?`<p class="story">“${escapeHtml(m.note)}”</p>`:''}</div>`;
}

/* ---------- V3: progress ---------- */
function renderProgress(room,c){
  const t=room.wishlist.length||1;
  const seg=[['idea',.3],['planned',.55],['preparing',.8],['done',1]];
  document.getElementById('progress').innerHTML=`<b>${icon('monitoring',true)} Progress wishlist</b>
    <div class="bar">${seg.map(([k,o])=>`<i style="width:${(c[k]||0)/t*100}%;opacity:${o}"></i>`).join('')}</div>
    <span class="badge">${Object.keys(STATUS_LABEL).map(k=>`${icon(STATUS_ICON[k],true)} ${STATUS_LABEL[k]} ${c[k]||0}`).join(' · ')}</span>
    <div class="badge" style="margin-top:6px">${icon('event',true)} ${(room.events||[]).length} event · ${icon('photo_camera',true)} ${(room.memories||[]).length} memory · ${icon('lock',true)} ${(room.secrets||[]).length} secret</div>`;
}

/* ---------- V4: undang & export ---------- */
function shareRoom(){
  const room=currentRoomObj(), id=state.currentRoom;
  const url=location.protocol.startsWith('http')&&!/^(127\.|localhost)/.test(location.hostname)?new URL('index.html',location.href).href+'?room='+id:'';
  const text=`Gabung ke room "${room.name}" di SharedWish.\nRoom ID: ${id}`+(url?`\nLink: ${url}`:'');
  if(navigator.share) navigator.share({text}).catch(()=>{});
  else if(navigator.clipboard) navigator.clipboard.writeText(text).then(()=>alert('Undangan disalin:\n\n'+text));
  else prompt('Salin undangan:',text);
}
function download(name,mime,content){
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([content],{type:mime})); a.download=name; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}
function exportJson(){
  const r=currentRoomObj();
  download(`sharedwish-${state.currentRoom}.json`,'application/json',JSON.stringify({room:r.name,roomId:state.currentRoom,members:r.members,wishlist:r.wishlist,events:r.events||[],memories:r.memories||[],secret_saya:r.secrets||[]},null,2));
}
function exportCsv(){
  const r=currentRoomObj(), q=v=>'"'+String(v==null?'':v).replace(/"/g,'""')+'"';
  const L=[['tipe','judul','tanggal','status/reminder','catatan','pembuat']];
  r.wishlist.forEach(w=>L.push(['wishlist',w.title,d10(w.target),w.status,w.description,w.creator]));
  (r.events||[]).forEach(e=>L.push(['event',e.title,(d10(e.date)+' '+(e.time||'')).trim(),e.reminder,e.notes,e.creator]));
  (r.memories||[]).forEach(m=>L.push(['memory',m.title,d10(m.date),'',m.note,m.creator]));
  download(`sharedwish-${state.currentRoom}.csv`,'text/csv;charset=utf-8','\ufeff'+L.map(x=>x.map(q).join(',')).join('\n'));
}

const qRoom=new URLSearchParams(location.search).get('room');
async function startApp(){
  try{authSession=JSON.parse(sessionStorage.getItem(AUTH_STORAGE_KEY)||'null');}catch(error){authSession=null;}
  if(!authSession){location.replace('index.html'+location.search);return;}
  try{authSession=await getAuthSession();}
  catch(error){sessionStorage.removeItem(AUTH_STORAGE_KEY);location.replace('index.html'+location.search);return;}
  profileId=authSession.uid;
  const nameKey='sharedwish_profile_'+profileId;
  profileName=(localStorage.getItem(nameKey)||authSession.displayName||authSession.username||'').trim();
  try{
    previousNames=JSON.parse(localStorage.getItem('sharedwish_profile_previous_names_'+profileId)||'[]');
    if(!Array.isArray(previousNames))previousNames=[];
  }catch(error){previousNames=[];}
  document.getElementById('login-profile-name').textContent=profileName;
  const profilePhoto=localStorage.getItem('sharedwish_profile_photo_'+profileId);
  if(profilePhoto){
    document.getElementById('login-profile-photo').src=profilePhoto;
    document.getElementById('login-profile-photo').style.display='block';
    document.getElementById('login-profile-placeholder').style.display='none';
  }
  if(qRoom) document.getElementById('in-roomid').value=qRoom.toUpperCase();
  loadState();
  if(state.accountUid!==profileId||(qRoom&&state.currentRoom!==qRoom.toUpperCase())){
    state.currentRoom=null;state.currentUser=null;
  }
  state.accountUid=profileId;
  saveState();
  if(state.currentRoom&&state.rooms[state.currentRoom]) goRoom();
  else show('screen-login');
}
startApp();