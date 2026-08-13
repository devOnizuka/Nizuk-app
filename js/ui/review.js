// js/ui/review.js
const Review = (() => {
  const SESSION_LIMIT = 40;
  const SESSION_KEY   = 'obv2_session_state';

  let queue=[], current=null, idx=0, acertos=0, erros=0, combo=0;
  let respondido=false, progress={}, todosItens=[], sessionStart=0, cat='', modo='';

  // ── Persiste estado da sessão em sessionStorage (sobrevive a trocas de aba)
  function _salvarSessao() {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({
        queue: queue.map(i => i.id),  // só IDs para economizar espaço
        idx, acertos, erros, combo, sessionStart, cat, modo,
      }));
    } catch(e) {}
  }

  // ── Restaura sessão interrompida, se existir
  function _restaurarSessao() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return false;
      const s = JSON.parse(raw);
      if (!s.queue?.length || s.idx >= s.queue.length) { _limparSessao(); return false; }
      todosItens = _allItems();
      const idMap = {};
      todosItens.forEach(i => { idMap[i.id] = i; });
      const qRestored = s.queue.map(id => idMap[id]).filter(Boolean);
      if (qRestored.length !== s.queue.length) { _limparSessao(); return false; }
      queue = qRestored; idx = s.idx; acertos = s.acertos; erros = s.erros;
      combo = s.combo; sessionStart = s.sessionStart; cat = s.cat; modo = s.modo;
      progress = Storage.loadProgress();
      return true;
    } catch(e) { _limparSessao(); return false; }
  }

  function _limparSessao() {
    try { sessionStorage.removeItem(SESSION_KEY); } catch(e) {}
  }

  // ── Pool de todos os itens
  function _allItems() {
    return [
      ...HIRAGANA_DATA.map(i => ({...i, cat:'hiragana'})),
      ...KATAKANA_DATA.map(i => ({...i, cat:'katakana'})),
      ...VOCAB_DATA.map(i    => ({...i, cat:'vocab'})),
      ...KANJI_DATA.map(i    => ({...i, cat:'kanji'})),
      ...Storage.loadItems(),
    ];
  }

  // ── Abre tela de seleção de modo (oferece restaurar sessão interrompida se existir)
  function abrirSelecao(categoria) {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (s.queue?.length && s.idx < s.queue.length) {
          const labels = { kanji:'Kanji', vocab:'Vocabulário', hiragana:'Hiragana', katakana:'Katakana', '':'Geral' };
          const restante = s.queue.length - s.idx;
          if (confirm(`Você tem uma sessão interrompida (${restante} item(s) restante(s) em ${labels[s.cat] || s.cat}).\n\nDeseja continuar de onde parou?`)) {
            if (_restaurarSessao()) { _mostrar(); App.showScreen('review'); return; }
          } else {
            _limparSessao();
          }
        }
      }
    } catch(e) {}

    cat = categoria || '';
    const labels = { kanji:'Kanji', vocab:'Vocabulário', hiragana:'Hiragana', katakana:'Katakana', '':'Todos' };
    document.getElementById('mode-cat-label').textContent = labels[cat] || cat;
    App.showScreen('mode-select');
  }

  // ── Inicia sessão com modo escolhido
  function iniciar(modoCscolhido) {
    modo       = modoCscolhido; // 'encontrar' | 'reconhecer'
    progress   = Storage.loadProgress();
    todosItens = _allItems();

    let pool = cat ? todosItens.filter(i => i.cat === cat) : todosItens;

    // Guard: pool vazia — nenhum item cadastrado na categoria
    if (pool.length === 0) {
      const labels = { kanji:'Kanji', vocab:'Vocabulário', hiragana:'Hiragana', katakana:'Katakana', '':'geral' };
      alert(`Nenhum item encontrado em ${labels[cat] || cat}. Adicione itens na aba Conteúdo.`);
      App.showScreen('home');
      return;
    }

    let due = FSRS.filtrarDue(pool, progress);
    if (due.length === 0) due = pool; // se nada vence hoje, usa tudo

    // Ordena por prioridade SRS e embaralha
    let ordered = FSRS.ordenarPorPrioridade(FSRS.shuffle(due), progress);

    // Limita a SESSION_LIMIT
    queue = ordered.slice(0, SESSION_LIMIT);
    idx = 0; acertos = 0; erros = 0; combo = 0;
    sessionStart = Date.now();
    _mostrar();
    App.showScreen('review');
  }

  // ── Monta questão conforme o modo
  function _montarQuestao(item) {
    // Modo 1 — "Encontrar a palavra": pergunta = significado → resposta = char (+ leitura nas opções)
    // Modo 2 — "Reconhecer a palavra": pergunta = char + leitura → resposta = significado
    const pool = todosItens.filter(i => i.cat === item.cat && i.id !== item.id && i.char && i.meaning);

    if (modo === 'encontrar') {
      // Pergunta: significado em português
      // Alternativas: palavras japonesas (char), com leitura (romaji) embaixo
      const distratores = FSRS.shuffle(pool).slice(0, 3);
      const opcoes = FSRS.shuffle([item, ...distratores]);
      return {
        item,
        modo,
        pergunta:  item.meaning,
        subPergunta: null,
        label:     'Encontrar a palavra',
        labelSub:  'Qual é a palavra japonesa?',
        opcoes,            // array de items completos
        respostaId: item.id,
      };
    } else {
      // Modo "reconhecer": pergunta = char + leitura
      // Alternativas: significados (texto)
      const distratores = FSRS.shuffle(pool).slice(0, 3);
      const opcoesTexto = FSRS.shuffle([item, ...distratores]).map(i => i.meaning);
      return {
        item,
        modo,
        pergunta:   item.char,
        subPergunta: item.romaji || '',
        label:      'Reconhecer a palavra',
        labelSub:   'Qual é o significado?',
        opcoes:     opcoesTexto,   // array de strings
        respostaId: item.meaning,
      };
    }
  }

  // ── Renderiza a questão na tela
  function _mostrar() {
    respondido = false;

    if (idx >= queue.length) { _encerrar(); return; }

    const item = queue[idx];
    current = _montarQuestao(item);

    const total = queue.length;
    document.getElementById('rev-plabel').textContent  = `${idx + 1}/${total}`;
    document.getElementById('rev-pbar').style.width    = `${((idx) / total) * 100}%`;
    document.getElementById('rev-correct').textContent = `✓ ${acertos}`;
    document.getElementById('rev-wrong').textContent   = `✗ ${erros}`;

    const badge = document.getElementById('rev-combo');
    if (combo >= 3) { badge.textContent = `🔥 x${combo}`; badge.classList.remove('hidden'); }
    else badge.classList.add('hidden');

    // Cabeçalho da questão
    document.getElementById('rev-qtype').textContent = current.label;
    document.getElementById('rev-qlabel-sub').textContent = current.labelSub;

    // Pergunta principal
    const mainEl = document.getElementById('rev-qmain');
    const subEl  = document.getElementById('rev-qsub');
    const jEl    = document.getElementById('rev-jlpt');

    if (modo === 'encontrar') {
      // Mostra significado (texto) — aumentado de 1.35rem para 2rem para melhor legibilidade
      mainEl.style.fontFamily = 'var(--font-ui)';
      mainEl.style.fontSize   = '2rem';
      mainEl.textContent = current.pergunta;
      subEl.textContent  = '';
      jEl.textContent    = item.jlpt || '';
      jEl.style.display  = item.jlpt ? '' : 'none';
    } else {
      // Mostra kanji/kana — aumentado de 3.2rem para 5rem para melhor legibilidade
      mainEl.style.fontFamily = 'var(--font-jp)';
      mainEl.style.fontSize   = '5rem';
      mainEl.textContent = current.pergunta;
      subEl.textContent  = current.subPergunta || '';
      jEl.textContent    = item.jlpt || '';
      jEl.style.display  = item.jlpt ? '' : 'none';
    }

    // Feedback oculto
    document.getElementById('screen-review').classList.remove('has-feedback');
    document.getElementById('rev-feedback').classList.add('hidden');
    document.getElementById('rev-feedback').classList.remove('is-correct','is-wrong');
    document.getElementById('srs-btns').classList.add('hidden');

    // Monta opções
    const grid = document.getElementById('rev-options');
    grid.innerHTML = '';
    grid.classList.remove('hidden');

    if (modo === 'encontrar') {
      // Cada opção: item completo → botão mostra char + romaji
      grid.className = 'options-grid options-jp';
      current.opcoes.forEach(opItem => {
        const btn = document.createElement('button');
        btn.className = 'option-btn option-jp';
        btn.innerHTML = `<span class="opt-char">${opItem.char}</span>${opItem.romaji ? `<span class="opt-read">${opItem.romaji}</span>` : ''}`;
        btn.dataset.id = opItem.id;
        btn.onclick = () => _responder(opItem.id === current.respostaId, btn, opItem.id);
        grid.appendChild(btn);
      });
    } else {
      // Cada opção: string de significado
      grid.className = 'options-grid options-text';
      current.opcoes.forEach(texto => {
        const btn = document.createElement('button');
        btn.className = 'option-btn option-text';
        btn.textContent = texto;
        btn.onclick = () => _responder(texto === current.respostaId, btn, texto);
        grid.appendChild(btn);
      });
    }
  }

  // ── Processa resposta
  function _responder(correto, btnEl, valorEscolhido) {
    if (respondido) return;
    respondido = true;

    if (correto) { acertos++; combo++; } else { erros++; combo = 0; }

    // Marca todas as opções
    document.querySelectorAll('#rev-options .option-btn').forEach(b => {
      b.disabled = true;
      if (modo === 'encontrar') {
        if (b.dataset.id === current.respostaId) b.classList.add('correct-ans');
        else if (b === btnEl && !correto) b.classList.add('wrong-ans');
      } else {
        if (b.textContent === current.respostaId) b.classList.add('correct-ans');
        else if (b === btnEl && !correto) b.classList.add('wrong-ans');
      }
    });

    _falar(current.item.char);

    // Feedback
    document.getElementById('screen-review').classList.add('has-feedback');
    const fb = document.getElementById('rev-feedback');
    fb.classList.remove('hidden','is-correct','is-wrong');
    fb.classList.add(correto ? 'is-correct' : 'is-wrong');
    document.getElementById('rev-fb-icon').textContent = correto ? '✅ Correto!' : '❌ Incorreto';

    const respostaCorreta = modo === 'encontrar' ? current.item.char : current.item.meaning;
    document.getElementById('rev-fb-ans').textContent =
      correto ? '' : `Resposta correta: ${respostaCorreta}`;
    document.getElementById('rev-fb-exp').textContent =
      `${current.item.char}${current.item.romaji ? ' — ' + current.item.romaji : ''}${current.item.meaning ? ' — ' + current.item.meaning : ''}`;
    document.getElementById('rev-fb-next').textContent = '';
    document.getElementById('srs-btns').classList.remove('hidden');
  }

  // ── Aplica SRS e avança
  function aplicarSRS(qualidade) {
    const stt  = FSRS.initItem(progress[current.item.id]);
    const novo = FSRS.review(stt, qualidade);
    progress[current.item.id] = novo;
    Storage.saveProgress(progress);

    const stats = Storage.loadStats();
    stats.totalQuestoes++;
    qualidade >= 3 ? stats.totalAcertos++ : stats.totalErros++;
    Storage.saveStats(stats);

    const today = Storage.loadToday();
    today.reviews = (today.reviews || 0) + 1;
    qualidade >= 3 ? today.acertos++ : today.erros++;
    Storage.saveToday(today);
    Storage.atualizarStreak(1);

    document.getElementById('rev-fb-next').textContent = FSRS.nextReviewText(novo.interval);
    idx++;
    _salvarSessao();
    setTimeout(() => _mostrar(), 350);
  }

  // ── Encerra sessão e mostra resultado
  function _encerrar() {
    _limparSessao();
    const mins   = Math.round((Date.now() - sessionStart) / 60000);
    const today  = Storage.loadToday();
    today.minutos = (today.minutos || 0) + mins;
    Storage.saveToday(today);

    const total  = acertos + erros;
    const pct    = total > 0 ? Math.round((acertos / total) * 100) : 0;
    Storage.addSession({ data: new Date().toISOString(), tipo: 'review', modo, cat, acertos, erros, total, pct });

    _mostrarResultado({ acertos, erros, total, pct, mins });
  }

  function _mostrarResultado({ acertos, erros, total, pct, mins }) {
    const labels = { kanji:'Kanji', vocab:'Vocabulário', hiragana:'Hiragana', katakana:'Katakana', '':'Todos' };
    const modoLabel = modo === 'encontrar' ? 'Encontrar a palavra' : 'Reconhecer a palavra';
    const nota = pct >= 90 ? '🏆 Excelente!' : pct >= 70 ? '👍 Muito bem!' : pct >= 50 ? '📖 Continue praticando!' : '💪 Não desista!';

    document.getElementById('result-cat').textContent   = labels[cat] || cat;
    document.getElementById('result-modo').textContent  = modoLabel;
    document.getElementById('result-nota').textContent  = nota;
    document.getElementById('result-pct').textContent   = `${pct}%`;
    document.getElementById('result-acertos').textContent = acertos;
    document.getElementById('result-erros').textContent   = erros;
    document.getElementById('result-total').textContent   = total;
    document.getElementById('result-mins').textContent    = mins > 0 ? `${mins} min` : '< 1 min';

    App.showScreen('result');
  }

  function _falar(t) {
    if (!window.speechSynthesis) return;
    try {
      const vol = Storage.getEffectiveVolume(); // respeita mute (obv2_audio_muted) e volume (obv2_audio_vol)
      const u = new SpeechSynthesisUtterance(t);
      u.lang = 'ja-JP'; u.rate = 0.85; u.volume = vol;

      // Verifica se há voz japonesa disponível antes de tentar falar
      const vozes = window.speechSynthesis.getVoices();
      const temVozJP = vozes.length === 0 || vozes.some(v => v.lang.startsWith('ja'));
      if (!temVozJP) return;

      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch(e) {}
  }

    // expose para tela de resultado
  return { abrirSelecao, iniciar, aplicarSRS, get _lastModo(){ return modo; }, get _lastCat(){ return cat; } };
})();
