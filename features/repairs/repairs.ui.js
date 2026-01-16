/**
 * 維修管理 - UI 層
 * V160 - Repairs Module - UI Layer
 * 
 * 職責：
 * 1. 渲染維修列表
 * 2. 渲染維修表單
 * 3. 渲染搜尋/篩選介面
 * 4. 渲染統計資訊
 * 5. 事件處理
 */

// ------------------------------------------------------------
// HTML 轉義（避免 XSS / 屬性注入）
// 注意：專案內多數模組使用 escapeHtml（camelCase），但此檔案部分程式碼
// 使用 escapeHTML（全大寫）。為避免在 quote/order mini summary 等處出現
// 「escapeHTML is not defined」，此處提供一致且自足的 helper。
// ------------------------------------------------------------

const escapeHTML = (window.StringUtils && typeof window.StringUtils.escapeHTML === 'function')
  ? window.StringUtils.escapeHTML
  : function escapeHTMLFallback(input) {
      const s = (input === undefined || input === null) ? '' : String(input);
      return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    };

class RepairUI {
  constructor() {
    this.currentView = 'list'; // list, form, detail
    this.currentRepair = null;
    this.filters = {};
    this.sortBy = 'updatedAt';
    this.sortOrder = 'desc';
    this.searchDebounce = null;

    // 表單：公司選擇/輸入 debounce（避免每個鍵入都觸發聯絡人清單重算）
    this._customerPickTimer = null;

    // 功能優化：列表關鍵字搜尋（記住上一次輸入）
    const kw = this.loadKeyword();
    if (kw) this.filters.keyword = kw;

    // 列表分頁（顯示更多）
    this.pageSize = this.getDefaultPageSize();
    this.visibleCount = this.pageSize;
    this._lastQueryKey = '';

    // 列表顯示密度（標準/緊湊）
    this.listDensity = this.loadListDensity();

    // 進行中 / 歷史（已完成）
    this.scope = this.loadScope();
    this.applyScopeDefaults();

    // P3：篩選面板開關（記住上次狀態）
    this.filtersPanelOpen = this.loadFiltersPanelOpen();

    // P3-3：自訂檢視（Saved Views）
    this._savedViewsModule = 'repairs';
    this._activeViewId = this.loadLastSavedViewId();
    this._autoViewApplied = false;

    // 增量渲染 / 變更合併（效能）
    this._renderToken = 0;
    this._updateScheduled = false;

    // 表單 DOM 快取（效能/穩定）：避免重複 querySelector
    this._formEl = null;
    this._formEls = null;

    // 事件委派（P2-2）：列表/詳情按鈕統一由單一 click handler 處理
    this._delegatedClickHandler = null;

    // CodeOpt：事件清理控制（避免重複綁定/記憶體殘留）
    this._formAC = null;
    this._companyDropdownAC = null;
    this._contactDropdownAC = null;

  }

  // ========================================
  // Saved Views（自訂檢視）
  // ========================================

  _getLastViewKey() {
    try {
      if (window.SavedViews && typeof window.SavedViews.prefKey === 'function') {
        return window.SavedViews.prefKey('ui_repairs_last_view');
      }
    } catch (_) {}
    return this.getStorageKey('ui_repairs_last_view');
  }

  loadLastSavedViewId() {
    try {
      const key = this._getLastViewKey();
      const v = (localStorage.getItem(key) || '').toString().trim();
      return v;
    } catch (_) {
      return '';
    }
  }

  saveLastSavedViewId(id) {
    try {
      const key = this._getLastViewKey();
      const v = (id || '').toString();
      if (v) localStorage.setItem(key, v);
      else localStorage.removeItem(key);
    } catch (_) {
      // ignore
    }
  }

  listSavedViews() {
    try {
      if (window.SavedViews && typeof window.SavedViews.list === 'function') {
        return window.SavedViews.list(this._savedViewsModule) || [];
      }
    } catch (_) {}
    return [];
  }

  _buildCurrentViewPayload() {
    const f = { ...(this.getEffectiveFilters() || {}) };
    delete f.scope; // scope 另存
    return {
      scope: this.scope,
      filters: f,
      sortBy: this.sortBy,
      sortOrder: this.sortOrder,
      listDensity: this.listDensity
    };
  }

  _applyViewPayload(payload, opts) {
    const p = (payload && typeof payload === 'object') ? payload : {};
    const silent = !!(opts && opts.silent);

    // scope
    const scope = (p.scope === 'history') ? 'history' : 'active';
    this.scope = scope;
    this.saveScope(scope);
    this.applyScopeDefaults();

    // filters
    this.filters = (p.filters && typeof p.filters === 'object') ? { ...p.filters } : {};

    // sort
    if (p.sortBy) this.sortBy = String(p.sortBy);
    if (p.sortOrder) this.sortOrder = (String(p.sortOrder) === 'asc') ? 'asc' : 'desc';

    // density
    if (p.listDensity) {
      this.listDensity = (p.listDensity === 'compact') ? 'compact' : 'standard';
      this.saveListDensity(this.listDensity);
    }

    // keyword preference（與 keyword bar 同步）
    try {
      const kw = (this.filters.keyword || '').toString().trim();
      this.saveKeyword(kw);
    } catch (_) {}

    // 同步 UI
    try { this.refreshFiltersPanel(); } catch (_) {}
    try { this.applyDensityClass(); } catch (_) {}

    // 同步 keyword bar（repairs-keyword）
    try {
      const kwEl = document.getElementById('repairs-keyword');
      if (kwEl) kwEl.value = (this.filters.keyword || '').toString();
    } catch (_) {}

    if (!silent) {
      try {
        if (window.UI && typeof window.UI.toast === 'function') window.UI.toast('已套用檢視', { type: 'success' });
      } catch (_) {}
    }
  }

  _autoApplySavedViewIfNeeded() {
    if (this._autoViewApplied) return;
    this._autoViewApplied = true;
    const id = (this._activeViewId || '').toString().trim();
    if (!id) return;
    const views = this.listSavedViews();
    const v = views.find(x => x && x.id === id);
    if (!v || !v.payload) {
      this._activeViewId = '';
      try { this.saveLastSavedViewId(''); } catch (_) {}
      return;
    }
    this._applyViewPayload(v.payload, { silent: true });
  }

  renderSavedViewsToolbar() {
    const views = this.listSavedViews();
    const cur = (this._activeViewId || '').toString();
    return `
      <div class="toolbar-group saved-views" onclick="event.stopPropagation();">
        <select class="input sm sv-select" id="repairs-view-select" onchange="RepairUI.applySavedView(this.value)">
          <option value="">檢視：預設</option>
          ${views.map(v => `<option value="${escapeHTML(v.id)}" ${v.id === cur ? 'selected' : ''}>${escapeHTML(v.name || '未命名')}</option>`).join('')}
        </select>
        <button class="btn sm sv-btn" type="button" onclick="RepairUI.saveCurrentView()">⭐ 儲存檢視</button>
        <button class="btn sm ghost sv-btn" type="button" onclick="RepairUI.manageViews()">⚙ 管理檢視</button>
      </div>
    `;
  }

  refreshSavedViewsSelect() {
    const sel = document.getElementById('repairs-view-select');
    if (!sel) return;
    const views = this.listSavedViews();
    const cur = (this._activeViewId || '').toString();
    sel.innerHTML = `<option value="">檢視：預設</option>` + views.map(v => {
      const id = escapeHTML(v.id);
      const name = escapeHTML(v.name || '未命名');
      const selected = (v.id === cur) ? 'selected' : '';
      return `<option value="${id}" ${selected}>${name}</option>`;
    }).join('');
    try { sel.value = cur; } catch (_) {}
  }

  async saveCurrentViewInteractive() {
    const UI = window.UI;
    if (!UI || typeof UI.prompt !== 'function') {
      try { window.alert('系統 UI 元件尚未就緒，請稍後再試'); } catch (_) {}
      return;
    }

    const name = await UI.prompt({
      title: '儲存檢視',
      message: '將目前的篩選條件保存為一個可快速切換的檢視',
      label: '檢視名稱',
      placeholder: '例如：本週未結案 / 只看我的',
      defaultValue: ''
    });

    const n = (name || '').toString().trim();
    if (!n) return;

    const views = this.listSavedViews();
    const existed = views.find(v => (v && (v.name || '').toString().trim() === n));

    let id = '';
    if (existed && existed.id) {
      const ok = (UI && typeof UI.confirm === 'function')
        ? await UI.confirm({ title: '檢視已存在', message: `「${n}」已存在，是否覆寫？`, okText: '覆寫', cancelText: '取消', tone: 'danger' })
        : window.confirm(`「${n}」已存在，是否覆寫？`);
      if (!ok) return;
      id = existed.id;
    }

    const payload = this._buildCurrentViewPayload();
    const view = {
      id: id,
      name: n,
      module: this._savedViewsModule,
      payload
    };

    const saved = (window.SavedViews && typeof window.SavedViews.upsert === 'function')
      ? window.SavedViews.upsert(this._savedViewsModule, view)
      : view;

    this._activeViewId = saved.id;
    this.saveLastSavedViewId(saved.id);
    this.refreshSavedViewsSelect();
    try { if (window.UI && typeof window.UI.toast === 'function') window.UI.toast('已儲存檢視', { type: 'success' }); } catch (_) {}
  }

  applySavedViewById(id) {
    const vid = (id || '').toString().trim();
    this._activeViewId = vid;
    this.saveLastSavedViewId(vid);

    if (!vid) {
      // 使用者選擇「預設」：僅清除檢視選取，不強制改變目前篩選（避免誤觸造成資料視圖跳動）
      try { this.refreshSavedViewsSelect(); } catch (_) {}
      return;
    }

    const views = this.listSavedViews();
    const v = views.find(x => x && x.id === vid);
    if (!v || !v.payload) {
      try { if (window.UI && typeof window.UI.toast === 'function') window.UI.toast('找不到檢視，可能已被刪除', { type: 'warning' }); } catch (_) {}
      this._activeViewId = '';
      this.saveLastSavedViewId('');
      this.refreshSavedViewsSelect();
      return;
    }

    this._applyViewPayload(v.payload);
    this.visibleCount = this.pageSize;
    this.updateList();
    this.refreshSavedViewsSelect();
  }

  _renderManageViewsHtml() {
    const views = this.listSavedViews();
    if (!views.length) {
      return `
        <div class="muted">目前沒有任何檢視。你可以回到列表後按「⭐ 儲存」建立第一個檢視。</div>
      `;
    }

    return `
      <div class="saved-views-manage">
        <div class="muted" style="margin-bottom:10px;">共 ${views.length} 個檢視</div>
        <div class="sv-list">
          ${views.map(v => {
            const id = escapeHTML(v.id);
            const name = escapeHTML(v.name || '未命名');
            const active = (v.id === (this._activeViewId || '')) ? ' active' : '';
            return `
              <div class="sv-row${active}" data-id="${id}">
                <div class="sv-left">
                  <div class="sv-name">${name}</div>
                  <div class="sv-meta">${v.id === (this._activeViewId || '') ? '目前套用中' : ' '}</div>
                </div>
                <div class="sv-actions">
                  <button class="btn sm" type="button" data-act="apply">套用</button>
                  <button class="btn sm ghost" type="button" data-act="rename">改名</button>
                  <button class="btn sm danger ghost" type="button" data-act="delete">刪除</button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  manageSavedViews() {
    const UI = window.UI;
    if (!UI || typeof UI.openModal !== 'function') return;

    const modalId = 'ui-repairs-saved-views-modal';
    UI.openModal({
      id: modalId,
      title: '管理檢視',
      html: this._renderManageViewsHtml(),
      wideClass: 'modal-wide'
    });

    const wrap = document.getElementById(modalId);
    if (!wrap) return;

    const rerender = () => {
      try {
        const body = wrap.querySelector('.modal-body');
        if (body) body.innerHTML = this._renderManageViewsHtml();
      } catch (_) {}
    };

    wrap.addEventListener('click', async (e) => {
      const btn = e.target && e.target.closest ? e.target.closest('button[data-act]') : null;
      if (!btn) return;
      const act = (btn.getAttribute('data-act') || '').toString();
      const row = btn.closest('.sv-row');
      const id = row ? (row.getAttribute('data-id') || '').toString() : '';
      if (!id) return;

      if (act === 'apply') {
        this.applySavedViewById(id);
        rerender();
        return;
      }

      if (act === 'rename') {
        const views = this.listSavedViews();
        const current = views.find(v => v && v.id === id);
        const newName = await UI.prompt({
          title: '修改檢視名稱',
          label: '檢視名稱',
          defaultValue: (current && current.name) ? String(current.name) : ''
        });
        const nn = (newName || '').toString().trim();
        if (!nn) return;
        try {
          if (window.SavedViews && typeof window.SavedViews.rename === 'function') {
            window.SavedViews.rename(this._savedViewsModule, id, nn);
          }
        } catch (_) {}
        this.refreshSavedViewsSelect();
        rerender();
        try { if (window.UI && typeof window.UI.toast === 'function') window.UI.toast('已更新檢視名稱', { type: 'success' }); } catch (_) {}
        return;
      }

      if (act === 'delete') {
        const ok = (UI && typeof UI.confirm === 'function')
          ? await UI.confirm({ title: '確認刪除', message: '刪除後無法復原，確定要刪除這個檢視？', okText: '刪除', cancelText: '取消', tone: 'danger' })
          : window.confirm('刪除後無法復原，確定要刪除這個檢視？');
        if (!ok) return;

        try {
          if (window.SavedViews && typeof window.SavedViews.remove === 'function') {
            window.SavedViews.remove(this._savedViewsModule, id);
          }
        } catch (_) {}

        if ((this._activeViewId || '') === id) {
          this._activeViewId = '';
          this.saveLastSavedViewId('');
        }
        this.refreshSavedViewsSelect();
        rerender();
        try { if (window.UI && typeof window.UI.toast === 'function') window.UI.toast('已刪除檢視', { type: 'success' }); } catch (_) {}
      }
    });
  }

  // ========================================
  // Form DOM cache helpers (P2-2)
  // ========================================
  _getRepairForm() {
    const el = document.getElementById('repair-form');
    this._formEl = el || null;
    return this._formEl;
  }

  _getFormEl(name) {
    if (!name) return null;
    const form = this._formEl || this._getRepairForm();
    if (!form) return null;
    this._formEls = this._formEls || {};
    if (this._formEls[name] && form.contains(this._formEls[name])) return this._formEls[name];
    const el = (window.DomUtils && typeof window.DomUtils.byName === 'function')
      ? window.DomUtils.byName(form, name)
      : form.querySelector(`[name="${String(name)}"]`);
    this._formEls[name] = el || null;
    return this._formEls[name];
  }

  _clearFormCache() {
    this._formEl = null;
    this._formEls = null;

    // 若聯絡人下拉在開啟狀態，切換/重繪表單時必須關閉，避免殘留浮層
    try { if (typeof this._closeContactDropdown === 'function') this._closeContactDropdown(true); } catch (_) {}

    // 事件委派（P2-2）：列表/詳情按鈕統一由單一 click handler 處理
    this._delegatedClickHandler = null;

    // CodeOpt：若存在事件控制器，先 abort 再釋放引用（避免殘留）
    try { if (this._formAC && typeof this._formAC.abort === 'function') this._formAC.abort(); } catch (_) {}
    try { if (this._companyDropdownAC && typeof this._companyDropdownAC.abort === 'function') this._companyDropdownAC.abort(); } catch (_) {}
    try { if (this._contactDropdownAC && typeof this._contactDropdownAC.abort === 'function') this._contactDropdownAC.abort(); } catch (_) {}
    this._formAC = null;
    this._companyDropdownAC = null;
    this._contactDropdownAC = null;
  }

  // ========================================
  // 分頁（顯示更多） / 日期快速範圍
  // ========================================

  getDefaultPageSize() {
    try {
      if (window.ListPaging && typeof window.ListPaging.getDefaultPageSize === 'function') {
        return window.ListPaging.getDefaultPageSize();
      }
    } catch (_) {}
    const isMobile = (window.AppConfig && window.AppConfig.device && typeof window.AppConfig.device.isMobile === 'function')
      ? window.AppConfig.device.isMobile()
      : (window.innerWidth <= 640);
    return isMobile ? 40 : 60;
  }

  _stableStringify(obj) {
    try {
      if (!obj || typeof obj !== 'object') return JSON.stringify(obj);
      const keys = Object.keys(obj).sort();
      const out = {};
      for (const k of keys) out[k] = obj[k];
      return JSON.stringify(out);
    } catch (_) {
      try { return JSON.stringify(obj); } catch (__) { return String(obj); }
    }
  }

  _buildQueryKey(effectiveFilters) {
    return [
      this._stableStringify(effectiveFilters || {}),
      String(this.sortBy || ''),
      String(this.sortOrder || '')
    ].join('|');
  }

  _getTaiwanDateString(date) {
    try {
      if (window.RepairModel && typeof window.RepairModel.getTaiwanDateString === 'function') {
        return window.RepairModel.getTaiwanDateString(date);
      }
    } catch (_) {}
    try {
      const d = date ? new Date(date) : new Date();
      return d.toISOString().slice(0, 10);
    } catch (_) {
      return '';
    }
  }

  _daysAgoDateString(days) {
    const n = Number(days || 0);
    const ms = (Number.isFinite(n) ? n : 0) * 24 * 60 * 60 * 1000;
    return this._getTaiwanDateString(new Date(Date.now() - ms));
  }

  renderHistoryDatePresets() {
    if (this.scope !== 'history') return '';

    const f = this.getEffectiveFilters() || {};
    const from = (f.completedFrom || '').toString();
    const to = (f.completedTo || '').toString();

    const presets = [
      { key: '30', label: '近 30 天', from: this._daysAgoDateString(30) },
      { key: '90', label: '近 90 天', from: this._daysAgoDateString(90) },
      { key: '180', label: '近 180 天', from: this._daysAgoDateString(180) },
      { key: 'all', label: '全部', from: '' }
    ];

    const isAll = (!from && !to);

    return `
      <div class="date-preset-chips" aria-label="完成日期快速範圍" onclick="event.stopPropagation();">
        <span class="muted" style="margin-right:6px;">完成日期：</span>
        ${presets.map(p => {
          const active = (p.key === 'all') ? isAll : (from === p.from && !to);
          return `<button class="chip ${active ? 'active' : ''}" style="--chip-color:var(--color-secondary);" onclick="event.stopPropagation(); RepairUI.applyHistoryDatePreset('${p.key}')">${p.label}</button>`;
        }).join('')}
      </div>
    `;
  }

  applyHistoryDatePreset(key) {
    if (this.scope !== 'history') return;

    this.filters = this.filters || {};
    const k = (key || '').toString();

    if (k === 'all') {
      delete this.filters.completedFrom;
      delete this.filters.completedTo;
    } else {
      const days = Number(k);
      if (!Number.isFinite(days) || days <= 0) return;
      this.filters.completedFrom = this._daysAgoDateString(days);
      delete this.filters.completedTo;
    }

    // 同步篩選面板日期欄位（歷史模式即代表完成日期）
    const fromEl = document.getElementById('filter-date-from');
    const toEl = document.getElementById('filter-date-to');
    if (fromEl) fromEl.value = this.filters.completedFrom || '';
    if (toEl) toEl.value = this.filters.completedTo || '';

    this.updateList();
  }

  renderListFooter(meta) {
    const m = meta || {};
    const visible = Math.max(0, Number(m.visible || 0));
    const total = Math.max(0, Number(m.total || 0));
    const hasMore = !!m.hasMore;

    return `
      <div class="repairs-list-footer">
        <div class="muted">已顯示 <span class="mono">${visible}</span> / <span class="mono">${total}</span> 筆</div>
        <div class="repairs-list-footer-actions">
          ${hasMore ? `<button class="btn" onclick="RepairUI.loadMore()">顯示更多</button>` : `<span class="muted">已顯示全部</span>`}
        </div>
      </div>
    `;
  }

  loadMore() {
    const y = (typeof window !== 'undefined' && typeof window.scrollY === 'number') ? window.scrollY : 0;
    const next = (window.ListPaging && typeof window.ListPaging.nextVisibleCount === 'function')
      ? window.ListPaging.nextVisibleCount(this.visibleCount, this.pageSize)
      : ((this.visibleCount || this.pageSize || 60) + (this.pageSize || 60));
    this.visibleCount = next;
    this.updateList();
    try { window.scrollTo(0, y); } catch (_) {}
  }


  // ========================================
  // 偏好設定（列表密度）
  // ========================================

  getStorageKey(suffix) {
    try {
      const prefix = (window.AppConfig && window.AppConfig.system && window.AppConfig.system.storage && window.AppConfig.system.storage.prefix)
        ? window.AppConfig.system.storage.prefix
        : 'repair_tracking_v161_';
      return `${prefix}${suffix}`;
    } catch (_) {
      return `repair_tracking_v161_${suffix}`;
    }
  }

  loadListDensity() {
    try {
      const key = this.getStorageKey('ui_repairs_density');
      const v = localStorage.getItem(key);
      return (v === 'compact' || v === 'standard') ? v : 'standard';
    } catch (_) {
      return 'standard';
    }
  }

  saveListDensity(value) {
    try {
      const key = this.getStorageKey('ui_repairs_density');
      localStorage.setItem(key, value);
    } catch (_) {
      // ignore
    }
  }

  applyDensityClass(rootEl) {
    const el = rootEl || document.querySelector('.repairs-module');
    if (!el) return;
    el.classList.toggle('density-compact', this.listDensity === 'compact');
    el.classList.toggle('density-standard', this.listDensity !== 'compact');
  }

  getSelectedStatus() {
    const v = this.filters && this.filters.status && Array.isArray(this.filters.status) ? this.filters.status[0] : '';
    return v || '';
  }

  // ========================================
  // 偏好設定（scope：active/history）
  // ========================================

  loadScope() {
    try {
      const key = this.getStorageKey('ui_repairs_scope');
      const v = localStorage.getItem(key);
      return (v === 'history' || v === 'active') ? v : 'active';
    } catch (_) {
      return 'active';
    }
  }

  saveScope(value) {
    try {
      const key = this.getStorageKey('ui_repairs_scope');
      localStorage.setItem(key, value);
    } catch (_) {
      // ignore
    }
  }

  // ========================================
  // 偏好設定（列表關鍵字）
  // ========================================

  loadKeyword() {
    try {
      const key = this.getStorageKey('ui_repairs_keyword');
      const v = (localStorage.getItem(key) || '').toString().trim();
      return v;
    } catch (_) {
      return '';
    }
  }

  saveKeyword(value) {
    try {
      const key = this.getStorageKey('ui_repairs_keyword');
      const v = (value || '').toString().trim();
      if (v) localStorage.setItem(key, v);
      else localStorage.removeItem(key);
    } catch (_) {
      // ignore
    }
  }

  loadFiltersPanelOpen() {
    try {
      const key = this.getStorageKey('ui_repairs_filters_open');
      const v = (localStorage.getItem(key) || '').toString().trim().toLowerCase();
      if (!v) return false;
      return (v === '1' || v === 'true' || v === 'yes' || v === 'on');
    } catch (_) {
      return false;
    }
  }

  saveFiltersPanelOpen(isOpen) {
    try {
      const key = this.getStorageKey('ui_repairs_filters_open');
      localStorage.setItem(key, isOpen ? '1' : '0');
    } catch (_) {
      // ignore
    }
  }

  updateFiltersToggleButton() {
    const btn = document.getElementById('repairs-toggle-filters-btn');
    if (btn) btn.innerText = this.filtersPanelOpen ? '🔍 收合篩選' : '🔍 篩選';

    const emptyBtn = document.getElementById('repairs-empty-toggle-filters-btn');
    if (emptyBtn) emptyBtn.innerText = this.filtersPanelOpen ? '🔍 收合篩選' : '🔍 開啟篩選';
  }

  setFiltersPanelOpen(isOpen, opts) {
    const open = !!isOpen;
    this.filtersPanelOpen = open;

    const save = !(opts && opts.save === false);
    if (save) this.saveFiltersPanelOpen(open);

    const panel = document.getElementById('repairs-filters');
    if (panel) panel.style.display = open ? 'block' : 'none';

    // 同步按鈕文字與欄位值（即使收合也同步，避免下一次展開顯示舊值）
    try { this.updateFiltersToggleButton(); } catch (_) {}
    try { this.syncFiltersUI(); } catch (_) {}
  }

  toggleFiltersPanel() {
    this.setFiltersPanelOpen(!this.filtersPanelOpen);
  }

  refreshFiltersPanel() {
    const panel = document.getElementById('repairs-filters');
    if (!panel) return;
    panel.innerHTML = this.renderFilters();
    this.syncFiltersUI();
  }

  syncFiltersUI() {
    const f = (this.filters && typeof this.filters === 'object') ? this.filters : {};

    // keyword
    const keywordEl = document.getElementById('filter-keyword');
    const kw = (f.keyword || '').toString();
    if (keywordEl && keywordEl.value !== kw) keywordEl.value = kw;

    // status（history scope 不渲染）
    const statusEl = document.getElementById('filter-status');
    if (statusEl) {
      const v = Array.isArray(f.status) ? (f.status[0] || '') : (f.status || '');
      statusEl.value = v ? String(v) : '';
    }

    // priority
    const priorityEl = document.getElementById('filter-priority');
    if (priorityEl) {
      const v = Array.isArray(f.priority) ? (f.priority[0] || '') : (f.priority || '');
      priorityEl.value = v ? String(v) : '';
    }

    // owner（僅支援 me / all）
    const ownerEl = document.getElementById('filter-owner');
    if (ownerEl) {
      const uid = (window.AppState && typeof window.AppState.getUid === 'function')
        ? window.AppState.getUid()
        : (window.currentUser && window.currentUser.uid) ? window.currentUser.uid : '';
      ownerEl.value = (f.owner && uid && String(f.owner) === String(uid)) ? 'me' : '';
    }

    // date range（active: dateFrom/dateTo；history: completedFrom/completedTo）
    const dateFromEl = document.getElementById('filter-date-from');
    const dateToEl = document.getElementById('filter-date-to');

    if (this.scope === 'history') {
      if (dateFromEl) dateFromEl.value = (f.completedFrom || '').toString();
      if (dateToEl) dateToEl.value = (f.completedTo || '').toString();
    } else {
      if (dateFromEl) dateFromEl.value = (f.dateFrom || '').toString();
      if (dateToEl) dateToEl.value = (f.dateTo || '').toString();
    }

    // need parts
    const needPartsEl = document.getElementById('filter-need-parts');
    if (needPartsEl) {
      if (typeof f.needParts === 'boolean') {
        needPartsEl.value = f.needParts ? 'true' : 'false';
      } else {
        needPartsEl.value = '';
      }
    }
  }

  renderKeywordSearch() {
    const f = this.getEffectiveFilters() || {};
    const v = (f.keyword || '').toString();
    return `
      <div class="repairs-search" onclick="event.stopPropagation();">
        <input
          id="repairs-keyword"
          class="input repairs-keyword"
          type="search"
          placeholder="關鍵字：客戶 / SN / 問題 / 單號"
          value="${(v || '').replace(/"/g, '&quot;')}"
          oninput="RepairUI.handleKeywordInput(event)"
        />
        ${v ? `<button class="btn ghost sm" title="清除" onclick="RepairUI.clearKeyword()">✕</button>` : ''}
      </div>
    `;
  }

  applyScopeDefaults() {
    // scope 一律寫進 filters，讓 service/filter 同步一致
    this.filters = this.filters || {};
    this.filters.scope = this.scope;

    // 歷史：強制只看已完成 → 狀態 chips 不再具有意義，避免誤操作
    if (this.scope === 'history') {
      this.filters.status = [];
      this.sortBy = 'completedAt';
      this.sortOrder = 'desc';
    } else {
      if (this.sortBy === 'completedAt') this.sortBy = 'updatedAt';
    }
  }

  getEffectiveFilters() {
    const f = { ...(this.filters || {}) };
    f.scope = this.scope;

    // 歷史：強制忽略 status，並把日期篩選改為完成日期（completedFrom/completedTo）
    if (this.scope === 'history') {
      f.status = [];

      // 相容舊版：若曾使用 dateFrom/dateTo，視同 completedFrom/completedTo
      if (f.dateFrom && !f.completedFrom) f.completedFrom = f.dateFrom;
      if (f.dateTo && !f.completedTo) f.completedTo = f.dateTo;

      delete f.dateFrom;
      delete f.dateTo;
    } else {
      // 進行中：不套用完成日期篩選
      delete f.completedFrom;
      delete f.completedTo;
    }

    return f;
  }

  setScope(scope) {
    const s = (scope || '').toString();
    if (s !== 'active' && s !== 'history') return;
    this.scope = s;
    this.saveScope(s);
    this.applyScopeDefaults();

    // P3：scope 切換時同步更新篩選面板（欄位/標籤依 scope 變化）
    try { this.refreshFiltersPanel(); } catch (_) {}
    try { this.updateFiltersToggleButton(); } catch (_) {}

    this.updateList();
  }

  getScopeCounts() {
    try {
      const active = window.RepairService.search({ scope: 'active' }).length;
      const history = window.RepairService.search({ scope: 'history' }).length;
      return { active, history };
    } catch (_) {
      return { active: 0, history: 0 };
    }
  }

  renderScopeTabs() {
    const counts = this.getScopeCounts();
    const isActive = this.scope === 'active';
    const isHistory = this.scope === 'history';
    return `
      <div class="scope-tabs" aria-label="進行中/歷史切換">
        <button class="chip ${isActive ? 'active' : ''}" style="--chip-color:var(--color-primary);" onclick="event.stopPropagation(); RepairUI.setScope('active')">進行中 <span class="scope-count">${counts.active}</span></button>
        <button class="chip ${isHistory ? 'active' : ''}" style="--chip-color:var(--color-primary);" onclick="event.stopPropagation(); RepairUI.setScope('history')">歷史（已完成） <span class="scope-count">${counts.history}</span></button>
      </div>
    `;
  }

  getStatusChips() {
    const statuses = (window.AppConfig && window.AppConfig.business && window.AppConfig.business.repairStatus) ? window.AppConfig.business.repairStatus : [];
    const map = new Map();
    (statuses || []).forEach(s => {
      if (!s || !s.value) return;
      const key = String(s.value);
      if (!map.has(key)) map.set(key, { value: key, label: s.label || key, color: s.color || 'var(--color-primary)' });
    });

    // 依既定字典排序：進行中 / 需要零件 / 已完成
    const preferred = ['進行中', '需要零件', '已完成'];
    const ordered = [];
    preferred.forEach(k => { if (map.has(k)) { ordered.push(map.get(k)); map.delete(k); } });
    // 其餘狀態（若未來擴充）放後面
    for (const [, v] of map.entries()) ordered.push(v);

    return [
      { value: '', label: '全部', color: 'var(--color-text-secondary)' },
      ...ordered
    ];
  }

  renderStatusChips() {
    const selected = this.getSelectedStatus();
    const chips = this.getStatusChips();
    return `
      <div class="status-chips" aria-label="狀態快速篩選">
        ${chips.map(c => {
          const isActive = (c.value || '') === (selected || '');
          const enc = encodeURIComponent(c.value || '');
          const style = `--chip-color:${c.color};`;
          return `
            <button class="chip ${isActive ? 'active' : ''}" style="${style}" onclick="event.stopPropagation(); RepairUI.applyStatusChip('${enc}')">${c.label}</button>
          `;
        }).join('')}
      </div>
    `;
  }

  renderDensityToggle() {
    const mode = this.listDensity;
    return `
      <div class="density-toggle" aria-label="列表密度切換">
        <button class="chip ${mode === 'standard' ? 'active' : ''}" style="--chip-color:var(--color-primary);" onclick="event.stopPropagation(); RepairUI.setListDensity('standard')">標準</button>
        <button class="chip ${mode === 'compact' ? 'active' : ''}" style="--chip-color:var(--color-primary);" onclick="event.stopPropagation(); RepairUI.setListDensity('compact')">緊湊</button>
      </div>
    `;
  }
  
  /**
   * 渲染主介面
   */
  render(containerId) {
    const container = document.getElementById(containerId);
    if (!container) {
      console.error('Container not found:', containerId);
      return;
    }

    // P3-3：若使用者上次有選擇檢視，先套用（避免 scope/欄位 label 不一致）
    try { this._autoApplySavedViewIfNeeded(); } catch (_) {}
    
    container.innerHTML = `
      <div class="repairs-module ${this.listDensity === 'compact' ? 'density-compact' : 'density-standard'}">
        <!-- 頂部工具列 -->
        <div class="repairs-toolbar module-toolbar">
          <div class="module-toolbar-left">
            <div class="page-title">
              <h2>📋 維修管理</h2>
              <span class="muted" id="repairs-count">載入中...</span>
            </div>
          </div>
          
          <div class="module-toolbar-right">
            ${this.renderSavedViewsToolbar()}
            <button class="btn" id="repairs-toggle-filters-btn" onclick="RepairUI.toggleFilters()">
              ${this.filtersPanelOpen ? '🔍 收合篩選' : '🔍 篩選'}
            </button>
            <button class="btn" onclick="RepairUI.sync()">
              🔄 同步
            </button>
            <button class="btn primary" onclick="RepairUI.openForm()">
              ➕ 新增維修單
            </button>
          </div>
        </div>
        
        <!-- 篩選面板 -->
        <div id="repairs-filters" class="repairs-filters panel" style="display: ${this.filtersPanelOpen ? 'block' : 'none'};">
          ${this.renderFilters()}
        </div>
        
        <!-- 統計卡片 -->
        <div id="repairs-stats" class="repairs-stats">
          <div class="panel compact" style="padding:14px 16px; color: var(--color-text-secondary);">載入中...</div>
        </div>
        
        <!-- 主內容區 -->
        <div id="repairs-content" class="repairs-content">
          ${this.renderListShell([], { loading: true })}
        </div>
      </div>
      
      <!-- Modal 容器 -->
      <div id="repair-modal" class="modal" style="display: none;">
        <div class="modal-backdrop" onclick="RepairUI.closeModal()"></div>
        <div class="modal-content" id="repair-modal-content"></div>
      </div>
    `;
    
    // 預先載入客戶資料，確保「公司名稱」清單在維修表單中一致可用
    try {
      if (window.CustomerService && typeof window.CustomerService.init === 'function') {
        window.CustomerService.init().catch(e => console.warn('CustomerService init failed:', e));
      }
    } catch (e) {
      console.warn('CustomerService preload failed:', e);
    }

    // 綁定事件
    this.bindEvents();

    // 套用列表密度
    this.applyDensityClass(container.querySelector('.repairs-module'));

    // 篩選面板：套用開關狀態 + 同步欄位（P3）
    try { this.setFiltersPanelOpen(this.filtersPanelOpen, { save: false }); } catch (_) {}
    
    // 初次渲染（增量列表 + 統計/計數）
    this.updateList();
    
    console.log('✅ Repair UI rendered');
  }
  
  /**
   * 渲染篩選面板
   */
  renderFilters() {
    const statuses = AppConfig.business.repairStatus;
    // 防呆：避免狀態設定被重複注入造成 KPI 重複
    const seen = new Set();
    const uniqueStatuses = (statuses || []).filter(s => {
      const key = s && s.value ? String(s.value) : '';
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const priorities = AppConfig.business.priority;
    
    return `
      <div class="filters-grid">
        <div class="filter-group">
          <label class="filter-label">關鍵字搜尋</label>
          <input
            type="text"
            class="input"
            id="filter-keyword"
            placeholder="搜尋單號、序號、客戶、設備..."
            oninput="RepairUI.handleSearch(event)"
          />
        </div>
        
        ${this.scope === 'history' ? '' : `
          <div class="filter-group">
            <label class="filter-label">狀態</label>
            <select class="input" id="filter-status" onchange="RepairUI.applyFilters()">
              <option value="">全部</option>
              ${uniqueStatuses.map(s => `
                <option value="${s.value}">${s.label}</option>
              `).join('')}
            </select>
          </div>
        `}
        
        <div class="filter-group">
          <label class="filter-label">優先級</label>
          <select class="input" id="filter-priority" onchange="RepairUI.applyFilters()">
            <option value="">全部</option>
            ${priorities.map(p => `
              <option value="${p.value}">${p.label}</option>
            `).join('')}
          </select>
        </div>
        
        

        <div class="filter-group">
          <label class="filter-label">負責人</label>
          <select class="input" id="filter-owner" onchange="RepairUI.applyFilters()">
            <option value="">全部</option>
            <option value="me">只看我的</option>
          </select>
        </div>
        <div class="filter-group filter-date-range">
          <label class="filter-label">${this.scope === 'history' ? '完成日期範圍' : '維修日期範圍'}</label>
          <div class="date-range-row">
            <input
              type="date"
              class="input"
              id="filter-date-from"
              onchange="RepairUI.applyFilters()"
            />
            <span class="date-range-sep">至</span>
            <input
              type="date"
              class="input"
              id="filter-date-to"
              onchange="RepairUI.applyFilters()"
            />
          </div>
        </div>
        
        <div class="filter-group">
          <label class="filter-label">需要零件</label>
          <select class="input" id="filter-need-parts" onchange="RepairUI.applyFilters()">
            <option value="">全部</option>
            <option value="true">是</option>
            <option value="false">否</option>
          </select>
        </div>
        
        <div class="filter-group" style="align-self: flex-end;">
          <button class="btn" onclick="RepairUI.clearFilters()">
            清除篩選
          </button>
        </div>
      </div>
    `;
  }
  
  /**
   * 渲染統計卡片
   */
  renderStats(scopedOverride) {
    const scoped = Array.isArray(scopedOverride) ? scopedOverride : window.RepairService.search(this.getEffectiveFilters());
    const stats = window.RepairModel.getStats(scoped);
    const statuses = AppConfig.business.repairStatus;
    // 防呆：避免狀態設定被重複注入造成 KPI 重複
    const seen = new Set();
    const uniqueStatuses = (statuses || []).filter(s => {
      const key = s && s.value ? String(s.value) : '';
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    
    return `
      <div class="stats-grid">
        <div class="stat-card" style="--accent: var(--color-text-secondary);">
          <div class="stat-value">${stats.total}</div>
          <div class="stat-label">總計</div>
        </div>
        
        ${uniqueStatuses.map(status => `
          <div class="stat-card" style="--accent: ${status.color};">
            <div class="stat-value" style="color: ${status.color};">
              ${stats.byStatus[status.value] || 0}
            </div>
            <div class="stat-label">${status.label}</div>
          </div>
        `).join('')}
        
        <div class="stat-card" style="--accent: var(--color-secondary);">
          <div class="stat-value" style="color: var(--color-secondary);">
            ${stats.avgAge}
          </div>
          <div class="stat-label">平均處理天數</div>
        </div>
      </div>
    `;
  }
  
  /**
   * 渲染列表
   */
  renderList() {
    let repairs = window.RepairService.search(this.getEffectiveFilters());
    repairs = window.RepairModel.sort(repairs, this.sortBy, this.sortOrder);
    
    if (repairs.length === 0) {
      return this.renderEmptyState();
    }
    
    return `
      <div class="repairs-list">
        <div class="repairs-list-header panel compact">
          <div class="repairs-list-left">
            ${this.renderScopeTabs()}
            ${this.scope === 'active' ? this.renderStatusChips() : `
              <div class="muted">僅顯示「已完成」且未刪除的維修單；預設依完成時間由新到舊排序。</div>
              ${this.renderHistoryDatePresets()}
            `}
          </div>

          <div class="repairs-list-right">
            ${this.renderKeywordSearch()}
            <div class="repairs-list-sort">
              <label class="muted">排序：</label>
              <select class="input" id="sort-by" onchange="RepairUI.handleSort()" style="width: 150px;">
                <option value="updatedAt" ${this.sortBy === 'updatedAt' ? 'selected' : ''}>更新時間</option>
                <option value="createdAt" ${this.sortBy === 'createdAt' ? 'selected' : ''}>建立時間</option>
                <option value="completedAt" ${this.sortBy === 'completedAt' ? 'selected' : ''}>完成時間</option>
                <option value="customer" ${this.sortBy === 'customer' ? 'selected' : ''}>客戶名稱</option>
                <option value="status" ${this.sortBy === 'status' ? 'selected' : ''}>狀態</option>
                <option value="priority" ${this.sortBy === 'priority' ? 'selected' : ''}>優先級</option>
              </select>
              <button class="btn" onclick="RepairUI.toggleSortOrder()" title="切換順序">
                ${this.sortOrder === 'asc' ? '↑' : '↓'}
              </button>
            </div>
            ${this.renderDensityToggle()}
          </div>
        </div>
        
        <div class="repairs-cards">
          ${repairs.map(repair => this.renderRepairCard(repair)).join('')}
        </div>
      </div>
    `;
  }
  

  // ========================================
  // 增量渲染（列表卡片）
  // ========================================

  /**
   * 渲染列表殼（不含卡片內容）
   * - 由 updateList() 透過增量渲染填入卡片，避免一次性建構大量 DOM 造成卡頓
   */
  renderListShell(_repairs, options = {}) {
    const repairs = Array.isArray(_repairs) ? _repairs : [];
    const loading = !!options.loading;

    const pagination = options.pagination || null;
    const total = repairs.length;
    const visible = pagination ? Math.min(Number(pagination.visible || 0), total) : Math.min((this.visibleCount || this.pageSize || 60), total);
    const hasMore = pagination ? !!pagination.hasMore : (visible < total);

    return `
      <div class="repairs-list">
        <div class="repairs-list-header panel compact">
          <div class="repairs-list-left">
            ${this.renderScopeTabs()}
            ${this.scope === 'active' ? this.renderStatusChips() : `
              <div class="muted">僅顯示「已完成」且未刪除的維修單；預設依完成時間由新到舊排序。</div>
              ${this.renderHistoryDatePresets()}
            `}
          </div>

          <div class="repairs-list-right">
            ${this.renderKeywordSearch()}
            <div class="repairs-list-sort">
              <label class="muted">排序：</label>
              <select class="input" id="sort-by" onchange="RepairUI.handleSort()" style="width: 150px;">
                <option value="updatedAt" ${this.sortBy === 'updatedAt' ? 'selected' : ''}>更新時間</option>
                <option value="createdAt" ${this.sortBy === 'createdAt' ? 'selected' : ''}>建立時間</option>
                <option value="completedAt" ${this.sortBy === 'completedAt' ? 'selected' : ''}>完成時間</option>
                <option value="customer" ${this.sortBy === 'customer' ? 'selected' : ''}>客戶名稱</option>
                <option value="status" ${this.sortBy === 'status' ? 'selected' : ''}>狀態</option>
                <option value="priority" ${this.sortBy === 'priority' ? 'selected' : ''}>優先級</option>
              </select>
              <button class="btn" onclick="RepairUI.toggleSortOrder()" title="切換順序">
                ${this.sortOrder === 'asc' ? '↑' : '↓'}
              </button>
            </div>
            ${this.renderDensityToggle()}
          </div>
        </div>

        <div class="repairs-cards ${loading ? 'is-rendering' : ''}" id="repairs-cards" data-total="${repairs.length}">
          ${loading ? this.renderLoadingCards() : ''}
        </div>

        ${!loading && total > 0 ? this.renderListFooter({ visible, total, hasMore }) : ''}
      </div>
    `;
  }

  renderLoadingCards() {
    const isMobile = (window.AppConfig && window.AppConfig.device && typeof window.AppConfig.device.isMobile === 'function')
      ? window.AppConfig.device.isMobile()
      : (window.innerWidth <= 640);
    const n = isMobile ? 6 : 8;

    return Array.from({ length: n }).map(() => `
      <div class="repair-card-shell placeholder">
        <div class="repair-card-actions">
          <button class="btn ghost sm" disabled aria-hidden="true">✏️</button>
          <button class="btn ghost sm" disabled aria-hidden="true">🗑</button>
        </div>
        <div class="card repair-card placeholder">
          <div class="card-head">
            <div class="ph ph-line w-40"></div>
            <div class="ph ph-line w-70" style="margin-top:10px;"></div>
            <div class="ph ph-badges" style="margin-top:10px;"></div>
          </div>
          <div class="card-body">
            <div class="ph ph-line w-60"></div>
            <div class="ph ph-line w-90" style="margin-top:10px;"></div>
            <div class="ph ph-line w-80" style="margin-top:10px;"></div>
          </div>
          <div class="card-foot">
            <div class="ph ph-line w-80"></div>
            <div class="ph ph-line w-50"></div>
          </div>
        </div>
      </div>
    `).join('');
  }

  renderCardsIncrementally(repairs, cardsEl, token) {
    if (!cardsEl) return;

    const list = Array.isArray(repairs) ? repairs : [];
    const total = list.length;

    cardsEl.innerHTML = '';
    cardsEl.classList.add('is-rendering');

    const isMobile = (window.AppConfig && window.AppConfig.device && typeof window.AppConfig.device.isMobile === 'function')
      ? window.AppConfig.device.isMobile()
      : (window.innerWidth <= 640);

    const maxPerFrame = isMobile ? 10 : 18;
    const frameBudgetMs = isMobile ? 10 : 12;

    let i = 0;

    const step = () => {
      if (token !== this._renderToken) return;
      const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

      let html = '';
      let count = 0;

      while (i < total && count < maxPerFrame) {
        html += this.renderRepairCard(list[i]);
        i += 1;
        count += 1;

        const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        if ((now - t0) >= frameBudgetMs) break;
      }

      if (html) cardsEl.insertAdjacentHTML('beforeend', html);

      if (i < total) {
        requestAnimationFrame(step);
      } else {
        cardsEl.classList.remove('is-rendering');
      }
    };

    requestAnimationFrame(step);
  }

  /**
   * 合併短時間內多次資料變更（例如 init 時大量寫入/同步），避免重複整頁重繪
   */
  requestUpdateList() {
    if (this._updateScheduled) return;
    this._updateScheduled = true;
    requestAnimationFrame(() => {
      this._updateScheduled = false;
      try { this.updateList(); } catch (e) { console.warn('updateList failed:', e); }
    });
  }

  renderLinkageChips(repairId) {
    try {
      if (!window.LinkageHelper || typeof window.LinkageHelper.getForRepair !== 'function') return '';
      const s = window.LinkageHelper.getForRepair(repairId);

      const partsText = (s.parts && s.parts.total > 0)
        ? `${s.parts.primary.label} ${s.parts.primary.count}/${s.parts.total}`
        : '無';

      const quoteText = (s.quotes && s.quotes.total > 0)
        ? `${s.quotes.primary.label} ${s.quotes.primary.count}/${s.quotes.total}`
        : '未建立';

      const orderText = (s.orders && s.orders.total > 0)
        ? `${s.orders.primary.label} ${s.orders.primary.count}/${s.orders.total}`
        : '未建立';

      return `
        <div class="repair-linkage" onclick="event.stopPropagation();">
          <span class="chip quick static" style="--chip-color: var(--color-warning);">🧩 零件：${partsText}</span>
          <span class="chip quick static" style="--chip-color: var(--color-accent);">🧾 報價：${quoteText}</span>
          <span class="chip quick static" style="--chip-color: var(--color-secondary);">📦 訂單：${orderText}</span>
        </div>
      `;
    } catch (e) {
      console.warn('renderLinkageChips failed:', e);
      return '';
    }
  }

  /**
   * 渲染維修卡片（企業系統風：操作列外置）
   */
  renderRepairCard(repair) {
    const display = window.RepairModel.toDisplay(repair);
    const statusConfig = AppConfig.getStatusByValue(repair.status);
    const priorityConfig = AppConfig.business.priority.find(p => p.value === repair.priority);

    // HTML 安全：避免使用者輸入含尖括號/引號造成卡片 DOM 破壞或整頁事件失效
    const escapeHtml = (input) => {
      const s = (input === null || input === undefined) ? '' : String(input);
      return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    };

    const safeId = escapeHtml(repair.id);
    const safeCustomer = escapeHtml(repair.customer);
    const safeMachine = escapeHtml(repair.machine);
    const safeIssue = escapeHtml(repair.issue);
    const safeOwnerName = escapeHtml(repair.ownerName);
    const safeCreatedDate = escapeHtml((repair.createdDate || '').toString().trim() || (display.createdAtFormatted || '').slice(0, 10));
    const safeCompletedDate = escapeHtml((display.completedAtFormatted || '').toString().trim() || safeCreatedDate);

    return `
      <div class="repair-card-shell" data-repair-id="${safeId}">
        <div class="repair-card-actions" data-no-open="1">
          <button class="btn sm ghost" type="button" data-action="repair-edit" data-id="${safeId}">✏️ 編輯</button>
          <button class="btn sm danger" type="button" data-action="repair-delete" data-id="${safeId}">🗑 刪除</button>
        </div>

        <div class="repair-card card accent-left" style="--accent-opacity:.55" data-action="repair-open-detail" data-id="${safeId}">
          <div class="card-head">
            <div style="min-width:0;">
              <div class="repair-card-id">${safeId}</div>
              <div class="muted repair-card-sub">${safeCustomer}</div>
            </div>
            <div class="card-head-right repair-card-badges">
              ${repair.needParts ? '<span class="badge badge-warning">需零件</span>' : ''}
              <span class="badge custom" style="--badge-color:${priorityConfig.color};">${priorityConfig.label}</span>
            </div>
          </div>

          <div class="card-body">
            <div class="repair-card-machine">${safeMachine}</div>
            <div class="repair-card-issue">${safeIssue}</div>
            ${this.renderLinkageChips(repair.id)}
          </div>

          <div class="card-foot repair-card-foot">
            <div class="repair-card-status">
              <span class="badge custom" style="--badge-color:${statusConfig.color};">${statusConfig.label}</span>
              <div class="progress-bar" style="--bar-color:${statusConfig.color};">
                <div class="progress-fill" style="width: ${repair.progress}%;"></div>
              </div>
              <span class="progress-text">${repair.progress}%</span>
            </div>

            <div class="repair-card-meta">
              <span class="muted">👤 ${safeOwnerName}</span>
              ${this.scope === 'history'
                ? `<span class="muted">✅ 完成：${safeCompletedDate}</span>`
                : `<span class="muted">📅 ${safeCreatedDate}</span>`}
              ${display.ageInDays > 7 ? `<span class="badge badge-warning">${display.ageInDays} 天</span>` : ''}
              <a class="link" href="javascript:void(0)" data-action="repair-open-history" data-id="${safeId}">查看歷史</a>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  
  /**
   * 渲染空狀態
   */
  renderEmptyState() {
    const scopeTotal = (window.RepairService && typeof window.RepairService.search === 'function')
      ? window.RepairService.search({ scope: this.scope }).length
      : 0;

    // scope 不視為「額外篩選」；避免歷史模式永遠顯示「有篩選」
    const raw = this.getEffectiveFilters();
    const effectiveFilters = Object.entries(raw || {})
      .filter(([k, _]) => k !== 'scope')
      .filter(([_, v]) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0));
    const hasExtraFilters = effectiveFilters.length > 0;

    return `
      <div class="empty-state">
        <div class="empty-icon">📋</div>
        <div class="empty-title">沒有維修記錄</div>
        <div class="empty-text">
          ${hasExtraFilters
            ? `沒有符合篩選條件的記錄（此分頁共 ${scopeTotal} 筆），請調整或清除篩選條件。`
            : '開始建立第一筆維修記錄'}
        </div>

        <div style="display:flex; gap:10px; justify-content:center; flex-wrap:wrap; margin-top: 6px;">
          ${hasExtraFilters ? `
            <button class="btn" onclick="RepairUI.clearFilters()">🧹 清除篩選</button>
            <button class="btn" id="repairs-empty-toggle-filters-btn" onclick="RepairUI.toggleFilters()">${this.filtersPanelOpen ? '🔍 收合篩選' : '🔍 開啟篩選'}</button>
          ` : ''}
          <button class="btn primary" onclick="RepairUI.openForm()">➕ 新增維修單</button>
        </div>
      </div>
    `;
  }
  /**
   * 更新計數
   * @param {object=} meta 可傳入 { scopeTotal, filtered, rawFilters } 以避免重複 search
   */
  updateCount(meta) {
    const countEl = document.getElementById('repairs-count');
    if (!countEl) return;

    let scopeTotal = 0;
    let filtered = 0;
    let raw = null;

    try {
      if (meta && typeof meta === 'object') {
        scopeTotal = Number(meta.scopeTotal || 0);
        filtered = Number(meta.filtered || 0);
        raw = meta.rawFilters || null;
      } else {
        scopeTotal = window.RepairService.search({ scope: this.scope }).length;
        filtered = window.RepairService.search(this.getEffectiveFilters()).length;
        raw = this.getEffectiveFilters();
      }

      // 僅以 scope 為母集合；若使用者另外加了篩選條件，才顯示 x/y
      const effectiveFilters = Object.entries(raw || {})
        .filter(([k, _]) => k !== 'scope')
        .filter(([_, v]) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0));
      const hasExtraFilters = effectiveFilters.length > 0;

      if (hasExtraFilters && filtered !== scopeTotal) {
        countEl.textContent = `顯示 ${filtered} / ${scopeTotal} 筆`;
      } else {
        countEl.textContent = `共 ${scopeTotal} 筆`;
      }
    } catch (_) {
      // ignore
    }
  }

  /**
   * 更新統計
   */
  updateStats(scopedOverride) {
    const statsContainer = document.getElementById('repairs-stats');
    if (statsContainer) {
      statsContainer.innerHTML = this.renderStats(scopedOverride);
    }
  }
  
    /**
   * 更新列表（增量渲染）
   */
  updateList() {
    const contentContainer = document.getElementById('repairs-content');
    if (!contentContainer) return;

    const effective = this.getEffectiveFilters();

    // filters/sort 變更時，重置分頁顯示數量
    const qk = this._buildQueryKey(effective);
    if (qk !== this._lastQueryKey) {
      this._lastQueryKey = qk;
      this.visibleCount = this.pageSize || this.getDefaultPageSize();
    }

    let repairs = [];
    try {
      repairs = window.RepairService.search(effective) || [];
      repairs = window.RepairModel.sort(repairs, this.sortBy, this.sortOrder) || repairs;
    } catch (e) {
      console.warn('RepairUI.updateList search failed:', e);
      repairs = [];
    }

    const total = repairs.length;
    const visible = Math.min((this.visibleCount || this.pageSize || 60), total);
    const hasMore = visible < total;
    const visibleList = repairs.slice(0, visible);

    // 先更新主內容（殼 / 空狀態）
    if (!repairs || total === 0) {
      contentContainer.innerHTML = this.renderEmptyState();
      // 空狀態不需要渲染卡片
    } else {
      contentContainer.innerHTML = this.renderListShell(repairs, { loading: false, pagination: { visible, total, hasMore } });
      const cardsEl = document.getElementById('repairs-cards');
      const token = ++this._renderToken;
      this.renderCardsIncrementally(visibleList, cardsEl, token);
    }

    // 計數/統計：避免重複 search
    let scopeTotal = 0;
    try { scopeTotal = window.RepairService.search({ scope: this.scope }).length; } catch (_) { scopeTotal = 0; }

    this.updateCount({ scopeTotal, filtered: total, rawFilters: effective });
    this.updateStats(repairs);
  }

  /**
   * 綁定事件
   */
  bindEvents() {
    // 監聽資料變更
    window.RepairService.onChange((action, repair) => {
      try {
        console.log('Data changed:', action, repair?.id);
        this.requestUpdateList();
      } catch (err) {
        if (window.ErrorHandler && typeof window.ErrorHandler.handle === 'function') {
          window.ErrorHandler.handle(err, 'Repairs', 'MEDIUM', { action, repairId: repair?.id });
        } else {
          console.error(err);
        }
      }
    });
    
    // 監聽快捷鍵
    window.addEventListener('shortcut:new-repair', (window.guard ? window.guard(() => {
      this.openForm();
    }, 'Repairs') : (() => { this.openForm(); })));
    // P2-2：事件委派綁定（只綁一次）
    this.bindDelegatedClicks();
  }


  /**
   * 事件委派（P2-2）：避免在每張卡片/每個按鈕綁定 handler
   * 規則：
   * - 使用 data-action / data-id
   * - 非 open-detail 類動作一律 stopPropagation，避免誤觸卡片點擊
   */
  bindDelegatedClicks() {
    if (this._delegatedClickHandler) return;

    const delegatedHandler = async (e) => {
      const target = e.target;
      if (!target || !target.closest) return;

      const el = target.closest('[data-action]');
      if (!el) return;

      const action = el.getAttribute('data-action') || '';
      const id = el.getAttribute('data-id') || '';

      // 避免 a/button 預設行為
      if (el.tagName === 'A' || el.tagName === 'BUTTON') {
        e.preventDefault();
      }

      const stop = () => {
        try { e.stopPropagation(); } catch (_) {}
      };

      try {
        switch (action) {
          case 'repair-open-detail':
            // 允許冒泡，維持卡片點擊直覺
            if (window.RepairUI && typeof window.RepairUI.openDetail === 'function') {
              await window.RepairUI.openDetail(id);
            }
            return;

          case 'repair-edit':
            stop();
            if (window.RepairUI && typeof window.RepairUI.openForm === 'function') {
              await window.RepairUI.openForm(id);
            }
            return;

          case 'repair-delete':
            stop();
            if (window.RepairUI && typeof window.RepairUI.confirmDelete === 'function') {
              await window.RepairUI.confirmDelete(id);
            }
            return;

          case 'repair-open-history':
            stop();
            if (window.RepairUI && typeof window.RepairUI.openHistory === 'function') {
              await window.RepairUI.openHistory(id);
            }
            return;

          case 'quote-open-create':
            stop();
            if (window.repairUI && typeof window.repairUI.openOrCreateQuote === 'function') {
              await window.repairUI.openOrCreateQuote();
            }
            return;

          case 'order-open-create':
            stop();
            if (window.repairUI && typeof window.repairUI.openOrCreateOrder === 'function') {
              await window.repairUI.openOrCreateOrder();
            }
            return;

          default:
            return;
        }
      } catch (err) {
        if (window.ErrorHandler && typeof window.ErrorHandler.handle === 'function') {
          window.ErrorHandler.handle(err, 'Repairs', 'MEDIUM', { action, id });
        } else {
          console.error('Delegated click failed:', action, id, err);
        }
      }
    };

    this._delegatedClickHandler = (window.guard ? window.guard(delegatedHandler, 'Repairs') : delegatedHandler);

    // 綁在 document，避免列表/詳情 render 重建造成 handler 消失
    document.addEventListener('click', this._delegatedClickHandler);
  }


  /**
   * 確認並刪除維修單（軟刪除）
   * - 會將 isDeleted 標記為 true，並寫入 deletedAt/deletedBy
   * - 刪除後「進行中 / 歷史」列表都不再顯示
   */
  async confirmDelete(id) {
    const repairId = (id || '').toString().trim();
    if (!repairId) return;

    // 以較可判讀的資訊提示使用者
    const r = (window.RepairService && typeof window.RepairService.get === 'function')
      ? window.RepairService.get(repairId)
      : null;

    const title = (r && (r.repairNo || r.id)) ? (r.repairNo || r.id) : repairId;
    const customer = r ? (r.customer || '') : '';
    const machine = r ? (r.machine || '') : '';
    const hint = [customer, machine].filter(Boolean).join(' / ');
    const msg = `確定要刪除此維修單？

${title}${hint ? `
${hint}` : ''}

（軟刪除：不會出現在進行中/歷史列表，但仍保留於資料庫與變更紀錄）`;

    {
      const ok = (window.UI && typeof window.UI.confirm === 'function')
        ? await window.UI.confirm({ title: '確認刪除維修單', message: msg, okText: '刪除', cancelText: '取消', tone: 'danger' })
        : confirm(msg);
      if (!ok) return;
    }

    try {
      if (!window.RepairService || typeof window.RepairService.delete !== 'function') {
        throw new Error('RepairService 尚未就緒');
      }

      await window.RepairService.delete(repairId);

      // 若目前有開啟詳情/表單 modal，刪除後直接關閉避免殘留
      try {
        const modal = document.getElementById('repair-modal');
        const isOpen = modal && (modal.style.display === 'flex' || modal.style.display === 'block');
        if (isOpen) RepairUI.closeModal();
      } catch (_) {}

      this.currentRepair = null;
      this.currentView = 'list';

      // 主動刷新一次（雖然 onChange 也會刷新，但這裡確保 UI 立即同步）
      try { this.updateList(); } catch (_) {}

    } catch (error) {
      console.error('Repair delete error:', error);
      const msg = '刪除失敗：' + (error?.message || error);
      if (window.UI && typeof window.UI.toast === 'function') window.UI.toast(msg, { type: 'error' });
      else alert(msg);
    }
  }

  /**
   * 公司名稱選擇：更新聯絡人清單（datalist），不主動覆寫已填資料
   * （保底：避免 inline handler 觸發時因缺少方法而造成全站 Fatal）
   */
  handleCustomerPick(event) {
    try {
      const raw = (event && event.target ? event.target.value : '');
      const customerEl = (event && event.target) ? event.target : null;
      const company = (raw || '').toString().trim();

      const contactEl = this._getFormEl('contact');
      const phoneEl = this._getFormEl('phone');
      const emailEl = this._getFormEl('email');
      const datalist = document.getElementById('contact-list');

      const norm = (s) => (s || '').toString().trim().toLowerCase();

      const hasCompany = (name) => {
        const key = norm(name);
        if (!key || !window.CustomerService) return false;
        try {
          const all = (typeof window.CustomerService.getAll === 'function')
            ? window.CustomerService.getAll()
            : (Array.isArray(window.CustomerService.customers) ? window.CustomerService.customers : []);
          return (all || []).some(c => c && !c.isDeleted && norm(c.name) === key);
        } catch (_) {
          return false;
        }
      };

      const prevCompany = (this._lastCustomerCompany || '').toString().trim();
      const prevKey = norm(prevCompany);
      const newKey = norm(company);

      // 公司被清空：必須清除聯絡人/電話/Email 與 datalist，避免殘留上一次的資料
      if (!company) {
        try { if (customerEl) customerEl.dataset.companyPicked = '0'; } catch (_) {}
        if (contactEl) contactEl.value = '';
        if (phoneEl) phoneEl.value = '';
        if (emailEl) emailEl.value = '';
        if (datalist) datalist.innerHTML = '';
        // 清除上一個聯絡人的自動帶入記錄（避免後續聯絡人切換時誤判為可覆寫）
        this._lastPickedContactName = '';
        this._lastPickedContactPhone = '';
        this._lastPickedContactEmail = '';
        try { if (typeof this._closeContactDropdown === 'function') this._closeContactDropdown(true); } catch (_) {}
        this._lastCustomerCompany = '';
        this._lastCustomerCompanyValid = false;
        return;
      }

      // 公司變更（含 prevKey 尚未初始化的情況）：一律清空聯絡人/電話/Email，避免殘留上一家公司資料
      const hasPrevFilled = !!(
        (contactEl && String(contactEl.value || '').trim()) ||
        (phoneEl && String(phoneEl.value || '').trim()) ||
        (emailEl && String(emailEl.value || '').trim())
      );
      if (prevKey !== newKey && (prevKey || hasPrevFilled)) {
        if (contactEl) contactEl.value = '';
        if (phoneEl) phoneEl.value = '';
        if (emailEl) emailEl.value = '';

        // 公司變更：清除上一個聯絡人的自動帶入記錄
        this._lastPickedContactName = '';
        this._lastPickedContactPhone = '';
        this._lastPickedContactEmail = '';
        try { if (typeof this._closeContactDropdown === 'function') this._closeContactDropdown(true); } catch (_) {}
      }

      if (!window.CustomerService) {
        this._lastCustomerCompany = company;
        this._lastCustomerCompanyValid = false;
        try { if (customerEl) customerEl.dataset.companyPicked = '0'; } catch (_) {}
        return;
      }

      // 只有在「公司存在於客戶主檔」時，才刷新聯絡人清單；否則清空 datalist 避免誤導
      const isValidCompany = hasCompany(company);

      // 記錄：是否已「選定有效公司」（用於公司下拉行為判斷：避免必須先刪除才看得到完整清單）
      try { if (customerEl) customerEl.dataset.companyPicked = isValidCompany ? '1' : '0'; } catch (_) {}

      const contacts = (isValidCompany && typeof window.CustomerService.getContactsByCompanyName === 'function')
        ? window.CustomerService.getContactsByCompanyName(company)
        : [];

      // 更新聯絡人 datalist
      if (datalist) {
        const names = Array.from(new Set((contacts || []).map(c => (c.contact || '').toString().trim()).filter(Boolean)));
        datalist.innerHTML = names.map(n => {
          const safe = (n || '').toString().replace(/"/g, '&quot;');
          return safe ? `<option value="${safe}"></option>` : '';
        }).join('');
      }

      // 自動帶入：優先使用「最近一次維修單」的聯絡人；否則用客戶主檔最新一筆聯絡人
      const nonEmptyContacts = (contacts || []).filter(c => (c.contact || "").toString().trim());
      if (isValidCompany && contactEl && !contactEl.value && nonEmptyContacts.length >= 1) {
        let chosen = null;

        // 1) 最近一次維修單（同公司）有聯絡人者
        try {
          if (window.RepairService && typeof window.RepairService.getAll === "function") {
            const all = window.RepairService.getAll() || [];
            const ckey = norm(company);
            const toTs = (r) => {
              const a = r && (r.updatedAt || r.createdAt || r.createdDate || "");
              const t = Date.parse(String(a));
              return Number.isFinite(t) ? t : 0;
            };
            const recent = [...all].filter(r => r && !r.isDeleted && norm(r.customer) === ckey && (r.contact || r.phone || r.email))
              .sort((a, b) => toTs(b) - toTs(a))[0];
            const recentName = (recent && recent.contact ? String(recent.contact).trim() : "");
            if (recentName) {
              chosen = nonEmptyContacts.find(c => norm(c.contact) === norm(recentName)) || null;
            }
          }
        } catch (_) {}

        // 2) fallback：客戶主檔最新一筆（getContactsByCompanyName 已是最新在前）
        if (!chosen) chosen = nonEmptyContacts[0] || null;

        if (chosen) {
          contactEl.value = (chosen.contact || "").toString();
          // 公司自動帶入：若欄位是空的才寫入（不覆寫手動輸入）
          if (phoneEl && !phoneEl.value) phoneEl.value = chosen.phone || "";
          if (emailEl && !emailEl.value) emailEl.value = chosen.email || "";

          // 記住這次帶入的聯絡人資訊，供「使用者改選聯絡人」時判斷是否可覆寫
          this._lastPickedContactName = (chosen.contact || "").toString().trim();
          this._lastPickedContactPhone = (chosen.phone || "").toString();
          this._lastPickedContactEmail = (chosen.email || "").toString();
        }
      }

      this._lastCustomerCompany = company;
      this._lastCustomerCompanyValid = !!isValidCompany;
    } catch (e) {
      console.warn('handleCustomerPick failed:', e);
    }
  }

  /**
   * 聯絡人選擇：自動帶入電話/Email（不覆寫已填資料）
   */
  handleContactPick(event) {
    try {
      const contactName = (event && event.target ? event.target.value : '').trim();
      if (!contactName) return;
      if (!window.CustomerService) return;

      const companyEl = document.querySelector('#repair-form input[name="customer"]');
      const company = (companyEl && companyEl.value ? companyEl.value : '').trim();
      if (!company) return;

      const phoneEl = document.querySelector('#repair-form input[name="phone"]');
      const emailEl = document.querySelector('#repair-form input[name="email"]');

      const match = (typeof window.CustomerService.findContact === 'function')
        ? window.CustomerService.findContact(company, contactName)
        : null;

      if (!match) return;

      // 使用者改選聯絡人時：
      // - 若 phone/email 為空 → 直接帶入
      // - 若 phone/email 等於「上一個聯絡人自動帶入值」→ 視為未手動修改，可覆寫
      // - 若使用者已手動改過 phone/email → 不覆寫
      const prevName = (this._lastPickedContactName || '').toString().trim();
      const prevPhone = (this._lastPickedContactPhone || '').toString();
      const prevEmail = (this._lastPickedContactEmail || '').toString();

      const canSetPhone = !!(phoneEl && (!phoneEl.value || (prevName && phoneEl.value === prevPhone)));
      const canSetEmail = !!(emailEl && (!emailEl.value || (prevName && emailEl.value === prevEmail)));

      if (canSetPhone) phoneEl.value = match.phone || '';
      if (canSetEmail) emailEl.value = match.email || '';

      // 更新「最近一次選取聯絡人」記錄（用於判斷後續是否可覆寫）
      this._lastPickedContactName = contactName;
      this._lastPickedContactPhone = (match.phone || '').toString();
      this._lastPickedContactEmail = (match.email || '').toString();
    } catch (e) {
      console.warn('handleContactPick failed:', e);
    }
  }

  // ========================================
  // 公司下拉（自訂）
  // - 解決：公司欄位要換公司時，必須先手動刪除再選取的操作成本
  // - 保留：仍可直接輸入 + datalist 快速匹配
  // ========================================

  _closeCompanyDropdown(silent) {
    try {
      const el = this._companyDropdownEl;
      if (el && el.parentNode) el.parentNode.removeChild(el);
      this._companyDropdownEl = null;

      try { if (this._companyDropdownAC && typeof this._companyDropdownAC.abort === 'function') this._companyDropdownAC.abort(); } catch (_) {}
      this._companyDropdownAC = null;

      if (this._companyDropdownScrollHandler) {
        window.removeEventListener('scroll', this._companyDropdownScrollHandler, true);
        window.removeEventListener('resize', this._companyDropdownScrollHandler, true);
        this._companyDropdownScrollHandler = null;
      }
      if (this._companyDropdownOutsideHandler) {
        document.removeEventListener('mousedown', this._companyDropdownOutsideHandler, true);
        this._companyDropdownOutsideHandler = null;
      }
      if (this._companyDropdownKeyHandler) {
        document.removeEventListener('keydown', this._companyDropdownKeyHandler, true);
        this._companyDropdownKeyHandler = null;
      }
    } catch (e) {
      if (!silent) console.warn('_closeCompanyDropdown failed:', e);
    }
  }

  async toggleCompanyDropdown(event) {
    try {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }

      // 先關閉其他下拉（避免兩個同時開啟造成遮擋/誤判）
      try { if (this._contactDropdownEl) this._closeContactDropdown(true); } catch (_) {}

      // 已開啟 → 關閉
      if (this._companyDropdownEl) {
        this._closeCompanyDropdown(true);
        return;
      }

      const customerEl = this._getFormEl('customer');
      if (!customerEl) return;

      if (!window.CustomerService) return;

      // 取得公司清單（去重）
      let all = [];
      try {
        all = (typeof window.CustomerService.getAll === 'function')
          ? (window.CustomerService.getAll() || [])
          : (Array.isArray(window.CustomerService.customers) ? window.CustomerService.customers : []);
      } catch (_) {
        all = [];
      }

      const seen = new Set();
      const names = [];
      for (const c of (all || [])) {
        const name = (c && !c.isDeleted ? (c.name || '') : '').toString().trim();
        if (!name) continue;
        const key = name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        names.push(name);
      }

      if (!names.length) return;

      let q = (customerEl.value || '').toString().trim().toLowerCase();
      const picked = (customerEl.dataset && customerEl.dataset.companyPicked === '1');
      if (picked) q = '';
      // 若目前欄位值已是「完整公司名」（精確匹配），視同已選定公司：下拉預設改顯示完整清單
      const exact = q && names.some(n => n.toLowerCase() === q);
      if (exact) q = '';
      let list = names;

      // 排序策略
      if (q) {
        // 有輸入：先過濾，再讓「開頭匹配」排前面
        list = names
          .filter(n => n.toLowerCase().includes(q))
          .sort((a, b) => {
            const aa = a.toLowerCase();
            const bb = b.toLowerCase();
            const as = aa.startsWith(q) ? 0 : 1;
            const bs = bb.startsWith(q) ? 0 : 1;
            if (as !== bs) return as - bs;
            return aa.localeCompare(bb, 'zh-Hant');
          });
      } else {
        // 無輸入：釘選優先，其餘依字母排序
        let settings = null;
        try { settings = await this.getSettingsSafe(); } catch (_) { settings = null; }
        const pinned = Array.isArray(settings?.pinnedCompanies) ? settings.pinnedCompanies : [];
        const pinnedKeys = new Set(pinned.map(x => String(x || '').toLowerCase()));

        const pinnedOrdered = [];
        for (const p of pinned) {
          const name = (p || '').toString().trim();
          if (!name) continue;
          const key = name.toLowerCase();
          if (!seen.has(key)) continue; // 不在客戶主檔就不顯示
          pinnedOrdered.push(name);
        }

        const rest = names
          .filter(n => !pinnedKeys.has(n.toLowerCase()))
          .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase(), 'zh-Hant'));

        list = [...pinnedOrdered, ...rest];
      }

      // 避免清單過長造成操作困難
      list = list.slice(0, 80);
      if (!list.length) return;

      const rect = customerEl.getBoundingClientRect();
      const dd = document.createElement('div');
      dd.className = 'rt-company-dd';
      dd.style.left = `${Math.max(8, rect.left)}px`;
      dd.style.width = `${Math.max(260, rect.width)}px`;

      const spaceBelow = window.innerHeight - rect.bottom;
      const preferHeight = Math.min(320, list.length * 42 + 16);
      if (spaceBelow < 180 && rect.top > 220) {
        const top = Math.max(8, rect.top - preferHeight - 8);
        dd.style.top = `${top}px`;
      } else {
        dd.style.top = `${Math.min(window.innerHeight - 8, rect.bottom + 6)}px`;
      }

      dd.innerHTML = list.map(name => {
        const safeText = this.escapeBasic(name);
        const safeAttr = this.escapeBasic(name);
        return `<div class="rt-company-item" data-name="${safeAttr}">${safeText}</div>`;
      }).join('');

      dd.addEventListener('click', (e) => {
        try {
          const item = e.target && e.target.closest ? e.target.closest('.rt-company-item') : null;
          if (!item) return;
          const name = (item.getAttribute('data-name') || '').toString();
          if (!name) return;
          // 套用公司（並自動刷新聯絡人/電話/Email）
          this.applyCompanyToForm(name);
          // 觸發 change：讓既有的監聽（例如序號提示）保持一致
          try { customerEl.dispatchEvent(new Event('change', { bubbles: true })); } catch (_) {}
          this._closeCompanyDropdown(true);
          try { customerEl.focus(); } catch (_) {}
        } catch (_) {
          this._closeCompanyDropdown(true);
        }
      });

      document.body.appendChild(dd);
      this._companyDropdownEl = dd;

      // CodeOpt：用 AbortController 管理 window/document 事件，避免重複綁定殘留
      try { if (this._companyDropdownAC && typeof this._companyDropdownAC.abort === 'function') this._companyDropdownAC.abort(); } catch (_) {}
      this._companyDropdownAC = (window.EventUtils && typeof window.EventUtils.createController === 'function')
        ? window.EventUtils.createController()
        : null;

      const onDD = (el, evt, fn, opts) => {
        try {
          if (window.EventUtils && typeof window.EventUtils.on === 'function') {
            window.EventUtils.on(el, evt, fn, opts, this._companyDropdownAC);
          } else if (el) {
            el.addEventListener(evt, fn, opts || false);
          }
        } catch (_) {
          try { el && el.addEventListener(evt, fn, opts || false); } catch (_) {}
        }
      };

      this._companyDropdownScrollHandler = () => {
        try { this._closeCompanyDropdown(true); } catch (_) {}
      };
      onDD(window, 'scroll', this._companyDropdownScrollHandler, { capture: true, passive: true });
      onDD(window, 'resize', this._companyDropdownScrollHandler, { capture: true, passive: true });

      this._companyDropdownOutsideHandler = (e) => {
        try {
          const t = e && e.target ? e.target : null;
          const btn = t && t.closest ? t.closest('.input-dropdown-btn[data-dd="company"]') : null;
          const inside = (this._companyDropdownEl && this._companyDropdownEl.contains(t)) || btn;
          if (!inside) this._closeCompanyDropdown(true);
        } catch (_) {
          this._closeCompanyDropdown(true);
        }
      };
      onDD(document, 'mousedown', this._companyDropdownOutsideHandler, { capture: true });

      this._companyDropdownKeyHandler = (e) => {
        if (e && e.key === 'Escape') this._closeCompanyDropdown(true);
      };
      onDD(document, 'keydown', this._companyDropdownKeyHandler, { capture: true });

    } catch (e) {
      console.warn('toggleCompanyDropdown failed:', e);
      try { this._closeCompanyDropdown(true); } catch (_) {}
    }
  }

  static toggleCompanyDropdown(event) {
    try {
      const instance = window.repairUI;
      if (!instance || typeof instance.toggleCompanyDropdown !== 'function') return;
      return instance.toggleCompanyDropdown(event);
    } catch (e) {
      console.warn('RepairUI.toggleCompanyDropdown wrapper failed:', e);
    }
  }

  // ========================================
  // 聯絡人下拉（自訂）
  // ========================================

  _closeContactDropdown(silent) {
    try {
      const el = this._contactDropdownEl;
      if (el && el.parentNode) el.parentNode.removeChild(el);
      this._contactDropdownEl = null;

      try { if (this._contactDropdownAC && typeof this._contactDropdownAC.abort === 'function') this._contactDropdownAC.abort(); } catch (_) {}
      this._contactDropdownAC = null;

      // 清理：滾動/縮放監聽（避免下拉選單「卡住」在畫面上）
      if (this._contactDropdownScrollHandler) {
        window.removeEventListener('scroll', this._contactDropdownScrollHandler, true);
        window.removeEventListener('resize', this._contactDropdownScrollHandler, true);
        this._contactDropdownScrollHandler = null;
      }

      if (this._contactDropdownOutsideHandler) {
        document.removeEventListener('mousedown', this._contactDropdownOutsideHandler, true);
        this._contactDropdownOutsideHandler = null;
      }
      if (this._contactDropdownKeyHandler) {
        document.removeEventListener('keydown', this._contactDropdownKeyHandler, true);
        this._contactDropdownKeyHandler = null;
      }
    } catch (e) {
      if (!silent) console.warn('_closeContactDropdown failed:', e);
    }
  }

  toggleContactDropdown(event) {
    try {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }

      // 先關閉公司下拉（避免同時開啟造成遮擋/誤判）
      try { if (this._companyDropdownEl) this._closeCompanyDropdown(true); } catch (_) {}

      // 已開啟 → 關閉
      if (this._contactDropdownEl) {
        this._closeContactDropdown(true);
        return;
      }

      const contactEl = this._getFormEl('contact');
      const companyEl = this._getFormEl('customer');
      if (!contactEl || !companyEl) return;

      const company = (companyEl.value || '').toString().trim();
      if (!company) return;
      if (!window.CustomerService || typeof window.CustomerService.getContactsByCompanyName !== 'function') return;

      const raw = window.CustomerService.getContactsByCompanyName(company) || [];
      const list = (raw || [])
        .filter(c => c && (c.contact || '').toString().trim())
        .map(c => ({
          contact: (c.contact || '').toString().trim(),
          phone: (c.phone || '').toString().trim(),
          email: (c.email || '').toString().trim()
        }));

      if (list.length <= 0) return;

      // 去重：同 contact 若電話/Email 不同，仍保留第一筆（避免清單爆長）
      const seen = new Set();
      const uniq = [];
      for (const it of list) {
        const key = it.contact.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        uniq.push(it);
      }

      const rect = contactEl.getBoundingClientRect();
      const dd = document.createElement('div');
      dd.className = 'rt-contact-dd';
      dd.style.left = `${Math.max(8, rect.left)}px`;
      dd.style.width = `${Math.max(220, rect.width)}px`;

      // 盡量往下展開；若下方空間不足則往上
      const spaceBelow = window.innerHeight - rect.bottom;
      const preferHeight = Math.min(260, uniq.length * 54 + 16);
      if (spaceBelow < 160 && rect.top > 200) {
        const top = Math.max(8, rect.top - preferHeight - 8);
        dd.style.top = `${top}px`;
      } else {
        dd.style.top = `${Math.min(window.innerHeight - 8, rect.bottom + 6)}px`;
      }

      dd.innerHTML = uniq.map(it => {
        const safeName = (it.contact || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const meta = [it.phone, it.email].filter(Boolean).join(' / ');
        const safeMeta = meta.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const dataName = (it.contact || '').replace(/"/g, '&quot;');
        const dataPhone = (it.phone || '').replace(/"/g, '&quot;');
        const dataEmail = (it.email || '').replace(/"/g, '&quot;');
        return `
          <div class="rt-contact-item" data-name="${dataName}" data-phone="${dataPhone}" data-email="${dataEmail}">
            <div class="name">${safeName}</div>
            ${safeMeta ? `<div class="meta">${safeMeta}</div>` : ''}
          </div>
        `;
      }).join('');

      // 使用 click：允許清單滾動（pointerdown 會在觸控滑動時誤判為點選，造成「卡住/無法滑動」）
      dd.addEventListener('click', (e) => {
        try {
          const item = e.target && e.target.closest ? e.target.closest('.rt-contact-item') : null;
          if (!item) return;
          const name = (item.getAttribute('data-name') || '').toString();
          if (!name) return;
          contactEl.value = name;
          // 以同一套邏輯帶入 phone/email（允許覆寫先前的自動帶入值）
          this.handleContactPick({ target: { value: name } });
          this._closeContactDropdown(true);
          try { contactEl.focus(); } catch (_) {}
        } catch (_) {
          this._closeContactDropdown(true);
        }
      });

      document.body.appendChild(dd);
      this._contactDropdownEl = dd;

      // CodeOpt：用 AbortController 管理 window/document 事件，避免重複綁定殘留
      try { if (this._contactDropdownAC && typeof this._contactDropdownAC.abort === 'function') this._contactDropdownAC.abort(); } catch (_) {}
      this._contactDropdownAC = (window.EventUtils && typeof window.EventUtils.createController === 'function')
        ? window.EventUtils.createController()
        : null;

      const onDDContact = (el, evt, fn, opts) => {
        try {
          if (window.EventUtils && typeof window.EventUtils.on === 'function') {
            window.EventUtils.on(el, evt, fn, opts, this._contactDropdownAC);
          } else if (el) {
            el.addEventListener(evt, fn, opts || false);
          }
        } catch (_) {
          try { el && el.addEventListener(evt, fn, opts || false); } catch (_) {}
        }
      };

      // 任何滾動/縮放時關閉（下拉選單使用 position:fixed，避免表單捲動後選單位置不對而像「卡住」）
      this._contactDropdownScrollHandler = () => {
        try { this._closeContactDropdown(true); } catch (_) {}
      };
      onDDContact(window, 'scroll', this._contactDropdownScrollHandler, { capture: true, passive: true });
      onDDContact(window, 'resize', this._contactDropdownScrollHandler, { capture: true, passive: true });

      // 點擊外部關閉
      this._contactDropdownOutsideHandler = (e) => {
        try {
          const t = e && e.target ? e.target : null;
          const btn = t && t.closest ? t.closest('.input-dropdown-btn[data-dd="contact"]') : null;
          const inside = (this._contactDropdownEl && (this._contactDropdownEl.contains(t))) || btn;
          if (!inside) this._closeContactDropdown(true);
        } catch (_) {
          this._closeContactDropdown(true);
        }
      };
      onDDContact(document, 'mousedown', this._contactDropdownOutsideHandler, { capture: true });

      this._contactDropdownKeyHandler = (e) => {
        if (e && e.key === 'Escape') this._closeContactDropdown(true);
      };
      onDDContact(document, 'keydown', this._contactDropdownKeyHandler, { capture: true });

    } catch (e) {
      console.warn('toggleContactDropdown failed:', e);
      try { this._closeContactDropdown(true); } catch (_) {}
    }
  }

  /**
   * Static wrapper：供 UI 內 inline onclick 使用（RepairUI.toggleContactDropdown）。
   * 本專案採用 RepairUI(class) + repairUI(instance) 並存；
   * 因此所有 inline onclick 必須走 static wrapper 才能呼叫 instance method。
   */
  static toggleContactDropdown(event) {
    try {
      const instance = window.repairUI;
      if (!instance || typeof instance.toggleContactDropdown !== 'function') return;
      return instance.toggleContactDropdown(event);
    } catch (e) {
      console.warn('RepairUI.toggleContactDropdown wrapper failed:', e);
    }
  }

  /**
   * 表單後處理：載入「常用公司/最近使用」、綁定釘選與歷史帶入
   */
  async afterRenderForm() {
    // event binding (avoid duplicate)
    // CodeOpt：以 AbortController 管理表單事件，避免重複綁定與殘留
    try { if (this._formAC && typeof this._formAC.abort === 'function') this._formAC.abort(); } catch (_) {}
    this._formAC = (window.EventUtils && typeof window.EventUtils.createController === 'function')
      ? window.EventUtils.createController()
      : null;

    const onForm = (el, evt, fn, opts) => {
      try {
        if (window.EventUtils && typeof window.EventUtils.on === 'function') {
          window.EventUtils.on(el, evt, fn, opts, this._formAC);
        } else if (el) {
          el.addEventListener(evt, fn, opts || false);
        }
      } catch (_) {
        try { el && el.addEventListener(evt, fn, opts || false); } catch (_) {}
      }
    };

    const pinBtn = document.getElementById('btn-pin-company');
    const histBtn = document.getElementById('btn-history-company');
    const customerEl = document.querySelector('#repair-form input[name="customer"]');

    // baseline：記住當前公司（用於「公司變更」時清空並重新帶入聯絡人資料）
    try {
      const cur = (customerEl?.value || '').toString().trim();
      this._lastCustomerCompany = cur;
      // 是否存在於客戶主檔（避免使用者輸入中途字串被誤判）
      if (window.CustomerService) {
        const norm = (s) => (s || '').toString().trim().toLowerCase();
        const key = norm(cur);
        const all = (typeof window.CustomerService.getAll === 'function')
          ? window.CustomerService.getAll()
          : (Array.isArray(window.CustomerService.customers) ? window.CustomerService.customers : []);
        this._lastCustomerCompanyValid = !!(key && (all || []).some(c => c && !c.isDeleted && norm(c.name) === key));
      } else {
        this._lastCustomerCompanyValid = false;
      }
    } catch (_) {
      this._lastCustomerCompany = (customerEl?.value || '').toString().trim();
      this._lastCustomerCompanyValid = false;
    }

    if (pinBtn && !pinBtn.dataset.bound) {
      pinBtn.dataset.bound = '1';
      const onPin = async () => {
        const company = (customerEl?.value || '').toString().trim();
        if (!company) return;
        await this.togglePinnedCompany(company);
      };
      onForm(pinBtn, 'click', (window.guard ? window.guard(onPin, 'RepairsForm') : onPin));
    }

    if (histBtn && !histBtn.dataset.bound) {
      histBtn.dataset.bound = '1';
      const onHist = () => { this.openHistoryPicker(); };
      onForm(histBtn, 'click', (window.guard ? window.guard(onHist, 'RepairsForm') : onHist));
    }

    if (customerEl && !customerEl.dataset.boundQuick) {
      customerEl.dataset.boundQuick = '1';
      onForm(customerEl, 'input', () => {
        this.refreshPinButtonState();
        // 使用 debounce：避免每次鍵入都重算聯絡人清單
        try {
          if (this._customerPickTimer) clearTimeout(this._customerPickTimer);
          this._customerPickTimer = setTimeout(() => {
            try { this.handleCustomerPick({ target: customerEl }); } catch (_) {}
          }, 120);
        } catch (_) {}
        try { if (typeof this.updateSerialHints === 'function') this.updateSerialHints(); } catch (_) {}
      });
      onForm(customerEl, 'change', () => {
        this.refreshPinButtonState();
        // 變更（含 datalist 選取）時立即刷新聯絡人清單並帶入
        try { this.handleCustomerPick({ target: customerEl }); } catch (_) {}
        try { if (typeof this.updateSerialHints === 'function') this.updateSerialHints(); } catch (_) {}
      });

      // P0：公司已選定時，點一下輸入框即可開啟清單（免先刪除）
      onForm(customerEl, 'click', () => {
        try {
          const v = (customerEl.value || '').toString().trim();
          const picked = (customerEl.dataset && customerEl.dataset.companyPicked === '1');
          if (!v || !picked) return;
          // 若清單已開啟則不重複開（避免閃爍）
          if (this._companyDropdownEl) return;
          setTimeout(() => { try { this.toggleCompanyDropdown(); } catch (_) {} }, 0);
        } catch (_) {}
      });

      // P0：鍵盤快速開啟公司清單（F4 / Alt+↓）
      onForm(customerEl, 'keydown', (e) => {
        try {
          if (!e) return;
          const k = e.key;
          if (k === 'F4' || (k === 'ArrowDown' && e.altKey)) {
            e.preventDefault();
            this.toggleCompanyDropdown();
          }
        } catch (_) {}
      });
    }

    // chips (pinned / recent)
    try {
      await this.refreshCompanyQuickPicks({ force: true });
    } catch (e) {
      console.warn('refreshCompanyQuickPicks failed:', e);
      const pinnedEl = document.getElementById('pinned-company-chips');
      if (pinnedEl) pinnedEl.innerHTML = `<span class="muted">載入失敗</span>`;
      const recentEl = document.getElementById('recent-company-chips');
      if (recentEl && !recentEl.innerHTML) recentEl.innerHTML = `<span class="muted">載入失敗</span>`;
    }
    this.refreshPinButtonState();

    // 模板下拉（V161.127）：必須在表單初次 render 後立即綁定
    // 避免必須先觸發「公司名稱 input」才會填入模板選項。
    try {
      if (typeof this.bindTemplatePicker === 'function') this.bindTemplatePicker();
    } catch (_) {}

    // 設備產品線/機型級聯選擇（若 forms 模組有提供則初始化）
    try {
      if (typeof this.initEquipmentPicker === 'function') this.initEquipmentPicker();
    } catch (e) {
      console.warn('initEquipmentPicker failed in afterRenderForm:', e);
    }

    // P0：若為「複製」流程，帶入來源欄位（需在設備選擇器初始化後）
    try {
      if (typeof this._applyDuplicatePrefill === 'function') this._applyDuplicatePrefill();
    } catch (e) {
      console.warn('_applyDuplicatePrefill failed in afterRenderForm:', e);
    }

    // 序號提示 chips click（同公司+同機型 最近序號）
    const serialChipsEl = document.getElementById('serial-suggest-chips');
    if (serialChipsEl && !serialChipsEl.dataset.bound) {
      serialChipsEl.dataset.bound = '1';
      onForm(serialChipsEl, 'click', (e) => {
        const btn = e.target?.closest?.('button[data-serial]');
        if (!btn) return;
        const serial = (btn.getAttribute('data-serial') || '').toString();
        const serialInput = document.querySelector('#repair-form input[name="serialNumber"]');
        if (serialInput) {
          serialInput.value = serial;
          try { serialInput.dispatchEvent(new Event('input', { bubbles: true })); } catch (_) {}
        }
      });
    }

    try { if (typeof this.updateSerialHints === 'function') this.updateSerialHints(); } catch (_) {}

    // P3：必填欄位即時驗證提示（不新增 required，只針對既有 required 欄位）
    try {
      const form = document.getElementById('repair-form');
      if (form && window.FormValidate) {
        window.FormValidate.bindForm(form);
        window.FormValidate.resetForm(form);
      }
    } catch (e) {
      console.warn('FormValidate bind failed:', e);
    }
  }

  /**
   * 取得設定（含保底）
   */
  async getSettingsSafe() {
    try {
      if (window.SettingsService && typeof window.SettingsService.getSettings === 'function') {
        const s = await window.SettingsService.getSettings();
        return s || (window.SettingsModel ? window.SettingsModel.defaultSettings() : {});
      }
    } catch (e) {
      console.warn('getSettingsSafe failed:', e);
    }
    return (window.SettingsModel ? window.SettingsModel.defaultSettings() : {});
  }

  /**
   * 序號提示：同公司 + 同機型 最近序號（可點選快速帶入）
   */
  updateSerialHints() {
    try {
      const wrap = document.getElementById('serial-suggest');
      const chipsEl = document.getElementById('serial-suggest-chips');
      if (!wrap || !chipsEl) return;

      const customer = (document.querySelector('#repair-form input[name="customer"]')?.value || '').toString().trim();
      const machine = (document.getElementById('machine-final')?.value || '').toString().trim();
      const excludeId = (document.querySelector('#repair-form input[name="id"]')?.value || '').toString().trim();

      if (!customer || !machine || !window.RepairService) {
        wrap.style.display = 'none';
        chipsEl.innerHTML = '';
        return;
      }

      let serials = [];
      if (typeof window.RepairService.getRecentSerialNumbers === 'function') {
        serials = window.RepairService.getRecentSerialNumbers({ customer, machine, excludeId, limit: 6 }) || [];
      } else if (typeof window.RepairService.getAll === 'function') {
        // fallback：使用 getAll() 篩選（較慢，但保底）
        const all = window.RepairService.getAll() || [];
        const toEpoch = (window.TimeUtils && typeof window.TimeUtils.toEpoch === "function")
          ? ((v, fb = 0) => window.TimeUtils.toEpoch(v, fb))
          : ((v, fb = 0) => { const t = Date.parse(String(v ?? "")); return Number.isFinite(t) ? t : fb; });

        const toTime = (r) => {
          const s = (r && (r.updatedAt || r.createdAt)) ? String(r.updatedAt || r.createdAt) : '';
          const t1 = toEpoch(s, 0);
          if (t1) return t1;
          const d = (r && r.createdDate) ? String(r.createdDate) : "";
          const t2 = toEpoch(d ? `${d}T00:00:00+08:00` : "", 0);
          return t2;

        };
        const c = customer.toLowerCase();
        const m = machine.toLowerCase();
        const filtered = all.filter(r => {
          if (!r) return false;
          if (excludeId && String(r.id || '') === excludeId) return false;
          if (String(r.customer || '').trim().toLowerCase() !== c) return false;
          if (String(r.machine || '').trim().toLowerCase() !== m) return false;
          return !!String(r.serialNumber || '').trim();
        }).sort((a, b) => toTime(b) - toTime(a));
        const seen = new Set();
        for (const r of filtered) {
          const sn = String(r.serialNumber || '').trim();
          const key = sn.toLowerCase();
          if (!sn || seen.has(key)) continue;
          seen.add(key);
          serials.push(sn);
          if (serials.length >= 6) break;
        }
      }

      if (!Array.isArray(serials) || serials.length === 0) {
        wrap.style.display = 'none';
        chipsEl.innerHTML = '';
        return;
      }

      wrap.style.display = '';
      chipsEl.innerHTML = serials.map(sn => {
        const safe = this.escapeBasic(sn);
        return `<button type="button" class="chip quick" data-serial="${safe}" title="套用序號">${safe}</button>`;
      }).join('');
    } catch (e) {
      console.warn('updateSerialHints failed:', e);
    }
  }


  escapeBasic(input) {
    return (input ?? '').toString()
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * 刷新：常用公司 / 最近使用 Chips
   */
  async refreshCompanyQuickPicks(opts = {}) {
    const pinnedEl = document.getElementById('pinned-company-chips');
    const recentEl = document.getElementById('recent-company-chips');
    if (!pinnedEl && !recentEl) return;

    // 先給使用者立即回饋（避免停在空白或永遠顯示舊狀態）
    if (pinnedEl) pinnedEl.innerHTML = `<span class="muted">載入中...</span>`;
    if (recentEl) recentEl.innerHTML = `<span class="muted">載入中...</span>`;

    let settings;
    try {
      settings = await this.getSettingsSafe();
    } catch (e) {
      console.warn('getSettingsSafe failed in refreshCompanyQuickPicks:', e);
      settings = (window.SettingsModel ? window.SettingsModel.defaultSettings() : {});
    }
    const topN = Number(settings.pinnedTopN || 8);
    const pinned = Array.isArray(settings.pinnedCompanies) ? settings.pinnedCompanies.slice(0, Math.max(1, Math.min(12, topN))) : [];

    const pinnedKeys = new Set((pinned || []).map(x => String(x || '').toLowerCase()));

    // pinned
    if (pinnedEl) {
      if (!pinned.length) {
        pinnedEl.innerHTML = `<span class="muted">尚未設定</span>`;
      } else {
        pinnedEl.innerHTML = pinned.map(name => {
          const safe = this.escapeBasic(name);
          return `<button type="button" class="chip quick" data-company="${safe}" title="套用公司">${safe}</button>`;
        }).join('');
      }

      if (!pinnedEl.dataset.bound) {
        pinnedEl.dataset.bound = '1';
        pinnedEl.addEventListener('click', (e) => {
          const btn = e.target?.closest?.('button[data-company]');
          if (!btn) return;
          const company = (btn.getAttribute('data-company') || '').toString();
          this.applyCompanyToForm(company);
        });
      }
    }

    // recent (unique, exclude pinned)
    if (recentEl) {
      const limit = Number(settings.recentCompaniesLimit ?? 8);
      const recentCompanies = this.getRecentCompanies(Math.max(0, Math.min(20, limit)), pinnedKeys);

      if (!recentCompanies.length) {
        recentEl.innerHTML = `<span class="muted">尚無近期紀錄</span>`;
      } else {
        recentEl.innerHTML = recentCompanies.map(name => {
          const safe = this.escapeBasic(name);
          return `<button type="button" class="chip quick" data-company="${safe}" title="套用公司">${safe}</button>`;
        }).join('');
      }

      if (!recentEl.dataset.bound) {
        recentEl.dataset.bound = '1';
        recentEl.addEventListener('click', (e) => {
          const btn = e.target?.closest?.('button[data-company]');
          if (!btn) return;
          const company = (btn.getAttribute('data-company') || '').toString();
          this.applyCompanyToForm(company);
        });
      }
    }
  }

  getRecentCompanies(limit, pinnedKeys) {
    try {
      if (!window.RepairService || typeof window.RepairService.getAll !== 'function') return [];
      const list = window.RepairService.getAll() || [];
      const toTs = (x) => {
        const t = new Date(x || 0).getTime();
        return Number.isFinite(t) ? t : 0;
      };
      const sorted = [...list].sort((a, b) => {
        const ta = Math.max(toTs(a.updatedAt), toTs(a.createdAt));
        const tb = Math.max(toTs(b.updatedAt), toTs(b.createdAt));
        return tb - ta;
      });

      const seen = new Set();
      const out = [];
      for (const r of sorted) {
        const name = (r.customer || '').toString().trim();
        if (!name) continue;
        const key = name.toLowerCase();
        if (pinnedKeys && pinnedKeys.has(key)) continue;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(name);
        if (out.length >= limit) break;
      }
      return out;
    } catch (e) {
      console.warn('getRecentCompanies failed:', e);
      return [];
    }
  }

  /**
   * 套用公司到表單 + 更新聯絡人清單
   */
  applyCompanyToForm(company) {
    const customerEl = document.querySelector('#repair-form input[name="customer"]');
    if (!customerEl) return;
    customerEl.value = (company || '').toString().trim();
    // 同步更新聯絡人 datalist
    this.handleCustomerPick({ target: customerEl });
    this.refreshPinButtonState();
  }

  /**
   * 刷新釘選按鈕狀態
   */
  async refreshPinButtonState() {
    const btn = document.getElementById('btn-pin-company');
    const customerEl = document.querySelector('#repair-form input[name="customer"]');
    if (!btn || !customerEl) return;

    const company = (customerEl.value || '').toString().trim();
    if (!company) {
      btn.textContent = '釘選';
      btn.classList.remove('primary');
      return;
    }

    const settings = await this.getSettingsSafe();
    const arr = Array.isArray(settings.pinnedCompanies) ? settings.pinnedCompanies : [];
    const key = company.toLowerCase();
    const pinned = arr.some(x => String(x || '').toLowerCase() === key);

    btn.textContent = pinned ? '已釘選' : '釘選';
    btn.classList.toggle('primary', pinned);
  }

  /**
   * 釘選 / 取消釘選（以公司名稱為主）
   */
  async togglePinnedCompany(company) {
    if (!company) return;
    if (!window.SettingsService || typeof window.SettingsService.getSettings !== 'function') return;

    const settings = await this.getSettingsSafe();
    const arr = Array.isArray(settings.pinnedCompanies) ? [...settings.pinnedCompanies] : [];
    const key = company.toLowerCase();
    const idx = arr.findIndex(x => String(x || '').toLowerCase() === key);

    if (idx >= 0) {
      arr.splice(idx, 1);
    } else {
      // 新釘選放最前面，提高優先順序
      arr.unshift(company);
    }

    await window.SettingsService.update({
      pinnedTopN: settings.pinnedTopN || 8,
      pinnedCompanies: arr
    });

    // refresh ui
    await this.refreshCompanyQuickPicks();
    await this.refreshPinButtonState();
  }

  /**
   * 歷史帶入：顯示該公司最近維修單，快速帶入聯絡資訊/設備資訊
   */
  async openHistoryPicker() {
    const customerEl = document.querySelector('#repair-form input[name="customer"]');
    const company = (customerEl?.value || '').toString().trim();
    if (!company) {
      const msg = '請先輸入公司名稱';
      if (window.UI && typeof window.UI.toast === 'function') window.UI.toast(msg, { type: 'warning' });
      else alert(msg);
      return;
    }
    if (!window.RepairService || typeof window.RepairService.getAll !== 'function') {
      const msg = 'RepairService 尚未就緒';
      if (window.UI && typeof window.UI.toast === 'function') window.UI.toast(msg, { type: 'error' });
      else alert(msg);
      return;
    }

    // build list
    const all = window.RepairService.getAll() || [];
    const toTs = (x) => {
      const t = new Date(x || 0).getTime();
      return Number.isFinite(t) ? t : 0;
    };
    const list = all
      .filter(r => (r.customer || '').toString().trim().toLowerCase() === company.toLowerCase())
      .sort((a, b) => Math.max(toTs(b.updatedAt), toTs(b.createdAt)) - Math.max(toTs(a.updatedAt), toTs(a.createdAt)))
      .slice(0, 30);

    const esc = (s) => this.escapeBasic(s);

    const modalId = 'history-picker-modal';
    // ensure single
    const existing = document.getElementById(modalId);
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = modalId;
    modal.className = 'modal';
    modal.style.display = 'flex';
    modal.style.zIndex = '1200';

    const itemsHtml = list.length ? list.map(r => {
      const title = `${r.repairNo || r.id || ''}`.trim();
      const machine = (r.machine || '').toString().trim();
      const contact = (r.contact || '').toString().trim();
      const meta = [
        machine ? `設備：${machine}` : '',
        contact ? `聯絡人：${contact}` : '',
        r.status ? `狀態：${r.status}` : ''
      ].filter(Boolean).join('　');
      const dateStr = r.createdAt ? new Date(r.createdAt).toLocaleDateString('zh-TW') : '';
      return `
        <div class="list-item">
          <div class="left">
            <div class="title">${esc(title)} <span class="tag">${esc(dateStr)}</span></div>
            <div class="meta">${esc(meta || '—')}</div>
          </div>
          <div class="right">
            <button type="button" class="btn sm primary" data-act="apply" data-id="${esc(r.id)}">帶入</button>
          </div>
        </div>
      `;
    }).join('') : `<div class="muted">找不到該公司歷史維修單</div>`;

    modal.innerHTML = `
      <div class="modal-backdrop"></div>
      <div class="modal-content modal-wide">
        <div class="modal-header">
          <div style="min-width:0;">
            <div class="modal-title">歷史帶入：${esc(company)}</div>
            <div class="muted" style="margin-top:4px;">點選「帶入」將套用聯絡資訊與設備資訊（不會覆寫問題描述/工作內容）</div>
          </div>
          <button type="button" class="btn ghost" data-act="close">關閉</button>
        </div>

        <div class="modal-body">
          <div class="settings-row" style="gap:8px;">
            <input class="input" id="history-picker-search" placeholder="搜尋（設備/聯絡人/單號）" />
            <button type="button" class="btn ghost" data-act="clear">清除</button>
          </div>

          <div class="list history-picker-list" id="history-picker-list">
            ${itemsHtml}
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const close = () => {
      const el = document.getElementById(modalId);
      if (el) el.remove();
    };

    modal.querySelector('.modal-backdrop')?.addEventListener('click', close);
    modal.querySelector('button[data-act="close"]')?.addEventListener('click', close);

    const listEl = modal.querySelector('#history-picker-list');
    const searchEl = modal.querySelector('#history-picker-search');
    const clearBtn = modal.querySelector('button[data-act="clear"]');

    const renderFiltered = (keyword) => {
      const kw = (keyword || '').toString().trim().toLowerCase();
      const filtered = !kw ? list : list.filter(r => {
        const blob = `${r.repairNo||''} ${r.machine||''} ${r.contact||''} ${r.email||''} ${r.phone||''}`.toLowerCase();
        return blob.includes(kw);
      });
      if (!listEl) return;
      if (!filtered.length) {
        listEl.innerHTML = `<div class="muted">沒有符合的歷史資料</div>`;
        return;
      }
      listEl.innerHTML = filtered.map(r => {
        const title = `${r.repairNo || r.id || ''}`.trim();
        const machine = (r.machine || '').toString().trim();
        const contact = (r.contact || '').toString().trim();
        const meta = [
          machine ? `設備：${machine}` : '',
          contact ? `聯絡人：${contact}` : '',
          r.status ? `狀態：${r.status}` : ''
        ].filter(Boolean).join('　');
        const dateStr = r.createdAt ? new Date(r.createdAt).toLocaleDateString('zh-TW') : '';
        return `
          <div class="list-item">
            <div class="left">
              <div class="title">${esc(title)} <span class="tag">${esc(dateStr)}</span></div>
              <div class="meta">${esc(meta || '—')}</div>
            </div>
            <div class="right">
              <button type="button" class="btn sm primary" data-act="apply" data-id="${esc(r.id)}">帶入</button>
            </div>
          </div>
        `;
      }).join('');
    };

    if (searchEl) {
      searchEl.addEventListener('input', () => {
        renderFiltered(searchEl.value);
      });
    }
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (searchEl) searchEl.value = '';
        renderFiltered('');
      });
    }

    if (listEl) {
      const onApply = async (e) => {
        const btn = e.target?.closest?.('button[data-act="apply"]');
        if (!btn) return;
        const id = btn.getAttribute('data-id');
        await this.applyHistoryToForm(id);
        close();
      };
      listEl.addEventListener('click', (window.guard ? window.guard(onApply, 'RepairsHistory') : onApply));
    }
  }

  /**
   * 將歷史資料套用到表單（聯絡資訊/設備資訊）
   * 規則：不跳確認，永遠直接覆寫（包含空值也會覆寫）
   * 僅覆寫聯絡/設備欄位，不影響問題描述/工作內容。
   */
  async applyHistoryToForm(repairId) {
    const r = window.RepairService?.get?.(repairId);
    if (!r) return;

    const form = document.getElementById('repair-form');
    if (!form) return;

    const norm = (v) => (v == null ? '' : String(v));

    const machineVal = norm(r.machine).toString().trim();

    const inferProductLine = (machineName) => {
      try {
        const name = (machineName || '').toString().trim();
        if (!name) return '';
        const catalog = (window.AppConfig && typeof window.AppConfig.getMachineCatalog === 'function')
          ? window.AppConfig.getMachineCatalog()
          : ((window.AppConfig && window.AppConfig.business && window.AppConfig.business.machineCatalog)
            ? window.AppConfig.business.machineCatalog
            : {});
        for (const [line, models] of Object.entries(catalog || {})) {
          if (Array.isArray(models) && models.includes(name)) return line;
        }
      } catch (_) {}
      return '';
    };

    const productLineVal = norm(r.productLine).toString().trim() || inferProductLine(machineVal);

    const fields = [
      ['contact', r.contact],
      ['phone', r.phone],
      ['email', r.email],
      ['serialNumber', r.serialNumber]
    ];

    for (const [name, value] of fields) {
      const el = (window.DomUtils && typeof window.DomUtils.byName === 'function')
        ? window.DomUtils.byName(form, name)
        : form.querySelector(`[name="${name}"]`);
      if (!el) continue;
      el.value = norm(value);
    }

    // 產品線 / 設備：同步到顯示用欄位（select / manual）與最終 machine 值
    const plEl = document.getElementById('product-line')
      || ((window.DomUtils && window.DomUtils.byName) ? window.DomUtils.byName(form, 'productLine') : form.querySelector('[name="productLine"]'));
    if (plEl) plEl.value = productLineVal;

    const machineEl = document.getElementById('machine-final')
      || ((window.DomUtils && window.DomUtils.byName) ? window.DomUtils.byName(form, 'machine') : form.querySelector('[name="machine"]'));
    if (machineEl) machineEl.value = machineVal;

    try {
      if (typeof this._syncEquipmentPickerState === 'function') {
        this._syncEquipmentPickerState({ productLine: productLineVal, currentMachine: machineVal });
      }
    } catch (e) {
      console.warn('applyHistoryToForm: sync equipment picker failed:', e);
    }

    try { if (typeof this.updateSerialHints === 'function') this.updateSerialHints(); } catch (_) {}


    // 同步更新聯絡人清單（若有選公司）
    const customerEl = (window.DomUtils && window.DomUtils.byName)
      ? window.DomUtils.byName(form, 'customer')
      : form.querySelector('[name="customer"]');
    if (customerEl && customerEl.value) {
      this.handleCustomerPick({ target: customerEl });
    }
  }

  /**
   * Static wrappers for inline handlers
   */
  static handleCustomerPick(event) {
    const instance = window.repairUI;
    if (instance && typeof instance.handleCustomerPick === 'function') {
      instance.handleCustomerPick(event);
      instance.refreshPinButtonState?.();
    }
  }

  static handleContactPick(event) {
    const instance = window.repairUI;
    if (instance && typeof instance.handleContactPick === 'function') {
      instance.handleContactPick(event);
    }
  }



  // === 互動方法（由 HTML onclick 呼叫）===
  
  /**
   * 切換篩選面板
   */
  static toggleFilters() {
    const instance = window.repairUI;
    if (instance && typeof instance.toggleFiltersPanel === 'function') {
      instance.toggleFiltersPanel();
      return;
    }

    // fallback（保相容）
    const panel = document.getElementById('repairs-filters');
    if (panel) {
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    }
  }

  // ========================================
  // Saved Views（自訂檢視）
  // ========================================

  static applySavedView(viewId) {
    const instance = window.repairUI;
    if (!instance || typeof instance.applySavedViewById !== 'function') return;
    instance.applySavedViewById(viewId);
  }

  static saveCurrentView() {
    const instance = window.repairUI;
    if (!instance || typeof instance.saveCurrentViewInteractive !== 'function') return;
    instance.saveCurrentViewInteractive();
  }

  static manageViews() {
    const instance = window.repairUI;
    if (!instance || typeof instance.manageSavedViews !== 'function') return;
    instance.manageSavedViews();
  }
  
  /**
   * 處理搜尋（防抖）
   */
  static handleSearch(event) {
    const instance = window.repairUI;
    const keyword = event.target.value.trim();
    
    // 清除之前的計時器
    if (instance.searchDebounce) {
      clearTimeout(instance.searchDebounce);
    }
    
    // 設定新的計時器
    instance.searchDebounce = setTimeout(() => {
      if (!instance.filters) instance.filters = {};
      if (keyword) instance.filters.keyword = keyword;
      else delete instance.filters.keyword;
      instance.updateList();
    }, 300);
  }
  
  /**
   * 套用篩選
   */
  static applyFilters() {
    const instance = window.repairUI;
    
    // 收集篩選條件
    const filters = {};
    
    const keyword = document.getElementById('filter-keyword')?.value.trim();
    if (keyword) filters.keyword = keyword;
    
    const status = document.getElementById('filter-status')?.value;
    if (status) filters.status = [status];
    
    const priority = document.getElementById('filter-priority')?.value;
    if (priority) filters.priority = [priority];
    
    
    const owner = document.getElementById('filter-owner')?.value;
    if (owner === 'me') filters.owner = (window.AppState?.getUid?.() || window.currentUser?.uid || '');
    const dateFrom = document.getElementById('filter-date-from')?.value;
    if (dateFrom) {
      if (instance.scope === 'history') filters.completedFrom = dateFrom;
      else filters.dateFrom = dateFrom;
    }

    const dateTo = document.getElementById('filter-date-to')?.value;
    if (dateTo) {
      if (instance.scope === 'history') filters.completedTo = dateTo;
      else filters.dateTo = dateTo;
    }
    
    const needParts = document.getElementById('filter-need-parts')?.value;
    if (needParts) filters.needParts = needParts === 'true';
    
    instance.filters = filters;
    instance.updateList();
  }

  /**
   * 狀態 Chips：快速套用/清除狀態篩選
   */
  static applyStatusChip(encodedValue) {
    const instance = window.repairUI;
    const value = decodeURIComponent(encodedValue || '');

    if (!instance.filters) instance.filters = {};
    if (value) {
      instance.filters.status = [value];
    } else {
      delete instance.filters.status;
    }

    // 同步篩選面板（即使面板收起來也要保持一致）
    const sel = document.getElementById('filter-status');
    if (sel) sel.value = value;

    instance.updateList();
  }

  /**
   * 完成日期快速範圍（歷史模式）
   */
  static applyHistoryDatePreset(key) {
    const instance = window.repairUI;
    if (!instance || typeof instance.applyHistoryDatePreset !== 'function') return;
    instance.applyHistoryDatePreset(key);
  }

  /**
   * 分頁：顯示更多
   */
  static loadMore() {
    const instance = window.repairUI;
    if (!instance || typeof instance.loadMore !== 'function') return;
    instance.loadMore();
  }

  /**
   * scope 切換：active / history
   */
  static setScope(scope) {
    const instance = window.repairUI;
    if (!instance || typeof instance.setScope !== 'function') return;
    instance.setScope(scope);
  }

  /**
   * 列表密度切換：標準 / 緊湊
   */
  static setListDensity(mode) {
    const instance = window.repairUI;
    const m = (mode === 'compact') ? 'compact' : 'standard';
    instance.listDensity = m;
    instance.saveListDensity(m);
    instance.applyDensityClass();
    instance.updateList();
  }
  
  /**
   * 清除篩選
   */
    static clearFilters() {
    const instance = window.repairUI;

    // 清除表單（篩選面板可能收起，但元素仍在 DOM；仍做防呆）
    [
      'filter-keyword',
      'filter-status',
      'filter-priority',
      'filter-owner',
      'filter-date-from',
      'filter-date-to',
      'filter-need-parts'
    ].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });

    // 清除篩選條件
    instance.filters = {};
    // 保留 scope 由 getEffectiveFilters 注入，但 keyword 偏好需要同步清除
    try { instance.saveKeyword(''); } catch (_) {}
    instance.updateList();
  }

  // ========================================
  // 關鍵字搜尋（列表）
  // ========================================

  static handleKeywordInput(event) {
    const instance = window.repairUI;
    const el = event?.target;
    const v = (el?.value || '').toString();

    // debounce：避免每個按鍵都觸發重算/重渲染
    if (instance._kwDebounce) {
      try { clearTimeout(instance._kwDebounce); } catch (_) {}
    }

    instance._kwDebounce = setTimeout(() => {
      const kw = v.trim();
      instance.filters = instance.filters || {};
      if (kw) instance.filters.keyword = kw;
      else delete instance.filters.keyword;
      instance.saveKeyword(kw);

      // 關鍵字變更時回到第一頁
      instance.visibleCount = instance.pageSize;
      instance.updateList();
    }, 180);
  }

  static clearKeyword() {
    const instance = window.repairUI;
    instance.filters = instance.filters || {};
    delete instance.filters.keyword;
    try { instance.saveKeyword(''); } catch (_) {}
    const el = document.getElementById('repairs-keyword');
    if (el) el.value = '';
    instance.visibleCount = instance.pageSize;
    instance.updateList();
  }

  
  /**
   * 處理排序
   */
  static handleSort() {
    const instance = window.repairUI;
    const sortBy = document.getElementById('sort-by')?.value;
    
    if (sortBy) {
      instance.sortBy = sortBy;
      instance.updateList();
    }
  }
  
  /**
   * 切換排序順序
   */
  static toggleSortOrder() {
    const instance = window.repairUI;
    instance.sortOrder = instance.sortOrder === 'asc' ? 'desc' : 'asc';
    instance.updateList();
  }
  
  /**
   * 同步資料
   */
  static async sync() {
    try {
      const btn = event.target;
      btn.disabled = true;
      btn.textContent = '🔄 同步中...';
      
      await window.RepairService.sync();
      
      const instance = window.repairUI;
      instance.updateList();
      
      btn.textContent = '✅ 同步完成';
      setTimeout(() => {
        btn.disabled = false;
        btn.textContent = '🔄 同步';
      }, 2000);
      
    } catch (error) {
      console.error('Sync error:', error);
      {
        const msg = '同步失敗：' + (error?.message || error);
        if (window.UI && typeof window.UI.toast === 'function') window.UI.toast(msg, { type: 'error' });
        else alert(msg);
      }
    }
  }
  
  // === Modal 方法 ===

  /**
   * 同步「維修詳情/歷史」視窗大小。
   *
   * 背景：renderDetail() 內部可能用 .modal-dialog 搭配 modal-wide / modal-large 等尺寸類別，
   * 但外層 #repair-modal-content 仍是預設寬度，會造成視窗大小看起來不一致。
   *
   * 作法：偵測內容內第一個 .modal-dialog 的尺寸 class，複製到外層 content。
   */
  static _syncModalSize(contentEl) {
    if (!contentEl) return;
    const sizeClasses = ['modal-wide', 'modal-large', 'modal-xlarge'];

    // 先清掉舊的尺寸（避免上一次殘留）
    try { contentEl.classList.remove(...sizeClasses); } catch (_) {}

    const dialog = contentEl.querySelector?.('.modal-dialog');
    if (!dialog) return;

    const hit = sizeClasses.find(c => dialog.classList.contains(c));
    if (hit) {
      try { contentEl.classList.add(hit); } catch (_) {}
    }
  }
  
  /**
   * 開啟新增表單
   */
  static async openForm(repairId = null) {
    const instance = window.repairUI;
    instance.currentRepair = repairId ? window.RepairService.get(repairId) : null;

    const modal = document.getElementById('repair-modal');
    const content = document.getElementById('repair-modal-content');

    if (!(modal && content)) return;

    // 避免從「詳情/歷史（較寬）」切回表單時，尺寸 class 殘留
    try { content.classList.remove('modal-wide', 'modal-large', 'modal-xlarge'); } catch (_) {}

    // 先打開 modal（避免使用者感覺「沒反應」）
    modal.style.display = 'flex';

    // 每次開啟表單都要強制回到頂部，避免上一次在 modal 內捲動的位置被沿用
    // （使用者要求：滑桿/狀態區必須在最上方，開啟新增/編輯時要直接看到）
    const resetModalScroll = () => {
      try { content && (content.scrollTop = 0); } catch (_) {}
      try { modal && (modal.scrollTop = 0); } catch (_) {}
    };
    resetModalScroll();
    content.innerHTML = `
      <div class="modal-dialog">
        <div class="modal-header">
          <h3>${repairId ? '編輯維修單' : '新增維修單'}</h3>
          <button class="modal-close" onclick="RepairUI.closeModal()">✕</button>
        </div>
        <div class="modal-body">
          <div class="muted">載入中...</div>
        </div>
      </div>
    `;

    // 確保 CustomerService 已初始化，避免「公司名稱」清單偶發空白
    try {
      if (window.CustomerService && typeof window.CustomerService.init === 'function') {
        await window.CustomerService.init();
      }
    } catch (e) {
      console.warn('CustomerService init skipped:', e);
    }

    // 初始化 Settings（提供「常用公司 Top N / 最近使用 / 歷史帶入」）
    try {
      if (window.SettingsService && typeof window.SettingsService.init === 'function' && !window.SettingsService.isInitialized) {
        await window.SettingsService.init();
      }
    } catch (e) {
      console.warn('SettingsService init skipped:', e);
    }

    // 初始化 RepairTemplatesService（避免模板下拉初次載入為空）
    try {
      if (window.Utils && typeof window.Utils.ensureServiceReady === 'function') {
        await window.Utils.ensureServiceReady('RepairTemplatesService');
      } else if (window.RepairTemplatesService && typeof window.RepairTemplatesService.init === 'function' && !window.RepairTemplatesService.ready) {
        await window.RepairTemplatesService.init();
      }
    } catch (e) {
      console.warn('RepairTemplatesService init skipped:', e);
    }

    // 重繪表單
    content.innerHTML = instance.renderForm();
    // 表單預設使用標準寬度；仍同步一次以確保沒有殘留尺寸
    RepairUI._syncModalSize(content);

    // 若表單內容本身宣告尺寸（未來擴充），同步到外層
    RepairUI._syncModalSize(content);

    // 再次保險：render 後與下一個 frame 都重置一次（避免瀏覽器因 focus/重排而跳到中段）
    resetModalScroll();
    requestAnimationFrame(resetModalScroll);

    // 表單後處理（快速選 / 歷史帶入等）
    try {
      if (typeof instance.afterRenderForm === 'function') {
        await instance.afterRenderForm();
      }
    } catch (e) {
      console.warn('afterRenderForm failed:', e);
    }

    // afterRenderForm 可能會更新 chips/DOM，最後再確保維持在頂部
    resetModalScroll();
  }
  
  /**
   * 詳情 → 📄 複製：複製成新維修單（開啟新增表單並帶入必要欄位）
   */
  static async duplicateRepair(repairId) {
    try {
      const instance = window.repairUI;
      if (!instance || typeof instance.duplicateRepair !== 'function') return;
      await instance.duplicateRepair(repairId);
    } catch (e) {
      console.warn('RepairUI.duplicateRepair wrapper failed:', e);
      const msg = '複製失敗';
      if (window.UI && typeof window.UI.toast === 'function') window.UI.toast(msg, { type: 'error' });
      else alert(msg);
    }
  }

  /**
   * 開啟詳情
   */
  
static openDetail(repairId) {
    const instance = window.repairUI;
    instance.currentRepair = window.RepairService.get(repairId);
    
    if (!instance.currentRepair) {
      {
        const msg = '找不到維修記錄';
        if (window.UI && typeof window.UI.toast === 'function') window.UI.toast(msg, { type: 'warning' });
        else alert(msg);
      }
      return;
    }
    
    const modal = document.getElementById('repair-modal');
    const content = document.getElementById('repair-modal-content');
    
    if (modal && content) {
      content.innerHTML = instance.renderDetail();
      RepairUI._syncModalSize(content);
      modal.style.display = 'flex';

      // 避免沿用前一次捲動位置
      try { content.scrollTop = 0; } catch (_) {}
      try { modal.scrollTop = 0; } catch (_) {}

      // 延後載入：零件追蹤摘要
      setTimeout(() => {
        RepairUI.loadPartsMini(repairId);
      }, 0);

      // 延後載入：保養摘要（MNT-4）
      setTimeout(async () => {
        try {
          if (instance && typeof instance.refreshMaintenanceSummary === 'function') {
            await instance.refreshMaintenanceSummary(repairId);
          }
        } catch (e) {
          console.warn('RepairUI: maintenance mini load failed', e);
        }
      }, 0);

      // 延後載入：報價 / 訂單摘要 + 綁定按鈕（避免 DOM 尚未就緒）
      setTimeout(async () => {
        try {
          if (instance && typeof instance.bindQuoteOrderBlock === 'function') {
            instance.bindQuoteOrderBlock();
          }
          if (instance && typeof instance.refreshQuoteOrderSummary === 'function') {
            // Quote/Order 模組可能尚未 init/load：使用 Utils 做「只載一次」的防呆與效能優化
            if (window.Utils && typeof window.Utils.ensureServiceReady === 'function') {
              await window.Utils.ensureServiceReady('QuoteService', { loadAll: true });
              await window.Utils.ensureServiceReady('OrderService', { loadAll: true });
            } else {
              // fallback（保留舊行為，避免 utils 未載入時失效）
              try {
                if (window.QuoteService && typeof window.QuoteService.init === 'function' && !window.QuoteService.isInitialized) {
                  await window.QuoteService.init();
                }
                if (window.QuoteService && typeof window.QuoteService.loadAll === 'function') {
                  await window.QuoteService.loadAll();
                }
              } catch (e) {
                console.warn('RepairUI: QuoteService init/load failed', e);
              }
              try {
                if (window.OrderService && typeof window.OrderService.init === 'function' && !window.OrderService.isInitialized) {
                  await window.OrderService.init();
                }
                if (window.OrderService && typeof window.OrderService.loadAll === 'function') {
                  await window.OrderService.loadAll();
                }
              } catch (e) {
                console.warn('RepairUI: OrderService init/load failed', e);
              }
            }

            await instance.refreshQuoteOrderSummary();
          }
        } catch (e) {
          console.warn('RepairUI: quote/order mini load failed', e);
        }
      }, 0);
    }
  }
  

  /**
   * 開啟歷史紀錄（對齊「查看歷史」的操作；會自動捲動到歷史區塊）
   */
  static openHistory(repairId) {
    // 先沿用 openDetail 行為
    RepairUI.openDetail(repairId);

    // P3：切換到「變更記錄」標籤
    setTimeout(() => {
      try { RepairUI.switchDetailTab('history'); } catch (_) {}
    }, 0);
  }

  /**
   * 維修詳情：切換標籤（總覽 / 變更記錄）
   */
  static switchDetailTab(tab) {
    const key = (tab || '').toString();

    const main = document.getElementById('repair-detail-tab-main');
    const hist = document.getElementById('repair-detail-tab-history');
    const btnMain = document.getElementById('repair-detail-tab-btn-main');
    const btnHist = document.getElementById('repair-detail-tab-btn-history');

    if (!main || !hist || !btnMain || !btnHist) return;

    const showHistory = (key === 'history');

    main.style.display = showHistory ? 'none' : '';
    hist.style.display = showHistory ? '' : 'none';

    try { btnMain.classList.toggle('active', !showHistory); } catch (_) {}
    try { btnHist.classList.toggle('active', showHistory); } catch (_) {}

    // 切換後回到頂部，避免使用者誤以為卡住
    const content = document.getElementById('repair-modal-content');
    const modal = document.getElementById('repair-modal');
    try { if (content) content.scrollTop = 0; } catch (_) {}
    try { if (modal) modal.scrollTop = 0; } catch (_) {}
  }

  /**
   * 維修詳情：載入零件追蹤摘要
   */
  static async loadPartsMini(repairId) {
    const host = document.getElementById('repair-parts-mini');
    if (!host) return;

    // 零件模組可能尚未初始化：在此做最低限度 init + load
    if (!window.RepairPartsService) {
      host.innerHTML = '<div class="muted">零件模組未載入</div>';
      return;
    }

    try {
      if (!window.RepairPartsService.isInitialized) {
        await window.RepairPartsService.init();
      }
      await window.RepairPartsService.loadAll();

      const items = (window.RepairPartsService.listForRepair(repairId) || [])
        .filter(i => !i.isDeleted);

      if (items.length === 0) {
        host.innerHTML = '<div class="muted">目前沒有零件追蹤項目</div>';
        return;
      }

      const statusBadge = (s) => {
        const status = (s || '').toString();
        const map = {
          '需求提出': 'badge-warning',
          '已報價': 'badge-info',
          '已下單': 'badge-info',
          '已到貨': 'badge-success',
          '已更換': 'badge-success',
          '取消': 'badge'
        };
        const cls = map[status] || 'badge';
        return `<span class="badge ${cls}">${status || '—'}</span>`;
      };

      const list = items
        .slice()
        .sort((a, b) => String(a.updatedAt || '').localeCompare(String(b.updatedAt || '')))
        .reverse()
        .slice(0, 6)
        .map(i => {
          const name = (i.partName || '').toString();
          const mpn = (i.mpn || '').toString();
          const qty = Number(i.qty);
          const qtyText = Number.isFinite(qty) ? qty : '';
          return `
            <div style="display:flex;gap:10px;align-items:center;justify-content:space-between;padding:8px 10px;border:1px solid var(--color-border);border-radius:10px;background:var(--color-surface);margin:6px 0">
              <div style="min-width:0">
                <div style="font-weight:600;line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${name || '(未命名零件)'}</div>
                <div class="muted" style="font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${mpn ? `MPN: ${mpn}` : ''}${qtyText !== '' ? `　Qty: ${qtyText}` : ''}</div>
              </div>
              <div>${statusBadge(i.status)}</div>
            </div>
          `;
        }).join('');

      host.innerHTML = list + (items.length > 6 ? '<div class="muted" style="margin-top:6px">僅顯示最新 6 筆</div>' : '');
    } catch (e) {
      console.error(e);
      host.innerHTML = '<div class="muted">零件摘要載入失敗</div>';
    }
  }

  /**
   * 從維修詳情跳轉至「零件追蹤」模組（可選 quickAdd）
   */
  static openRepairParts(repairId, options = {}) {
    try {
      if (window.partsUI?.setContextRepair) {
        window.partsUI.setContextRepair(repairId);
      }
      if (window.AppRouter?.navigate) {
        window.AppRouter.navigate('parts');
      }
      if (options && options.quickAdd) {
        setTimeout(() => {
          try { window.partsUI?.openAddTracker?.(); } catch (_) {}
        }, 350);
      }
    } catch (e) {
      console.error(e);
    }
  }

  // ===============================
  // MNT-4 - Repairs ↔ Maintenance linkage（Static wrappers）
  // 說明：本檔案採用「RepairUI（class）+ repairUI（instance）」並存模式。
  // UI 內大量 onclick 以 RepairUI.xxx 呼叫，因此此處提供 wrapper 將呼叫轉交給 instance。
  // ===============================

  static async openMaintenanceFromRepair(repairId) {
    const instance = window.repairUI;
    if (!instance || typeof instance.openMaintenanceFromRepair !== 'function') {
      if (window.UI && typeof window.UI.toast === 'function') window.UI.toast('維修模組尚未就緒（repairUI 未初始化）', { type: 'warning' });
      else alert('維修模組尚未就緒（repairUI 未初始化）');
      return;
    }
    return await instance.openMaintenanceFromRepair(repairId);
  }

  static async createMaintenanceEquipmentFromRepair(repairId) {
    const instance = window.repairUI;
    if (!instance || typeof instance.createMaintenanceEquipmentFromRepair !== 'function') {
      if (window.UI && typeof window.UI.toast === 'function') window.UI.toast('維修模組尚未就緒（repairUI 未初始化）', { type: 'warning' });
      else alert('維修模組尚未就緒（repairUI 未初始化）');
      return;
    }
    return await instance.createMaintenanceEquipmentFromRepair(repairId);
  }

  static async addMaintenanceRecordFromRepair(repairId) {
    const instance = window.repairUI;
    if (!instance || typeof instance.addMaintenanceRecordFromRepair !== 'function') {
      if (window.UI && typeof window.UI.toast === 'function') window.UI.toast('維修模組尚未就緒（repairUI 未初始化）', { type: 'warning' });
      else alert('維修模組尚未就緒（repairUI 未初始化）');
      return;
    }
    return await instance.addMaintenanceRecordFromRepair(repairId);
  }

  static async closeAndWriteMaintenance(repairId) {
    const instance = window.repairUI;
    if (!instance || typeof instance.closeAndWriteMaintenance !== 'function') {
      if (window.UI && typeof window.UI.toast === 'function') window.UI.toast('維修模組尚未就緒（repairUI 未初始化）', { type: 'warning' });
      else alert('維修模組尚未就緒（repairUI 未初始化）');
      return;
    }
    return await instance.closeAndWriteMaintenance(repairId);
  }

  /**
   * 關閉 Modal
   */
  static closeModal() {
    const modal = document.getElementById('repair-modal');
    if (modal) {
      modal.style.display = 'none';
    }

    // 清理內容與狀態，避免下一次開啟時殘留造成 UI 卡住或誤判
    const content = document.getElementById('repair-modal-content');
    if (content) {
      content.innerHTML = '';
      try { content.classList.remove('modal-wide', 'modal-large', 'modal-xlarge'); } catch (_) {}
    }

    const instance = window.repairUI;
    if (instance) {
      instance.currentRepair = null;
      try { if (typeof instance._clearFormCache === 'function') instance._clearFormCache(); } catch (_) {}
    }
  }

  // ===============================
  // V161.105 - Repair Templates
  // ===============================
  bindTemplatePicker(){
    const sel = document.getElementById('repair-template-select');
    const btnManage = document.getElementById('btn-template-manage');
    if(!sel) return;

    // fill options
    const list = (window.RepairTemplatesService && typeof window.RepairTemplatesService.getEnabled === 'function')
      ? window.RepairTemplatesService.getEnabled()
      : [];
    sel.innerHTML = `<option value="">（不使用模板）</option>` + list.map(t=>{
      const name = escapeHTML((t.name||'').toString());
      return `<option value="${escapeAttr(t.id)}">${name}</option>`;
    }).join('');

    sel.onchange = ()=>{
      const id = sel.value;
      if(!id) return;
      const t = window.RepairTemplatesService ? window.RepairTemplatesService.getById(id) : null;
      if(!t) return;
      this.applyTemplateToForm(t);
      // reset select back to blank to allow re-apply
      sel.value = '';
    };

    if(btnManage){
      btnManage.onclick = ()=>{
        try{
          if(window.AppRouter && typeof window.AppRouter.navigate==='function'){
            window.AppRouter.navigate('settings');
            // best effort scroll
            setTimeout(()=>{
              const el = document.getElementById('settings-repair-templates-card');
              if(el) el.scrollIntoView({behavior:'smooth', block:'start'});
            }, 200);
          }
        }catch(_){}
      };
    }
  }

  applyTemplateToForm(tpl){
    const form = document.getElementById('repair-form');
    if(!form || !tpl) return;
    const fire = (el)=>{
      if(!el) return;
      try{ el.dispatchEvent(new Event('input', {bubbles:true})); }catch(_){ }
      try{ el.dispatchEvent(new Event('change', {bubbles:true})); }catch(_){ }
    };

    const setVal = (name, val)=>{
      const el = form.querySelector(`[name="${name}"]`);
      if(!el) return;
      el.value = (val ?? '');
      fire(el);
    };

    const setBool = (name, boolVal)=>{
      const el = form.querySelector(`[name="${name}"]`);
      if(!el) return;
      if (el.type === 'checkbox') {
        el.checked = !!boolVal;
      } else {
        el.value = !!boolVal ? '1' : '';
      }
      fire(el);
    };

    setVal('status', tpl.status || '');
    setVal('progress', Number(tpl.progress ?? 0));
    setVal('priority', tpl.priority || '');
    setVal('productLine', tpl.productLine || '');
    setVal('machine', tpl.machine || '');
    setVal('issue', tpl.issue || '');
    setVal('content', tpl.content || '');
    setVal('notes', tpl.notes || '');
    setBool('needParts', tpl.needParts === true);

    // update progress label if exists
    const pv = document.getElementById('progress-value');
    if(pv) pv.textContent = `${Number(tpl.progress ?? 0)}%`;

    // keep status/progress coupling rules
    try{ RepairUI.handleStatusChange({ target: form.querySelector('[name="status"]') }); }catch(_){}
  }

  // ===============================
  // MNT-4 - Repairs ↔ Maintenance linkage
  // ===============================
  _maintenanceSvc(){
    try { return window._svc ? window._svc('MaintenanceService') : window.MaintenanceService; } catch (_) { return window.MaintenanceService; }
  }

  async _ensureMaintenanceReady(){
    try {
      if (window.Utils && typeof window.Utils.ensureServiceReady === 'function') {
        await window.Utils.ensureServiceReady('MaintenanceService', { loadAll: true });
        return true;
      }
      const svc = this._maintenanceSvc();
      if (!svc) return false;
      if (typeof svc.init === 'function' && !svc.isInitialized) await svc.init();
      if (typeof svc.loadAll === 'function') await svc.loadAll();
      return true;
    } catch (e) {
      console.warn('RepairUI: ensure MaintenanceService ready failed', e);
      return false;
    }
  }

  _getRepairById(repairId){
    try { return window.RepairService?.get?.(repairId) || null; } catch (_) { return null; }
  }

  _buildMaintenancePrefillFromRepair(repair){
    const r = repair || {};
    const serial = (r.serialNumber || '').toString().trim();
    const productLine = (r.productLine || '').toString().trim();
    const machine = (r.machine || '').toString().trim();
    const customer = (r.customer || '').toString().trim();

    return {
      equipmentNo: serial,
      name: machine,
      model: productLine,
      location: customer,
      ownerName: (r.ownerName || '').toString().trim(),
      ownerEmail: (r.ownerEmail || '').toString().trim(),
      installDate: (r.createdDate || '').toString().trim() // 可手動調整
    };
  }

  async refreshMaintenanceSummary(repairId){
    const sum = document.getElementById('maintenance-summary');
    const act = document.getElementById('maintenance-actions');
    if (!sum || !act) return;

    const rid = (repairId || this.currentRepair?.id || '').toString();
    const repair = this._getRepairById(rid) || this.currentRepair;
    if (!repair) {
      sum.innerHTML = '<div class="muted">找不到維修單資料</div>';
      return;
    }

    const esc = (s)=> (window.StringUtils?.escapeHTML ? window.StringUtils.escapeHTML(String(s ?? '')) : String(s ?? ''));
    const serial = (repair.serialNumber || '').toString().trim();

    // 無序號：只能提示
    if (!serial) {
      sum.innerHTML = '<div class="muted">此維修單尚未填寫「序號」。請先編輯維修單補上序號後再連動保養。</div>';
      return;
    }

    const ok = await this._ensureMaintenanceReady();
    if (!ok) {
      sum.innerHTML = '<div class="muted">保養模組尚未就緒（MaintenanceService 未載入或初始化失敗）</div>';
      return;
    }

    const svc = this._maintenanceSvc();
    const eq = (svc?.getEquipments?.() || []).find(x => x && !x.isDeleted && String(x.equipmentNo||'').trim() === serial) || null;

    const badge = (s, due) => {
      const st = (s || '').toString();
      const r1 = Number(due?.remind1) || 3;
      const r2 = Number(due?.remind2) || 7;
      if (st === 'overdue') return '<span class="badge badge-error">逾期</span>';
      if (st === 'dueSoon1') return `<span class="badge badge-warning">${r1} 天內到期</span>`;
      if (st === 'dueSoon2') return `<span class="badge badge-info">${r2} 天內到期</span>`;
      if (st === 'noRecord') return '<span class="badge">尚無紀錄</span>';
      if (st === 'notCreated') return '<span class="badge">未建立設備</span>';
      return '<span class="badge badge-success">正常</span>';
    };

    let html = '';
    let btnCloseText = '✅ 結案並寫入保養';
    let hasLinkedRecord = false;

    if (!eq) {
      html = `
        <div style="display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;">
          <div style="min-width:0;">
            <div style="font-weight:800;">序號：${esc(serial)}</div>
            <div class="muted" style="margin-top:4px;">此序號尚未在保養設備中建立。你可以一鍵建立設備後再新增紀錄。</div>
          </div>
          <div>${badge('notCreated')}</div>
        </div>
      `.trim();
    } else {
      const due = svc?.getDueInfo ? svc.getDueInfo(eq) : null;
      const st = due?.status || 'ok';

      // 是否已存在「本維修單」寫入的紀錄（避免重複建立）
      try {
        const tag = `repair:${rid}`;
        const recs = (svc?.getRecords?.() || []).filter(r => r && !r.isDeleted && String(r.equipmentId||'') === String(eq.id));
        const linked = recs.find(r => Array.isArray(r.tags) && r.tags.includes(tag));
        if (linked) {
          hasLinkedRecord = true;
          btnCloseText = '🔎 開啟保養紀錄';
        }
      } catch (_) {}

      html = `
        <div style="display:flex;gap:10px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;">
          <div style="min-width:0;">
            <div style="font-weight:800;">序號：${esc(serial)}</div>
            <div class="muted" style="margin-top:4px;">設備：${esc(eq.name || repair.machine || '')}${eq.model ? `　|　型號：${esc(eq.model)}` : ''}</div>
            <div class="muted" style="margin-top:4px;">上次保養：${esc(due?.lastYMD || '—')}　|　下次到期：${esc(due?.nextDue || '—')}</div>
            <div class="muted" style="margin-top:4px;">週期：每 ${esc(due?.cycleEvery || eq.cycleEvery || 30)} ${esc(due?.cycleUnit || eq.cycleUnit || 'day')}</div>
            ${hasLinkedRecord ? '<div class="muted" style="margin-top:4px;">此維修單已建立（或已存在）對應的保養紀錄。</div>' : ''}
          </div>
          <div style="display:flex;gap:8px;align-items:center;">${badge(st, due)}</div>
        </div>
      `.trim();
    }

    sum.innerHTML = html;

    // 動作列：依狀態調整文案（不做 disabled，維持流程可用性；邏輯於 handler 內防呆）
    act.innerHTML = `
      <button class="chip" type="button" onclick="RepairUI.openMaintenanceFromRepair('${esc(rid)}')">開啟保養</button>
      <button class="chip" type="button" onclick="RepairUI.createMaintenanceEquipmentFromRepair('${esc(rid)}')">建立設備</button>
      <button class="chip" type="button" onclick="RepairUI.addMaintenanceRecordFromRepair('${esc(rid)}')">＋建紀錄</button>
      <button class="chip" type="button" onclick="RepairUI.closeAndWriteMaintenance('${esc(rid)}')">${esc(btnCloseText)}</button>
    `.trim();
  }

  async openMaintenanceFromRepair(repairId){
    const rid = (repairId || '').toString();
    const repair = this._getRepairById(rid);
    if (!repair) {
      window.UI?.toast?.('找不到維修單', { type: 'warning' });
      return;
    }
    const serial = (repair.serialNumber || '').toString().trim();
    if (!serial) {
      window.UI?.toast?.('請先在維修單填寫序號，才能連動保養設備', { type: 'warning' });
      return;
    }

    const ok = await this._ensureMaintenanceReady();
    if (!ok) {
      window.UI?.toast?.('保養模組初始化失敗', { type: 'error' });
      return;
    }
    const svc = this._maintenanceSvc();
    const eq = (svc?.getEquipments?.() || []).find(x => x && !x.isDeleted && String(x.equipmentNo||'').trim() === serial) || null;

    if (eq) {
      window.__maintenanceDeepLink = { tab: 'equipments', searchEquip: serial, filterEquipmentId: eq.id };
    } else {
      window.__maintenanceDeepLink = { tab: 'equipments', searchEquip: serial, action: { type: 'createEquipment', prefill: this._buildMaintenancePrefillFromRepair(repair) } };
    }

    // 關閉維修詳情 modal，避免遮擋
    try { RepairUI.closeModal(); } catch (_) {}
    try { window.AppRouter?.navigate?.('maintenance'); } catch (_) {}
  }

  async createMaintenanceEquipmentFromRepair(repairId){
    const rid = (repairId || '').toString();
    const repair = this._getRepairById(rid);
    if (!repair) {
      window.UI?.toast?.('找不到維修單', { type: 'warning' });
      return;
    }
    const serial = (repair.serialNumber || '').toString().trim();
    if (!serial) {
      window.UI?.toast?.('請先在維修單填寫序號，才能建立保養設備', { type: 'warning' });
      return;
    }

    const ok = await this._ensureMaintenanceReady();
    if (!ok) {
      window.UI?.toast?.('保養模組初始化失敗', { type: 'error' });
      return;
    }

    const svc = this._maintenanceSvc();
    try {
      const exist = (svc?.getEquipments?.() || []).find(x => x && !x.isDeleted && String(x.equipmentNo||'').trim() === serial) || null;
      const prefill = this._buildMaintenancePrefillFromRepair(repair);
      const eq = exist ? exist : await svc.upsertEquipment(prefill);
      window.__maintenanceDeepLink = { tab: 'equipments', searchEquip: serial, filterEquipmentId: eq.id, action: { type: 'editEquipment', equipmentId: eq.id } };
      try { RepairUI.closeModal(); } catch (_) {}
      window.AppRouter?.navigate?.('maintenance');
      window.UI?.toast?.('已建立保養設備', { type: 'success' });
    } catch (e) {
      console.error(e);
      window.UI?.toast?.((e && e.message) ? `建立設備失敗：${e.message}` : '建立設備失敗', { type: 'error' });
    }
  }

  async addMaintenanceRecordFromRepair(repairId){
    const rid = (repairId || '').toString();
    const repair = this._getRepairById(rid);
    if (!repair) {
      window.UI?.toast?.('找不到維修單', { type: 'warning' });
      return;
    }
    const serial = (repair.serialNumber || '').toString().trim();
    if (!serial) {
      window.UI?.toast?.('請先在維修單填寫序號，才能新增保養紀錄', { type: 'warning' });
      return;
    }

    const ok = await this._ensureMaintenanceReady();
    if (!ok) {
      window.UI?.toast?.('保養模組初始化失敗', { type: 'error' });
      return;
    }
    const svc = this._maintenanceSvc();

    try {
      const exist = (svc?.getEquipments?.() || []).find(x => x && !x.isDeleted && String(x.equipmentNo||'').trim() === serial) || null;
      const eq = exist ? exist : await svc.upsertEquipment(this._buildMaintenancePrefillFromRepair(repair));

      window.__maintenanceDeepLink = {
        tab: 'records',
        searchEquip: serial,
        filterEquipmentId: eq.id,
        action: { type: 'createRecord', equipmentId: eq.id }
      };
      try { RepairUI.closeModal(); } catch (_) {}
      window.AppRouter?.navigate?.('maintenance');
      window.UI?.toast?.('已開啟新增保養紀錄', { type: 'success' });
    } catch (e) {
      console.error(e);
      window.UI?.toast?.((e && e.message) ? `新增紀錄失敗：${e.message}` : '新增紀錄失敗', { type: 'error' });
    }
  }

  async closeAndWriteMaintenance(repairId){
    const rid = (repairId || '').toString();
    const repair = this._getRepairById(rid);
    if (!repair) {
      window.UI?.toast?.('找不到維修單', { type: 'warning' });
      return;
    }
    const serial = (repair.serialNumber || '').toString().trim();
    if (!serial) {
      window.UI?.toast?.('請先在維修單填寫序號，才能結案並寫入保養', { type: 'warning' });
      return;
    }

    const ok = await this._ensureMaintenanceReady();
    if (!ok) {
      window.UI?.toast?.('保養模組初始化失敗', { type: 'error' });
      return;
    }
    const svc = this._maintenanceSvc();

    try {
      // 1) 確保設備存在
      const exist = (svc?.getEquipments?.() || []).find(x => x && !x.isDeleted && String(x.equipmentNo||'').trim() === serial) || null;
      const eq = exist ? exist : await svc.upsertEquipment(this._buildMaintenancePrefillFromRepair(repair));

      // 2) 找是否已存在「本維修單」對應紀錄（避免重複建立）
      const tag = `repair:${rid}`;
      const recs = (svc?.getRecords?.() || []).filter(r => r && !r.isDeleted && String(r.equipmentId||'') === String(eq.id));
      let record = recs.find(r => Array.isArray(r.tags) && r.tags.includes(tag)) || null;

      // 3) 若不存在則建立
      if (!record) {
        // 來源：零件追蹤（最佳努力；若未初始化，嘗試 init/loadAll）
        let parts = [];
        try {
          if (window.RepairPartsService && typeof window.RepairPartsService.listForRepair === 'function') {
            if (!window.RepairPartsService.isInitialized && typeof window.RepairPartsService.init === 'function') {
              await window.RepairPartsService.init();
            }
            if (typeof window.RepairPartsService.loadAll === 'function') {
              await window.RepairPartsService.loadAll();
            }

            const items = (window.RepairPartsService.listForRepair(rid) || []).filter(i => i && !i.isDeleted);
            const used = items.filter(i => String(i.status||'').trim() === '已更換');

            parts = used.map(i => {
              const name = (i.partName || '').toString().trim();
              const mpn = (i.mpn || '').toString().trim();
              const vendor = (i.vendor || '').toString().trim();
              const qty = Number(i.qty);
              const qtyText = Number.isFinite(qty) ? qty : 1;
              const noteParts = [];
              if (mpn) noteParts.push(`MPN: ${mpn}`);
              if (vendor) noteParts.push(`Vendor: ${vendor}`);
              return { name: name || '(未命名零件)', qty: qtyText, note: noteParts.join(' / ') };
            });
          }
        } catch (e) {
          console.warn('RepairUI: load parts for maintenance record failed', e);
          parts = [];
        }

        const today = window.MaintenanceModel?.todayYMD ? window.MaintenanceModel.todayYMD() : (new Date().toISOString().slice(0,10));

        const notesLines = [];
        notesLines.push(`由維修單結案建立`);
        if (repair.repairNo) notesLines.push(`維修單號：${repair.repairNo}`);
        notesLines.push(`維修單 ID：${rid}`);
        if (repair.customer) notesLines.push(`客戶：${repair.customer}`);
        if (repair.machine) notesLines.push(`設備：${repair.machine}`);
        if (repair.serialNumber) notesLines.push(`序號：${repair.serialNumber}`);
        if (repair.issue) notesLines.push(`問題：${repair.issue}`);
        if (repair.content) notesLines.push(`內容：${repair.content}`);
        if (parts.length) notesLines.push(`更換零件：${parts.map(p => `${p.name} x${p.qty}`).join('；')}`);

        const input = {
          equipmentId: eq.id,
          performedAt: today,
          performer: (repair.ownerName || '').toString().trim(),
          parts,
          notes: notesLines.join('\n'),
          tags: [tag, repair.repairNo ? `repairNo:${repair.repairNo}` : `repairNo:${rid}`]
        };

        record = await svc.upsertRecord(input);
      }

      // 4) 結案（狀態/進度）
      try {
        const needUpdate = (String(repair.status||'') !== '已完成') || (Number(repair.progress) !== 100);
        if (needUpdate && window.RepairService && typeof window.RepairService.update === 'function') {
          await window.RepairService.update(rid, { status: '已完成', progress: 100, historyNote: '結案並寫入保養紀錄' });
        }
      } catch (e) {
        console.warn('RepairUI: close repair failed (non-fatal)', e);
      }

      // 5) 跳轉並開啟該紀錄（編輯）
      window.__maintenanceDeepLink = {
        tab: 'records',
        searchEquip: serial,
        filterEquipmentId: eq.id,
        action: { type: 'editRecord', recordId: record.id }
      };

      try { RepairUI.closeModal(); } catch (_) {}
      window.AppRouter?.navigate?.('maintenance');
      window.UI?.toast?.('已結案並寫入保養紀錄', { type: 'success' });
    } catch (e) {
      console.error(e);
      window.UI?.toast?.((e && e.message) ? `結案寫入失敗：${e.message}` : '結案寫入失敗', { type: 'error' });
    }
  }

  // ===============================
  // V161.105 - Quote/Order linkage
  // ===============================
  bindQuoteOrderBlock(){
    // P2-2：改用事件委派（data-action），避免每次 openDetail 重新綁 onclick
    const btnQ = document.getElementById('btn-open-create-quote');
    const btnO = document.getElementById('btn-open-create-order');
    if(btnQ && !btnQ.getAttribute('data-action')) btnQ.setAttribute('data-action','quote-open-create');
    if(btnO && !btnO.getAttribute('data-action')) btnO.setAttribute('data-action','order-open-create');
  }

  async refreshQuoteOrderSummary(){
  const box = document.getElementById('quote-order-summary');
  if(!box || !this.currentRepair) return;
  const rid = this.currentRepair.id;

  const pickLatest = (arr)=> (window.Utils && typeof window.Utils.pickLatest === 'function')
    ? window.Utils.pickLatest(arr)
    : ((Array.isArray(arr) && arr.length) ? arr[0] : null);

  let qCount = 0, oCount = 0;
  let qLatest = null, oLatest = null;

  try{
    if(window.QuoteService){
      if(typeof window.QuoteService.getSummaryForRepair === 'function'){
        const s = window.QuoteService.getSummaryForRepair(rid) || {};
        qCount = Number(s.count)||0;
        qLatest = s.latest || null;
      }else if(typeof window.QuoteService.getForRepair === 'function'){
        const arr = await window.QuoteService.getForRepair(rid);
        qCount = Array.isArray(arr) ? arr.length : 0;
        qLatest = pickLatest(arr);
      }
    }
    if(window.OrderService){
      if(typeof window.OrderService.getSummaryForRepair === 'function'){
        const s = window.OrderService.getSummaryForRepair(rid) || {};
        oCount = Number(s.count)||0;
        oLatest = s.latest || null;
      }else if(typeof window.OrderService.getForRepair === 'function'){
        const arr = await window.OrderService.getForRepair(rid);
        oCount = Array.isArray(arr) ? arr.length : 0;
        oLatest = pickLatest(arr);
      }
    }
  }catch(e){
    console.warn('RepairUI.refreshQuoteOrderSummary failed', e);
  }

  // 動作 chips：依是否存在最新單據決定顯示「建立 / 開啟」
  try{
    const btnQ = document.getElementById('btn-open-create-quote');
    const btnO = document.getElementById('btn-open-create-order');
    if(btnQ) btnQ.textContent = (qLatest ? '開啟報價' : '建立報價');
    if(btnO) btnO.textContent = (oLatest ? '開啟訂單' : '建立訂單');
  }catch(_){ }

  const esc = (s)=>escapeHTML((s??'').toString());
  const fmt = (v) => {
    try {
      if (window.TimeUtils && typeof window.TimeUtils.formatTaipeiDateTime === 'function') {
        return window.TimeUtils.formatTaipeiDateTime(v) || '-';
      }
      const ms = (typeof window.toEpoch === 'function')
        ? window.toEpoch(v, 0)
        : (window.TimeUtils?.toEpoch ? window.TimeUtils.toEpoch(v, 0) : (Date.parse(String(v ?? '')) || 0));
      if (!ms) return '-';
      return new Date(ms).toLocaleString();
    } catch (_) {
      return '-';
    }
  };
  const itemCount = (x)=> Array.isArray(x?.items) ? x.items.length : 0;

  const statusChip = (label, status)=>{
    const st = (status || '-').toString();
    return `<span class="chip static" title="${esc(st)}">${esc(label)}：${esc(st)}</span>`;
  };
  const timeChip = (label, v)=>{
    const t = fmt(v);
    return `<span class="chip static" title="${esc(t)}">${esc(label)}：${esc(t)}</span>`;
  };
  const countChip = (label, n)=> `<span class="chip static">${esc(label)}：${Number(n)||0}</span>`;

  box.innerHTML = `
    <div class="chip-row" style="justify-content:flex-start;">
      ${countChip('報價', qCount)}
      ${qLatest ? countChip('項目', itemCount(qLatest)) : ''}
      ${qLatest ? statusChip('最新狀態', qLatest.status) : '<span class="chip static">尚無報價</span>'}
      ${qLatest ? timeChip('更新', (qLatest.updatedAt||qLatest.createdAt)) : ''}
    </div>
    <div class="chip-row" style="justify-content:flex-start;margin-top:8px;">
      ${countChip('訂單', oCount)}
      ${oLatest ? countChip('項目', itemCount(oLatest)) : ''}
      ${oLatest ? statusChip('最新狀態', oLatest.status) : '<span class="chip static">尚無訂單</span>'}
      ${oLatest ? timeChip('更新', (oLatest.updatedAt||oLatest.createdAt)) : ''}
    </div>
  `;
  }

  async openOrCreateQuote(){
  if(!this.currentRepair) return;
  const rid = this.currentRepair.id;

  let target = null;
  try{
    if(window.QuoteService){
      if(typeof window.QuoteService.getLatestForRepair === 'function'){
        target = window.QuoteService.getLatestForRepair(rid);
      }else if(typeof window.QuoteService.getSummaryForRepair === 'function'){
        target = window.QuoteService.getSummaryForRepair(rid)?.latest || null;
      }else if(typeof window.QuoteService.getForRepair === 'function'){
        const arr = await window.QuoteService.getForRepair(rid);
        target = (window.Utils?.pickLatest) ? window.Utils.pickLatest(arr) : (arr && arr[0]) || null;
      }

      if(!target && typeof window.QuoteService.createFromRepair === 'function'){
        target = await window.QuoteService.createFromRepair(this.currentRepair);
      }
    }
  }catch(e){
    console.warn('RepairUI.openOrCreateQuote failed', e);
  }
  if(!target) return;

  // 確保模組載入後再切換並開啟明細（避免延遲載入造成空白）
  if (window.ModuleLoader?.ensure) {
    try { await window.ModuleLoader.ensure('quotes'); } catch (_) {}
  }
  if (window.AppRouter && typeof window.AppRouter.navigate === 'function') {
    await window.AppRouter.navigate('quotes');
    try { window.QuotesUI?.openDetail?.(target.id); } catch (_) {}
  }
  }

  async openOrCreateOrder(){
  if(!this.currentRepair) return;
  const rid = this.currentRepair.id;

  let target = null;
  try{
    if(window.OrderService){
      if(typeof window.OrderService.getLatestForRepair === 'function'){
        target = window.OrderService.getLatestForRepair(rid);
      }else if(typeof window.OrderService.getSummaryForRepair === 'function'){
        target = window.OrderService.getSummaryForRepair(rid)?.latest || null;
      }else if(typeof window.OrderService.getForRepair === 'function'){
        const arr = await window.OrderService.getForRepair(rid);
        target = (window.Utils?.pickLatest) ? window.Utils.pickLatest(arr) : (arr && arr[0]) || null;
      }

      if(!target && typeof window.OrderService.createFromRepair === 'function'){
        target = await window.OrderService.createFromRepair(this.currentRepair);
      }
    }
  }catch(e){
    console.warn('RepairUI.openOrCreateOrder failed', e);
  }
  if(!target) return;

  if (window.ModuleLoader?.ensure) {
    try { await window.ModuleLoader.ensure('orders'); } catch (_) {}
  }
  if (window.AppRouter && typeof window.AppRouter.navigate === 'function') {
    await window.AppRouter.navigate('orders');
    try { window.OrdersUI?.openDetail?.(target.id); } catch (_) {}
  }
}

  /**
   * 複製維修單：開啟新增表單並帶入來源欄位
   * - 不複製：狀態/進度、零件追蹤勾選、時間戳、歷史
   */
  async duplicateRepair(repairId) {
    try {
      const rid = (repairId || '').toString().trim();
      if (!rid) return;

      let src = null;
      try {
        if (window.RepairService) {
          if (typeof window.RepairService.get === 'function') src = window.RepairService.get(rid);
          else if (typeof window.RepairService.getById === 'function') src = window.RepairService.getById(rid);
          else if (typeof window.RepairService.getAll === 'function') {
            const arr = window.RepairService.getAll();
            if (Array.isArray(arr)) src = arr.find(x => x && x.id === rid);
          }
        }
      } catch (_) {}

      if (!src) {
        const msg = '找不到要複製的維修單';
        if (window.UI && typeof window.UI.toast === 'function') window.UI.toast(msg, { type: 'warning' });
        else alert(msg);
        return;
      }

      // 深拷貝避免後續操作污染原始資料
      try {
        this._dupSourceRepair = (typeof structuredClone === 'function') ? structuredClone(src) : JSON.parse(JSON.stringify(src));
      } catch (_) {
        this._dupSourceRepair = { ...src };
      }

      await RepairUI.openForm(null);
      if (window.UI && typeof window.UI.toast === 'function') window.UI.toast('已建立複製草稿，請確認後儲存', { type: 'info' });

    } catch (e) {
      console.warn('duplicateRepair failed:', e);
      const msg = e && e.message ? `複製失敗：${e.message}` : '複製失敗';
      if (window.UI && typeof window.UI.toast === 'function') window.UI.toast(msg, { type: 'error' });
      else alert(msg);
    }
  }

  _applyDuplicatePrefill() {
    try {
      // 僅在「新增」表單（currentRepair 為 null）才允許帶入
      if (this.currentRepair) return false;
      if (!this._dupSourceRepair) return false;

      const src = this._dupSourceRepair;
      this._dupSourceRepair = null;

      const form = document.getElementById('repair-form');
      if (!form) return false;

      const setField = (name, value, fire = true) => {
        const el = form.querySelector(`[name="${name}"]`);
        if (!el) return;
        el.value = (value ?? '').toString();
        if (fire) {
          try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch (_) {}
          try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (_) {}
        }
      };

      // 1) 客戶/聯絡人（先帶入公司，觸發聯絡人清單刷新）
      setField('customer', src.customer || '', true);
      setField('contact', src.contact || '', true);

      // 2) 電話/Email（覆寫為來源值）
      const phoneEl = form.querySelector('[name="phone"]');
      if (phoneEl) phoneEl.value = (src.phone || '').toString();
      const emailEl = form.querySelector('[name="email"]');
      if (emailEl) emailEl.value = (src.email || '').toString();

      // 3) 設備產品線/機型
      const plEl = form.querySelector('[name="productLine"]');
      if (plEl) {
        plEl.value = (src.productLine || '').toString();
        try { plEl.dispatchEvent(new Event('change', { bubbles: true })); } catch (_) {}
      }

      const machineVal = (src.machine || '').toString();
      if (machineVal) {
        const sel = document.getElementById('machine-select');
        const manual = document.getElementById('machine-manual');
        const final = document.getElementById('machine-final');

        if (sel && final) {
          const hasOpt = Array.from(sel.options || []).some(o => (o && o.value === machineVal));
          if (hasOpt) {
            sel.value = machineVal;
            try { sel.dispatchEvent(new Event('change', { bubbles: true })); } catch (_) {}
          } else {
            sel.value = '__manual__';
            try { sel.dispatchEvent(new Event('change', { bubbles: true })); } catch (_) {}
            if (manual) {
              manual.value = machineVal;
              try { manual.dispatchEvent(new Event('input', { bubbles: true })); } catch (_) {}
            } else {
              final.value = machineVal;
            }
          }
        } else {
          // fallback: hidden field
          const m = form.querySelector('[name="machine"]');
          if (m) m.value = machineVal;
        }
      }

      // 4) 其他主要欄位
      setField('serialNumber', src.serialNumber || '', true);
      setField('issue', src.issue || '', false);

      const contentEl = form.querySelector('[name="content"]');
      if (contentEl) contentEl.value = (src.content || '').toString();
      const notesEl = form.querySelector('[name="notes"]');
      if (notesEl) notesEl.value = (src.notes || '').toString();

      // 5) 優先級（可選）
      try {
        const pr = (src.priority || '').toString();
        if (pr) {
          const prEl = form.querySelector('[name="priority"]');
          if (prEl) prEl.value = pr;
        }
      } catch (_) {}

      // 聚焦問題描述，方便立即調整
      try { form.querySelector('[name="issue"]')?.focus?.(); } catch (_) {}

      return true;
    } catch (e) {
      console.warn('_applyDuplicatePrefill failed:', e);
      return false;
    }
  }


}

// 建立全域實例
const repairUI = new RepairUI();
window.repairUI = repairUI;
window.RepairUI = RepairUI;

console.log('✅ RepairUI loaded');

// === V161.105: Template Manage (inline onclick fallback) ===
RepairUI.templateManage = function () {
  try {
    if (window.AppRouter && typeof window.AppRouter.navigate === 'function') {
      window.AppRouter.navigate('settings');
    } else {
      // fallback hash route
      window.location.hash = '#settings';
    }
    window.setTimeout(() => {
      const card =
        document.getElementById('settings-repair-templates-card') ||
        document.querySelector('section.templates-card') ||
        document.querySelector('[data-section="repair-templates"]');
      if (card && typeof card.scrollIntoView === 'function') {
        card.scrollIntoView({ behavior: 'smooth', block: 'start' });
        card.classList.add('flash-highlight');
        window.setTimeout(() => card.classList.remove('flash-highlight'), 1200);
      }
    }, 200);
  } catch (e) {
    console.warn('[TemplateManage] failed:', e);
  }
};

