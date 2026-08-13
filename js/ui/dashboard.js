// js/ui/dashboard.js
const Dashboard = {
  render() {
    this._streak();
    this._today();
    this._due();
  },

  _allItems() {
    const base = [
      ...HIRAGANA_DATA.map(i => ({...i, cat:'hiragana'})),
      ...KATAKANA_DATA.map(i => ({...i, cat:'katakana'})),
      ...VOCAB_DATA.map(i    => ({...i, cat:'vocab'})),
      ...KANJI_DATA.map(i    => ({...i, cat:'kanji'})),
    ];
    const custom = Storage.loadItems();
    return [...base, ...custom];
  },

  _streak() {
    const s = Storage.loadStreak();
    document.getElementById('dash-streak-num').textContent = s.dias;
  },

  _today() {
    const t = Storage.loadToday();
    document.getElementById('today-time').textContent  = t.minutos > 0 ? `${t.minutos}min` : '0min';
    document.getElementById('today-cards').textContent = t.reviews || 0;
    document.getElementById('today-right').textContent = t.acertos || 0;
    document.getElementById('today-wrong').textContent = t.erros   || 0;
    const total = (t.acertos||0) + (t.erros||0);
    const acc   = total > 0 ? Math.round((t.acertos / total) * 100) + '%' : '—';
    document.getElementById('today-acc').textContent = acc;
  },

  _due() {
    const prog  = Storage.loadProgress();
    const items = this._allItems();
    const due   = FSRS.filtrarDue(items, prog);
    const el    = document.getElementById('due-count');
    const btn   = document.getElementById('btn-study-now');
    el.textContent  = due.length;
    btn.disabled    = due.length === 0;
    btn.textContent = due.length === 0 ? 'Tudo em dia! ✓' : 'Revisar agora →';
  },
};
