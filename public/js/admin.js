/* StakeTruth — shared admin panel logic, loaded on every /admin/*.html page. */
(function () {
  'use strict';
  var AD = window.AD = window.AD || {};

  var savedTheme = localStorage.getItem('st_theme');
  if (savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);

  // Same broken-image fallback convention as public/js/app.js.
  document.addEventListener('error', function (e) {
    var el = e.target;
    if (el && el.tagName === 'IMG' && el.hasAttribute('data-fallback-hide')) el.style.display = 'none';
  }, true);

  AD.escapeHtml = function (str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  AD.formatDate = function (isoString) {
    if (!isoString) return '';
    var d = new Date(String(isoString).replace(' ', 'T'));
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  async function api(path, options) {
    options = options || {};
    options.headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
    options.credentials = 'include';
    if (options.body && typeof options.body !== 'string') options.body = JSON.stringify(options.body);
    var res = await fetch('/api' + path, options);
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(data.message || 'Request failed');
    return data;
  }
  AD.api = api;

  AD.showToast = function (message, type) {
    var wrap = document.querySelector('.toast-wrap');
    if (!wrap) { wrap = document.createElement('div'); wrap.className = 'toast-wrap'; document.body.appendChild(wrap); }
    var toast = document.createElement('div');
    toast.className = 'toast watermark ' + (type || '');
    toast.textContent = message;
    wrap.appendChild(toast);
    setTimeout(function () { toast.remove(); }, type === 'error' ? 6000 : 4000);
  };

  // ---- Global error handler (admin panel) ------------------------------------
  var lastErrorKey = null;
  var lastErrorAt = 0;
  function reportError(message) {
    var key = String(message);
    var now = Date.now();
    if (key === lastErrorKey && now - lastErrorAt < 3000) return;
    lastErrorKey = key;
    lastErrorAt = now;
    AD.showToast(message, 'error');
  }
  AD.reportError = reportError;

  window.addEventListener('error', function (event) {
    if (!event || event.message === 'Script error.') return;
    reportError(event.message || 'An unexpected error occurred.');
  });
  window.addEventListener('unhandledrejection', function (event) {
    var reason = event && event.reason;
    var message = (reason && (reason.message || reason)) || 'An unexpected error occurred.';
    reportError(String(message));
  });

  var NAV_ITEMS = [
    { key: 'dashboard', href: 'dashboard.html', icon: 'dashboard', label: 'Dashboard' },
    { key: 'intelligence', href: 'intelligence.html', icon: 'psychology', label: 'Intelligence' },
    { key: 'weights', href: 'weights.html', icon: 'tune', label: 'Weight Tuner' },
    { key: 'predictions', href: 'predictions.html', icon: 'sports_soccer', label: 'Predictions' },
    { key: 'bet-builder', href: 'bet-builder.html', icon: 'stacked_line_chart', label: 'Bet Builder' },
    { key: 'categories', href: 'categories.html', icon: 'category', label: 'Categories' },
    { key: 'leaderboard', href: 'leaderboard.html', icon: 'leaderboard', label: 'Leaderboard' },
    { key: 'blog', href: 'blog.html', icon: 'article', label: 'Blog' },
    { key: 'announcements', href: 'announcements.html', icon: 'campaign', label: 'Announcements' },
    { key: 'subscriptions', href: 'subscriptions.html', icon: 'workspace_premium', label: 'Subscriptions' },
    { key: 'users', href: 'users.html', icon: 'group', label: 'Users' },
    { key: 'leagues', href: 'leagues.html', icon: 'emoji_events', label: 'Leagues' },
    { key: 'moderation', href: 'moderation.html', icon: 'shield', label: 'Moderation' },
    { key: 'ads', href: 'ads.html', icon: 'campaign', label: 'Ad Slots' },
    { key: 'sync', href: 'sync.html', icon: 'sync', label: 'Data Sync' },
    { key: 'analytics', href: 'analytics.html', icon: 'insights', label: 'Website Analytics' },
    { key: 'performance', href: 'performance.html', icon: 'query_stats', label: 'Performance & Analytics' },
    { key: 'revenue', href: 'revenue.html', icon: 'payments', label: 'Revenue' },
    { key: 'backlinks', href: 'backlinks.html', icon: 'link', label: 'Backlinks' },
    { key: 'pages', href: 'pages.html', icon: 'description', label: 'Site Pages' },
    { key: 'seo-pages', href: 'seo-pages.html', icon: 'auto_awesome_motion', label: 'SEO Pages' },
    { key: 'seo', href: 'seo.html', icon: 'search', label: 'SEO Settings' },
    { key: 'settings', href: 'settings.html', icon: 'settings', label: 'Settings' },
  ];

  // Inline SVGs keep the admin navigation usable when Google Fonts is blocked.
  var ICON_PATHS = {
    dashboard: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',
    psychology: '<circle cx="12" cy="8" r="4"/><path d="M5 21v-3a7 7 0 0 1 14 0v3M9 8h6M12 5v6"/>',
    sports_soccer: '<circle cx="12" cy="12" r="9"/><path d="m9 10 3-2 3 2-1 4h-4zM5 9l4 1M15 10l4-1M10 14l-2 5M14 14l2 5"/>',
    stacked_line_chart: '<path d="M3 20h18M4 16l5-5 4 3 7-8M4 11l5-5 4 3 7-6"/>',
    category: '<rect x="3" y="3" width="8" height="8"/><circle cx="17" cy="7" r="4"/><path d="m7 15 5 6H2zM15 15h6v6h-6z"/>',
    leaderboard: '<path d="M3 21h18M4 21v-7h5v7M10 21V7h5v14M16 21v-10h5v10M12 3v2"/>',
    article: '<path d="M5 3h14v18H5zM8 7h8M8 11h8M8 15h6"/>',
    campaign: '<path d="M3 10h4l11-5v14L7 14H3zM7 14l2 6h3M20 9a4 4 0 0 1 0 6"/>',
    workspace_premium: '<circle cx="12" cy="9" r="6"/><path d="m8 14-2 8 6-3 6 3-2-8M12 6l1 2h2l-2 2 1 2-2-1-2 1 1-2-2-2h2z"/>',
    group: '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2"/><path d="M3 20v-2a6 6 0 0 1 12 0v2zM16 15a4 4 0 0 1 5 4v1h-4"/>',
    emoji_events: '<path d="M7 3h10v7a5 5 0 0 1-10 0zM7 5H3v3a4 4 0 0 0 4 4M17 5h4v3a4 4 0 0 1-4 4M12 15v4M8 21h8"/>',
    shield: '<path d="m12 2 8 4v6c0 5-3 8-8 10-5-2-8-5-8-10V6zM9 12l2 2 4-4"/>',
    sync: '<path d="M20 7V3l-3 3a8 8 0 0 0-13 5M4 17v4l3-3a8 8 0 0 0 13-5M16 7h4M4 17h4"/>',
    insights: '<path d="M3 20h18M5 16l5-5 4 3 5-8M16 6h3v3"/>',
    query_stats: '<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6M6 11l3-3 2 2 3-4"/>',
    payments: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>',
    search: '<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/>',
    link: '<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2"/>',
    description: '<path d="M5 2h9l5 5v15H5zM14 2v5h5M8 12h8M8 16h8"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M10 2h4l1 3 3 1 3-1 2 4-2 2v3l2 2-2 4-3-1-3 1-1 3h-4l-1-3-3-1-3 1-2-4 2-2v-3L1 9l2-4 3 1 3-1z"/>',
    open_in_new: '<path d="M13 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-8M13 3h8v8M21 3l-10 10"/>',
    logout: '<path d="M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h5M14 7l5 5-5 5M19 12H8"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 11v6M12 7h.01"/>',
    add: '<path d="M12 5v14M5 12h14"/>',
    edit: '<path d="M4 20h4l12-12-4-4L4 16zM14 6l4 4"/>',
    delete: '<path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v7M14 11v7"/>'
  };
  AD.icon = function (name) {
    return '<svg class="admin-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICON_PATHS[name] || ICON_PATHS.description) + '</svg>';
  };
  AD.replaceIcons = function (root) {
    (root || document).querySelectorAll('.material-icons-round').forEach(function (el) {
      var name = el.textContent.trim();
      if (ICON_PATHS[name]) el.innerHTML = AD.icon(name);
    });
  };

  function sidebarHtml(activeKey) {
    return '<div style="font-family:var(--font-head);font-weight:800;font-size:1.1rem;padding:8px 12px 20px;">STAKETRUTH<div style="font-size:0.7rem;font-weight:600;color:var(--text-soft);">Admin</div></div>' +
      NAV_ITEMS.map(function (item) {
        return '<a href="' + item.href + '" class="' + (item.key === activeKey ? 'active' : '') + '">' + AD.icon(item.icon) + item.label + '</a>';
      }).join('') +
      '<a href="/" target="_blank" style="margin-top:16px;border-top:1px solid var(--border);padding-top:16px;">' + AD.icon('open_in_new') + 'View Site</a>' +
      '<button id="ad-logout-btn" style="width:100%;">' + AD.icon('logout') + 'Logout</button>';
  }

  AD.requireAdmin = async function () {
    try {
      var res = await api('/auth/me');
      if (!res.data.user || res.data.user.role !== 'admin') throw new Error('not admin');
      localStorage.setItem('st_admin', JSON.stringify(res.data.user));
      return res.data.user;
    } catch (e) {
      localStorage.removeItem('st_admin');
      window.location.href = '/admin/index.html';
      return null;
    }
  };

  AD.renderShell = function (activeKey, user, pageTitle) {
    var sidebar = document.getElementById('admin-sidebar');
    if (sidebar) sidebar.innerHTML = sidebarHtml(activeKey);
    AD.replaceIcons(document);
    var heading = document.getElementById('page-heading');
    if (heading) heading.textContent = pageTitle || '';
    var userSlot = document.getElementById('admin-user-slot');
    if (userSlot) userSlot.innerHTML = '<span class="text-soft" style="font-size:0.85rem;">' + AD.escapeHtml(user.name) + '</span>';

    var toggle = document.getElementById('sidebar-toggle');
    var overlay = document.getElementById('admin-overlay');
    if (toggle) toggle.addEventListener('click', function () { sidebar.classList.add('open'); overlay.classList.add('open'); });
    if (overlay) overlay.addEventListener('click', function () { sidebar.classList.remove('open'); overlay.classList.remove('open'); });

    document.addEventListener('click', function (e) {
      if (e.target && e.target.id === 'ad-logout-btn') {
        api('/auth/logout', { method: 'POST' }).finally(function () {
          localStorage.removeItem('st_admin');
          window.location.href = '/admin/index.html';
        });
      }
    });
  };

  // ---- Bulk-select table helper ---------------------------------------------
  // Wires a header "select all" checkbox + per-row checkboxes + a sticky bulk
  // action toolbar. `onSelectionChange(selectedIds)` fires whenever the set changes.
  AD.wireBulkSelect = function (tableEl, toolbarEl, onSelectionChange) {
    function getRowBoxes() { return Array.from(tableEl.querySelectorAll('[data-row-check]')); }
    function selected() { return getRowBoxes().filter(function (b) { return b.checked; }).map(function (b) { return b.getAttribute('data-row-check'); }); }
    function update() {
      var ids = selected();
      toolbarEl.classList.toggle('open', ids.length > 0);
      var countEl = toolbarEl.querySelector('[data-selected-count]');
      if (countEl) countEl.textContent = ids.length;
      if (onSelectionChange) onSelectionChange(ids);
    }
    var selectAll = tableEl.querySelector('[data-select-all]');
    if (selectAll) selectAll.addEventListener('change', function () {
      getRowBoxes().forEach(function (b) { b.checked = selectAll.checked; });
      update();
    });
    tableEl.addEventListener('change', function (e) {
      if (e.target.matches('[data-row-check]')) update();
    });
    return { getSelected: selected, reset: function () { getRowBoxes().forEach(function (b) { b.checked = false; }); if (selectAll) selectAll.checked = false; update(); } };
  };

  AD.confirmAction = function (message) { return window.confirm(message); };
})();
