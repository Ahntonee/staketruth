/* StakeTruth — statistics.html page logic. Loads lazily per accordion section
   so Chart.js only renders charts the visitor actually opens (mobile-friendly). */
(function () {
  var loaded = {};
  var MARKETS = ['home_win', 'away_win', 'draw', 'over_1_5', 'over_2_5', 'over_3_5', 'under_1_5', 'under_2_5', 'under_3_5', 'gg'];

  function barChart(canvasId, labels, data, label, color) {
    var ctx = document.getElementById(canvasId);
    if (!ctx || !window.Chart) return;
    if (ctx._chart) ctx._chart.destroy();
    ctx._chart = new Chart(ctx, {
      type: 'bar',
      data: { labels: labels, datasets: [{ label: label, data: data, backgroundColor: color || '#ff6b35', borderRadius: 6 }] },
      options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } },
    });
  }

  function doughnutChart(canvasId, labels, data) {
    var ctx = document.getElementById(canvasId);
    if (!ctx || !window.Chart) return;
    if (ctx._chart) ctx._chart.destroy();
    ctx._chart = new Chart(ctx, {
      type: 'doughnut',
      data: { labels: labels, datasets: [{ data: data, backgroundColor: ['#ff6b35', '#f0b90b', '#ffca28', '#ff9a56', '#e0501f', '#d4a017', '#4caf6d', '#ffb347', '#c9880a', '#ffe082'] }] },
      options: { responsive: true },
    });
  }

  function renderTable(elId, rows, columns) {
    var el = document.getElementById(elId);
    if (!el) return;
    if (!rows.length) { el.innerHTML = '<div class="empty-state">Not enough graded data yet.</div>'; return; }
    var head = '<tr>' + columns.map(function (c) { return '<th>' + c.label + '</th>'; }).join('') + '</tr>';
    var body = rows.map(function (r) {
      return '<tr>' + columns.map(function (c) { return '<td data-label="' + c.label + '">' + (c.format ? c.format(r) : (r[c.key] ?? '—')) + '</td>'; }).join('') + '</tr>';
    }).join('');
    el.innerHTML = '<div class="table-scroll"><table class="data-table">' + head + body + '</table></div>';
  }

  async function get(path) {
    var res = await fetch('/api' + path);
    var json = await res.json();
    return json.data || [];
  }

  async function loadHero() {
    var data = await get('/statistics/summary');
    var el = document.getElementById('stat-tiles');
    if (!el) return;
    el.innerHTML = [
      { label: 'Total Predictions', value: Math.round(Number(data.totalPredictions) || 0) },
      { label: 'Win Rate', value: (Number(data.winRate) || 0).toFixed(1) + '%' },
      { label: 'Most Reliable Market', value: data.bestMarket || '—' },
      { label: 'Best League', value: data.bestLeague || '—' },
    ].map(function (t) {
      return '<div class="stat-card"><div class="stat-card__value">' + t.value + '</div><div class="stat-card__label">' + t.label + '</div></div>';
    }).join('');
  }

  async function loadTeamsScoring(mode) {
    var rows = await get('/statistics/teams/' + (mode === 'lowest' ? 'lowest-scoring' : 'highest-scoring') + '?limit=15');
    renderTable('teams-scoring-table', rows, [
      { key: 'team_name', label: 'Team' },
      { key: 'goals_scored_avg', label: 'Goals/Game', format: function (r) { return Number(r.goals_scored_avg || 0).toFixed(2); } },
    ]);
    barChart('teams-scoring-chart', rows.map(function (r) { return r.team_name; }), rows.map(function (r) { return Number(r.goals_scored_avg || 0); }), 'Goals/Game');
  }

  async function loadLeaguesScoring(mode) {
    var rows = await get('/statistics/leagues/' + (mode === 'lowest' ? 'lowest-scoring' : 'highest-scoring') + '?limit=15');
    renderTable('leagues-scoring-table', rows, [
      { key: 'league_name', label: 'League' },
      { key: 'goals_per_game', label: 'Goals/Game', format: function (r) { return Number(r.goals_per_game || 0).toFixed(2); } },
    ]);
    barChart('leagues-scoring-chart', rows.map(function (r) { return r.league_name; }), rows.map(function (r) { return Number(r.goals_per_game || 0); }), 'Goals/Game', '#f0b90b');
  }

  async function loadMarketReliability() {
    var rows = await get('/statistics/markets/reliable');
    renderTable('market-reliability-table', rows, [
      { key: 'market', label: 'Market' },
      { key: 'category', label: 'Category' },
      { key: 'total', label: 'Tips' },
      { key: 'win_rate', label: 'Win Rate', format: function (r) { return r.win_rate + '%'; } },
    ]);
    doughnutChart('market-reliability-chart', rows.slice(0, 8).map(function (r) { return r.category; }), rows.slice(0, 8).map(function (r) { return Number(r.win_rate); }));
  }

  async function loadTeamsByMarket(market) {
    var rows = await get('/statistics/teams/reliable?market=' + encodeURIComponent(market) + '&limit=15');
    renderTable('teams-by-market-list', rows, [
      { key: 'team', label: 'Team' },
      { key: 'total', label: 'Sample' },
      { key: 'win_rate', label: 'Win Rate', format: function (r) { return r.total ? ((r.correct / r.total) * 100).toFixed(1) + '%' : '—'; } },
    ]);
  }

  async function loadLeaguesByMarket(market) {
    var rows = await get('/statistics/leagues/reliable?market=' + encodeURIComponent(market) + '&limit=15');
    renderTable('leagues-by-market-list', rows, [
      { key: 'league', label: 'League' },
      { key: 'total', label: 'Sample' },
      { key: 'win_rate', label: 'Win Rate', format: function (r) { return r.total ? ((r.correct / r.total) * 100).toFixed(1) + '%' : '—'; } },
    ]);
  }

  async function loadPicksByLeague(leagueId) {
    if (!leagueId) return;
    var rows = await get('/statistics/leagues/effective?league_id=' + leagueId);
    renderTable('picks-by-league-list', rows, [
      { key: 'market', label: 'Market' }, { key: 'category', label: 'Category' },
      { key: 'total', label: 'Sample' },
      { key: 'win_rate', label: 'Win Rate', format: function (r) { return r.total ? ((r.correct / r.total) * 100).toFixed(1) + '%' : '—'; } },
    ]);
  }

  async function loadPicksByTeam(team) {
    if (!team) return;
    var rows = await get('/statistics/teams/effective?team=' + encodeURIComponent(team));
    renderTable('picks-by-team-list', rows, [
      { key: 'market', label: 'Market' }, { key: 'category', label: 'Category' },
      { key: 'total', label: 'Sample' },
      { key: 'win_rate', label: 'Win Rate', format: function (r) { return r.total ? ((r.correct / r.total) * 100).toFixed(1) + '%' : '—'; } },
    ]);
  }

  function populateMarketSelects() {
    var opts = MARKETS.map(function (m) { return '<option value="' + m + '">' + m.replace(/_/g, ' ') + '</option>'; }).join('');
    ['teams-by-market-select', 'leagues-by-market-select'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.innerHTML = opts;
    });
  }

  async function populateLeagueSelect() {
    var res = await fetch('/api/leagues');
    var json = await res.json();
    var el = document.getElementById('picks-by-league-select');
    if (!el) return;
    el.innerHTML = (json.data || []).map(function (l) { return '<option value="' + l.id + '">' + l.name + '</option>'; }).join('');
  }

  function wireAccordion() {
    document.querySelectorAll('.accordion-header').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var section = btn.getAttribute('data-section');
        var body = document.getElementById('section-' + section);
        var isOpen = body.classList.toggle('open');
        btn.classList.toggle('open', isOpen);
        if (isOpen && !loaded[section]) {
          loaded[section] = true;
          if (section === 'teams-scoring') loadTeamsScoring('highest');
          if (section === 'leagues-scoring') loadLeaguesScoring('highest');
          if (section === 'market-reliability') loadMarketReliability();
          if (section === 'teams-by-market') { populateMarketSelects(); loadTeamsByMarket(MARKETS[0]); }
          if (section === 'leagues-by-market') { populateMarketSelects(); loadLeaguesByMarket(MARKETS[0]); }
          if (section === 'picks-by-league') populateLeagueSelect();
        }
      });
    });

    document.querySelectorAll('[data-toggle-mode]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var group = btn.getAttribute('data-toggle-mode');
        document.querySelectorAll('[data-toggle-mode="' + group + '"]').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        if (group === 'teams-scoring') loadTeamsScoring(btn.getAttribute('data-mode'));
        if (group === 'leagues-scoring') loadLeaguesScoring(btn.getAttribute('data-mode'));
      });
    });

    var teamsByMarketSelect = document.getElementById('teams-by-market-select');
    if (teamsByMarketSelect) teamsByMarketSelect.addEventListener('change', function () { loadTeamsByMarket(this.value); });
    var leaguesByMarketSelect = document.getElementById('leagues-by-market-select');
    if (leaguesByMarketSelect) leaguesByMarketSelect.addEventListener('change', function () { loadLeaguesByMarket(this.value); });
    var picksByLeagueSelect = document.getElementById('picks-by-league-select');
    if (picksByLeagueSelect) picksByLeagueSelect.addEventListener('change', function () { loadPicksByLeague(this.value); });
    var picksByTeamBtn = document.getElementById('picks-by-team-btn');
    if (picksByTeamBtn) picksByTeamBtn.addEventListener('click', function () {
      loadPicksByTeam(document.getElementById('picks-by-team-input').value.trim());
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    loadHero();
    wireAccordion();
    // First section open by default
    var first = document.querySelector('.accordion-header');
    if (first) first.click();
  });
})();
