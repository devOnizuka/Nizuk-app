// js/engine/firebase-sync.js
// Autenticação (email/senha) + sincronização de progresso via Firestore.
// Carregado como <script type="module">, expõe window.NizukSync para os
// scripts clássicos (app.js etc.) chamarem sem precisar virar módulo.

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged, sendPasswordResetEmail,
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDiRJwfmhG1lhcBoESAzu5fhucvSXgQkAM",
  authDomain: "nizuk-25a12.firebaseapp.com",
  projectId: "nizuk-25a12",
  storageBucket: "nizuk-25a12.firebasestorage.app",
  messagingSenderId: "286392437628",
  appId: "1:286392437628:web:74e40daa5b48a67c91b2f9",
};

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

const AUTO_SYNC_MS = 90 * 1000; // sincroniza sozinho a cada 90s enquanto logado
let autoSyncTimer = null;
let currentUser = null;
let statusListeners = [];

function _notify(status, extra) {
  statusListeners.forEach(fn => { try { fn(status, extra); } catch (e) { console.warn(e); } });
}

function _userDocRef(uid) {
  return doc(db, 'users', uid);
}

async function pushToCloud() {
  if (!currentUser) return { ok: false, error: 'sem_login' };
  try {
    const snap = window.Storage.snapshot();
    await setDoc(_userDocRef(currentUser.uid), { ...snap, updatedAt: serverTimestamp() });
    _notify('synced');
    return { ok: true };
  } catch (e) {
    _notify('error', e);
    return { ok: false, error: e.message };
  }
}

async function pullFromCloud() {
  if (!currentUser) return { ok: false, error: 'sem_login' };
  try {
    const snap = await getDoc(_userDocRef(currentUser.uid));
    if (!snap.exists()) return { ok: false, error: 'sem_dados_na_nuvem' };
    const result = window.Storage.restore(snap.data());
    _notify('synced');
    return result;
  } catch (e) {
    _notify('error', e);
    return { ok: false, error: e.message };
  }
}

// Roda uma vez, logo após o login: decide se puxa a nuvem ou envia o local.
async function _resolveOnLogin() {
  try {
    const cloudSnap = await getDoc(_userDocRef(currentUser.uid));
    if (!cloudSnap.exists()) {
      // Primeira vez dessa conta: manda o que já existe neste aparelho.
      await pushToCloud();
      return;
    }
    const localStats = window.Storage.loadStats();
    const localTemDados = (localStats?.totalQuestoes || 0) > 0;
    if (localTemDados) {
      const usarNuvem = window.confirm(
        'Encontramos progresso salvo na nuvem para esta conta.\n\n' +
        'Substituir os dados deste aparelho pelos da nuvem?\n' +
        '(Recomendado ao logar pela 1ª vez num novo aparelho. ' +
        'Cancelar mantém os dados locais como estão — use "Sincronizar agora" depois se quiser enviar os dados locais.)'
      );
      if (usarNuvem) {
        window.Storage.restore(cloudSnap.data());
      }
    } else {
      // Aparelho sem progresso local relevante: só traz o da nuvem.
      window.Storage.restore(cloudSnap.data());
    }
    _notify('synced');
  } catch (e) {
    _notify('error', e);
  }
}

function _startAutoSync() {
  _stopAutoSync();
  autoSyncTimer = setInterval(() => { if (currentUser) pushToCloud(); }, AUTO_SYNC_MS);
  window.addEventListener('visibilitychange', _onVisibilityChange);
  window.addEventListener('beforeunload', _onBeforeUnload);
}

function _stopAutoSync() {
  if (autoSyncTimer) clearInterval(autoSyncTimer);
  autoSyncTimer = null;
  window.removeEventListener('visibilitychange', _onVisibilityChange);
  window.removeEventListener('beforeunload', _onBeforeUnload);
}

function _onVisibilityChange() {
  if (document.visibilityState === 'hidden' && currentUser) pushToCloud();
}
function _onBeforeUnload() {
  if (currentUser) pushToCloud();
}

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if (user) {
    _notify('login', { email: user.email });
    await _resolveOnLogin();
    _startAutoSync();
  } else {
    _notify('logout');
    _stopAutoSync();
  }
});

window.NizukSync = {
  async signUp(email, password) {
    try {
      await createUserWithEmailAndPassword(auth, email, password);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.code, message: _traduzErro(e.code) };
    }
  },
  async signIn(email, password) {
    try {
      await signInWithEmailAndPassword(auth, email, password);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.code, message: _traduzErro(e.code) };
    }
  },
  async resetPassword(email) {
    try {
      await sendPasswordResetEmail(auth, email);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.code, message: _traduzErro(e.code) };
    }
  },
  async signOutUser() {
    if (currentUser) await pushToCloud(); // garante que o último estado local subiu antes de sair
    await signOut(auth);
  },
  syncNow: pushToCloud,
  pullNow: pullFromCloud,
  isLoggedIn: () => !!currentUser,
  getUserEmail: () => currentUser?.email || null,
  onStatusChange(fn) { statusListeners.push(fn); },
};

function _traduzErro(code) {
  const map = {
    'auth/email-already-in-use': 'Este email já está cadastrado. Tente entrar em vez de cadastrar.',
    'auth/invalid-email': 'Email inválido.',
    'auth/weak-password': 'Senha muito curta (mínimo 6 caracteres).',
    'auth/user-not-found': 'Email não encontrado.',
    'auth/wrong-password': 'Senha incorreta.',
    'auth/invalid-credential': 'Email ou senha incorretos.',
    'auth/too-many-requests': 'Muitas tentativas. Aguarde um pouco e tente de novo.',
  };
  return map[code] || 'Erro ao autenticar. Tente novamente.';
}

window.dispatchEvent(new Event('nizuk-sync-ready'));
