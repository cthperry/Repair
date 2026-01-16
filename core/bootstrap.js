/**
 * 系統啟動器（Bootstrap）
 * V160 - 系統啟動的第一道防線
 * 
 * 職責：
 * 1. 載入核心配置
 * 2. 初始化錯誤處理
 * 3. 渲染基礎 UI
 * 4. 準備認證環境
 */

class Bootstrap {
  constructor() {
    this.startTime = Date.now();
    this.loadSteps = [];
    this.isReady = false;
  }
  
  /**
   * 主啟動流程
   */
  async start() {
    try {
      console.log(`🚀 Starting ${AppConfig.getFullVersion()}...`);

      // Step 0: 同步頁面版本顯示（避免 HTML 與 AppConfig 版本不一致造成誤判）
      await this.step('Sync Page Version', () => {
        this.syncPageVersion();
      });
      
      // Step 1: 初始化錯誤處理器（最優先）
      await this.step('Initialize Error Handler', () => {
        (window.ErrorHandler && typeof window.ErrorHandler.init === 'function') ? window.ErrorHandler.init() : console.warn('⚠️ ErrorHandler not available at bootstrap init');
      });
      
      // Step 2: 檢查瀏覽器相容性
      await this.step('Check Browser Compatibility', () => {
        this.checkBrowserCompatibility();
      });
      
      // Step 3: 偵測裝置類型
      await this.step('Detect Device', () => {
        this.detectDevice();
      });
      
      // Step 4: 載入基礎樣式
      await this.step('Load Base Styles', () => {
        this.loadBaseStyles();
      });
      
      // Step 5: 渲染載入畫面
      await this.step('Render Loading Screen', () => {
        this.renderLoadingScreen();
      });
      
      // Step 6: 準備認證環境
      await this.step('Prepare Auth Environment', () => {
        this.prepareAuthEnvironment();
      });
      
      // Step 7: 綁定全域快捷鍵
      await this.step('Bind Global Shortcuts', () => {
        this.bindGlobalShortcuts();
      });
      
      // 完成啟動
      const loadTime = Date.now() - this.startTime;
      console.log(`✅ Bootstrap completed in ${loadTime}ms`);
      
      this.isReady = true;
      this.onReady();
      
    } catch (error) {
      // 如果 Bootstrap 失敗，這是最嚴重的錯誤
      console.error('💥 Bootstrap failed:', error);
      try { window.ErrorHandler && typeof window.ErrorHandler.log === 'function' ? window.ErrorHandler.log('CRITICAL', 'Bootstrap', error.message, { error }) : console.error('[Bootstrap CRITICAL]', error); } catch (_) { console.error('[Bootstrap CRITICAL]', error); }
      this.renderBootstrapError(error);
    }
  }
  
  /**
   * 執行步驟（包含錯誤處理）
   */
  async step(name, fn) {
    const start = Date.now();
    
    try {
      await fn();
      const duration = Date.now() - start;
      this.loadSteps.push({ name, status: 'success', duration });
      console.log(`  ✓ ${name} (${duration}ms)`);
    } catch (error) {
      const duration = Date.now() - start;
      this.loadSteps.push({ name, status: 'failed', duration, error });
      console.error(`  ✗ ${name} (${duration}ms)`, error);
      throw error;
    }
  }
  


  /**
   * 同步頁面版本顯示（以 AppConfig 為準）
   * - 避免使用者看到 HTML title 與側邊欄版本不一致，誤以為版本未更新
   */
  syncPageVersion() {
    try {
      const build = `${AppConfig.VERSION}.${AppConfig.BUILD_NUMBER}`;
      const title = (typeof document !== 'undefined' && document) ? (document.title || '') : '';
      const path = (typeof location !== 'undefined' && location) ? String(location.pathname || '').toLowerCase() : '';

      let suffix = '';
      if (path.includes('mobile') || /\bmobile\b/i.test(title)) suffix = ' - Mobile';
      else if (path.includes('desktop') || /\bdesktop\b/i.test(title)) suffix = ' - Desktop';
      else if (path.includes('index') || /\bindex\b/i.test(title)) suffix = ' - Index';

      if (typeof document !== 'undefined' && document) {
        document.title = `維修追蹤系統 ${build}${suffix}`;
      }
    } catch (_) {}
  }

  /**
   * 檢查瀏覽器相容性
   */
  checkBrowserCompatibility() {
    const required = {
      localStorage: typeof Storage !== 'undefined',
      fetch: typeof fetch !== 'undefined',
      promise: typeof Promise !== 'undefined',
      es6: typeof Symbol !== 'undefined'
    };
    
    const missing = Object.entries(required)
      .filter(([key, supported]) => !supported)
      .map(([key]) => key);
    
    if (missing.length > 0) {
      throw new Error(`瀏覽器不支援以下功能: ${missing.join(', ')}`);
    }
    
    console.log('  ✓ Browser compatibility check passed');
  }
  
  /**
   * 偵測裝置類型
   */
  detectDevice() {
    const deviceType = AppConfig.device.getDeviceType();
    const deviceInfo = {
      type: deviceType,
      width: window.innerWidth,
      height: window.innerHeight,
      isMobile: AppConfig.device.isMobile(),
      isTablet: AppConfig.device.isTablet(),
      isDesktop: AppConfig.device.isDesktop(),
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      language: navigator.language
    };
    
    // 儲存裝置資訊
    try { (window.AppState && typeof window.AppState.setDeviceInfo === "function") ? window.AppState.setDeviceInfo(deviceInfo) : (window.deviceInfo = deviceInfo); } catch (_) { window.deviceInfo = deviceInfo; }
    
    console.log(`  ✓ Device: ${deviceType} (${deviceInfo.width}x${deviceInfo.height})`);
  }
  
  /**
   * 載入基礎樣式
   */
  loadBaseStyles() {
    // CSS 變數（全域）
    const root = document.documentElement;
    const colors = AppConfig.ui.colors;
    
    Object.entries(colors).forEach(([key, value]) => {
      // 同時支援 camelCase 與 kebab-case（避免 CSS 變數命名不一致）
      const kebab = key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
      root.style.setProperty(`--color-${key}`, value);
      root.style.setProperty(`--color-${kebab}`, value);
    });
    
    // 設定裝置類型 class
    const __d = (window.AppState && typeof window.AppState.getDeviceInfo === "function") ? window.AppState.getDeviceInfo() : window.deviceInfo;
    document.body.className = `device-${(__d && __d.type) ? __d.type : "unknown"}`;
    
    console.log('  ✓ Base styles loaded');
  }
  
  /**
   * 渲染載入畫面
   */
  renderLoadingScreen() {
    const loadingHTML = `
      <div id="app-loading" style="
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: linear-gradient(135deg, var(--color-background) 0%, var(--color-surfaceMuted) 100%);
        color: var(--color-text);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 999998;
        transition: opacity 0.3s;
      ">
        <div style="text-align: center; padding: 20px;">
          <div style="font-size: 48px; margin-bottom: 20px; animation: pulse 2s ease-in-out infinite;">
            🔧
          </div>
          <div style="font-size: 24px; font-weight: 600; margin-bottom: 10px; color: var(--color-primary);">
            維修追蹤系統
          </div>
          <div style="font-size: 14px; color: var(--color-text-secondary); margin-bottom: 30px;">
            ${AppConfig.VERSION_NAME}
          </div>
          <div class="spinner" style="
            width: 40px;
            height: 40px;
            margin: 0 auto;
            border: 3px solid var(--color-border);
            border-top: 3px solid var(--color-primary);
            border-radius: 50%;
            animation: spin 1s linear infinite;
          "></div>
          <div id="loading-status" style="
            margin-top: 20px;
            font-size: 12px;
            color: var(--color-text-secondary);
          ">
            正在初始化系統...
          </div>
        </div>
      </div>
      
      <style>
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      </style>
    `;
    
    // 插入到 body 開頭
    document.body.insertAdjacentHTML('afterbegin', loadingHTML);
    
    console.log('  ✓ Loading screen rendered');
  }
  
  /**
   * 更新載入狀態
   */
  updateLoadingStatus(message) {
    const statusEl = document.getElementById('loading-status');
    if (statusEl) {
      statusEl.textContent = message;
    }
  }
  
  /**
   * 移除載入畫面
   */
  removeLoadingScreen() {
    const loading = document.getElementById('app-loading');
    if (loading) {
      loading.style.opacity = '0';
      setTimeout(() => loading.remove(), 300);
    }
  }
  
  /**
   * 準備認證環境
   */
  prepareAuthEnvironment() {
    // 渲染登入容器
    const loginHTML = `
      <div id="login-container" style="
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: linear-gradient(135deg, var(--color-background) 0%, var(--color-surfaceMuted) 100%);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 999997;
      ">
        <div id="login-content">
          <!-- 登入表單將由 Auth 模組渲染 -->
        </div>
      </div>
      
      <div id="app-container" style="display: none;">
        <!-- 主應用將在登入後渲染 -->
      </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', loginHTML);
    
    console.log('  ✓ Auth environment prepared');
  }
  
  /**
   * 綁定全域快捷鍵
   */
  bindGlobalShortcuts() {
    if (this._shortcutsBound) return;
    this._shortcutsBound = true;
    document.addEventListener('keydown', (e) => {
      // Ctrl+K / Cmd+K: 全域快速搜尋（登入後才生效）
      try {
        const authed = ((window.AppState && typeof window.AppState.isAuthenticated === 'function') ? window.AppState.isAuthenticated() : window.isAuthenticated);
        const key = (e.key || '').toString().toLowerCase();
        const isMac = /Mac|iPhone|iPad|iPod/i.test(navigator.platform || '');
        const hit = (authed && key === 'k' && (e.ctrlKey || (isMac && e.metaKey)));
        if (hit) {
          e.preventDefault();
          try { window.GlobalSearch?.open?.(); } catch (_) {}
          return;
        }
      } catch (_) {}

      // Ctrl+N: 新增維修單（登入後才生效）
      if (e.ctrlKey && e.key === 'n' && ((window.AppState && typeof window.AppState.isAuthenticated === 'function') ? window.AppState.isAuthenticated() : window.isAuthenticated)) {
        e.preventDefault();
        if (window.AppRouter && window.AppRouter.currentFeature === 'repairs') {
          // 觸發新增維修單（由 repairs 模組實作）
          const event = new CustomEvent('shortcut:new-repair');
          window.dispatchEvent(event);
        }
      }
      
      // Ctrl+S: 儲存（登入後才生效）
      if (e.ctrlKey && e.key === 's' && ((window.AppState && typeof window.AppState.isAuthenticated === 'function') ? window.AppState.isAuthenticated() : window.isAuthenticated)) {
        e.preventDefault();
        const event = new CustomEvent('shortcut:save');
        window.dispatchEvent(event);
      }
      
      // Esc: 關閉 Modal
      if (e.key === 'Escape') {
        const event = new CustomEvent('shortcut:escape');
        window.dispatchEvent(event);
      }
    });
    
    console.log('  ✓ Global shortcuts bound');
  }
  
  /**
   * 啟動完成回呼
   */
  onReady() {
    // 觸發 ready 事件
    const event = new CustomEvent('bootstrap:ready', {
      detail: {
        loadTime: Date.now() - this.startTime,
        steps: this.loadSteps
      }
    });
    window.dispatchEvent(event);
    
    // 移除載入畫面
    setTimeout(() => {
      this.removeLoadingScreen();
    }, 500);
  }
  
  /**
   * 渲染 Bootstrap 錯誤
   */
  renderBootstrapError(error) {
    document.body.innerHTML = `
      <div style="
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: linear-gradient(135deg, #7f1d1d 0%, #991b1b 100%);
        color: #fef2f2;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
      ">
        <div style="max-width: 600px; text-align: center;">
          <div style="font-size: 64px; margin-bottom: 20px;">💥</div>
          <h1 style="font-size: 28px; font-weight: 600; margin-bottom: 10px;">
            系統啟動失敗
          </h1>
          <p style="font-size: 16px; color: #fecaca; margin-bottom: 30px;">
            很抱歉，系統無法完成啟動程序。請嘗試重新整理頁面。
          </p>
          <div style="
            background: rgba(0,0,0,0.2);
            border-radius: 8px;
            padding: 15px;
            margin-bottom: 20px;
            text-align: left;
          ">
            <div style="font-size: 12px; color: #fca5a5; margin-bottom: 8px;">
              錯誤資訊：
            </div>
            <div style="
              font-family: monospace;
              font-size: 13px;
              color: #fef2f2;
              word-break: break-all;
            ">
              ${error.message}
            </div>
          </div>
          <button onclick="location.reload()" style="
            padding: 12px 24px;
            background: #fef2f2;
            color: #991b1b;
            border: none;
            border-radius: 6px;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
          ">
            🔄 重新整理頁面
          </button>
        </div>
      </div>
    `;
  }
  
  /**
   * 取得啟動資訊
   */
  getBootInfo() {
    return {
      version: AppConfig.getFullVersion(),
      startTime: this.startTime,
      loadTime: this.isReady ? Date.now() - this.startTime : null,
      steps: this.loadSteps,
      device: window.deviceInfo
    };
  }
}

// 建立全域實例
const bootstrap = new Bootstrap();

// 輸出到全域
if (typeof window !== 'undefined') {
  window.Bootstrap = bootstrap;
}

// 頁面載入完成後自動啟動
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    bootstrap.start();
  });
} else {
  bootstrap.start();
}

console.log('✅ Bootstrap loaded');
