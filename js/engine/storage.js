// js/engine/storage.js
// Fase 0.5 — Robustez, proteção contra perda de dados e monitoramento de persistência.
// Nenhuma dependência externa. Nenhum backend. Nenhuma alteração de comportamento visível.

const Storage = {
  K: {
    progress: 'obv2_progress',
    stats:    'obv2_stats',
    sessions: 'obv2_sessions',
    items:    'obv2_items',
    streak:   'obv2_streak',
    today:    'obv2_today',
    // legado
    custom:   'obv2_custom',
    // Fase 0 — centralizadas aqui
    audioVol:    'obv2_audio_vol',
    audioMuted:  'obv2_audio_muted',
    ankiDecks:   'obv2_anki_decks',
    // Fase 0.5 — backup automático interno (duas slots em rotação)
    autoBackupA: 'obv2_autobackup_a',
    autoBackupB: 'obv2_autobackup_b',
    autoBackupSlot: 'obv2_autobackup_slot', // 'a' ou 'b' — qual slot foi gravado por último
    // Fase 0.5 — controle de storage
    storageWarnDismissed: 'obv2_storage_warn_dismissed',
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // ETAPA 1 — Detecção de falha de gravação
  // _set/_setRaw agora retornam true/false.
  // Toda falha passa por _onWriteError(), ponto único e não espalhado.
  // ─────────────────────────────────────────────────────────────────────────────

  // Handler centralizado de falha de escrita. Chamado apenas por _set/_setRaw.
  // Acumula o aviso e delega para a UI (app.js registra o listener via onWriteError).
  _writeErrorHandler: null,
  onWriteError(fn) { this._writeErrorHandler = fn; },

  _onWriteError(key, err) {
    const isQuota = err && (err.name === 'QuotaExceededError' || err.code === 22 || err.code === 1014);
    const msg = isQuota
      ? 'Armazenamento local cheio. Exporte um backup agora para não perder dados.'
      : 'Falha ao salvar dados localmente. Verifique se o navegador permite armazenamento.';
    if (typeof this._writeErrorHandler === 'function') {
      this._writeErrorHandler({ key, err, msg, isQuota });
    } else {
      // Fallback: console.warn silencioso (melhor que nada sem UI pronta)
      console.warn('[Storage] ' + msg, key, err);
    }
  },

  // Leitura JSON — nunca lança exceção para o chamador
  _get(k, def) {
    try {
      const raw = localStorage.getItem(this.K[k]);
      if (raw === null) return def;
      return JSON.parse(raw) ?? def;
    } catch(e) { return def; }
  },

  // Gravação JSON — retorna true em sucesso, false em falha (nunca silencia)
  _set(k, v) {
    try {
      localStorage.setItem(this.K[k], JSON.stringify(v));
      return true;
    } catch(e) {
      this._onWriteError(this.K[k], e);
      return false;
    }
  },

  // Leitura bruta (formato string simples, ex: '0.7' para volume)
  _getRaw(k, def) {
    try {
      const v = localStorage.getItem(this.K[k]);
      return v === null ? def : v;
    } catch(e) { return def; }
  },

  // Gravação bruta — retorna true/false, não silencia
  _setRaw(k, v) {
    try {
      localStorage.setItem(this.K[k], String(v));
      return true;
    } catch(e) {
      this._onWriteError(this.K[k], e);
      return false;
    }
  },

  // Gravação direta por nome de chave literal (usado pelo sistema de backup)
  _setRawKey(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch(e) {
      // Backup falhou: não chama _onWriteError para não criar loop de aviso
      console.warn('[Storage] autobackup write failed:', key, e);
      return false;
    }
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // ETAPA 2 — Verificação de integridade
  // Após cada gravação crítica, relemos e comparamos o tamanho do JSON gravado.
  // Detecta: corrupção silenciosa, truncamento pelo navegador, falso-positivo de escrita.
  // Leve: sem libs, sem cripto — só length do JSON.
  // ─────────────────────────────────────────────────────────────────────────────

  _verifyWrite(k, serializado) {
    try {
      const lido = localStorage.getItem(this.K[k]);
      if (lido === null) {
        console.warn('[Storage] integrity: chave sumiu após gravação:', this.K[k]);
        return false;
      }
      if (lido.length !== serializado.length) {
        console.warn('[Storage] integrity: tamanho diverge após gravação:', this.K[k],
          'esperado:', serializado.length, 'lido:', lido.length);
        return false;
      }
      return true;
    } catch(e) { return false; }
  },

  // Versão de _set com verificação de integridade (usado para dados críticos)
  _setVerified(k, v) {
    const serializado = JSON.stringify(v);
    try {
      localStorage.setItem(this.K[k], serializado);
    } catch(e) {
      this._onWriteError(this.K[k], e);
      return false;
    }
    if (!this._verifyWrite(k, serializado)) {
      // Gravou mas leitura diverge: avisa como se fosse falha de escrita
      this._onWriteError(this.K[k], new Error('integrity_mismatch'));
      return false;
    }
    return true;
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // ETAPA 3 — Backup automático local (dois slots em rotação)
  // Snapshot periódico de todos os dados. Preserva última versão válida.
  // Não substitui exportação manual. Funciona em segundo plano.
  // Slots: obv2_autobackup_a / obv2_autobackup_b — alternados a cada gravação.
  // ─────────────────────────────────────────────────────────────────────────────

  // Intervalo mínimo entre backups automáticos (ms). 5 minutos.
  AUTO_BACKUP_INTERVAL_MS: 5 * 60 * 1000,
  _lastAutoBackupAt: 0,

  // Cria um snapshot de todos os dados e grava no próximo slot disponível.
  // Retorna true se o backup foi gravado, false se foi pulado (muito cedo) ou falhou.
  criarAutoBackup(forcar) {
    const agora = Date.now();
    if (!forcar && agora - this._lastAutoBackupAt < this.AUTO_BACKUP_INTERVAL_MS) return false;

    const snapshot = {
      version: 4,
      autoBackupAt: new Date().toISOString(),
      progress:  this._get('progress', {}),
      stats:     this._get('stats', {}),
      sessions:  this._get('sessions', []),
      items:     this._get('items', []),
      streak:    this._get('streak', {}),
      today:     this._get('today', {}),
      ankiDecks: this._get('ankiDecks', []),
      audio: {
        vol:   this._getRaw('audioVol', '0.7'),
        muted: this._getRaw('audioMuted', 'false'),
      },
    };

    const json = JSON.stringify(snapshot);

    // Determina qual slot usar (alternado para proteger contra falha durante escrita)
    const slotAtual = localStorage.getItem(this.K.autoBackupSlot) || 'b';
    const proximoSlot = slotAtual === 'a' ? 'b' : 'a';
    const chaveSlot = proximoSlot === 'a' ? this.K.autoBackupA : this.K.autoBackupB;

    const ok = this._setRawKey(chaveSlot, json);
    if (ok) {
      // Só atualiza o ponteiro de slot DEPOIS de gravar o conteúdo com sucesso
      try { localStorage.setItem(this.K.autoBackupSlot, proximoSlot); } catch(e) {}
      this._lastAutoBackupAt = agora;
    }
    return ok;
  },

  // Lê e valida um slot de autobackup. Retorna o objeto parsed ou null.
  _lerSlotBackup(slot) {
    const chave = slot === 'a' ? this.K.autoBackupA : this.K.autoBackupB;
    try {
      const raw = localStorage.getItem(chave);
      if (!raw) return null;
      const d = JSON.parse(raw);
      // Validação mínima: precisa ter version e pelo menos um campo de dados
      if (!d || typeof d !== 'object' || !d.version) return null;
      if (typeof d.progress !== 'object' || d.progress === null) return null;
      return d;
    } catch(e) { return null; }
  },

  // Recupera o backup automático mais recente e válido.
  // Tenta o slot mais recente primeiro; se inválido, tenta o outro.
  // Usado pela Etapa 5 (recuperação segura).
  recuperarAutoBackup() {
    const slotRecente = localStorage.getItem(this.K.autoBackupSlot) || 'a';
    const slotAntigo  = slotRecente === 'a' ? 'b' : 'a';

    const d = this._lerSlotBackup(slotRecente) || this._lerSlotBackup(slotAntigo);
    return d; // null se nenhum slot válido existir
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // ETAPA 4 — Status de armazenamento
  // Estima espaço usado. Exibe aviso apenas quando necessário (>80% da heurística).
  // Não cria telas complexas: retorna um objeto de diagnóstico que a UI pode usar.
  // ─────────────────────────────────────────────────────────────────────────────

  // Heurística conservadora para quota do localStorage (navegadores variam: 5–10 MB)
  STORAGE_QUOTA_ESTIMATE_BYTES: 5 * 1024 * 1024,

  diagnosticoArmazenamento() {
    let usadoBytes = 0;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        const val = localStorage.getItem(key) || '';
        // UTF-16: cada char = 2 bytes em alguns navegadores, mas JS strings são UTF-16 internamente.
        // Heurística conservadora: 2 bytes/char.
        usadoBytes += (key.length + val.length) * 2;
      }
    } catch(e) {}

    const quota = this.STORAGE_QUOTA_ESTIMATE_BYTES;
    const pct   = usadoBytes / quota;
    const risco = pct >= 0.9 ? 'critico' : pct >= 0.8 ? 'alto' : pct >= 0.6 ? 'medio' : 'baixo';

    return {
      usadoBytes,
      usadoKB:   Math.round(usadoBytes / 1024),
      quotaBytes: quota,
      quotaKB:   Math.round(quota / 1024),
      percentual: Math.round(pct * 100),
      risco,
      // true se deve exibir aviso ao usuário
      deveAvisar: risco === 'alto' || risco === 'critico',
      mensagem: risco === 'critico'
        ? 'Armazenamento local quase cheio! Exporte um backup agora.'
        : risco === 'alto'
        ? 'Armazenamento próximo do limite. Considere exportar um backup.'
        : null,
    };
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // ETAPA 5 — Recuperação segura
  // Se a leitura de dados críticos retornar valor impossível (null inesperado,
  // estrutura inválida), tenta restaurar do autobackup antes de retornar default.
  // Princípio: nunca apaga dados recuperáveis.
  // ─────────────────────────────────────────────────────────────────────────────

  // Tenta restaurar um campo específico do autobackup mais recente válido.
  // Retorna o valor restaurado, ou def se não for possível.
  _tentarRecuperar(campo, def) {
    try {
      const backup = this.recuperarAutoBackup();
      if (!backup) return def;
      const val = backup[campo];
      // Validação mínima para não restaurar lixo
      if (val === undefined || val === null) return def;
      console.info('[Storage] recuperado do autobackup:', campo);
      return val;
    } catch(e) { return def; }
  },

  // Leitura com recuperação: se _get retornar null (chave ausente) E houver
  // indício de que deveria existir (chave já foi gravada antes), tenta autobackup.
  // Usado para progress e items, que são os mais críticos.
  _getComRecuperacao(k, def, validarFn) {
    const val = this._get(k, null);
    if (val !== null && (!validarFn || validarFn(val))) return val;
    // Valor ausente ou inválido: tentar recuperar
    if (val !== null) {
      // Existe mas está inválido — situação preocupante, tenta backup
      console.warn('[Storage] dado inválido em', this.K[k], '— tentando autobackup');
    }
    return this._tentarRecuperar(k, def);
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // API pública — idêntica à Fase 0 externamente
  // ─────────────────────────────────────────────────────────────────────────────

  // ── Progress (crítico: usa _setVerified + recuperação)
  loadProgress()  {
    return this._getComRecuperacao('progress', {},
      v => typeof v === 'object' && v !== null && !Array.isArray(v));
  },
  saveProgress(d) {
    const ok = this._setVerified('progress', d);
    if (ok) this.criarAutoBackup();
    return ok;
  },

  // ── Stats
  loadStats()  { return this._get('stats', { totalQuestoes:0, totalAcertos:0, totalErros:0, tempoTotal:0 }); },
  saveStats(d) { return this._set('stats', d); },

  // ── Sessions
  loadSessions()  { return this._get('sessions', []); },
  addSession(s)   {
    const a = this.loadSessions();
    a.unshift(s);
    if(a.length>60) a.pop();
    return this._set('sessions', a);
  },

  // ── Items customizados/importados (crítico: usa _setVerified + recuperação)
  loadItems() {
    let items = this._getComRecuperacao('items', null,
      v => Array.isArray(v));
    if (items === null) {
      items = this._migrateCustom();
      this._setVerified('items', items);
    }
    return items;
  },
  saveItems(items) {
    const ok = this._setVerified('items', items);
    if (ok) this.criarAutoBackup();
    return ok;
  },

  addItem(item) {
    const items = this.loadItems();
    const id = item.id || `i_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
    const newItem = { ...item, id, createdAt: item.createdAt || Date.now() };
    items.push(newItem);
    this.saveItems(items);
    return newItem;
  },

  updateItem(id, changes) {
    const items = this.loadItems();
    const idx = items.findIndex(i => i.id === id);
    if (idx < 0) return false;
    items[idx] = { ...items[idx], ...changes, id };
    this.saveItems(items);
    return true;
  },

  deleteItem(id) {
    let items = this.loadItems();
    const before = items.length;
    items = items.filter(i => i.id !== id);
    if (items.length === before) return false;
    this.saveItems(items);
    const prog = this.loadProgress();
    if (prog[id]) { delete prog[id]; this.saveProgress(prog); }
    return true;
  },

  getItemsByCategory(cat) {
    return this.loadItems().filter(i => i.cat === cat);
  },

  // Migração do formato legado
  _migrateCustom() {
    try {
      const raw = localStorage.getItem(this.K.custom);
      if (!raw) return [];
      const custom = JSON.parse(raw);
      const result = [];
      const ts = Date.now();
      let seq = 0;
      ['hiragana','katakana','vocab','kanji'].forEach(cat => {
        (custom[cat] || []).forEach((c) => {
          result.push({
            id: `mig_${cat}_${seq++}_${ts}`,
            cat, char: c.char, romaji: c.romaji || '',
            meaning: c.meaning || '', jlpt: c.jlpt || '',
            tags: [], origin: 'custom', createdAt: Date.now(),
          });
        });
      });
      return result;
    } catch(e) { return []; }
  },

  loadCustom() {
    const items = this.loadItems();
    const out = { hiragana:[], katakana:[], vocab:[], kanji:[] };
    items.forEach(i => { if(out[i.cat]) out[i.cat].push(i); });
    return out;
  },
  saveCustom(d) {
    const existing = this.loadItems().filter(i => i.origin !== 'custom');
    const migrated = [];
    ['hiragana','katakana','vocab','kanji'].forEach(cat => {
      (d[cat]||[]).forEach((c,idx) => {
        migrated.push({ id: c.id || `leg_${cat}_${idx}`, cat, ...c, origin:'custom' });
      });
    });
    this.saveItems([...existing, ...migrated]);
  },

  // ── Áudio
  loadAudioVolume()  { return this._getRaw('audioVol', '0.7'); },
  saveAudioVolume(v) { return this._setRaw('audioVol', v); },

  loadAudioMuted()      { return this._getRaw('audioMuted', 'false') === 'true'; },
  saveAudioMuted(muted) { return this._setRaw('audioMuted', muted ? 'true' : 'false'); },

  getEffectiveVolume() {
    if (this.loadAudioMuted()) return 0;
    const v = parseFloat(this.loadAudioVolume());
    return Number.isFinite(v) ? v : 0.7;
  },

  // ── Decks Anki
  loadAnkiDecks()  { return this._get('ankiDecks', []); },
  saveAnkiDecks(d) { return this._set('ankiDecks', d); },

  // ── Streak
  loadStreak() { return this._get('streak', { dias:0, ultimoDia:null, historico:{} }); },
  atualizarStreak(n) {
    const hoje = new Date().toDateString();
    const s = this.loadStreak();
    s.historico = s.historico || {};
    s.historico[hoje] = (s.historico[hoje] || 0) + n;
    if (s.ultimoDia !== hoje) {
      const ontem = new Date(Date.now() - 86400000).toDateString();
      s.dias = s.ultimoDia === ontem ? s.dias + 1 : 1;
      s.ultimoDia = hoje;
    }
    this._set('streak', s);
    return s;
  },

  // ── Today
  loadToday() {
    const hoje = new Date().toDateString();
    const d = this._get('today', {});
    if (d.date !== hoje) return { date:hoje, reviews:0, acertos:0, erros:0, minutos:0 };
    return d;
  },
  saveToday(d) { return this._set('today', d); },

  // ── Export / Import (inalterados da Fase 0, exceto: exportar() agora force-cria autobackup)
  // snapshot(): monta o objeto de dados completo (usado por exportar() e pela sincronização em nuvem)
  snapshot() {
    return {
      version: 4,
      exportedAt: new Date().toISOString(),
      progress:  this.loadProgress(),
      stats:     this.loadStats(),
      sessions:  this.loadSessions(),
      items:     this.loadItems(),
      streak:    this.loadStreak(),
      today:     this.loadToday(),
      ankiDecks: this.loadAnkiDecks(),
      audio: {
        vol:   this.loadAudioVolume(),
        muted: this.loadAudioMuted(),
      },
    };
  },

  exportar() {
    // Aproveita o clique de exportar para criar também um autobackup fresco
    this.criarAutoBackup(true);
    const data = this.snapshot();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type:'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `obenkyo_backup_${new Date().toISOString().slice(0,10)}.json`;
    a.click(); URL.revokeObjectURL(url);
  },

  MAX_BACKUP_VERSION: 4,

  // restore(d): grava um objeto de dados já validado/parseado (usado por importar() e pela sincronização em nuvem)
  restore(d) {
    if (!d || typeof d !== 'object' || Array.isArray(d)) {
      return { ok:false, error:'formato_invalido', message:'O arquivo não tem o formato esperado de um backup.' };
    }

    const version = Number(d.version) || 0;
    if (version > this.MAX_BACKUP_VERSION) {
      return {
        ok:false, error:'versao_incompativel',
        message:`Este backup foi exportado por uma versão mais nova do app (v${version}). Atualize o app antes de importar este arquivo.`,
      };
    }

    const checks = [
      ['progress',  v => typeof v === 'object' && v !== null && !Array.isArray(v)],
      ['stats',     v => typeof v === 'object' && v !== null && !Array.isArray(v)],
      ['sessions',  v => Array.isArray(v)],
      ['items',     v => Array.isArray(v)],
      ['streak',    v => typeof v === 'object' && v !== null && !Array.isArray(v)],
      ['today',     v => typeof v === 'object' && v !== null && !Array.isArray(v)],
      ['ankiDecks', v => Array.isArray(v)],
      ['custom',    v => typeof v === 'object' && v !== null && !Array.isArray(v)],
      ['audio',     v => typeof v === 'object' && v !== null && !Array.isArray(v)],
    ];
    for (const [field, valid] of checks) {
      if (d[field] !== undefined && !valid(d[field])) {
        return { ok:false, error:'dados_corrompidos', message:`O campo "${field}" do backup está corrompido ou num formato inesperado.` };
      }
    }

    // Cria autobackup ANTES de sobrescrever — preserva estado anterior como fallback
    this.criarAutoBackup(true);

    if (d.progress)  this.saveProgress(d.progress);
    if (d.stats)     this.saveStats(d.stats);
    if (d.sessions)  this._set('sessions', d.sessions);
    if (d.streak)    this._set('streak', d.streak);
    if (d.today)     this.saveToday(d.today);
    if (d.ankiDecks) this.saveAnkiDecks(d.ankiDecks);
    if (d.audio) {
      if (d.audio.vol !== undefined)   this.saveAudioVolume(d.audio.vol);
      if (d.audio.muted !== undefined) this.saveAudioMuted(!!d.audio.muted);
    }
    if (d.items)        this.saveItems(d.items);
    else if (d.custom)  this.saveCustom(d.custom);

    return { ok:true };
  },

  importar(json) {
    let d;
    try { d = JSON.parse(json); }
    catch (e) {
      return { ok:false, error:'json_invalido', message:'O arquivo selecionado não é um JSON válido.' };
    }
    return this.restore(d);
  },
};
