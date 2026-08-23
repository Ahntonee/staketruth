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
    { key: 'predictions', href: 'predictions.html', icon: 'sports_soccer', label: 'Predictions' },
    { key: 'categories', href: 'categories.html', icon: 'category', label: 'Categories' },
    { key: 'leaderboard', href: 'leaderboard.html', icon: 'leaderboard', label: 'Leaderboard' },
    { key: 'blog', href: 'blog.html', icon: 'article', label: 'Blog' },
    { key: 'subscriptions', href: 'subscriptions.html', icon: 'workspace_premium', label: 'Subscriptions' },
    { key: 'users', href: 'users.html', icon: 'group', label: 'Users' },
    { key: 'leagues', href: 'leagues.html', icon: 'emoji_events', label: 'Leagues' },
    { key: 'moderation', href: 'moderation.html', icon: 'shield', label: 'Moderation' },
    { key: 'ads', href: 'ads.html', icon: 'campaign', label: 'Ad Slots' },
    { key: 'sync', href: 'sync.html', icon: 'sync', label: 'Data Sync' },
    { key: 'analytics', href: 'analytics.html', icon: 'insights', label: 'Website Analytics' },
    { key: 'revenue', href: 'revenue.html', icon: 'payments', label: 'Revenue' },
    { key: 'seo', href: 'seo.html', icon: 'search', label: 'SEO' },
    { key: 'seo-pages', href: 'seo-pages.html', icon: 'article', label: 'SEO Pages' },
    { key: 'backlinks', href: 'backlinks.html', icon: 'link', label: 'Backlinks' },
    { key: 'pages', href: 'pages.html', icon: 'description', label: 'Pages' },
    { key: 'settings', href: 'settings.html', icon: 'settings', label: 'Settings' },
  ];

  function sidebarHtml(activeKey) {
    return '<div style="font-family:var(--font-head);font-weight:800;font-size:1.1rem;padding:8px 12px 20px;">STAKETRUTH<div style="font-size:0.7rem;font-weight:600;color:var(--text-soft);">Admin</div></div>' +
      NAV_ITEMS.map(function (item) {
        return '<a href="' + item.href + '" class="' + (item.key === activeKey ? 'active' : '') + '"><span class="material-icons-round" style="font-size:1.1rem;">' + item.icon + '</span>' + item.label + '</a>';
      }).join('') +
      '<a href="/" target="_blank" style="margin-top:16px;border-top:1px solid var(--border);padding-top:16px;"><span class="material-icons-round" style="font-size:1.1rem;">open_in_new</span>View Site</a>' +
      '<button id="ad-logout-btn" style="width:100%;"><span class="material-icons-round" style="font-size:1.1rem;">logout</span>Logout</button>';
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
