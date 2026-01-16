/**
 * UI Mode（介面模式：標準 / 簡易）
 * V161.205
 *
 * 目標：
 * - 讓使用者在「設定」中切換簡易模式，以降低介面複雜度。
 * - 簡易模式預設僅保留：維修 / 客戶 / 週報 / 設定。
 * - 其餘模組（機台歷史/保養/零件/報價/訂單/知識庫/指南）隱藏並禁止導向。
 */
(function () {
  'use strict';

  const MODES = {
    STANDARD: 'standard',
    SIMPLE: 'simple'
  };

  const FULL_ROUTES = ['repairs', 'machines', 'maintenance', 'customers', 'parts', 'quotes', 'orders', 'kb', 'weekly', 'guide', 'settings'];
  const SIMPLE_ROUTES = ['repairs', 'customers', 'weekly', 'settings'];

  let _mode = MODES.STANDARD;
  let _origGlobalSearchOpen = null;

  function _toast(msg, type) {
    try {
      if (window.UI && typeof window.UI.toast === 'function') {
        window.UI.toast(msg, { type: type || 'info' });
        return;
      }
    } catch (_) {}
    try { console.log('[UIMode]', msg); } catch (_) {}
  }

  function getMode() {
    return _mode;
  }

  function isSimple() {
    return _mode === MODES.SIMPLE;
  }

  function getAllowedRoutes(mode) {
    const m = (mode || _mode || MODES.STANDARD);
    return (m === MODES.SIMPLE) ? [...SIMPLE_ROUTES] : [...FULL_ROUTES];
  }

  function isRouteAllowed(route) {
    const r = (route || '').toString().trim();
    return getAllowedRoutes().includes(r);
  }

  function _applyBodyAttr() {
    try {
      document.body.dataset.uiMode = _mode;
    } catch (_) {}
  }

  function _applyGlobalSearchPolicy() {
    // 簡易模式：停用全域搜尋（避免使用者覺得太複雜）
    try {
      if (!window.GlobalSearch) return;
      if (!_origGlobalSearchOpen && typeof window.GlobalSearch.open === 'function') {
        _origGlobalSearchOpen = window.GlobalSearch.open.bind(window.GlobalSearch);
      }

      if (isSimple()) {
        try { window.GlobalSearch.close?.(); } catch (_) {}
        if (_origGlobalSearchOpen) {
          window.GlobalSearch.open = function () {
            _toast('簡易模式已停用全域搜尋；如需使用，請到「設定 → 介面模式」切回標準模式。', 'warning');
          };
        }
      } else {
        if (_origGlobalSearchOpen) {
          window.GlobalSearch.open = _origGlobalSearchOpen;
        }
      }
    } catch (e) {
      console.warn('UIMode apply global search policy failed:', e);
    }
  }

  function _redirectIfDisallowed() {
    try {
      if (!window.AppRouter || typeof window.AppRouter.navigate !== 'function') return;
      const cur = (window.AppRouter.currentFeature || window.AppRouter.current || '').toString().trim();
      if (!cur) return;
      if (!isRouteAllowed(cur)) {
        _toast('目前為簡易模式，此功能已隱藏，已返回「維修管理」。', 'warning');
        window.AppRouter.navigate('repairs');
      }
    } catch (_) {}
  }

  function apply(settings) {
    const next = (settings && typeof settings.uiMode === 'string') ? settings.uiMode : null;
    _mode = (next === MODES.SIMPLE) ? MODES.SIMPLE : MODES.STANDARD;
    _applyBodyAttr();
    _applyGlobalSearchPolicy();
    _redirectIfDisallowed();
  }

  async function initFromSettings() {
    try {
      const ss = (typeof window._svc === 'function' ? window._svc('SettingsService') : window.SettingsService);
      if (!ss || typeof ss.getSettings !== 'function') {
        apply({ uiMode: MODES.STANDARD });
        return;
      }
      const s = await ss.getSettings();
      apply(s || {});
    } catch (e) {
      console.warn('UIMode initFromSettings failed:', e);
      apply({ uiMode: MODES.STANDARD });
    }
  }

  // Listen settings changes
  function _bindOnce() {
    if (window.__uiModeBound) return;
    window.__uiModeBound = true;

    window.addEventListener('settings:updated', (ev) => {
      try { apply(ev && ev.detail ? ev.detail : {}); } catch (_) {}
    });

    // login: re-init (避免切換帳號時延用舊 mode)
    window.addEventListener('auth:login', () => {
      try { initFromSettings(); } catch (_) {}
    });

    window.addEventListener('auth:logout', () => {
      // 登出回到標準（避免下一個帳號誤套用）
      try { _mode = MODES.STANDARD; _applyBodyAttr(); _applyGlobalSearchPolicy(); } catch (_) {}
    });
  }

  _bindOnce();

  window.UIMode = {
    MODES,
    getMode,
    isSimple,
    getAllowedRoutes,
    isRouteAllowed,
    apply,
    initFromSettings
  };

  console.log('✅ UIMode loaded');
})();
