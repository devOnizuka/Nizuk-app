// js/ui/stats.js
const Stats = (() => {
  function render() {
    const stats    = Storage.loadStats();
    const progress = Storage.loadProgress();

    const total = stats.totalQuestoes || 0;
    const ac    = stats.totalAcertos  || 0;
    const er    = stats.totalErros    || 0;
    const pct   = total > 0 ? Math.round((ac / total) * 100) : 0;

    // Distribuição SRS usando repetitions como proxy
    const dist = { novo: 0, aprendendo: 0, forte: 0, dominado: 0 };
    Object.values(progress).forEach(p => {
      if      (p.repetitions === 0)  dist.novo++;
      else if (p.repetitions <= 2)   dist.aprendendo++;
      else if (p.repetitions <= 5)   dist.forte++;
      else                           dist.dominado++;
    });

    document.getElementById('stats-content').innerHTML = `
      <div class="stat-card">
        <h3>Resumo Geral</h3>
        <div class="stat-grid">
          <div class="stat-item"><div class="num">${ac}</div><div class="lbl">Acertos</div></div>
          <div class="stat-item"><div class="num" style="color:var(--wrong)">${er}</div><div class="lbl">Erros</div></div>
          <div class="stat-item"><div class="num">${pct}%</div><div class="lbl">Taxa de acerto</div></div>
          <div class="stat-item"><div class="num">${total}</div><div class="lbl">Total de revisões</div></div>
        </div>
      </div>

      <div class="stat-card">
        <h3>Distribuição do Conhecimento</h3>
        <div class="dist-grid">
          <div class="dist-item novo">
            <div class="num">🆕 ${dist.novo}</div>
            <div class="lbl">Novos</div>
          </div>
          <div class="dist-item aprendendo">
            <div class="num">📖 ${dist.aprendendo}</div>
            <div class="lbl">Aprendendo</div>
          </div>
          <div class="dist-item forte">
            <div class="num">💪 ${dist.forte}</div>
            <div class="lbl">Fortes</div>
          </div>
          <div class="dist-item dominado">
            <div class="num">⭐ ${dist.dominado}</div>
            <div class="lbl">Dominados</div>
          </div>
        </div>
      </div>
    `;
  }

  return { render };
})();
