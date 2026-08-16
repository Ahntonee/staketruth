/* StakeTruth — shared frontend logic, loaded on every public page. */
(function () {
  'use strict';

  // ---- Theme (applied before paint to avoid a flash) -----------------------
  var savedTheme = localStorage.getItem('st_theme');
  if (savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);

  var ST = window.ST = window.ST || {};
  ST.currentUser = null;

  // Helmet's CSP blocks inline onerror="..." attributes (script-src-attr 'none'),
  // which is correct security behaviour — so broken-image fallbacks are handled
  // here via a single capturing listener instead of inline handlers.
  document.addEventListener('error', function (e) {
    var el = e.target;
    if (!el || el.tagName !== 'IMG') return;
    if (el.hasAttribute('data-fallback-hide')) el.style.display = 'none';
    if (el.hasAttribute('data-fallback-show-sibling') && el.nextElementSibling) {
      el.style.display = 'none';
      el.nextElementSibling.style.display = 'inline';
    }
  }, true);

  // ---- Basic utilities -------------------------------------------------------
  ST.escapeHtml = function (str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  ST.formatDate = function (isoString, opts) {
    if (!isoString) return '';
    var d = new Date(isoString.replace(' ', 'T'));
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString('en-GB', opts || { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  };

  ST.formatOdds = function (value) {
    if (value === null || value === undefined) return '—';
    return Number(value).toFixed(2);
  };

  ST.showToast = function (message, type) {
    var wrap = document.querySelector('.toast-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'toast-wrap';
      document.body.appendChild(wrap);
    }
    var toast = document.createElement('div');
    toast.className = 'toast watermark ' + (type || '');
    toast.textContent = message;
    wrap.appendChild(toast);
    setTimeout(function () { toast.remove(); }, type === 'error' ? 6000 : 4000);
  };

  // ---- Global error handler --------------------------------------------------
  // Catches anything that would otherwise fail silently: uncaught exceptions,
  // unhandled promise rejections, and (via api()) failed fetches that callers
  // forgot to try/catch. De-duplicates identical messages within a short
  // window so a repeating error doesn't spam the toast stack.
  var lastErrorKey = null;
  var lastErrorAt = 0;
  function reportError(message) {
    var key = String(message);
    var now = Date.now();
    if (key === lastErrorKey && now - lastErrorAt < 3000) return;
    lastErrorKey = key;
    lastErrorAt = now;
    ST.showToast(message, 'error');
  }
  ST.reportError = reportError;

  window.addEventListener('error', function (event) {
    // Ignore cross-origin script errors (e.g. ad/analytics scripts) — they
    // arrive as the generic "Script error." with no useful detail anyway.
    if (!event || event.message === 'Script error.') return;
    reportError(event.message || 'An unexpected error occurred.');
  });

  window.addEventListener('unhandledrejection', function (event) {
    var reason = event && event.reason;
    var message = (reason && (reason.message || reason)) || 'An unexpected error occurred.';
    reportError(String(message));
  });

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
  ST.api = api;

  // ---- Auth state --------------------------------------------------------
  ST.getUser = function () {
    try { return JSON.parse(localStorage.getItem('st_user') || 'null'); } catch (e) { return null; }
  };
  ST.setUser = function (user) {
    ST.currentUser = user;
    if (user) localStorage.setItem('st_user', JSON.stringify(user));
    else localStorage.removeItem('st_user');
  };
  ST.clearUser = function () { ST.setUser(null); };

  ST.refreshAuth = async function () {
    try {
      var res = await api('/auth/me');
      ST.setUser(res.data.user);
      ST.currentSubscription = res.data.subscription;
    } catch (e) {
      ST.clearUser();
    }
    renderAuthUI();
    return ST.currentUser;
  };

  ST.logout = async function () {
    try { await api('/auth/logout', { method: 'POST' }); } catch (e) { /* ignore */ }
    ST.clearUser();
    window.location.href = '/';
  };

  // ---- Header / Footer injection --------------------------------------------
  var NAV_LINKS = [
    { href: '/', label: 'Home' },
    { href: '/predictions.html', label: 'Predictions' },
    { href: '/pricing.html', label: 'Subscription' },
    { href: '/blog.html', label: 'Blog' },
    { href: '/about.html', label: 'About Us' },
  ];

  function navHtml(cssClass) {
    var path = window.location.pathname;
    return NAV_LINKS.map(function (l) {
      var active = (l.href === '/' && path === '/') || (l.href !== '/' && path.indexOf(l.href) === 0);
      return '<a href="' + l.href + '" class="' + cssClass + (active ? ' active' : '') + '">' + l.label + '</a>';
    }).join('');
  }

  function headerHtml() {
    return '' +
      '<div class="ticker-wrap"><div class="ticker-track" id="st-ticker"><span>Loading today\'s predictions…</span></div></div>' +
      '<div class="header-inner">' +
        '<a href="/" class="site-logo"><img src="/images/logo.png" alt="StakeTruth" data-fallback-show-sibling><span class="brand-fallback" style="display:none">STAKETRUTH</span></a>' +
        '<nav class="main-nav">' + navHtml('nav-link') + '</nav>' +
        '<div class="header-actions">' +
          '<button class="theme-toggle" id="st-theme-toggle" aria-label="Toggle theme"><span class="material-icons-round" id="st-theme-icon">dark_mode</span></button>' +
          '<div id="st-auth-slot"></div>' +
          '<button class="mobile-menu-toggle" id="st-mobile-toggle" aria-label="Menu"><span class="material-icons-round">menu</span></button>' +
        '</div>' +
      '</div>' +
      '<div class="mobile-drawer" id="st-drawer">' +
        '<div class="mobile-drawer__overlay" id="st-drawer-overlay"></div>' +
        '<div class="mobile-drawer__panel">' +
          '<button class="mobile-drawer__close" id="st-drawer-close">&times;</button>' +
          navHtml('') +
          '<div id="st-drawer-auth" style="margin-top:16px;border-top:1px solid var(--border);padding-top:12px;"></div>' +
        '</div>' +
      '</div>';
  }

  function footerHtml() {
    return '' +
      '<div class="container">' +
        '<div class="footer-grid">' +
          '<div class="footer-brand">' +
            '<img src="/images/logo.png" alt="StakeTruth" data-fallback-hide>' +
            '<p>Data-Driven Picks. Proven Results.</p>' +
            '<div class="social-links" id="st-social-links"></div>' +
          '</div>' +
          '<div><h4>Quick Links</h4>' +
            '<a href="/predictions.html">Predictions</a>' +
            '<a href="/pricing.html">VIP Subscription</a>' +
            '<a href="/statistics.html">Statistics</a>' +
            '<a href="/blog.html">Blog</a>' +
          '</div>' +
          '<div><h4>Legal</h4>' +
            '<a href="/terms.html">Terms of Service</a>' +
            '<a href="/privacy.html">Privacy Policy</a>' +
            '<a href="/contact.html">Contact</a>' +
          '</div>' +
          '<div><h4>Reach Us</h4><div id="st-contact-links"></div></div>' +
        '</div>' +
        '<div class="footer-other-sites" id="st-other-sites" style="display:none;">' +
          '<h4>Other Sites</h4><div class="footer-other-sites__links" id="st-other-sites-links"></div>' +
        '</div>' +
        '<div class="footer-bottom">' +
          '<p>&copy; ' + new Date().getFullYear() + ' StakeTruth. For entertainment only. Please gamble responsibly.</p>' +
        '</div>' +
      '</div>';
  }

  function renderAuthUI() {
    var user = ST.currentUser;
    var slot = document.getElementById('st-auth-slot');
    var drawerAuth = document.getElementById('st-drawer-auth');
    if (!slot) return;

    if (!user) {
      slot.innerHTML = '<button class="btn btn-outline btn-sm" data-auth-open="login">Log In</button> <button class="btn btn-primary btn-sm" data-auth-open="register">Sign Up</button>';
      if (drawerAuth) drawerAuth.innerHTML = '<button data-auth-open="login">Log In</button><button data-auth-open="register">Sign Up</button>';
      return;
    }

    var initial = (user.name || '?').charAt(0).toUpperCase();
    var adminLink = user.role === 'admin' ? '<a href="/admin/dashboard.html">Admin Panel</a>' : '';
    slot.innerHTML =
      '<div class="avatar-dropdown">' +
        '<button class="avatar-btn" id="st-avatar-btn">' + initial + '</button>' +
        '<div class="avatar-menu" id="st-avatar-menu">' +
          '<a href="/dashboard.html">Dashboard</a>' + adminLink +
          '<button id="st-logout-btn">Logout</button>' +
        '</div>' +
      '</div>';
    if (drawerAuth) {
      drawerAuth.innerHTML = '<a href="/dashboard.html">Dashboard</a>' + adminLink + '<button id="st-logout-btn-mobile">Logout</button>';
      var mb = document.getElementById('st-logout-btn-mobile');
      if (mb) mb.addEventListener('click', ST.logout);
    }
    var avatarBtn = document.getElementById('st-avatar-btn');
    var avatarMenu = document.getElementById('st-avatar-menu');
    if (avatarBtn) avatarBtn.addEventListener('click', function () { avatarMenu.classList.toggle('open'); });
    document.addEventListener('click', function (e) {
      if (avatarMenu && !avatarMenu.contains(e.target) && e.target !== avatarBtn) avatarMenu.classList.remove('open');
    });
    var logoutBtn = document.getElementById('st-logout-btn');
    if (logoutBtn) logoutBtn.addEventListener('click', ST.logout);
  }

  function wireHeaderInteractions() {
    var themeToggle = document.getElementById('st-theme-toggle');
    var themeIcon = document.getElementById('st-theme-icon');
    function setIcon() {
      var isDark = document.documentElement.getAttribute('data-theme') === 'dark' ||
        (!document.documentElement.getAttribute('data-theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);
      if (themeIcon) themeIcon.textContent = isDark ? 'light_mode' : 'dark_mode';
    }
    setIcon();
    if (themeToggle) {
      themeToggle.addEventListener('click', function () {
        var current = document.documentElement.getAttribute('data-theme') ||
          (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
        var next = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('st_theme', next);
        setIcon();
      });
    }

    var mobileToggle = document.getElementById('st-mobile-toggle');
    var drawer = document.getElementById('st-drawer');
    var drawerClose = document.getElementById('st-drawer-close');
    var drawerOverlay = document.getElementById('st-drawer-overlay');
    if (mobileToggle) mobileToggle.addEventListener('click', function () { drawer.classList.add('open'); });
    if (drawerClose) drawerClose.addEventListener('click', function () { drawer.classList.remove('open'); });
    if (drawerOverlay) drawerOverlay.addEventListener('click', function () { drawer.classList.remove('open'); });
  }

  ST.injectHeader = function () {
    var el = document.getElementById('site-header');
    if (!el) return;
    el.innerHTML = headerHtml();
    wireHeaderInteractions();
    renderAuthUI();
    renderTicker();
  };

  ST.injectFooter = function () {
    var el = document.getElementById('site-footer');
    if (!el) return;
    el.innerHTML = footerHtml();
    fetchSocialLinks();
    fetchOtherSites();
  };

  var SOCIAL_ICONS = { twitter: 'X', telegram: 'TG', facebook: 'FB', reddit: 'RD', whatsapp: 'WA' };
  async function fetchSocialLinks() {
    try {
      var res = await api('/pages/social-links');
      var container = document.getElementById('st-social-links');
      var contactContainer = document.getElementById('st-contact-links');
      var data = res.data || {};
      if (container) {
        var html = '';
        Object.keys(data).forEach(function (key) {
          if (SOCIAL_ICONS[key] && data[key]) html += '<a href="' + data[key] + '" target="_blank" rel="noopener">' + SOCIAL_ICONS[key] + '</a>';
        });
        container.innerHTML = html;
      }
      if (contactContainer) {
        var contactHtml = '';
        if (data.contact_whatsapp) contactHtml += '<a href="https://wa.me/' + data.contact_whatsapp.replace(/[^0-9]/g, '') + '" target="_blank" rel="noopener">WhatsApp: ' + ST.escapeHtml(data.contact_whatsapp) + '</a>';
        if (data.contact_email) contactHtml += '<a href="mailto:' + data.contact_email + '">Email: ' + ST.escapeHtml(data.contact_email) + '</a>';
        contactContainer.innerHTML = contactHtml || '<a href="/contact.html">Contact Form</a>';
      }
    } catch (e) { /* footer still works without social/contact links */ }
  }

  async function fetchOtherSites() {
    var wrap = document.getElementById('st-other-sites');
    var container = document.getElementById('st-other-sites-links');
    if (!wrap || !container) return;
    try {
      var res = await api('/backlinks/active');
      if (!res.data.length) return;
      container.innerHTML = res.data.map(function (b, i) {
        return (i ? '<span class="sep">|</span>' : '') + '<a href="' + b.url + '" target="_blank" rel="sponsored noopener">' + ST.escapeHtml(b.name) + '</a>';
      }).join('');
      wrap.style.display = '';
    } catch (e) { /* footer still works without backlinks */ }
  }

  // ---- Leagues / stats caching ----------------------------------------------
  ST.fetchLeagues = async function () {
    var cached = sessionStorage.getItem('st_leagues_cache');
    if (cached) {
      try {
        var parsed = JSON.parse(cached);
        if (Date.now() - parsed.at < 5 * 60 * 1000) return parsed.data;
      } catch (e) { /* fallthrough to refetch */ }
    }
    var res = await api('/leagues?grouped=true');
    sessionStorage.setItem('st_leagues_cache', JSON.stringify({ at: Date.now(), data: res.data }));
    return res.data;
  };

  ST.fetchStats = async function () {
    var res = await api('/predictions/stats');
    return res.data;
  };

  // ---- Prediction card rendering --------------------------------------------
  function confidenceClass(score) {
    if (score === null || score === undefined) return 'poor';
    if (score >= 80) return 'high';
    if (score >= 60) return 'mid';
    if (score >= 40) return 'low';
    return 'poor';
  }

  ST.buildPredictionCard = function (p) {
    var isLocked = !!p.lockReason;
    var cardClasses = 'prediction-card';
    if (p.is_banker) cardClasses += ' banker-card';
    else if (p.is_vip) cardClasses += ' vip-card';
    if (isLocked) cardClasses += ' locked-card';

    var badges = '';
    if (p.is_banker) badges += '<span class="badge badge-banker">Banker</span>';
    if (p.is_vip) badges += '<span class="badge badge-vip">VIP</span>';
    if (p.result === 'won') badges += '<span class="badge badge-won">Won</span>';
    if (p.result === 'lost') badges += '<span class="badge badge-lost">Lost</span>';
    if (p.result === 'pending') badges += '<span class="badge badge-pending">Pending</span>';

    var bookieTags = (p.bookies_available || []).slice(0, 3).map(function (b) {
      return '<span class="bookie-tag"><span class="odds-live-dot"></span>' + ST.escapeHtml(b) + '</span>';
    }).join('');

    // Autoscore — only ever present when intelligence_score is non-null, which
    // the backend already guarantees is null for anything this viewer can't see.
    var scoreBadge = p.intelligence_score
      ? '<div class="score-badge ' + confidenceClass(p.intelligence_score) + '" title="Intelligence Engine confidence score">' + p.intelligence_score + '</div>'
      : '';

    var innerContent = scoreBadge +
      '<div class="prediction-card__league"><span>' + ST.escapeHtml(p.league_name || 'Football') + '</span><span>' + ST.formatDate(p.match_date) + '</span></div>' +
      '<div class="prediction-card__teams">' +
        '<div class="prediction-card__team"><img src="' + (p.home_team_logo || '') + '" data-fallback-hide><span>' + ST.escapeHtml(p.home_team) + '</span></div>' +
        '<div class="prediction-card__vs">VS</div>' +
        '<div class="prediction-card__team"><img src="' + (p.away_team_logo || '') + '" data-fallback-hide><span>' + ST.escapeHtml(p.away_team) + '</span></div>' +
      '</div>' +
      '<div class="prediction-card__tip">' + ST.escapeHtml(p.tip) + '</div>' +
      '<div class="prediction-card__meta">' + badges +
        (p.odds ? '<span>Odds: ' + ST.formatOdds(p.odds) + '</span>' : '') +
        (p.result === 'won' || p.result === 'lost' ? '<span>' + (p.home_score ?? '') + ' - ' + (p.away_score ?? '') + '</span>' : '') +
      '</div>' +
      (p.intelligence_score ? '<div class="confidence-bar-track"><div class="confidence-bar-fill ' + confidenceClass(p.intelligence_score) + '" style="width:' + p.intelligence_score + '%"></div></div>' : '') +
      (p.analysis ? '<div class="prediction-card__analysis" style="margin-top:8px;">' + ST.escapeHtml(p.analysis) + '</div>' : '') +
      (bookieTags ? '<div class="flex gap-8" style="margin-top:8px;flex-wrap:wrap;">' + bookieTags + '</div>' : '') +
      (!p.voting_disabled ? '<div style="margin-top:12px;" data-vote-poll data-prediction-id="' + p.id + '"></div>' : '') +
      '<div class="prediction-card__footer" style="margin-top:10px;">' +
        '<a href="/prediction/' + p.slug + '" class="btn btn-outline btn-sm">View Details</a>' +
      '</div>';

    if (!isLocked) {
      return '<div class="' + cardClasses + '">' + innerContent + '</div>';
    }

    var ctaHtml = p.lockReason === 'guest'
      ? '<p>Sign up free to unlock this pick</p><button type="button" class="btn btn-vip btn-sm" data-auth-open="register">Sign Up Free</button>'
      : '<p>Upgrade to VIP to unlock this pick</p><a href="/pricing.html" class="btn btn-vip btn-sm">Join VIP</a>';

    return '<div class="' + cardClasses + '">' +
      '<div class="locked-card__content">' + innerContent + '</div>' +
      '<div class="locked-card__overlay">' +
        '<span class="material-icons-round">lock</span>' +
        ctaHtml +
      '</div>' +
    '</div>';
  };

  ST.renderPredictionsInto = function (container, predictions) {
    if (!container) return;
    if (!predictions.length) {
      container.innerHTML = '<div class="empty-state">No predictions found for this filter yet.</div>';
      return;
    }
    container.innerHTML = predictions.map(ST.buildPredictionCard).join('');
    container.querySelectorAll('[data-vote-poll]').forEach(function (el) {
      ST.initVotePoll(el, el.getAttribute('data-prediction-id'));
    });
  };

  ST.renderBankerCards = async function (container) {
    if (!container) return;
    try {
      var res = await api('/predictions/bankers');
      ST.renderPredictionsInto(container, res.data);
      container.closest('section') && (container.closest('section').style.display = res.data.length ? '' : 'none');
    } catch (e) { /* silent */ }
  };

  ST.renderVipPicksOfDay = async function (container) {
    if (!container) return;
    try {
      var res = await api('/predictions/vip-picks-of-day');
      if (!res.data.length) { container.innerHTML = ''; return; }
      container.innerHTML = res.data.map(function (p) {
        return '<div class="aside-widget">' + ST.buildPredictionCard(p) + '</div>';
      }).join('');
    } catch (e) { container.innerHTML = ''; }
  };

  ST.renderRecentWins = async function (container) {
    if (!container) return;
    try {
      var res = await api('/predictions/recent-wins?limit=8');
      if (!res.data.length) { container.innerHTML = '<div class="aside-widget"><h3><span class="material-icons-round">military_tech</span>Recent Wins</h3><p class="text-soft">No graded wins yet.</p></div>'; return; }
      var rows = res.data.map(function (w) {
        return '<div class="recent-win-card">' +
          '<div class="recent-win-card__stars">★★★★★</div>' +
          '<div class="recent-win-card__teams">' + ST.escapeHtml(w.home_team) + ' vs ' + ST.escapeHtml(w.away_team) + '</div>' +
          '<div class="recent-win-card__meta"><span>Pick: ' + ST.escapeHtml(w.tip) + '</span>' + (w.odds ? '<span class="recent-win-card__odds">Odds: ' + ST.formatOdds(w.odds) + '</span>' : '') + '</div>' +
          '<div class="recent-win-card__outcome"><span class="badge badge-won">WON</span><span class="recent-win-card__score">' + w.home_score + '-' + w.away_score + '</span></div>' +
        '</div>';
      }).join('');
      container.innerHTML = '<div class="aside-widget"><h3><span class="material-icons-round">military_tech</span>Recent Wins</h3>' + rows + '</div>';
    } catch (e) { container.innerHTML = ''; }
  };

  // ---- Ticker ---------------------------------------------------------------
  async function renderTicker() {
    var el = document.getElementById('st-ticker');
    if (!el) return;
    try {
      var res = await api('/predictions?date=today&limit=10');
      if (!res.data.length) { el.closest('.ticker-wrap').style.display = 'none'; return; }
      el.innerHTML = res.data.map(function (p) {
        return '<span>&#9917; ' + ST.escapeHtml(p.home_team) + ' vs ' + ST.escapeHtml(p.away_team) + ' — ' + ST.escapeHtml(p.tip === '🔒 Locked' ? 'Prediction available' : p.tip) + '</span>';
      }).join('');
    } catch (e) {
      var wrap = document.querySelector('.ticker-wrap');
      if (wrap) wrap.style.display = 'none';
    }
  }

  // ---- Vote polls (polling, not WebSockets — see build spec Part 12) ------
  ST.initVotePoll = function (container, predictionId) {
    var pollTimer = null;
    async function render() {
      try {
        var res = await api('/predictions/' + predictionId + '/votes');
        var d = res.data;
        if (d.myVote) {
          container.innerHTML =
            '<div class="vote-poll"><div class="vote-poll__head"><span>Who wins? <span class="badge-live badge" style="margin-left:6px;">Live</span></span><span>' + d.total + ' votes</span></div>' +
            '<div class="vote-poll__bars">' +
              ['home', 'draw', 'away'].map(function (k) {
                var label = k === 'home' ? 'Home' : k === 'draw' ? 'Draw' : 'Away';
                return '<div class="vote-poll__row"><span>' + label + '</span><div class="vote-poll__track"><div class="vote-poll__fill" style="width:' + d[k] + '%"></div></div><span>' + d[k] + '%</span></div>';
              }).join('') +
            '</div></div>';
        } else {
          container.innerHTML =
            '<div class="vote-poll"><div class="vote-poll__head"><span>Who wins?</span><span>' + d.total + ' votes so far</span></div>' +
            '<div class="vote-poll__buttons">' +
              '<button data-choice="home">Home</button><button data-choice="draw">Draw</button><button data-choice="away">Away</button>' +
            '</div></div>';
          container.querySelectorAll('button[data-choice]').forEach(function (btn) {
            btn.addEventListener('click', async function () {
              try {
                await api('/predictions/' + predictionId + '/votes', { method: 'POST', body: { choice: btn.getAttribute('data-choice') } });
                render();
              } catch (err) { ST.showToast(err.message, 'error'); }
            });
          });
        }
      } catch (e) { /* silent */ }
    }
    render();
    if (document.visibilityState === 'visible') pollTimer = setInterval(render, 7000);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && !pollTimer) pollTimer = setInterval(render, 7000);
      else if (document.visibilityState !== 'visible' && pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    });
  };

  // ---- Auth modal (login / register — no separate pages) --------------------
  function authModalShell() {
    var overlay = document.getElementById('st-auth-modal');
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'st-auth-modal';
    overlay.innerHTML = '<div class="modal watermark"><div class="modal-header"><h3 id="st-auth-title">Log In</h3><button class="modal-close" id="st-auth-close">&times;</button></div><div id="st-auth-body"></div></div>';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeAuthModal(); });
    document.getElementById('st-auth-close').addEventListener('click', closeAuthModal);
    return overlay;
  }
  function closeAuthModal() {
    var overlay = document.getElementById('st-auth-modal');
    if (overlay) overlay.classList.remove('open');
  }

  function loginFormHtml() {
    return '' +
      '<form id="st-login-form">' +
        '<div class="form-group"><label class="form-label">Email</label><input required type="email" name="email" class="form-control"></div>' +
        '<div class="form-group"><label class="form-label">Password</label><input required type="password" name="password" class="form-control"></div>' +
        '<button type="button" id="st-forgot-link" style="background:none;border:none;color:var(--primary);font-size:0.85rem;padding:0;margin-bottom:16px;">Forgot password?</button>' +
        '<button type="submit" class="btn btn-primary btn-block">Log In</button>' +
      '</form>' +
      '<p class="text-soft text-center" style="margin-top:14px;">No account? <button type="button" data-auth-open="register" style="background:none;border:none;color:var(--primary);font-weight:700;">Sign up free</button></p>';
  }

  function registerFormHtml() {
    return '' +
      '<form id="st-register-form">' +
        '<div class="form-group"><label class="form-label">Name</label><input required type="text" name="name" class="form-control"></div>' +
        '<div class="form-group"><label class="form-label">Email</label><input required type="email" name="email" class="form-control"></div>' +
        '<div class="form-group"><label class="form-label">Password</label><input required type="password" name="password" class="form-control" minlength="8"><small class="text-soft">8+ characters, 1 uppercase, 1 number, 1 special character.</small></div>' +
        '<button type="submit" class="btn btn-primary btn-block">Create Free Account</button>' +
      '</form>' +
      '<p class="text-soft text-center" style="margin-top:14px;">Already have an account? <button type="button" data-auth-open="login" style="background:none;border:none;color:var(--primary);font-weight:700;">Log in</button></p>';
  }

  function otpFormHtml(email) {
    return '' +
      '<p class="text-soft">We sent a 6-digit code to <strong>' + ST.escapeHtml(email) + '</strong>.</p>' +
      '<form id="st-otp-form">' +
        '<div class="form-group"><label class="form-label">Verification Code</label><input required maxlength="6" pattern="[0-9]{6}" name="token" class="form-control" style="letter-spacing:6px;font-size:1.3rem;text-align:center;"></div>' +
        '<button type="submit" class="btn btn-primary btn-block">Verify &amp; Continue</button>' +
      '</form>';
  }

  function forgotFormHtml() {
    return '' +
      '<form id="st-forgot-form">' +
        '<div class="form-group"><label class="form-label">Email</label><input required type="email" name="email" class="form-control"></div>' +
        '<button type="submit" class="btn btn-primary btn-block">Send Reset Link</button>' +
      '</form>';
  }

  ST.openAuthModal = function (mode) {
    var overlay = authModalShell();
    var title = document.getElementById('st-auth-title');
    var body = document.getElementById('st-auth-body');
    if (mode === 'register') { title.textContent = 'Create Your Free Account'; body.innerHTML = registerFormHtml(); wireRegisterForm(); }
    else if (mode === 'forgot') { title.textContent = 'Reset Password'; body.innerHTML = forgotFormHtml(); wireForgotForm(); }
    else { title.textContent = 'Log In'; body.innerHTML = loginFormHtml(); wireLoginForm(); }
    overlay.classList.add('open');
  };

  // A full reload after login/register is deliberate: every page's gating
  // (locked prediction cards, VIP teasers, dashboard content) was rendered
  // against the guest role at initial load, so patching just the header's
  // auth slot would leave the rest of the page stale. The welcome toast
  // survives the reload via sessionStorage so the UX still feels immediate.
  function completeAuthSuccess(user, message) {
    ST.setUser(user);
    sessionStorage.setItem('st_pending_toast', JSON.stringify({ message: message, type: 'success' }));
    window.location.reload();
  }

  function wireLoginForm() {
    document.getElementById('st-login-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      var fd = new FormData(e.target);
      try {
        var res = await api('/auth/login', { method: 'POST', body: { email: fd.get('email'), password: fd.get('password') } });
        completeAuthSuccess(res.data.user, 'Welcome back, ' + res.data.user.name + '!');
      } catch (err) { ST.showToast(err.message, 'error'); }
    });
    document.getElementById('st-forgot-link').addEventListener('click', function () { ST.openAuthModal('forgot'); });
  }

  function wireRegisterForm() {
    document.getElementById('st-register-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      var fd = new FormData(e.target);
      var email = fd.get('email');
      try {
        await api('/auth/register', { method: 'POST', body: { name: fd.get('name'), email: email, password: fd.get('password') } });
        document.getElementById('st-auth-title').textContent = 'Check Your Email';
        document.getElementById('st-auth-body').innerHTML = otpFormHtml(email);
        document.getElementById('st-otp-form').addEventListener('submit', async function (ev) {
          ev.preventDefault();
          var otpFd = new FormData(ev.target);
          try {
            var res = await api('/auth/register/verify', { method: 'POST', body: { email: email, token: otpFd.get('token') } });
            completeAuthSuccess(res.data.user, 'Welcome to StakeTruth, ' + res.data.user.name + '!');
          } catch (err) { ST.showToast(err.message, 'error'); }
        });
      } catch (err) { ST.showToast(err.message, 'error'); }
    });
  }

  function wireForgotForm() {
    document.getElementById('st-forgot-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      var fd = new FormData(e.target);
      try {
        await api('/auth/forgot-password', { method: 'POST', body: { email: fd.get('email') } });
        ST.showToast('If that email exists, a reset link is on its way.', 'success');
        closeAuthModal();
      } catch (err) { ST.showToast(err.message, 'error'); }
    });
  }

  // Single delegated listener covers every [data-auth-open] button, including
  // ones rendered later inside dynamically-built prediction cards.
  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('[data-auth-open]');
    if (btn) ST.openAuthModal(btn.getAttribute('data-auth-open'));
  });

  // ---- Ad slots ---------------------------------------------------------------
  function adSlotHtml(slot) {
    if (slot.ad_type === 'banner_image' && slot.image_url) {
      var img = '<img src="' + slot.image_url + '" alt="Advertisement" style="max-width:100%;border-radius:var(--radius);">';
      return slot.link_url ? '<a href="' + slot.link_url + '" target="_blank" rel="sponsored noopener">' + img + '</a>' : img;
    }
    if (slot.ad_type === 'text_link' && slot.link_url) {
      return '<a class="ad-slot__text-link" href="' + slot.link_url + '" target="_blank" rel="sponsored noopener">' + ST.escapeHtml(slot.link_text || slot.link_url) + '</a>';
    }
    if (slot.ad_type === 'custom_code' && slot.custom_code) {
      return slot.custom_code;
    }
    if (slot.ad_client_id && slot.ad_slot_id) {
      return '<ins class="adsbygoogle" style="display:block" data-ad-client="' + slot.ad_client_id +
        '" data-ad-slot="' + slot.ad_slot_id + '" data-ad-format="' + (slot.ad_format || 'auto') + '" data-full-width-responsive="true"></ins>';
    }
    return '';
  }

  ST.injectAdSlots = async function () {
    try {
      var res = await api('/ads/active');
      (res.data || []).forEach(function (slot) {
        var html = adSlotHtml(slot);
        if (!html) return;
        document.querySelectorAll('.ad-slot[data-placement="' + slot.placement + '"]').forEach(function (el) {
          el.innerHTML = html;
          if (slot.ad_type === 'custom_code') {
            // innerHTML doesn't execute <script> tags -- re-create them so custom ad code actually runs.
            el.querySelectorAll('script').forEach(function (old) {
              var s = document.createElement('script');
              Array.from(old.attributes).forEach(function (a) { s.setAttribute(a.name, a.value); });
              s.textContent = old.textContent;
              old.replaceWith(s);
            });
          } else if (!slot.ad_type || slot.ad_type === 'adsense') {
            try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) { /* AdSense script not loaded in dev */ }
          }
        });
      });
    } catch (e) { /* no ad slots configured yet */ }
  };

  // ---- Boot -------------------------------------------------------------------
  document.addEventListener('DOMContentLoaded', function () {
    ST.injectHeader();
    ST.injectFooter();
    ST.refreshAuth();
    ST.injectAdSlots();

    var pending = sessionStorage.getItem('st_pending_toast');
    if (pending) {
      sessionStorage.removeItem('st_pending_toast');
      try { var t = JSON.parse(pending); ST.showToast(t.message, t.type); } catch (e) { /* ignore */ }
    }
  });
})();
