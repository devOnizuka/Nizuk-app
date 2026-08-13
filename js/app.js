// js/app.js
const App = (() => {
  const NO_NAV = ['review','anki-review','detail','mode-select','result'];

  function showScreen(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const t = document.getElementById(`screen-${name}`);
    if (t) { t.classList.add('active'); window.scrollTo(0,0); }

    document.getElementById('navbar').style.display = NO_NAV.includes(name) ? 'none' : 'flex';

    const navMap = { 'anki-deck':'anki','anki-review':'anki','detail':'browse','mode-select':'home','result':'home' };
    const activeNav = navMap[name] || name;
    document.querySelectorAll('.nav-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.screen === activeNav)
    );
  }

  function init() {
    // Navbar
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const sc = btn.dataset.screen;
        showScreen(sc);
        if (sc==='home')   Dashboard.render();
        if (sc==='stats')  Stats.render();
        if (sc==='browse') Browse.render();
        if (sc==='anki')   Anki.renderDecks();
      });
    });

    Dashboard.render();
    Browse.init();
    Anki.init();

    // Atalhos de categoria → abre seleção de modo
    document.querySelectorAll('.shortcut-btn').forEach(btn => {
      btn.addEventListener('click', () => Review.abrirSelecao(btn.dataset.cat));
    });

    // Revisar agora → abre seleção sem categoria específica
    document.getElementById('btn-study-now').addEventListener('click', () => Review.abrirSelecao(''));

    // Voltar da seleção de modo
    document.getElementById('btn-back-mode').addEventListener('click', () => {
      showScreen('home'); Dashboard.render();
    });

    // Seleção de modo
    document.getElementById('btn-mode-encontrar').addEventListener('click', () => Review.iniciar('encontrar'));
    document.getElementById('btn-mode-reconhecer').addEventListener('click', () => Review.iniciar('reconhecer'));

    // Export / Import
    document.getElementById('btn-export').addEventListener('click', () => Storage.exportar());
    document.getElementById('import-file').addEventListener('change', e => {
      const file = e.target.files[0]; if(!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        const result = Storage.importar(ev.target.result);
        if (result.ok) {
          alert('✅ Progresso importado!');
          Dashboard.render();
        } else {
          alert('❌ Erro ao importar.\n' + (result.message || ''));
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    });

    // Revisão SRS
    document.getElementById('btn-back-review').addEventListener('click', () => {
      if (confirm('Sair da revisão? O progresso desta sessão será perdido.')) {
        showScreen('home'); Dashboard.render();
      }
    });
    document.querySelectorAll('#srs-btns .srs-btn').forEach(btn =>
      btn.addEventListener('click', () => Review.aplicarSRS(parseInt(btn.dataset.q)))
    );

    // Tela de resultado
    document.getElementById('btn-result-repeat').addEventListener('click', () => {
      Review.iniciar(Review._lastModo || 'reconhecer');
    });
    document.getElementById('btn-result-other').addEventListener('click', () => {
      Review.abrirSelecao(Review._lastCat || '');
    });
    document.getElementById('btn-result-home').addEventListener('click', () => {
      showScreen('home'); Dashboard.render();
    });

    // Detail back
    document.getElementById('btn-back-detail').addEventListener('click', () => showScreen('browse'));

    _initVolume();
    _initMute();

    // Fase 0.5 — inicializa sistemas de robustez APÓS o resto da UI estar pronta
    _initStorageGuard();

    initAccountUI();
  }

  // ── Conta / Sincronização (Firebase) ─────────────────────────────────
  function initAccountUI() {
    const modal        = document.getElementById('modal-account');
    const viewOut       = document.getElementById('account-logged-out');
    const viewIn         = document.getElementById('account-logged-in');
    const errorEl       = document.getElementById('account-error');
    const statusEl      = document.getElementById('account-sync-status');
    const emailEl       = document.getElementById('account-email');
    const passEl        = document.getElementById('account-password');
    const currentEmailEl = document.getElementById('account-current-email');
    const iconEl        = document.getElementById('account-icon');

    function openModal()  { modal.classList.remove('hidden'); errorEl.classList.add('hidden'); }
    function closeModal() { modal.classList.add('hidden'); }
    function showError(msg) { errorEl.textContent = msg; errorEl.classList.remove('hidden'); }

    function refreshView() {
      const logado = window.NizukSync && window.NizukSync.isLoggedIn();
      viewOut.classList.toggle('hidden', logado);
      viewIn.classList.toggle('hidden', !logado);
      iconEl.textContent = logado ? '☁️' : '👤';
      if (logado) currentEmailEl.textContent = window.NizukSync.getUserEmail();
    }

    document.getElementById('btn-account').addEventListener('click', () => { refreshView(); openModal(); });
    document.getElementById('btn-account-close').addEventListener('click', closeModal);
    modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

    document.getElementById('btn-account-signup').addEventListener('click', async () => {
      if (!window.NizukSync) return showError('Sincronização ainda carregando, tente em instantes.');
      const r = await window.NizukSync.signUp(emailEl.value.trim(), passEl.value);
      if (!r.ok) return showError(r.message);
      refreshView();
    });

    document.getElementById('btn-account-signin').addEventListener('click', async () => {
      if (!window.NizukSync) return showError('Sincronização ainda carregando, tente em instantes.');
      const r = await window.NizukSync.signIn(emailEl.value.trim(), passEl.value);
      if (!r.ok) return showError(r.message);
      refreshView();
    });

    document.getElementById('btn-account-logout').addEventListener('click', async () => {
      await window.NizukSync.signOutUser();
      refreshView();
    });

    document.getElementById('btn-account-sync-now').addEventListener('click', async () => {
      statusEl.textContent = 'Sincronizando...';
      const r = await window.NizukSync.syncNow();
      statusEl.textContent = r.ok ? '✅ Sincronizado agora' : '⚠️ Falha ao sincronizar';
      Dashboard.render();
    });

    // O módulo Firebase carrega depois (type=module) e avisa quando está pronto
    window.addEventListener('nizuk-sync-ready', () => {
      window.NizukSync.onStatusChange((status) => {
        if (status === 'synced')  statusEl.textContent = '✅ Sincronizado às ' + new Date().toLocaleTimeString('pt-BR');
        if (status === 'error')   statusEl.textContent = '⚠️ Erro ao sincronizar (verifique a internet)';
        if (status === 'login' || status === 'logout') refreshView();
        if (status === 'login') Dashboard.render(); // dados podem ter mudado após puxar da nuvem
      });
      refreshView();
    });
  }

  // ── Controle de volume (Fase 0 — inalterado)
  function _initVolume() {
    const saved = Storage.loadAudioVolume();
    document.querySelectorAll('.vol-btn[data-vol]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.vol === saved);
      btn.addEventListener('click', () => {
        Storage.saveAudioVolume(btn.dataset.vol);
        document.querySelectorAll('.vol-btn[data-vol]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });
  }

  // ── Mute (Fase 0 — inalterado)
  function _initMute() {
    const btn = document.getElementById('btn-mute-toggle');
    if (!btn) return;

    const render = () => {
      const muted = Storage.loadAudioMuted();
      btn.textContent = muted ? '🔇 Mutado' : '🔊 Som ligado';
      btn.classList.toggle('active', muted);
    };
    render();

    btn.addEventListener('click', () => {
      const novoEstado = !Storage.loadAudioMuted();
      Storage.saveAudioMuted(novoEstado);
      if (novoEstado && window.speechSynthesis) {
        try { window.speechSynthesis.cancel(); } catch(e) {}
      }
      render();
    });
  }

  // ── Fase 0.5 — Guard de armazenamento
  // Registra o handler centralizado de falha de escrita (Etapa 1) e
  // verifica o status de armazenamento na inicialização (Etapa 4).
  // Tudo em um único ponto — nenhum try/catch espalhado pela app.
  function _initStorageGuard() {
    // Etapa 1: registra o handler de falha de escrita no Storage
    Storage.onWriteError(({ msg, isQuota }) => {
      _mostrarBannerErro(msg, isQuota);
    });

    // Etapa 4: verifica uso na inicialização; exibe aviso se necessário
    const diag = Storage.diagnosticoArmazenamento();
    if (diag.deveAvisar && diag.mensagem) {
      _mostrarBannerAviso(diag.mensagem, diag.percentual);
    }

    // Etapa 3: primeiro autobackup ao abrir o app (garante snapshot inicial)
    Storage.criarAutoBackup();
  }

  // ── Banner de erro de gravação (Etapa 1 — falha de escrita)
  // Exibido apenas uma vez por sessão para não ser intrusivo; persiste até o usuário fechar.
  let _bannerErroExibido = false;
  function _mostrarBannerErro(mensagem, isQuota) {
    if (_bannerErroExibido) return; // não repetir para a mesma sessão
    _bannerErroExibido = true;
    _criarBanner('storage-error-banner', '⚠️ ' + mensagem, '#c0392b', isQuota ? true : false);
  }

  // ── Banner de aviso de espaço (Etapa 4 — armazenamento próximo do limite)
  function _mostrarBannerAviso(mensagem, pct) {
    _criarBanner('storage-warn-banner', `💾 ${mensagem} (${pct}% usado)`, '#e67e22', false);
  }

  // Cria e injeta um banner persistente no topo da página.
  // Se já existir um banner com o mesmo id, não duplica.
  function _criarBanner(id, texto, cor, temBotaoExportar) {
    if (document.getElementById(id)) return;
    const div = document.createElement('div');
    div.id = id;
    div.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:9999',
      `background:${cor}`, 'color:#fff', 'font-size:.85rem',
      'padding:10px 14px', 'display:flex', 'align-items:center',
      'justify-content:space-between', 'gap:8px', 'box-shadow:0 2px 6px rgba(0,0,0,.25)',
    ].join(';');

    const msg = document.createElement('span');
    msg.textContent = texto;
    div.appendChild(msg);

    const acoes = document.createElement('span');
    acoes.style.cssText = 'display:flex;gap:8px;flex-shrink:0';

    if (temBotaoExportar) {
      const btnExp = document.createElement('button');
      btnExp.textContent = '💾 Exportar agora';
      btnExp.style.cssText = 'background:#fff;color:' + cor + ';border:none;padding:4px 10px;border-radius:4px;cursor:pointer;font-weight:700;font-size:.8rem';
      btnExp.onclick = () => Storage.exportar();
      acoes.appendChild(btnExp);
    }

    const btnFechar = document.createElement('button');
    btnFechar.textContent = '✕';
    btnFechar.style.cssText = 'background:transparent;color:#fff;border:1px solid rgba(255,255,255,.5);padding:2px 8px;border-radius:4px;cursor:pointer;font-size:.9rem';
    btnFechar.onclick = () => div.remove();
    acoes.appendChild(btnFechar);

    div.appendChild(acoes);
    document.body.prepend(div);
  }

  return { init, showScreen };
})();

document.addEventListener('DOMContentLoaded', () => { App.init(); });
