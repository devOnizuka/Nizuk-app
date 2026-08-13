// js/ui/anki.js — Baralhos Anki integrados ao sistema de conteúdo
const Anki = (() => {
  // Fase 0 — antes este módulo lia/escrevia localStorage diretamente com sua
  // própria constante ANKI_KEY. Agora delega para Storage, que é o único
  // ponto de acesso a localStorage no projeto. Assinatura de loadDecks/saveDecks
  // permanece igual — nenhum outro lugar deste arquivo precisou mudar.
  function loadDecks() { return Storage.loadAnkiDecks(); }
  function saveDecks(d) { Storage.saveAnkiDecks(d); }

  let currentDeckId = null;

  // ── Render deck list
  function renderDecks() {
    const decks = loadDecks();
    const container = document.getElementById('anki-deck-list');
    if (decks.length === 0) {
      container.innerHTML = `
        <div class="anki-empty">
          <div class="anki-empty-icon">🃏</div>
          <div class="anki-empty-text">Nenhum baralho ainda.<br>Crie um novo ou importe um arquivo Anki (.txt).</div>
        </div>`;
      return;
    }
    container.innerHTML = decks.map(deck => {
      const cards = deck.cards || [];
      const allItems = Storage.getItemsByCategory(deck.cat || 'vocab');
      // Cards deste baralho que estão no storage de items
      const deckItems = Storage.loadItems().filter(i => i.deckId === deck.id);
      const prog = Storage.loadProgress();
      const due  = deckItems.filter(i => FSRS.isDue(FSRS.initItem(prog[i.id]))).length;
      return `<div class="anki-deck-card" data-id="${deck.id}">
        <div class="anki-deck-icon">🃏</div>
        <div class="anki-deck-info">
          <div class="anki-deck-name">${_esc(deck.name)}</div>
          ${deck.desc ? `<div class="anki-deck-desc">${_esc(deck.desc)}</div>` : ''}
          <div class="anki-deck-meta">
            <span class="anki-badge total">📂 ${deck.cat||'vocab'}</span>
            <span class="anki-badge total">${deckItems.length} cards</span>
            ${due > 0 ? `<span class="anki-badge due">📅 ${due} para revisar</span>` : ''}
          </div>
        </div>
        <div class="anki-deck-arrow">›</div>
      </div>`;
    }).join('');

    container.querySelectorAll('.anki-deck-card').forEach(el => {
      el.addEventListener('click', () => openDeck(el.dataset.id));
    });
  }

  // ── Open deck
  function openDeck(deckId) {
    const decks = loadDecks();
    const deck  = decks.find(d => d.id === deckId);
    if (!deck) return;
    currentDeckId = deckId;

    const deckItems = Storage.loadItems().filter(i => i.deckId === deckId);
    const prog = Storage.loadProgress();
    const due  = deckItems.filter(i => FSRS.isDue(FSRS.initItem(prog[i.id]))).length;
    let aprendendo = 0, dominados = 0;
    deckItems.forEach(i => {
      const s = FSRS.initItem(prog[i.id]);
      if (s.repetitions >= 5) dominados++;
      else if (s.repetitions >= 1) aprendendo++;
    });

    document.getElementById('anki-deck-title').textContent = deck.name;
    document.getElementById('anki-deck-cat-badge').textContent = deck.cat || 'vocab';
    document.getElementById('anki-deck-stats').innerHTML = `
      <div class="anki-stat-chip"><div class="anki-stat-num">${deckItems.length}</div><div class="anki-stat-lbl">Total</div></div>
      <div class="anki-stat-chip"><div class="anki-stat-num" style="color:var(--wrong)">${due}</div><div class="anki-stat-lbl">Para revisar</div></div>
      <div class="anki-stat-chip"><div class="anki-stat-num" style="color:var(--gold)">${aprendendo}</div><div class="anki-stat-lbl">Aprendendo</div></div>
      <div class="anki-stat-chip"><div class="anki-stat-num" style="color:var(--correct)">${dominados}</div><div class="anki-stat-lbl">Dominados</div></div>`;

    const btnStudy = document.getElementById('btn-anki-study-deck');
    btnStudy.disabled = deckItems.length === 0;
    btnStudy.textContent = due > 0 ? `📖 Estudar (${due} pendentes)` : deckItems.length > 0 ? '📖 Estudar (novos)' : '📖 Estudar';

    _renderDeckCardList(deckItems);
    document.getElementById('anki-add-card-form').classList.add('hidden');
    document.getElementById('anki-rename-form').classList.add('hidden');
    document.getElementById('anki-card-front').value = '';
    document.getElementById('anki-card-back').value  = '';
    document.getElementById('anki-card-hint').value  = '';
    App.showScreen('anki-deck');
  }

  function _renderDeckCardList(deckItems) {
    const list = document.getElementById('anki-card-list');
    const prog = Storage.loadProgress();
    if (deckItems.length === 0) {
      list.innerHTML = '<p style="color:var(--mid);font-size:.85rem;padding:4px 0">Nenhum card. Adicione o primeiro!</p>';
      return;
    }
    list.innerHTML = deckItems.map(item => {
      const stt = FSRS.initItem(prog[item.id]);
      const lvl = stt.repetitions >= 5 ? '⭐' : stt.repetitions >= 1 ? '📖' : '🆕';
      return `<div class="anki-card-item">
        <div class="anki-card-front">${_esc(item.char)}</div>
        <div class="anki-card-back">${_esc(item.meaning)}</div>
        <div class="anki-card-lvl">${lvl}</div>
        <button class="anki-card-edit" data-id="${item.id}" title="Editar">✏️</button>
        <button class="anki-card-del"  data-id="${item.id}" title="Excluir">✕</button>
      </div>`;
    }).join('');

    list.querySelectorAll('.anki-card-del').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!confirm('Excluir este card? O progresso SRS também será removido.')) return;
        Storage.deleteItem(btn.dataset.id);
        openDeck(currentDeckId);
      });
    });
    list.querySelectorAll('.anki-card-edit').forEach(btn => {
      btn.addEventListener('click', () => _openCardEdit(btn.dataset.id));
    });
  }

  // ── Inline card edit
  function _openCardEdit(itemId) {
    const item = Storage.loadItems().find(i => i.id === itemId);
    if (!item) return;
    const existing = document.getElementById('inline-card-edit-' + itemId);
    if (existing) { existing.remove(); return; }

    // Fecha outros edits abertos
    document.querySelectorAll('.inline-card-edit').forEach(el => el.remove());

    const row = document.querySelector(`.anki-card-edit[data-id="${itemId}"]`)?.closest('.anki-card-item');
    if (!row) return;

    const div = document.createElement('div');
    div.className = 'inline-card-edit';
    div.id = 'inline-card-edit-' + itemId;
    div.innerHTML = `
      <div class="edit-field-row"><label class="edit-field-label">Frente (pergunta)</label>
        <input class="form-input edit-field-input" id="ice-char" value="${_esc(item.char||'')}"/></div>
      <div class="edit-field-row"><label class="edit-field-label">Verso (resposta)</label>
        <input class="form-input edit-field-input" id="ice-meaning" value="${_esc(item.meaning||'')}"/></div>
      <div class="edit-field-row"><label class="edit-field-label">Leitura / Dica</label>
        <input class="form-input edit-field-input" id="ice-romaji" value="${_esc(item.romaji||'')}"/></div>
      <div class="edit-field-row"><label class="edit-field-label">Tags (separadas por vírgula)</label>
        <input class="form-input edit-field-input" id="ice-tags" value="${_esc((item.tags||[]).join(', '))}"/></div>
      <div class="edit-form-actions">
        <button class="btn-edit-cancel" id="ice-cancel">Cancelar</button>
        <button class="btn-edit-save"   id="ice-save">Salvar</button>
      </div>`;

    row.insertAdjacentElement('afterend', div);
    document.getElementById('ice-char').focus();

    document.getElementById('ice-cancel').onclick = () => div.remove();
    document.getElementById('ice-save').onclick = () => {
      const char    = document.getElementById('ice-char').value.trim();
      const meaning = document.getElementById('ice-meaning').value.trim();
      const romaji  = document.getElementById('ice-romaji').value.trim();
      const tagsRaw = document.getElementById('ice-tags').value.trim();
      if (!char || !meaning) { alert('Frente e verso são obrigatórios!'); return; }
      const tags = tagsRaw ? tagsRaw.split(',').map(t=>t.trim()).filter(Boolean) : [];
      Storage.updateItem(itemId, { char, meaning, romaji, tags });
      div.remove();
      openDeck(currentDeckId);
    };
  }

  // ── Add card manual
  function addCard() {
    const front = document.getElementById('anki-card-front').value.trim();
    const back  = document.getElementById('anki-card-back').value.trim();
    const hint  = document.getElementById('anki-card-hint').value.trim();
    if (!front || !back) { alert('Preencha frente e verso!'); return; }
    const decks = loadDecks();
    const deck  = decks.find(d => d.id === currentDeckId);
    if (!deck) return;
    Storage.addItem({
      cat: deck.cat || 'vocab', char: front, meaning: back,
      romaji: hint, tags: [], origin: 'imported', deckId: currentDeckId, deckName: deck.name,
    });
    document.getElementById('anki-card-front').value = '';
    document.getElementById('anki-card-back').value  = '';
    document.getElementById('anki-card-hint').value  = '';
    document.getElementById('anki-add-card-form').classList.add('hidden');
    openDeck(currentDeckId);
  }

  // ── Create deck
  function createDeck(name, desc, cat) {
    if (!name.trim()) return;
    const decks = loadDecks();
    decks.push({ id:`deck_${Date.now()}`, name:name.trim(), desc:desc.trim(), cat:cat||'vocab', created:Date.now() });
    saveDecks(decks);
    renderDecks();
  }

  // ── Rename deck
  function renameDeck(deckId, name, desc, cat) {
    const decks = loadDecks();
    const deck  = decks.find(d => d.id === deckId);
    if (!deck) return;
    deck.name = name.trim() || deck.name;
    deck.desc = desc.trim();
    deck.cat  = cat || deck.cat;
    saveDecks(decks);
    // Atualiza deckName nos items
    Storage.loadItems().filter(i => i.deckId === deckId).forEach(i => {
      Storage.updateItem(i.id, { deckName: deck.name, cat: deck.cat });
    });
  }

  // ── Delete deck
  function deleteDeck(deckId) {
    const decks = loadDecks();
    const deck = decks.find(d => d.id === deckId);
    if (!deck) return;
    const deckItems = Storage.loadItems().filter(i => i.deckId === deckId);
    const choice = deckItems.length > 0
      ? confirm(`Deseja excluir o baralho "${deck.name}" e TODOS os seus ${deckItems.length} cards?\n\nOK = Excluir baralho e cards\nCancelar = Apenas excluir o baralho (manter cards)`)
      : true;
    if (choice === null || choice === undefined) return;
    if (choice) {
      // Exclui baralho e todos os cards
      deckItems.forEach(i => Storage.deleteItem(i.id));
    } else {
      // Mantém cards mas remove vínculo com o baralho
      deckItems.forEach(i => Storage.updateItem(i.id, { deckId: null, deckName: deck.name + ' (arquivado)' }));
    }
    const newDecks = loadDecks().filter(d => d.id !== deckId);
    saveDecks(newDecks);
    App.showScreen('anki');
    renderDecks();
  }

  // ── Import (.txt Anki / JSON)
  function importDeck(rawText, fileName) {
    const trimmed = rawText.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
      return _importAnkiTxt(rawText, fileName);
    }
    try {
      const data = JSON.parse(trimmed);
      const src  = Array.isArray(data) ? data : [data];
      let total  = 0;
      src.forEach((d, di) => {
        if (!d.cards?.length) return;
        // Mostra modal de categoria antes de importar
        _importWithCatChoice(d, fileName, di);
        total += d.cards.length;
      });
      return true;
    } catch(e) {
      alert('❌ Arquivo inválido.\n' + e.message);
      return false;
    }
  }

  function _importWithCatChoice(deckData, fileName, di) {
    const modal = document.getElementById('modal-import-cat');
    document.getElementById('import-cat-deck-name').textContent = deckData.name || _nameFromFile(fileName) || `Baralho ${di+1}`;
    modal.classList.remove('hidden');
    document.getElementById('btn-confirm-import-cat').onclick = () => {
      const cat  = document.getElementById('import-cat-select').value;
      const name = deckData.name || _nameFromFile(fileName) || 'Baralho Importado';
      const desc = deckData.desc || deckData.description || '';
      const decks = loadDecks();
      const deckId = `deck_${Date.now()}_${di}`;
      decks.push({ id:deckId, name, desc, cat, created:Date.now() });
      saveDecks(decks);
      const cards = deckData.cards.map((c,i) => ({
        cat, char:   _stripHtml(c.front||c.question||c.frente||String(c[Object.keys(c)[0]]||'')),
        meaning: _stripHtml(c.back||c.answer||c.verso||String(c[Object.keys(c)[1]]||'')),
        romaji:  _stripHtml(c.hint||c.dica||''),
        tags: c.tags||[], origin:'imported', deckId, deckName:name, createdAt:Date.now(),
      })).filter(c => c.char && c.meaning);
      cards.forEach(c => Storage.addItem(c));
      modal.classList.add('hidden');
      renderDecks();
      alert(`✅ "${name}" importado com ${cards.length} cards na categoria ${cat}!`);
    };
    document.getElementById('btn-cancel-import-cat').onclick = () => modal.classList.add('hidden');
  }

  function _importAnkiTxt(rawText, fileName) {
    const lines = rawText.split('\n');
    let separator = '\t', deckName = _nameFromFile(fileName) || 'Baralho Importado';
    let col0 = 0, col1 = 1, col2 = 2;

    for (const line of lines) {
      if (!line.startsWith('#')) break;
      if (/^#separator:tab/i.test(line)) separator = '\t';
      if (/^#separator:semicolon/i.test(line)) separator = ';';
      if (/^#separator:comma/i.test(line)) separator = ',';
      if (line.startsWith('#deck:')) deckName = line.replace('#deck:','').trim() || deckName;
      if (line.startsWith('#columns:')) {
        const cols = line.replace('#columns:','').split('\t').map(c=>c.toLowerCase().trim());
        const fi = cols.findIndex(c=>/expres|word|front|vocab/i.test(c));
        const ri = cols.findIndex(c=>/read|kana|hira|roma/i.test(c));
        const mi = cols.findIndex(c=>/mean|signif|english|back/i.test(c));
        if(fi>=0) col0=fi; if(ri>=0) col1=ri; if(mi>=0) col2=mi;
      }
    }

    const dataLines = lines.filter(l => l.trim() && !l.startsWith('#'));
    const parsed = dataLines.map((line,i) => {
      const cols = _parseAnkiLine(line, separator);
      if (cols.length < 2) return null;
      const front = _stripHtml((cols[col0]||'').trim());
      const back  = _stripHtml((cols[col2]||cols[1]||'').trim());
      const hint  = col1>=0 && col1!==col0 ? _stripHtml((cols[col1]||'').trim()) : '';
      if (!front || !back || front===back) return null;
      return { char:front, meaning:back, romaji: hint!==front?hint:'', tags:[], origin:'imported' };
    }).filter(Boolean);

    if (parsed.length === 0) { alert('Nenhum card válido encontrado.'); return false; }

    // Mostra modal de categoria
    const modal = document.getElementById('modal-import-cat');
    document.getElementById('import-cat-deck-name').textContent = deckName;
    modal.classList.remove('hidden');
    document.getElementById('btn-confirm-import-cat').onclick = () => {
      const cat    = document.getElementById('import-cat-select').value;
      const decks  = loadDecks();
      const deckId = `deck_${Date.now()}`;
      decks.push({ id:deckId, name:deckName, desc:`Importado do Anki — ${parsed.length} cards`, cat, created:Date.now() });
      saveDecks(decks);
      parsed.forEach(c => Storage.addItem({ ...c, cat, deckId, deckName }));
      modal.classList.add('hidden');
      renderDecks();
      alert(`✅ "${deckName}" importado com ${parsed.length} cards na categoria ${cat}!`);
    };
    document.getElementById('btn-cancel-import-cat').onclick = () => modal.classList.add('hidden');
    return true;
  }

  // ── Utils
  function _parseAnkiLine(line, sep) {
    const cols=[]; let cur='', inQ=false;
    for(let i=0;i<line.length;i++){
      const ch=line[i];
      if(ch==='"'){ if(inQ&&line[i+1]==='"'){cur+='"';i++;}else inQ=!inQ; }
      else if(ch===sep&&!inQ){cols.push(cur);cur='';}
      else cur+=ch;
    }
    cols.push(cur); return cols;
  }
  function _stripHtml(s){
    return String(s||'').replace(/<br\s*\/?>/gi,' ').replace(/<[^>]+>/g,'')
      .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&nbsp;/g,' ')
      .replace(/\s+/g,' ').trim();
  }
  function _nameFromFile(f){ return f?f.replace(/\.[^.]+$/,'').replace(/[_-]/g,' ').trim():''; }
  function _esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  // ── Review session (usa sistema SRS unificado)
  let revQueue=[], revIdx=0, revAcertos=0, revErros=0, revRevealed=false;

  function startReview() {
    const decks = loadDecks();
    const deck  = decks.find(d => d.id === currentDeckId);
    if (!deck) return;
    const deckItems = Storage.loadItems().filter(i => i.deckId === currentDeckId);
    if (!deckItems.length) return;
    const prog = Storage.loadProgress();
    let due = deckItems.filter(i => FSRS.isDue(FSRS.initItem(prog[i.id])));
    if (!due.length) due = deckItems.slice(0,20);
    revQueue = FSRS.shuffle(due);
    revIdx = 0; revAcertos = 0; revErros = 0;
    _showAnkiCard();
    App.showScreen('anki-review');
  }

  function _showAnkiCard() {
    revRevealed = false;
    if (revIdx >= revQueue.length) { _endReview(); return; }
    const card  = revQueue[revIdx];
    const total = revQueue.length;
    document.getElementById('anki-rev-pbar').style.width    = `${(revIdx/total)*100}%`;
    document.getElementById('anki-rev-plabel').textContent  = `${revIdx}/${total}`;
    document.getElementById('anki-rev-correct').textContent = `✓ ${revAcertos}`;
    document.getElementById('anki-rev-wrong').textContent   = `✗ ${revErros}`;
    document.getElementById('anki-rev-qtype').textContent   = 'Frente';
    document.getElementById('anki-rev-front').textContent   = card.char;
    document.getElementById('anki-rev-hint').textContent    = card.romaji || '';
    document.getElementById('anki-rev-hint').style.display  = card.romaji ? '' : 'none';
    document.getElementById('anki-rev-back-wrap').classList.add('hidden');
    document.getElementById('btn-anki-reveal').classList.remove('hidden');
    document.getElementById('anki-srs-btns').classList.add('hidden');
  }

  function revealCard() {
    if (revRevealed) return;
    revRevealed = true;
    const card = revQueue[revIdx];
    document.getElementById('anki-rev-back').textContent = card.meaning;
    document.getElementById('anki-rev-back-wrap').classList.remove('hidden');
    document.getElementById('btn-anki-reveal').classList.add('hidden');
    document.getElementById('anki-srs-btns').classList.remove('hidden');
  }

  function applyAnkiSRS(q) {
    const card = revQueue[revIdx];
    const prog = Storage.loadProgress();
    const stt  = FSRS.initItem(prog[card.id]);
    prog[card.id] = FSRS.review(stt, q);
    Storage.saveProgress(prog);
    // Atualiza stats globais
    const stats = Storage.loadStats();
    stats.totalQuestoes++;
    q >= 3 ? stats.totalAcertos++ : stats.totalErros++;
    Storage.saveStats(stats);
    const today = Storage.loadToday();
    today.reviews = (today.reviews||0)+1;
    q >= 3 ? today.acertos++ : today.erros++;
    Storage.saveToday(today);
    Storage.atualizarStreak(1);
    if (q >= 3) revAcertos++; else revErros++;
    revIdx++;
    setTimeout(() => _showAnkiCard(), 200);
  }

  function _endReview() {
    App.showScreen('anki-deck');
    openDeck(currentDeckId);
  }

  // ── Init
  function init() {
    // Novo baralho
    document.getElementById('btn-anki-new-deck').addEventListener('click', () => {
      document.getElementById('new-deck-name').value = '';
      document.getElementById('new-deck-desc').value = '';
      document.getElementById('new-deck-cat').value  = 'vocab';
      document.getElementById('modal-new-deck').classList.remove('hidden');
      document.getElementById('new-deck-name').focus();
    });
    document.getElementById('btn-cancel-deck').addEventListener('click', () =>
      document.getElementById('modal-new-deck').classList.add('hidden'));
    document.getElementById('modal-new-deck').addEventListener('click', e => {
      if (e.target===e.currentTarget) e.currentTarget.classList.add('hidden');
    });
    document.getElementById('btn-confirm-deck').addEventListener('click', () => {
      const name = document.getElementById('new-deck-name').value;
      const desc = document.getElementById('new-deck-desc').value;
      const cat  = document.getElementById('new-deck-cat').value;
      if (!name.trim()) { document.getElementById('new-deck-name').focus(); return; }
      createDeck(name, desc, cat);
      document.getElementById('modal-new-deck').classList.add('hidden');
    });
    document.getElementById('new-deck-name').addEventListener('keydown', e => {
      if (e.key==='Enter') document.getElementById('btn-confirm-deck').click();
    });

    // Import
    document.getElementById('btn-anki-import-deck').addEventListener('click', () =>
      document.getElementById('anki-import-file').click());
    document.getElementById('anki-import-file').addEventListener('change', e => {
      const file = e.target.files[0]; if(!file) return;
      const reader = new FileReader();
      reader.onload = ev => importDeck(ev.target.result, file.name);
      reader.readAsText(file, 'UTF-8');
      e.target.value = '';
    });

    // Back
    document.getElementById('btn-back-anki-deck').addEventListener('click', () => {
      App.showScreen('anki'); renderDecks();
    });

    // Rename
    document.getElementById('btn-anki-rename-deck').addEventListener('click', () => {
      const decks = loadDecks();
      const deck  = decks.find(d => d.id === currentDeckId);
      if (!deck) return;
      document.getElementById('rename-deck-name').value = deck.name;
      document.getElementById('rename-deck-desc').value = deck.desc || '';
      document.getElementById('rename-deck-cat').value  = deck.cat  || 'vocab';
      document.getElementById('anki-rename-form').classList.toggle('hidden');
    });
    document.getElementById('btn-rename-cancel').addEventListener('click', () =>
      document.getElementById('anki-rename-form').classList.add('hidden'));
    document.getElementById('btn-rename-save').addEventListener('click', () => {
      const name = document.getElementById('rename-deck-name').value;
      const desc = document.getElementById('rename-deck-desc').value;
      const cat  = document.getElementById('rename-deck-cat').value;
      renameDeck(currentDeckId, name, desc, cat);
      document.getElementById('anki-rename-form').classList.add('hidden');
      openDeck(currentDeckId);
    });

    // Delete deck
    document.getElementById('btn-anki-delete-deck').addEventListener('click', () =>
      deleteDeck(currentDeckId));

    // Add card
    document.getElementById('btn-anki-add-card').addEventListener('click', () => {
      document.getElementById('anki-add-card-form').classList.toggle('hidden');
      if (!document.getElementById('anki-add-card-form').classList.contains('hidden'))
        document.getElementById('anki-card-front').focus();
    });
    document.getElementById('btn-anki-save-card').addEventListener('click', () => addCard());

    // Study
    document.getElementById('btn-anki-study-deck').addEventListener('click', () => startReview());

    // Back from review
    document.getElementById('btn-back-anki-review').addEventListener('click', () => {
      if (revIdx===0 || confirm('Sair da revisão?')) { App.showScreen('anki-deck'); openDeck(currentDeckId); }
    });

    // Reveal
    document.getElementById('btn-anki-reveal').addEventListener('click', () => revealCard());

    // SRS
    document.querySelectorAll('#anki-srs-btns .srs-btn').forEach(btn =>
      btn.addEventListener('click', () => applyAnkiSRS(parseInt(btn.dataset.q))));

    // Modal import cat
    document.getElementById('modal-import-cat').addEventListener('click', e => {
      if (e.target===e.currentTarget) e.currentTarget.classList.add('hidden');
    });
  }

  return { init, renderDecks };
})();
