// js/ui/browse.js
const Browse = (() => {
  let currentTab    = 'kanji';
  let currentFilter = 'todos'; // todos | novos | aprendendo | fortes | dominados
  let currentGroup  = '';      // '' = todos, '__native__' = padrão, ou deckId

  function _getBase(tab) {
    if (tab === 'kanji')    return KANJI_DATA;
    if (tab === 'vocab')    return VOCAB_DATA;
    if (tab === 'hiragana') return HIRAGANA_DATA;
    if (tab === 'katakana') return KATAKANA_DATA;
    return [];
  }

  function getAllItems(tab) {
    const base   = _getBase(tab).map(i => ({ ...i, _native: true }));
    const custom = Storage.getItemsByCategory(tab).map(i => ({ ...i, _native: false }));
    return [...base, ...custom];
  }

  function _getGroups(tab) {
    const items = Storage.getItemsByCategory(tab);
    const groups = {};
    items.forEach(i => {
      if (i.deckId) groups[i.deckId] = i.deckName || i.deckId;
    });
    return groups;
  }

  function render(tab) {
    currentTab = tab || currentTab;
    currentGroup = '';
    document.querySelectorAll('.browse-tabs .tab-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.tab === currentTab)
    );
    _renderGroupBar();
    _renderFilterBar();
    _renderList();
    _renderAddForm();
  }

  function _renderGroupBar() {
    const groups = _getGroups(currentTab);
    const bar = document.getElementById('browse-group-bar');
    if (!bar) return;
    const groupEntries = Object.entries(groups);
    if (groupEntries.length === 0) { bar.style.display = 'none'; return; }
    bar.style.display = 'flex';
    bar.innerHTML =
      `<button class="group-chip${currentGroup===''?' active':''}" data-gid="">Todos</button>` +
      `<button class="group-chip${currentGroup==='__native__'?' active':''}" data-gid="__native__">Conteúdo Padrão</button>` +
      groupEntries.map(([id, name]) =>
        `<button class="group-chip${currentGroup===id?' active':''}" data-gid="${_esc(id)}">${_esc(name)}</button>`
      ).join('');
    bar.querySelectorAll('.group-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        currentGroup = btn.dataset.gid;
        _renderGroupBar();
        _renderList();
      });
    });
  }

  function _renderFilterBar() {
    const bar = document.getElementById('browse-filter-bar');
    if (!bar) return;
    const filters = [
      { id:'todos',      label:'Todos' },
      { id:'novos',      label:'🆕 Novos' },
      { id:'aprendendo', label:'📖 Aprendendo' },
      { id:'fortes',     label:'💪 Fortes' },
      { id:'dominados',  label:'⭐ Dominados' },
    ];
    bar.innerHTML = filters.map(f =>
      `<button class="filter-chip${currentFilter===f.id?' active':''}" data-fid="${f.id}">${f.label}</button>`
    ).join('');
    bar.querySelectorAll('.filter-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        currentFilter = btn.dataset.fid;
        _renderFilterBar();
        _renderList();
      });
    });
  }

  function _srsLevel(stt) {
    if (!stt.lastSeen || stt.repetitions <= 0) return 'novos';
    if (stt.repetitions <= 2)                  return 'aprendendo';
    if (stt.repetitions <= 5)                  return 'fortes';
    return 'dominados';
  }

  function _renderList() {
    const prog   = Storage.loadProgress();
    const search = (document.getElementById('filter-search')?.value || '').toLowerCase().trim();
    let items    = getAllItems(currentTab);

    if (currentGroup === '__native__') {
      items = items.filter(i => i._native);
    } else if (currentGroup) {
      items = items.filter(i => i.deckId === currentGroup);
    }

    if (currentFilter !== 'todos') {
      items = items.filter(i => {
        const stt = FSRS.initItem(prog[i.id]);
        return _srsLevel(stt) === currentFilter;
      });
    }

    if (search) {
      items = items.filter(i =>
        (i.char    || '').toLowerCase().includes(search) ||
        (i.romaji  || '').toLowerCase().includes(search) ||
        (i.meaning || '').toLowerCase().includes(search) ||
        (i.tags    || []).some(t => t.toLowerCase().includes(search))
      );
    }

    const list = document.getElementById('browse-list');
    if (items.length === 0) {
      list.innerHTML = '<p style="color:var(--mid);font-size:.88rem;padding:8px 0">Nenhum item encontrado.</p>';
      return;
    }

    list.innerHTML = items.map(item => {
      const stt = FSRS.initItem(prog[item.id]);
      const lvl = stt.repetitions >= 5 ? '⭐' :
                  stt.repetitions >= 3 ? '💪' :
                  stt.repetitions >= 1 ? '📖' : '🆕';
      const groupLabel = item._native ? 'nativo' : (item.deckName || (item.origin === 'imported' ? 'importado' : 'custom'));
      const badgeClass = item._native ? 'native' : 'imported';
      const originBadge = `<span class="origin-badge ${badgeClass}">${_esc(groupLabel)}</span>`;
      return `<div class="browse-item" data-id="${item.id}">
        <div class="browse-char">${item.char}</div>
        <div class="browse-info">
          <div class="browse-reading">${item.romaji || ''}</div>
          <div class="browse-meaning">${item.meaning || ''}</div>
          <div class="browse-badges">${originBadge}${(item.tags||[]).map(t=>`<span class="tag-badge">${_esc(t)}</span>`).join('')}</div>
        </div>
        <div class="browse-status">${lvl}</div>
      </div>`;
    }).join('');

    list.querySelectorAll('.browse-item').forEach(el => {
      el.addEventListener('click', () => {
        const all  = getAllItems(currentTab);
        const item = all.find(i => i.id === el.dataset.id);
        if (item) Detail.render(item, currentTab);
      });
    });
  }

  function _esc(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function _renderAddForm() {
    const cfg = {
      kanji:    [{f:'char',l:'Kanji / Palavra'},{f:'romaji',l:'Leitura (romaji)'},{f:'meaning',l:'Significado'},{f:'tags',l:'Tags (separadas por vírgula)'}],
      vocab:    [{f:'char',l:'Palavra'},{f:'romaji',l:'Leitura'},{f:'meaning',l:'Significado'},{f:'tags',l:'Tags'}],
      hiragana: [{f:'char',l:'Caractere'},{f:'romaji',l:'Romaji'},{f:'meaning',l:'Descrição'},{f:'tags',l:'Tags'}],
      katakana: [{f:'char',l:'Caractere'},{f:'romaji',l:'Romaji'},{f:'meaning',l:'Descrição'},{f:'tags',l:'Tags'}],
    };
    const fields = cfg[currentTab] || [];
    document.getElementById('form-fields').innerHTML = fields.map(f =>
      `<input class="form-input" id="inp-${f.f}" placeholder="${f.l}"/>`
    ).join('');
  }

  function addItem() {
    const char    = (document.getElementById('inp-char')?.value || '').trim();
    const romaji  = (document.getElementById('inp-romaji')?.value || '').trim();
    const meaning = (document.getElementById('inp-meaning')?.value || '').trim();
    const tagsRaw = (document.getElementById('inp-tags')?.value || '').trim();
    if (!char || !meaning) { alert('Caractere e significado são obrigatórios!'); return; }
    const tags = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : [];
    Storage.addItem({ cat: currentTab, char, romaji, meaning, tags, origin: 'custom' });
    document.getElementById('add-form').classList.add('hidden');
    ['char','romaji','meaning','tags'].forEach(f => {
      const el = document.getElementById(`inp-${f}`); if (el) el.value = '';
    });
    render(currentTab);
  }

  function init() {
    document.querySelectorAll('.browse-tabs .tab-btn').forEach(b =>
      b.addEventListener('click', () => render(b.dataset.tab))
    );
    // Debounce de 220ms para evitar re-render a cada tecla pressionada
    let _searchTimer = null;
    document.getElementById('filter-search').addEventListener('input', () => {
      clearTimeout(_searchTimer);
      _searchTimer = setTimeout(() => _renderList(), 220);
    });
    document.getElementById('btn-add-toggle').addEventListener('click', () => {
      document.getElementById('add-form').classList.toggle('hidden');
    });
    document.getElementById('btn-save-item').addEventListener('click', () => addItem());
  }

  return { render, init, getAllItems };
})();

// ── Detail ──────────────────────────────────────────────────────────────────
const Detail = {
  _item: null,
  _cat:  null,

  render(item, cat) {
    this._item = item;
    this._cat  = cat;
    const isNative = !!item._native;

    const prog = Storage.loadProgress();
    const stt  = FSRS.initItem(prog[item.id]);
    const bc   = { kanji:'漢字', vocab:'語彙', hiragana:'Hiragana', katakana:'Katakana' };
    document.getElementById('detail-breadcrumb').textContent = bc[cat] || cat;

    let html = `
      <div class="detail-hero">
        <div class="detail-char">${item.char}</div>
        <div class="detail-reading">${item.romaji || ''}</div>
        <div class="detail-meaning">${item.meaning || ''}</div>
        ${(item.tags||[]).length ? `<div style="margin-top:7px;display:flex;gap:5px;flex-wrap:wrap;justify-content:center">${item.tags.map(t=>`<span class="tag-badge">${t}</span>`).join('')}</div>` : ''}
        <div style="margin-top:9px">
          ${isNative ? '<span class="origin-badge native">nativo</span>' : `<span class="origin-badge imported">${item.deckName || (item.origin === 'imported' ? 'importado' : 'custom')}</span>`}
        </div>
      </div>`;

    if ((item.onyomi || item.kunyomi) && cat === 'kanji') {
      html += `<div class="detail-section">
        <h3>Leituras</h3>
        <div class="reading-grid">
          <div class="reading-box"><div class="reading-lbl">On'yomi</div><div class="reading-val" style="color:var(--red)">${item.onyomi||'—'}</div></div>
          <div class="reading-box"><div class="reading-lbl">Kun'yomi</div><div class="reading-val" style="color:var(--blue)">${item.kunyomi||'—'}</div></div>
        </div>
      </div>`;
    }

    if (item.examples?.length) {
      html += `<div class="detail-section"><h3>Exemplos</h3><div class="example-list">`;
      item.examples.forEach(e => {
        html += `<div class="example-item">
          <div class="example-jp">${e.jp}</div>
          <div class="example-read">${e.read||''}</div>
          <div class="example-pt">${e.pt||''}</div>
        </div>`;
      });
      html += `</div></div>`;
    }

    const nextText = stt.lastSeen ? FSRS.nextReviewText(stt.interval) : 'Nunca revisado';
    html += `<div class="detail-section">
      <h3>Progresso SRS</h3>
      <div class="srs-info">
        <div class="srs-info-item"><div class="srs-info-num">${stt.repetitions}</div><div class="srs-info-lbl">Repetições</div></div>
        <div class="srs-info-item"><div class="srs-info-num">${stt.acertos}</div><div class="srs-info-lbl">Acertos</div></div>
        <div class="srs-info-item"><div class="srs-info-num">${stt.erros}</div><div class="srs-info-lbl">Erros</div></div>
        <div class="srs-info-item"><div class="srs-info-num">${stt.ef.toFixed(1)}</div><div class="srs-info-lbl">Dificuldade</div></div>
      </div>
      <div style="font-size:.78rem;color:var(--blue);margin-top:8px;font-style:italic">${nextText}</div>
    </div>`;

    html += `<div class="detail-actions">
      <button class="btn-detail primary" id="btn-detail-review">📅 Revisar agora</button>
      <button class="btn-detail secondary" id="btn-detail-speak">🔊 Ouvir</button>
    </div>
    <div class="detail-edit-bar">
      <button class="btn-edit-action edit" id="btn-detail-edit">✏️ Editar</button>
      <button class="btn-edit-action remove" id="btn-detail-remove">🗑️ Remover</button>
    </div>`;

    const CATS = ['kanji','vocab','hiragana','katakana'];
    html += `<div class="detail-edit-form hidden" id="detail-edit-form">
      <div class="detail-edit-title">✏️ Editar item</div>
      <div class="edit-field-row">
        <label class="edit-field-label">Caractere / Palavra</label>
        <input class="form-input edit-field-input" id="edit-char" value="${this._esc(item.char||'')}"/>
      </div>
      <div class="edit-field-row">
        <label class="edit-field-label">Leitura (romaji / kana)</label>
        <input class="form-input edit-field-input" id="edit-romaji" value="${this._esc(item.romaji||'')}"/>
      </div>
      <div class="edit-field-row">
        <label class="edit-field-label">Significado / Resposta</label>
        <input class="form-input edit-field-input" id="edit-meaning" value="${this._esc(item.meaning||'')}"/>
      </div>
      <div class="edit-field-row">
        <label class="edit-field-label">Tags (separadas por vírgula)</label>
        <input class="form-input edit-field-input" id="edit-tags" value="${this._esc((item.tags||[]).join(', '))}"/>
      </div>
      <div class="edit-field-row">
        <label class="edit-field-label">Categoria</label>
        <select class="form-input edit-field-input" id="edit-cat">
          ${CATS.map(c => `<option value="${c}" ${c===cat?'selected':''}>${c.charAt(0).toUpperCase()+c.slice(1)}</option>`).join('')}
        </select>
      </div>
      ${isNative ? `<div class="edit-native-notice">ℹ️ Item nativo — as alterações serão salvas como uma versão personalizada do item original.</div>` : ''}
      <div class="edit-form-actions">
        <button class="btn-edit-cancel" id="btn-edit-cancel">Cancelar</button>
        <button class="btn-edit-save" id="btn-edit-save">Salvar alterações</button>
      </div>
    </div>`;

    document.getElementById('detail-content').innerHTML = html;
    App.showScreen('detail');

    document.getElementById('btn-detail-review').onclick = () => Review.iniciar(cat);
    document.getElementById('btn-detail-speak').onclick  = () => {
      if (!window.speechSynthesis) return;
      try {
        const vozes = window.speechSynthesis.getVoices();
        const temVozJP = vozes.length === 0 || vozes.some(v => v.lang.startsWith('ja'));
        if (!temVozJP) return;
        const vol = Storage.getEffectiveVolume(); // respeita mute (obv2_audio_muted) e volume (obv2_audio_vol)
        const u = new SpeechSynthesisUtterance(item.char);
        u.lang = 'ja-JP'; u.rate = 0.8; u.volume = vol;
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(u);
      } catch(e) {}
    };

    document.getElementById('btn-detail-edit').onclick = () => {
      document.getElementById('detail-edit-form').classList.toggle('hidden');
      document.getElementById('edit-char').focus();
    };
    document.getElementById('btn-edit-cancel').onclick = () => {
      document.getElementById('detail-edit-form').classList.add('hidden');
    };

    document.getElementById('btn-edit-save').onclick = () => {
      const char    = document.getElementById('edit-char').value.trim();
      const romaji  = document.getElementById('edit-romaji').value.trim();
      const meaning = document.getElementById('edit-meaning').value.trim();
      const tagsRaw = document.getElementById('edit-tags').value.trim();
      const newCat  = document.getElementById('edit-cat').value;
      if (!char || !meaning) { alert('Caractere e significado são obrigatórios!'); return; }
      const tags = tagsRaw ? tagsRaw.split(',').map(t=>t.trim()).filter(Boolean) : [];

      if (isNative) {
        const saved = Storage.addItem({
          cat: newCat, char, romaji, meaning, tags,
          origin: 'custom', derivedFrom: item.id,
        });
        Detail.render({ ...saved, _native: false }, newCat);
      } else {
        Storage.updateItem(item.id, { char, romaji, meaning, tags, cat: newCat });
        const updated = { ...item, char, romaji, meaning, tags, cat: newCat, _native: false };
        Detail.render(updated, newCat);
      }
      Browse.render(newCat);
    };

    document.getElementById('btn-detail-remove').onclick = () => {
      if (isNative) {
        if (!confirm(`"${item.char}" é um item nativo e não pode ser removido permanentemente.\n\nDeseja resetar o progresso SRS deste item? Ele voltará a aparecer como novo.`)) return;
        const prog = Storage.loadProgress();
        delete prog[item.id];
        Storage.saveProgress(prog);
        alert('✅ Progresso SRS resetado.');
        Detail.render(item, cat);
      } else {
        if (!confirm(`Excluir "${item.char}" permanentemente?\n\nO progresso SRS será removido, mas o histórico de revisões é preservado.`)) return;
        Storage.deleteItem(item.id);
        App.showScreen('browse');
        Browse.render(cat);
      }
    };
  },

  _esc(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  },
};
