// js/engine/fsrs.js — Motor FSRS (Free Spaced Repetition Scheduler)
// Substitui o SM-2. Mesma "API pública" (initItem, review, isDue, nextReviewText,
// filtrarDue, ordenarPorPrioridade, shuffle, gerarOpcoes) para não quebrar review.js,
// browse.js, anki.js, dashboard.js.
//
// Baseado nos parâmetros padrão do FSRS-4.5 (open-spaced-repetition/fsrs4anki),
// treinados sobre milhões de revisões reais — não são "chutados" como no SM-2.
//
// Campos do estado por item (persistidos em progress[item.id]):
//   stability    — S: há quantos dias, em média, a memória resiste sem esquecer
//   difficulty   — D: 1 (fácil) a 10 (difícil), específico do item
//   interval     — dias até a próxima revisão (calculado a partir de S)
//   dueDate      — timestamp da próxima revisão
//   repetitions  — sequência de acertos consecutivos (só para exibição/filtros)
//   acertos/erros/totalReviews/lastSeen/errosPorTipo — iguais ao SM-2, para stats

const FSRS = {
  // Parâmetros padrão FSRS-4.5 (17 pesos, w0..w16)
  W: [0.4072, 1.1829, 3.1262, 15.4722, 7.2102, 0.5316, 1.0651, 0.0234, 1.616,
      0.1544, 1.0824, 1.9813, 0.0953, 0.2975, 2.2042, 0.2407, 2.9466],

  DECAY: -0.5,
  get FACTOR() { return Math.pow(0.9, 1 / this.DECAY) - 1; }, // ≈0.2345679

  REQUEST_RETENTION: 0.9,   // meta: 90% de chance de lembrar no dia da revisão
  MAX_INTERVAL: 3650,       // teto de 10 anos, evita intervalos absurdos
  MIN_DIFFICULTY: 1,
  MAX_DIFFICULTY: 10,

  // ── Migração/inicialização de estado ──────────────────────────────────
  initItem(saved) {
    // Item novo, nunca visto
    if (!saved || (saved.stability == null && saved.interval == null)) {
      return {
        stability: 0, difficulty: 0, interval: 0,
        repetitions: 0, ef: 0, // 'ef' mantido só para não quebrar browse.js (mostra difficulty)
        dueDate: Date.now(),
        acertos: 0, erros: 0, totalReviews: 0, lastSeen: null,
        errosPorTipo: {},
      };
    }
    // Migração de item que já tinha progresso no SM-2 antigo (tem 'ef' mas não 'stability')
    if (saved.stability == null) {
      const efAntigo = saved.ef ?? 2.5;
      // Aproximação: ef alto (fácil) -> difficulty baixa; ef baixo -> difficulty alta
      const difficulty = Math.min(this.MAX_DIFFICULTY, Math.max(this.MIN_DIFFICULTY,
        11 - ((efAntigo - 1.3) / (2.5 - 1.3)) * 9
      ));
      const stability = Math.max(0.5, saved.interval || 0.5);
      return {
        stability, difficulty, interval: saved.interval ?? 0,
        repetitions: saved.repetitions ?? 0, ef: difficulty,
        dueDate: saved.dueDate ?? Date.now(),
        acertos: saved.acertos ?? 0, erros: saved.erros ?? 0,
        totalReviews: saved.totalReviews ?? 0, lastSeen: saved.lastSeen ?? null,
        errosPorTipo: saved.errosPorTipo ?? {},
      };
    }
    // Item já em formato FSRS
    return {
      stability: saved.stability, difficulty: saved.difficulty, interval: saved.interval ?? 0,
      repetitions: saved.repetitions ?? 0, ef: saved.difficulty,
      dueDate: saved.dueDate ?? Date.now(),
      acertos: saved.acertos ?? 0, erros: saved.erros ?? 0,
      totalReviews: saved.totalReviews ?? 0, lastSeen: saved.lastSeen ?? null,
      errosPorTipo: saved.errosPorTipo ?? {},
    };
  },

  // Probabilidade estimada de lembrar hoje, dado quantos dias se passaram (t) e a estabilidade (S)
  retrievability(t, s) {
    if (s <= 0) return 0;
    return Math.pow(1 + this.FACTOR * t / s, this.DECAY);
  },

  // Mapeia os botões da UI (0,1,3,5) para rating FSRS (1=Again,2=Hard,3=Good,4=Easy)
  _mapRating(qualidade) {
    if (qualidade <= 0) return 1; // Não lembrei
    if (qualidade <= 1) return 2; // Difícil
    if (qualidade <= 3) return 3; // Lembrei
    return 4;                     // Fácil
  },

  _clampD(d) { return Math.min(this.MAX_DIFFICULTY, Math.max(this.MIN_DIFFICULTY, d)); },

  // Calcula próxima revisão. `qualidade` continua no formato antigo (0/1/3/5) —
  // review.js e anki.js não precisam mudar.
  review(state, qualidade) {
    const s = { ...state };
    const w = this.W;
    const r = this._mapRating(qualidade);
    const now = Date.now();
    const msPerDay = 24 * 60 * 60 * 1000;
    const primeiraVez = !s.lastSeen || !s.stability;

    s.totalReviews++;
    r >= 3 ? s.acertos++ : s.erros++;
    r >= 3 ? s.repetitions++ : (s.repetitions = 0);

    if (primeiraVez) {
      // Estabilidade e dificuldade iniciais dependem só da 1ª avaliação
      s.difficulty = this._clampD(w[4] - Math.exp(w[5] * (r - 1)) + 1);
      s.stability = w[r - 1]; // w0..w3 = S0(Again/Hard/Good/Easy)
    } else {
      const t = Math.max(0, (now - s.lastSeen) / msPerDay);
      const R = this.retrievability(t, s.stability);

      // Atualiza dificuldade com reversão à média (evita travar no teto/piso)
      const D0Easy = this._clampD(w[4] - Math.exp(w[5] * (4 - 1)) + 1);
      let dNovo = s.difficulty - w[6] * (r - 3);
      dNovo = s.difficulty + (dNovo - s.difficulty) * ((10 - s.difficulty) / 9);
      dNovo = w[7] * D0Easy + (1 - w[7]) * dNovo;
      s.difficulty = this._clampD(dNovo);

      if (r === 1) {
        // Esqueceu: estabilidade cai (fórmula de "post-lapse stability")
        s.stability = w[11] * Math.pow(s.difficulty, -w[12]) *
          (Math.pow(s.stability + 1, w[13]) - 1) * Math.exp(w[14] * (1 - R));
      } else {
        // Lembrou (Difícil/Lembrei/Fácil): estabilidade cresce
        const hardPenalty = r === 2 ? w[15] : 1;
        const easyBonus   = r === 4 ? w[16] : 1;
        const ganho = Math.exp(w[8]) * (11 - s.difficulty) * Math.pow(s.stability, -w[9]) *
          (Math.exp((1 - R) * w[10]) - 1) * hardPenalty * easyBonus;
        s.stability = s.stability * (ganho + 1);
      }
      s.stability = Math.max(0.1, s.stability);
    }

    // Próximo intervalo (dias) para atingir a retenção-alvo configurada
    let intervalo = (s.stability / this.FACTOR) * (Math.pow(this.REQUEST_RETENTION, 1 / this.DECAY) - 1);
    intervalo = Math.min(this.MAX_INTERVAL, Math.max(1, Math.round(intervalo)));
    // Falhou: revisa de novo em breve (mesmo dia/no dia seguinte), não espera o cálculo de S baixo
    if (r === 1) intervalo = Math.min(intervalo, 1);

    s.interval = intervalo;
    s.dueDate = now + intervalo * msPerDay;
    s.lastSeen = now;
    s.ef = s.difficulty; // compat: browse.js exibe stt.ef

    return s;
  },

  isDue(state) {
    return (state.dueDate ?? 0) <= Date.now();
  },

  nextReviewText(interval) {
    if (!interval || interval === 0) return 'Revisar hoje';
    if (interval === 1) return 'Próxima revisão: amanhã';
    if (interval < 7)   return `Próxima revisão: em ${interval} dias`;
    if (interval < 30)  return `Próxima revisão: em ${Math.round(interval / 7)} semana(s)`;
    return `Próxima revisão: em ${Math.round(interval / 30)} mês(es)`;
  },

  filtrarDue(pool, progress) {
    return pool.filter(item => {
      const s = FSRS.initItem(progress[item.id]);
      return FSRS.isDue(s);
    });
  },

  ordenarPorPrioridade(items, progress) {
    return [...items].sort((a, b) => {
      const sa = FSRS.initItem(progress[a.id]);
      const sb = FSRS.initItem(progress[b.id]);
      if (!sa.lastSeen && sb.lastSeen) return -1;
      if (sa.lastSeen && !sb.lastSeen) return 1;
      return (sa.dueDate ?? 0) - (sb.dueDate ?? 0);
    });
  },

  shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  },

  gerarOpcoes(itemCorreto, todosItens, campo) {
    const correto = itemCorreto[campo];
    const dist = this.shuffle(
      todosItens.filter(i => i.id !== itemCorreto.id && i[campo] && i[campo] !== correto)
    ).slice(0, 3).map(i => i[campo]);
    return this.shuffle([correto, ...dist]);
  },
};
