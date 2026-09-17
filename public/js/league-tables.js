(function () {
  'use strict';
  var container = document.getElementById('league-tables-widgets');
  if (!container) return;
  var leagues = [[39, 'Premier League'], [140, 'La Liga'], [135, 'Serie A'], [78, 'Bundesliga'], [61, 'Ligue 1']];
  var types = [['standings', 'League Tables'], ['scorers', 'Top Goalscorers'], ['assists', 'Top Assists']];
  types.forEach(function (entry) {
    var type = entry[0];
    var widget = document.createElement('section');
    widget.className = 'aside-widget league-widget';
    widget.innerHTML = '<h3>' + entry[1] + '</h3><label for="league-' + type + '" class="sr-only">League for ' + entry[1] + '</label>' +
      '<select id="league-' + type + '" class="form-control">' + leagues.map(function (league) {
        return '<option value="' + league[0] + '">' + league[1] + '</option>';
      }).join('') + '</select><div class="league-table-result" aria-live="polite"></div>';
    container.appendChild(widget);
    var select = widget.querySelector('select');
    var result = widget.querySelector('.league-table-result');
    var version = 0;
    async function load() {
      var current = ++version;
      result.innerHTML = '<p class="text-soft">Loading table…</p>';
      try {
        var response = await ST.api('/league-tables/' + select.value + '/' + type);
        if (current !== version) return;
        var data = response.data;
        var meta = '<p class="league-table-meta">' + data.season + '/' + String(data.season + 1).slice(-2) +
          (data.updatedAt ? ' · Updated ' + ST.escapeHtml(new Date(data.updatedAt).toLocaleString()) : '') +
          (data.stale ? ' · Showing last available data' : '') + '</p>';
        if (!data.rows.length) { result.innerHTML = meta + '<p class="text-soft">This table is currently unavailable. Please check back later.</p>'; return; }
        var standing = type === 'standings';
        result.innerHTML = meta + '<div class="league-table-scroll" tabindex="0" role="region" aria-label="' + entry[1] + '"><table class="league-table"><caption class="sr-only">' + ST.escapeHtml(data.league) + ' ' + entry[1] + '</caption><thead><tr><th scope="col">#</th><th scope="col">' + (standing ? 'Team' : 'Player') + '</th>' +
          (standing ? '<th scope="col"><abbr title="Played">P</abbr></th><th scope="col"><abbr title="Goal difference">GD</abbr></th><th scope="col">Pts</th>' : '<th scope="col">' + (type === 'scorers' ? 'Goals' : 'Assists') + '</th>') + '</tr></thead><tbody>' + data.rows.map(function (row) {
            return '<tr><td>' + ST.escapeHtml(String(row.rank)) + '</td><th scope="row">' + ST.escapeHtml(row.name) + (row.team ? '<small>' + ST.escapeHtml(row.team) + '</small>' : '') + '</th>' +
              (standing ? '<td>' + ST.escapeHtml(String(row.played)) + '</td><td>' + ST.escapeHtml(String(row.goalDifference)) + '</td><td><strong>' + ST.escapeHtml(String(row.points)) + '</strong></td>' : '<td><strong>' + ST.escapeHtml(String(row.value)) + '</strong></td>') + '</tr>';
          }).join('') + '</tbody></table></div>';
      } catch (_) {
        if (current === version) result.innerHTML = '<p class="text-soft">Could not load this table.</p><button type="button" class="btn btn-outline btn-sm">Retry</button>';
        var retry = result.querySelector('button');
        if (retry) retry.addEventListener('click', load);
      }
    }
    select.addEventListener('change', load);
    load();
  });
})();
