/**
 * 全域快速搜尋（Ctrl+K）
 *
 * 一次搜尋：維修 / 客戶 / 零件 / 報價 / 訂單 / 知識庫
 * 並可直接跳轉到對應模組，再開啟明細（或編輯視窗）。
 */
(function () {
  'use strict';

  const _state = {
    ready: false,
    isOpen: false,
    overlay: null,
    input: null,
    list: null,
    status: null,
    hotkey: null,
    activeIndex: 0,
    results: [],
    _debounce: null,
    _renderToken: 0,
    _prefetchPromise: null,
    _bound: false,
  };

  const _meta = {
    repairs:  { key: 'repairs',  label: '維修',   icon: '📋' },
    customers:{ key: 'customers',label: '客戶',   icon: '👥' },
    parts:    { key: 'parts',    label: '零件',   icon: '🧩' },
    quotes:   { key: 'quotes',   label: '報價',   icon: '🧾' },
    orders:   { key: 'orders',   label: '訂單',   icon: '📦' },
    kb:       { key: 'kb',       label: '知識庫', icon: '📚' },
  };

  function _isAuthed() {
    try {
      if (window.AppState && typeof window.AppState.isAuthenticated === 'function') return !!window.AppState.isAuthenticated();
      return !!window.isAuthenticated;
    } catch (_) {
      return false;
    }
  }

  function _toast(msg, type = 'info') {
    try {
      if (window.UI && typeof window.UI.toast === 'function') return window.UI.toast(msg, { type });
    } catch (_) {}
    try { alert(msg); } catch (_) {}
  }

  function _escHtml(s) {
    try {
      if (window.StringUtils && typeof window.StringUtils.escapeHTML === 'function') return window.StringUtils.escapeHTML(s);
    } catch (_) {}
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function _escAttr(s) {
    try {
      if (window.StringUtils && typeof window.StringUtils.escapeAttr === 'function') return window.StringUtils.escapeAttr(s);
    } catch (_) {}
    return _escHtml(s);
  }

  function _norm(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[\u3000\s]+/g, ' ')
      .trim();
  }

  function _toDate(iso) {
    try {
      const s = String(iso || '');
      return s ? s.slice(0, 10) : '';
    } catch (_) {
      return '';
    }
  }

  function _buildOverlay() {
    if (_state.overlay) return;
    const el = document.createElement('div');
    el.id = 'global-search-overlay';
    el.className = 'gs-overlay';
    el.style.display = 'none';

    el.innerHTML = `
      <div class="gs-backdrop" data-gs="backdrop"></div>
      <div class="gs-card" role="dialog" aria-modal="true" aria-label="全域快速搜尋">
        <div class="gs-header">
          <div class="gs-title">全域快速搜尋</div>
          <div class="gs-hotkey" data-gs="hotkey">Ctrl + K</div>
        </div>
        <div class="gs-input-row">
          <input class="input gs-input" data-gs="input" placeholder="搜尋：公司 / 序號 / 料號 / 報價/訂單號 / 關鍵字…" autocomplete="off" />
          <button class="btn ghost gs-close" data-gs="close" title="關閉 (Esc)">關閉</button>
        </div>
        <div class="gs-status" data-gs="status"></div>
        <div class="gs-list" data-gs="list"></div>
        <div class="gs-footer">
          <div class="muted">↑↓ 選擇 · Enter 開啟 · Esc 關閉</div>
        </div>
      </div>
    `;

    document.body.appendChild(el);
    _state.overlay = el;
    _state.input = el.querySelector('[data-gs="input"]');
    _state.list = el.querySelector('[data-gs="list"]');
    _state.status = el.querySelector('[data-gs="status"]');
    _state.hotkey = el.querySelector('[data-gs="hotkey"]');

    // backdrop / close
    const backdrop = el.querySelector('[data-gs="backdrop"]');
    const closeBtn = el.querySelector('[data-gs="close"]');
    if (backdrop) backdrop.addEventListener('click', () => GlobalSearch.close());
    if (closeBtn) closeBtn.addEventListener('click', () => GlobalSearch.close());

    // input handler
    if (_state.input) {
      _state.input.addEventListener('input', () => {
        clearTimeout(_state._debounce);
        _state._debounce = setTimeout(() => {
          GlobalSearch.search(_state.input.value);
        }, 120);
      });

      _state.input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          GlobalSearch.close();
          return;
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          GlobalSearch.move(1);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          GlobalSearch.move(-1);
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          GlobalSearch.openActive();
          return;
        }
      });
    }

    // list click
    if (_state.list) {
      _state.list.addEventListener('click', async (ev) => {
        const row = ev.target && ev.target.closest ? ev.target.closest('[data-gs-idx]') : null;
        if (!row) return;
        const idx = Number(row.getAttribute('data-gs-idx'));
        if (!Number.isFinite(idx)) return;
        await GlobalSearch.openByIndex(idx);
      });
    }
  }

  async function _prefetch() {
    if (_state._prefetchPromise) return _state._prefetchPromise;
    _state._prefetchPromise = (async () => {
      try {
        const ensure = window.Utils && typeof window.Utils.ensureServiceReady === 'function'
          ? window.Utils.ensureServiceReady
          : null;

        if (!ensure) return;

        // 只要資料層可用即可，UI/Controller 由跳轉時載入
        await Promise.all([
          ensure('RepairService', { loadAll: true }),
          ensure('CustomerService', { loadAll: true }),
          ensure('PartService', { loadAll: true }),
          ensure('QuoteService', { loadAll: true }),
          ensure('OrderService', { loadAll: true }),
          ensure('KBService', { loadAll: false }),
        ]);
      } catch (e) {
        console.warn('GlobalSearch prefetch failed:', e);
      }
    })();
    return _state._prefetchPromise;
  }

  function _setStatus(text, kind = 'muted') {
    if (!_state.status) return;
    const cls = kind === 'error' ? 'gs-status error' : 'gs-status';
    _state.status.className = cls;
    _state.status.textContent = String(text || '');
  }

  function _setResults(results) {
    _state.results = Array.isArray(results) ? results : [];
    if (_state.activeIndex >= _state.results.length) _state.activeIndex = Math.max(0, _state.results.length - 1);
    if (_state.activeIndex < 0) _state.activeIndex = 0;
  }

  function _highlight(text, q) {
    const raw = String(text || '');
    const query = String(q || '').trim();
    if (!query) return _escHtml(raw);

    // 只做第一個匹配的簡單高亮（避免過度複雜）
    const idx = raw.toLowerCase().indexOf(query.toLowerCase());
    if (idx < 0) return _escHtml(raw);
    const a = raw.slice(0, idx);
    const b = raw.slice(idx, idx + query.length);
    const c = raw.slice(idx + query.length);
    return `${_escHtml(a)}<mark class="gs-mark">${_escHtml(b)}</mark>${_escHtml(c)}`;
  }

  function _render(query) {
    if (!_state.list) return;
    const q = String(query || '').trim();
    const results = _state.results;

    if (!q) {
      _state.list.innerHTML = `
        <div class="gs-empty">
          <div class="muted">開始輸入關鍵字即可搜尋（例如：公司名、序號、料號、報價/訂單號）。</div>
        </div>
      `;
      return;
    }

    if (!results.length) {
      _state.list.innerHTML = `
        <div class="gs-empty">
          <div class="muted">查無資料或尚未載入完成。</div>
        </div>
      `;
      return;
    }

    const rows = results.map((r, i) => {
      const m = _meta[r.route] || { label: r.route, icon: '🔎' };
      const active = (i === _state.activeIndex) ? 'active' : '';
      const titleHtml = _highlight(r.title, q);
      const subHtml = _highlight(r.subtitle, q);
      return `
        <div class="gs-row ${active}" data-gs-idx="${i}" role="button" tabindex="0">
          <div class="gs-row-left">
            <div class="gs-badge">${_escHtml(m.icon)} ${_escHtml(m.label)}</div>
            <div class="gs-text">
              <div class="gs-row-title">${titleHtml}</div>
              <div class="gs-row-sub">${subHtml}</div>
            </div>
          </div>
          <div class="gs-row-right">
            <span class="muted">${_escHtml(r.trailing || '')}</span>
          </div>
        </div>
      `;
    }).join('');

    _state.list.innerHTML = rows;
    // 確保 active row 可見
    try {
      const activeEl = _state.list.querySelector('.gs-row.active');
      if (activeEl && typeof activeEl.scrollIntoView === 'function') {
        activeEl.scrollIntoView({ block: 'nearest' });
      }
    } catch (_) {}
  }

  function _score(text, tokens) {
    const t = String(text || '');
    if (!t) return -1;
    const s = t.toLowerCase();

    let score = 0;
    for (const tok of tokens) {
      if (!tok) continue;
      const i = s.indexOf(tok);
      if (i < 0) return -1; // 必須全部命中
      score += (i === 0) ? 18 : 8;
      if (tok.length >= 4) score += 2;
    }
    // 小加權：字串越短越像精準命中
    score += Math.max(0, 20 - Math.min(20, s.length / 8));
    return score;
  }

  function _svc(name) {
    try {
      return (typeof window._svc === 'function') ? window._svc(name) : window[name];
    } catch (_) {
      return null;
    }
  }

  function _getRepairSearchText(r) {
    const parts = [];
    for (const k of ['repairNo','serialNumber','companyName','contactName','contactPhone','contactEmail','title','issue','problem','description','notes','status']) {
      if (r && r[k]) parts.push(String(r[k]));
    }
    return _norm(parts.join(' '));
  }

  function _getCustomerSearchText(c) {
    const parts = [];
    for (const k of ['companyName','name','phone','email','title','department','notes','address']) {
      if (c && c[k]) parts.push(String(c[k]));
    }
    return _norm(parts.join(' '));
  }

  function _getPartSearchText(p) {
    const parts = [];
    for (const k of ['mpn','name','vendor','maker','brand','model','notes','desc','description']) {
      if (p && p[k]) parts.push(String(p[k]));
    }
    return _norm(parts.join(' '));
  }

  function _getQuoteSearchText(q) {
    const parts = [];
    for (const k of ['quoteNo','companyName','contactName','serialNumber','repairId','notes','status']) {
      if (q && q[k]) parts.push(String(q[k]));
    }
    return _norm(parts.join(' '));
  }

  function _getOrderSearchText(o) {
    const parts = [];
    for (const k of ['orderNo','companyName','contactName','serialNumber','repairId','quoteId','notes','status']) {
      if (o && o[k]) parts.push(String(o[k]));
    }
    return _norm(parts.join(' '));
  }

  function _getKBSearchText(it) {
    try {
      if (it && it._search) return _norm(it._search);
    } catch (_) {}
    const parts = [];
    for (const k of ['title','question','answer','symptom','rootCause','solution','content','steps','notes']) {
      if (it && it[k]) parts.push(String(it[k]));
    }
    try {
      if (it && Array.isArray(it.tags)) parts.push(it.tags.join(' '));
    } catch (_) {}
    return _norm(parts.join(' '));
  }

  function _buildResults(query) {
    const q = _norm(query);
    const tokens = q.split(' ').filter(Boolean).slice(0, 6);
    if (!tokens.length) return [];

    const out = [];

    // repairs
    try {
      const rs = _svc('RepairService');
      const rows = (rs && typeof rs.getAll === 'function') ? rs.getAll() : (rs && Array.isArray(rs.repairs) ? rs.repairs : []);
      for (const r of (Array.isArray(rows) ? rows : [])) {
        if (!r || r.isDeleted) continue;
        const text = _getRepairSearchText(r);
        const sc = _score(text, tokens);
        if (sc < 0) continue;
        const title = `${r.repairNo || r.id || ''}${r.serialNumber ? ` · ${r.serialNumber}` : ''}${r.companyName ? ` · ${r.companyName}` : ''}`.trim();
        const subtitle = `${r.title || r.issue || r.problem || r.description || ''}`.trim() || (r.contactName ? `聯絡人：${r.contactName}` : '');
        out.push({
          route: 'repairs',
          id: String(r.id || ''),
          title: title || `維修單 ${String(r.id || '').slice(0, 8)}`,
          subtitle: subtitle,
          trailing: _toDate(r.updatedAt || r.createdAt),
          _score: sc + 10,
          _time: String(r.updatedAt || r.createdAt || ''),
        });
      }
    } catch (_) {}

    // customers
    try {
      const cs = _svc('CustomerService');
      const rows = (cs && typeof cs.getAll === 'function') ? cs.getAll() : (cs && Array.isArray(cs.customers) ? cs.customers : []);
      for (const c of (Array.isArray(rows) ? rows : [])) {
        if (!c || c.isDeleted) continue;
        const text = _getCustomerSearchText(c);
        const sc = _score(text, tokens);
        if (sc < 0) continue;
        const title = `${c.companyName || ''}${c.name ? ` · ${c.name}` : ''}`.trim() || (c.id ? `客戶 ${c.id}` : '客戶');
        const subtitle = `${c.phone ? `電話：${c.phone}` : ''}${(c.phone && c.email) ? ' · ' : ''}${c.email ? `Email：${c.email}` : ''}`.trim();
        out.push({
          route: 'customers',
          id: String(c.id || ''),
          title,
          subtitle,
          trailing: _toDate(c.updatedAt || c.createdAt),
          _score: sc + 8,
          _time: String(c.updatedAt || c.createdAt || ''),
        });
      }
    } catch (_) {}

    // parts
    try {
      const ps = _svc('PartService');
      const rows = (ps && typeof ps.getAll === 'function') ? ps.getAll() : (ps && Array.isArray(ps.parts) ? ps.parts : []);
      for (const p of (Array.isArray(rows) ? rows : [])) {
        if (!p || p.isDeleted) continue;
        const text = _getPartSearchText(p);
        const sc = _score(text, tokens);
        if (sc < 0) continue;
        const title = `${p.mpn || ''}${p.name ? ` · ${p.name}` : ''}`.trim() || (p.id ? `零件 ${p.id}` : '零件');
        const subtitle = `${p.vendor ? `Vendor：${p.vendor}` : ''}${(p.vendor && p.maker) ? ' · ' : ''}${p.maker ? `Maker：${p.maker}` : ''}`.trim();
        out.push({
          route: 'parts',
          id: String(p.id || ''),
          title,
          subtitle,
          trailing: _toDate(p.updatedAt || p.createdAt),
          _score: sc + 6,
          _time: String(p.updatedAt || p.createdAt || ''),
        });
      }
    } catch (_) {}

    // quotes
    try {
      const qs = _svc('QuoteService');
      const rows = (qs && typeof qs.getAll === 'function') ? qs.getAll() : (qs && Array.isArray(qs.quotes) ? qs.quotes : []);
      for (const qx of (Array.isArray(rows) ? rows : [])) {
        if (!qx || qx.isDeleted) continue;
        const text = _getQuoteSearchText(qx);
        const sc = _score(text, tokens);
        if (sc < 0) continue;
        const title = `${qx.quoteNo || qx.id || ''}${qx.companyName ? ` · ${qx.companyName}` : ''}`.trim() || (qx.id ? `報價 ${qx.id}` : '報價');
        const subtitle = `${qx.serialNumber ? `序號：${qx.serialNumber}` : ''}${(qx.serialNumber && qx.contactName) ? ' · ' : ''}${qx.contactName ? `聯絡人：${qx.contactName}` : ''}`.trim();
        out.push({
          route: 'quotes',
          id: String(qx.id || ''),
          title,
          subtitle,
          trailing: _toDate(qx.updatedAt || qx.createdAt),
          _score: sc + 6,
          _time: String(qx.updatedAt || qx.createdAt || ''),
        });
      }
    } catch (_) {}

    // orders
    try {
      const os = _svc('OrderService');
      const rows = (os && typeof os.getAll === 'function') ? os.getAll() : (os && Array.isArray(os.orders) ? os.orders : []);
      for (const ox of (Array.isArray(rows) ? rows : [])) {
        if (!ox || ox.isDeleted) continue;
        const text = _getOrderSearchText(ox);
        const sc = _score(text, tokens);
        if (sc < 0) continue;
        const title = `${ox.orderNo || ox.id || ''}${ox.companyName ? ` · ${ox.companyName}` : ''}`.trim() || (ox.id ? `訂單 ${ox.id}` : '訂單');
        const subtitle = `${ox.serialNumber ? `序號：${ox.serialNumber}` : ''}${(ox.serialNumber && ox.quoteId) ? ' · ' : ''}${ox.quoteId ? `Quote：${ox.quoteId}` : ''}`.trim();
        out.push({
          route: 'orders',
          id: String(ox.id || ''),
          title,
          subtitle,
          trailing: _toDate(ox.updatedAt || ox.createdAt),
          _score: sc + 6,
          _time: String(ox.updatedAt || ox.createdAt || ''),
        });
      }
    } catch (_) {}

    // kb
    try {
      const ks = _svc('KBService');
      const types = ['faq', 'failure', 'sop', 'case'];
      for (const t of types) {
        const list = (ks && typeof ks.getAll === 'function') ? ks.getAll(t) : [];
        for (const it of (Array.isArray(list) ? list : [])) {
          if (!it || it.isDeleted) continue;
          const text = _getKBSearchText(it);
          const sc = _score(text, tokens);
          if (sc < 0) continue;
          const title = (it.title || it.question || it.symptom || it.id || '').toString();
          const subtitle = (Array.isArray(it.tags) && it.tags.length) ? `Tag：${it.tags.slice(0, 4).join(', ')}` : (it.updatedBy ? `更新：${it.updatedBy}` : '');
          out.push({
            route: 'kb',
            id: String(it.id || ''),
            kbType: t,
            title: title || `知識庫 ${String(it.id || '').slice(0, 8)}`,
            subtitle,
            trailing: _toDate(it.updatedAt || it.createdAt),
            _score: sc + 4,
            _time: String(it.updatedAt || it.createdAt || ''),
          });
        }
      }
    } catch (_) {}

    // 排序：分數 desc，時間 desc
    out.sort((a, b) => {
      const ds = (b._score || 0) - (a._score || 0);
      if (ds !== 0) return ds;
      const bt = String(b._time || '');
      const at = String(a._time || '');
      return bt.localeCompare(at);
    });

    // 限制結果數量（避免卡頓）
    return out.slice(0, 60);
  }

  async function _openResult(r) {
    if (!r) return;
    if (!window.AppRouter || typeof window.AppRouter.navigate !== 'function') return;

    const route = String(r.route || '').trim();
    if (!route) return;

    try {
      await window.AppRouter.navigate(route);
      try { await window.ModuleLoader?.ensure?.(route); } catch (_) {}

      // 確保 DOM 已渲染
      await new Promise(res => setTimeout(res, 0));

      if (route === 'repairs') {
        try { window.RepairUI?.openDetail?.(r.id); } catch (_) {}
      } else if (route === 'customers') {
        try { window.CustomerUI?.openDetail?.(r.id); } catch (_) {}
      } else if (route === 'parts') {
        // 零件模組目前以「編輯視窗」作為開啟入口
        try { window.PartsUI?.openEditPart?.(r.id); } catch (_) {}
      } else if (route === 'quotes') {
        try { window.QuotesUI?.openDetail?.(r.id); } catch (_) {}
      } else if (route === 'orders') {
        try { window.OrdersUI?.openDetail?.(r.id); } catch (_) {}
      } else if (route === 'kb') {
        // KB 以 view modal 開啟
        try {
          if (r.kbType) {
            // 切到對應類型再開啟
            try { window.kbUI?.setType?.(r.kbType); } catch (_) {}
          }
          window.KBUI?.openView?.(r.id);
        } catch (_) {}
      }
    } catch (e) {
      console.warn('GlobalSearch openResult failed:', e);
    }
  }

  const GlobalSearch = {
    init() {
      if (_state.ready) return;
      _buildOverlay();
      _state.ready = true;

      // 視覺：Mac 使用 ⌘K（但仍支援 Ctrl+K）
      try {
        const isMac = /Mac|iPhone|iPad|iPod/i.test(navigator.platform || '');
        if (isMac && _state.hotkey) _state.hotkey.textContent = '⌘ + K';
      } catch (_) {}

      // 登出時強制關閉
      if (!_state._bound) {
        _state._bound = true;
        window.addEventListener('auth:logout', () => {
          try { GlobalSearch.close(); } catch (_) {}
          _state._prefetchPromise = null;
        });
      }
    },

    open() {
      if (!_isAuthed()) {
        _toast('請先登入後再使用全域搜尋。', 'warning');
        return;
      }
      this.init();
      if (!_state.overlay) return;

      _state.overlay.style.display = 'flex';
      _state.isOpen = true;
      _state.activeIndex = 0;
      _setResults([]);
      _setStatus('載入中…');
      _render('');

      // 先 focus，再 prefetch（避免 focus 失敗）
      try {
        if (_state.input) {
          _state.input.value = '';
          _state.input.focus();
          _state.input.select();
        }
      } catch (_) {}

      _prefetch().finally(() => {
        if (!_state.isOpen) return;
        _setStatus('');
      });
    },

    close() {
      if (!_state.overlay) return;
      _state.overlay.style.display = 'none';
      _state.isOpen = false;
      _setStatus('');
      _setResults([]);
      try { if (_state.input) _state.input.value = ''; } catch (_) {}
    },

    toggle() {
      if (_state.isOpen) this.close();
      else this.open();
    },

    async search(query) {
      if (!_state.isOpen) return;
      const q = String(query || '');
      const qn = _norm(q);

      // 避免每次都被打斷：以 token 控制最後一次渲染
      const token = ++_state._renderToken;

      if (!qn) {
        _setStatus('');
        _setResults([]);
        _render('');
        return;
      }

      _setStatus('搜尋中…');

      await _prefetch();
      if (token !== _state._renderToken) return;

      try {
        const res = _buildResults(qn);
        if (token !== _state._renderToken) return;
        _setResults(res);
        _setStatus(res.length ? '' : '');
        _render(qn);
      } catch (e) {
        console.warn('GlobalSearch search failed:', e);
        _setStatus('搜尋失敗，請稍後再試。', 'error');
      }
    },

    move(delta) {
      if (!_state.isOpen) return;
      const n = _state.results.length;
      if (!n) return;
      _state.activeIndex = Math.max(0, Math.min(n - 1, _state.activeIndex + (delta || 0)));
      _render(_state.input ? _state.input.value : '');
    },

    async openActive() {
      return this.openByIndex(_state.activeIndex);
    },

    async openByIndex(idx) {
      const i = Number(idx);
      if (!Number.isFinite(i)) return;
      const r = _state.results[i];
      if (!r) return;
      this.close();
      await _openResult(r);
    }
  };

  if (typeof window !== 'undefined') {
    window.GlobalSearch = GlobalSearch;

    // 登入後先初始化（僅建立 DOM，不做重型載入）
    try {
      window.addEventListener('auth:login', () => {
        try { GlobalSearch.init(); } catch (_) {}
      });
    } catch (_) {}
  }
})();
