const firebaseApiKey=(window.SHAREDWISH_FIREBASE_CONFIG||{}).apiKey||'';
const sessionKey='sharedwish_auth';
const params=new URLSearchParams(location.search);
const nameInput=document.getElementById('profile-name');
const photoInput=document.getElementById('profile-photo');
const photoPreview=document.getElementById('photo-preview');
const photoPlaceholder=document.getElementById('photo-placeholder');
const photoError=document.getElementById('photo-error');
const authError=document.getElementById('auth-error');
const authForm=document.getElementById('auth-form');
const recoveryForm=document.getElementById('recovery-form');
const profileForm=document.getElementById('profile-form');
const usernameInput=document.getElementById('auth-username');
const passwordInput=document.getElementById('auth-password');
const confirmPasswordInput=document.getElementById('auth-confirm-password');
const rememberUsername=document.getElementById('remember-username');
const recoveryUsernameInput=document.getElementById('recovery-username');
let authMode='login', account=null, existingName='', selectedPhoto='';
let previousNames=[];

function accountProfileKey(uid){return 'sharedwish_profile_'+uid;}
function accountPhotoKey(uid){return 'sharedwish_profile_photo_'+uid;}
function accountPreviousNamesKey(uid){return 'sharedwish_profile_previous_names_'+uid;}
function usernameValid(username){return /^[a-z0-9._-]{3,30}$/i.test(username);}
function configured(){return !!firebaseApiKey&&firebaseApiKey!=='REPLACE_WITH_YOUR_API_KEY';}
function usernameEmail(username){return username.toLowerCase()+'@sharedwish.invalid';}

function setAuthMode(mode){
  authMode=mode;
  document.getElementById('tab-login').hidden=mode==='login';
  document.getElementById('tab-register').hidden=mode==='register'||mode==='recover';
  document.getElementById('tab-recover').hidden=mode==='recover';
  document.getElementById('auth-switch-copy').textContent=mode==='recover'?'Kembali ke':mode==='register'?'Sudah punya akun?':'Belum punya akun?';
  authForm.hidden=mode==='recover';
  recoveryForm.hidden=mode!=='recover';
  document.getElementById('auth-heading').textContent=mode==='register'?'Buat akun':'Login';
  document.getElementById('auth-subtitle').textContent=mode==='register'?'Buat akun untuk melanjutkan ke SharedWish.':'Selamat datang kembali, masuk ke akun SharedWish kamu.';
  document.getElementById('auth-submit').innerHTML='<span class="icon" aria-hidden="true" style="color:inherit">'+(mode==='register'?'person_add':'login')+'</span> '+(mode==='register'?'Daftar':'Masuk');
  document.getElementById('confirm-password-wrap').hidden=mode!=='register';
  passwordInput.autocomplete=mode==='login'?'current-password':'new-password';
  authError.textContent='';
}
document.getElementById('tab-login').addEventListener('click',()=>setAuthMode('login'));
document.getElementById('tab-register').addEventListener('click',()=>setAuthMode('register'));
document.getElementById('tab-recover').addEventListener('click',()=>setAuthMode('recover'));
document.getElementById('toggle-password').addEventListener('click',()=>{
  const show=passwordInput.type==='password';
  passwordInput.type=show?'text':'password';
  document.querySelector('#toggle-password .icon').textContent=show?'visibility':'visibility_off';
  document.getElementById('toggle-password').setAttribute('aria-label',show?'Sembunyikan password':'Tampilkan password');
});
const rememberedUsername=localStorage.getItem('sharedwish_login_username')||'';
if(rememberedUsername){usernameInput.value=rememberedUsername;rememberUsername.checked=true;}

/* ===== Firebase REST helpers ===== */
function firebaseMessage(code){
  const m={
    EMAIL_EXISTS:'Username sudah digunakan. Coba username lain.',
    INVALID_LOGIN_CREDENTIALS:'Username atau password salah.',
    EMAIL_NOT_FOUND:'Username atau password salah.',
    INVALID_PASSWORD:'Username atau password salah.',
    WEAK_PASSWORD:'Password terlalu lemah. Gunakan minimal 8 karakter.',
    OPERATION_NOT_ALLOWED:'Provider Email/Password belum diaktifkan di Firebase.',
    API_KEY_INVALID:'Firebase API key belum benar.',
    TOO_MANY_ATTEMPTS_TRY_LATER:'Terlalu banyak percobaan. Coba lagi nanti.',
  };
  return m[code]||'Autentikasi gagal. Periksa koneksi dan konfigurasi Firebase.';
}
async function firebaseRequest(method,payload){
  if(!configured()) throw new Error('Firebase belum dikonfigurasi. Isi config di firebase-config.js.');
  const response=await fetch('https://identitytoolkit.googleapis.com/v1/'+method+'?key='+encodeURIComponent(firebaseApiKey),{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)
  });
  const data=await response.json();
  if(!response.ok) throw new Error(firebaseMessage(data.error&&data.error.message));
  return data;
}
async function refreshFirebaseSession(session){
  if(session.expiresAt>Date.now()+60000) return session;
  const response=await fetch('https://securetoken.googleapis.com/v1/token?key='+encodeURIComponent(firebaseApiKey),{
    method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({grant_type:'refresh_token',refresh_token:session.refreshToken})
  });
  const data=await response.json();
  if(!response.ok) throw new Error('Sesi berakhir. Silakan login kembali.');
  session.idToken=data.id_token;
  session.refreshToken=data.refresh_token||session.refreshToken;
  session.expiresAt=Date.now()+(Number(data.expires_in)||3600)*1000;
  sessionStorage.setItem(sessionKey,JSON.stringify(session));
  return session;
}
async function updateFirebaseName(displayName){
  account=await refreshFirebaseSession(account);
  const updated=await firebaseRequest('accounts:update',{idToken:account.idToken,displayName,returnSecureToken:true});
  account.idToken=updated.idToken||account.idToken;
  account.refreshToken=updated.refreshToken||account.refreshToken;
  account.expiresAt=Date.now()+(Number(updated.expiresIn)||3600)*1000;
  account.displayName=displayName;
  sessionStorage.setItem(sessionKey,JSON.stringify(account));
}

/* ===== Photo helpers ===== */
function renderPhotoPreview(){
  photoPreview.style.display=selectedPhoto?'block':'none';
  photoPlaceholder.style.display=selectedPhoto?'none':'inline-flex';
  if(selectedPhoto) photoPreview.src=selectedPhoto;
  else photoPreview.removeAttribute('src');
}
function compressPhoto(file){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onerror=()=>reject(new Error('Foto tidak bisa dibaca.'));
    reader.onload=()=>{
      const image=new Image();
      image.onerror=()=>reject(new Error('File ini bukan gambar yang valid.'));
      image.onload=()=>{
        const size=256, side=Math.min(image.naturalWidth,image.naturalHeight);
        const canvas=document.createElement('canvas');
        canvas.width=size; canvas.height=size;
        canvas.getContext('2d').drawImage(image,(image.naturalWidth-side)/2,(image.naturalHeight-side)/2,side,side,0,0,size,size);
        resolve(canvas.toDataURL('image/jpeg',.82));
      };
      image.src=reader.result;
    };
    reader.readAsDataURL(file);
  });
}
photoInput.addEventListener('change',async()=>{
  const file=photoInput.files[0];
  if(!file) return;
  if(!file.type.startsWith('image/')){photoError.textContent='Pilih file gambar.';photoInput.value='';return;}
  try{selectedPhoto=await compressPhoto(file);photoError.textContent='';renderPhotoPreview();}
  catch(e){photoError.textContent=e.message;}
});
document.getElementById('remove-photo').addEventListener('click',()=>{
  selectedPhoto=''; photoInput.value=''; photoError.textContent=''; renderPhotoPreview();
});

/* ===== Show profile form ===== */
function showProfile(session){
  account=session;
  const savedName=localStorage.getItem(accountProfileKey(session.uid));
  existingName=savedName||session.displayName||session.username;
  previousNames=[];
  try{const saved=JSON.parse(localStorage.getItem(accountPreviousNamesKey(session.uid))||'[]');if(Array.isArray(saved))previousNames=saved.filter(n=>typeof n==='string');}catch(e){}
  selectedPhoto=localStorage.getItem(accountPhotoKey(session.uid))||'';
  nameInput.value=existingName;
  document.getElementById('account-label').textContent='Login sebagai '+session.username;
  document.getElementById('auth-panel').hidden=true;
  document.getElementById('recovery-panel').hidden=true;
  profileForm.hidden=false;
  renderPhotoPreview();
}

/* ===== Auth form ===== */
authForm.addEventListener('submit',async event=>{
  event.preventDefault();
  authError.textContent='';
  const username=usernameInput.value.trim().toLowerCase();
  const password=passwordInput.value;
  if(!usernameValid(username)){authError.textContent='Username 3–30 karakter: huruf, angka, titik, garis bawah, atau strip.';return;}
  if(password.length<8){authError.textContent='Password minimal 8 karakter.';return;}
  if(authMode==='register'&&password!==confirmPasswordInput.value){authError.textContent='Konfirmasi password tidak sama.';return;}
  const button=document.getElementById('auth-submit');
  button.disabled=true;button.textContent=authMode==='login'?'Memeriksa...':'Membuat akun...';
  try{
    const method=authMode==='login'?'accounts:signInWithPassword':'accounts:signUp';
    let result=await firebaseRequest(method,{email:usernameEmail(username),password,returnSecureToken:true});
    if(rememberUsername.checked)localStorage.setItem('sharedwish_login_username',username);
    else localStorage.removeItem('sharedwish_login_username');
    let session={uid:result.localId,username,displayName:result.displayName||username,idToken:result.idToken,refreshToken:result.refreshToken,expiresAt:Date.now()+(Number(result.expiresIn)||3600)*1000};
    if(authMode==='register'){
      const legacyName=localStorage.getItem('sharedwish_profile')||'';
      session.displayName=legacyName||username;
      result=await firebaseRequest('accounts:update',{idToken:session.idToken,displayName:session.displayName,returnSecureToken:true});
      session.idToken=result.idToken||session.idToken;session.refreshToken=result.refreshToken||session.refreshToken;session.expiresAt=Date.now()+(Number(result.expiresIn)||3600)*1000;
    }
    sessionStorage.setItem(sessionKey,JSON.stringify(session));
    passwordInput.value='';confirmPasswordInput.value='';
    showProfile(session);
  }catch(error){authError.textContent=error.message;}
  finally{button.disabled=false;button.innerHTML='<span class="icon" aria-hidden="true" style="color:inherit">'+(authMode==='register'?'person_add':'login')+'</span> '+(authMode==='register'?'Daftar':'Masuk');}
});

/* ===== Recovery form: kirim email reset password ===== */
recoveryForm.addEventListener('submit',async event=>{
  event.preventDefault();
  authError.textContent='';
  const username=recoveryUsernameInput.value.trim().toLowerCase();
  if(!usernameValid(username)){authError.textContent='Masukkan username yang valid.';return;}
  const button=document.getElementById('recovery-submit');
  button.disabled=true;button.textContent='Mengirim...';
  try{
    await firebaseRequest('accounts:sendOobCode',{requestType:'PASSWORD_RESET',email:usernameEmail(username)});
    document.getElementById('recovery-panel').hidden=false;
    document.getElementById('auth-panel').hidden=true;
    document.getElementById('recovery-code-display').textContent='Email reset password sudah dikirim ke alamat yang terhubung dengan username "'+username+'". Cek inbox (dan folder Spam) kamu.';
    document.getElementById('copy-recovery').style.display='none';
  }catch(error){authError.textContent=error.message;}
  finally{button.disabled=false;button.textContent='Kirim email reset';}
});

document.getElementById('continue-after-recovery').addEventListener('click',()=>{
  document.getElementById('recovery-panel').hidden=true;
  document.getElementById('auth-panel').hidden=false;
  setAuthMode('login');
});

/* ===== Profile form ===== */
profileForm.addEventListener('submit',async event=>{
  event.preventDefault();
  const name=nameInput.value.trim().slice(0,30);
  if(!name){nameInput.focus();return;}
  const button=document.getElementById('profile-submit');
  button.disabled=true;button.textContent='Menyimpan...';photoError.textContent='';
  try{
    if(existingName&&existingName.toLowerCase()!==name.toLowerCase()&&!previousNames.some(old=>old.toLowerCase()===existingName.toLowerCase())) previousNames.push(existingName);
    if(name!==account.displayName) await updateFirebaseName(name);
    account.displayName=name;
    sessionStorage.setItem(sessionKey,JSON.stringify(account));
    localStorage.setItem(accountProfileKey(account.uid),name);
    localStorage.setItem(accountPreviousNamesKey(account.uid),JSON.stringify(previousNames));
    if(selectedPhoto)localStorage.setItem(accountPhotoKey(account.uid),selectedPhoto);
    else localStorage.removeItem(accountPhotoKey(account.uid));
    localStorage.removeItem('sharedwish_profile');
    localStorage.removeItem('sharedwish_profile_id');
    localStorage.removeItem('sharedwish_profile_previous_names');
    localStorage.removeItem('sharedwish_profile_photo');
    const savedState=JSON.parse(localStorage.getItem('sharedwish')||'{}');
    if(savedState.accountUid&&savedState.accountUid!==account.uid){savedState.currentRoom=null;savedState.currentUser=null;}
    if(existingName&&existingName.toLowerCase()!==name.toLowerCase()){savedState.currentRoom=null;savedState.currentUser=null;}
    savedState.accountUid=account.uid;
    localStorage.setItem('sharedwish',JSON.stringify(savedState));
    location.href='sharedwish-v1.html'+(params.has('room')?'?room='+encodeURIComponent(params.get('room')):'');
  }catch(error){photoError.textContent=error.message||'Profil gagal disimpan.';}
  finally{button.disabled=false;button.innerHTML='<span class="icon" aria-hidden="true" style="color:inherit">arrow_forward</span> Lanjutkan';}
});

/* ===== Ganti password (tombol "Ganti kode pemulihan" dialihfungsikan) ===== */
document.getElementById('rotate-recovery').addEventListener('click',async()=>{
  if(!account||!account.username) return;
  const button=document.getElementById('rotate-recovery');
  button.disabled=true;button.textContent='Mengirim email...';photoError.textContent='';
  try{
    await firebaseRequest('accounts:sendOobCode',{requestType:'PASSWORD_RESET',email:usernameEmail(account.username)});
    photoError.textContent='Email ganti password sudah dikirim. Cek inbox kamu.';
  }catch(error){photoError.textContent=error.message||'Gagal mengirim email.';}
  finally{button.disabled=false;button.textContent='Ganti password';}
});

document.getElementById('logout-button').addEventListener('click',()=>{
  sessionStorage.removeItem(sessionKey);
  try{const saved=JSON.parse(localStorage.getItem('sharedwish')||'{}');saved.currentRoom=null;saved.currentUser=null;localStorage.setItem('sharedwish',JSON.stringify(saved));}catch(e){}
  location.replace('index.html');
});

/* ===== Auto-restore session ===== */
(async()=>{
  if(!configured()){authError.textContent='Firebase belum dikonfigurasi. Isi config di firebase-config.js.';return;}
  const stored=sessionStorage.getItem(sessionKey);
  if(!stored)return;
  try{
    const session=await refreshFirebaseSession(JSON.parse(stored));
    showProfile(session);
  }catch(error){sessionStorage.removeItem(sessionKey);authError.textContent='Sesi berakhir. Silakan masuk kembali.';}
})();
