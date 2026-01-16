/**
 * 核心配置模組
 * V161 - 所有配置的單一來源
 */

const AppConfig = {
  // ========================================
  // 版本資訊
  // ========================================
  VERSION: 'V161',
  VERSION_DATE: '2026-01-16',
  VERSION_NAME: 'Modular Phoenix',
  BUILD_NUMBER: '205',
  
  // ========================================
  // Firebase 配置
  // ========================================
  firebase: {
    apiKey: "AIzaSyAs_w60l0g2UgN69VPu0HvIwhS1BHE44IQ",
    authDomain: "repair-tracking-d3de4.firebaseapp.com",
    databaseURL: "https://repair-tracking-d3de4-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "repair-tracking-d3de4",
    storageBucket: "repair-tracking-d3de4.firebasestorage.app",
    messagingSenderId: "385691075337",
    appId: "1:385691075337:web:66ee8dcce00c5b4ee9b46f"
  },
  
  // ========================================
  // 系統配置
  // ========================================
  system: {
    timezone: 'Asia/Taipei',
    timezoneOffset: 8, // UTC+8
    locale: 'zh-Hant',
    
    // 效能配置
    performance: {
      virtualListItemHeight: 60,
      virtualListBufferSize: 5,
      incrementalRenderBatchSize: 50,
      incrementalRenderDelay: 16,
      debounceDelay: 300,
      throttleDelay: 100
    },
    
    // 儲存配置
    storage: {
      prefix: 'repair_tracking_v161_',
      enableLocalBackup: true,
      enableFirebaseSync: true,
      syncInterval: 30000 // 30 秒
    }
  },
  
  // ========================================
  // 業務配置
  // ========================================
  business: {
    // 維修狀態選項
    repairStatus: [
      { value: '進行中', label: '進行中', color: '#3b82f6', progress: 10 },
      { value: '需要零件', label: '需要零件', color: '#f59e0b', progress: 50 },
      { value: '已完成', label: '已完成', color: '#16a34a', progress: 100 }
    ],

    // 優先級選項
    priority: [
      { value: 'low', label: '低', color: '#6b7280' },
      { value: 'normal', label: '一般', color: '#3b82f6' },
      { value: 'high', label: '高', color: '#f59e0b' },
      { value: 'urgent', label: '緊急', color: '#ef4444' }
    ],
    
    // 使用者角色
    roles: [
      { value: 'admin', label: '管理員', permissions: ['all'] },
      { value: 'engineer', label: '工程師', permissions: ['read', 'write', 'update'] }
    ],
    
    // 維修單號格式
    repairIdFormat: 'R{YYYYMMDD}-{SEQ}', // 例如：R20241215-001

    // 零件追蹤狀態（repairParts）
    partStatus: [
      { value: '需求提出', label: '需求提出' },
      { value: '已報價', label: '已報價' },
      { value: '已下單', label: '已下單' },
      { value: '已到貨', label: '已到貨' },
      { value: '已更換', label: '已更換' },
      { value: '取消', label: '取消' }
    ],

    // 報價狀態（quotes）
    quoteStatus: [
      { value: '草稿', label: '草稿' },
      { value: '已送出', label: '已送出' },
      { value: '已核准', label: '已核准' },
      { value: '已取消', label: '已取消' }
    ],

    // 訂單狀態（orders）
    orderStatus: [
      { value: '建立', label: '建立' },
      { value: '已下單', label: '已下單' },
      { value: '已到貨', label: '已到貨' },
      { value: '已結案', label: '已結案' },
      { value: '已取消', label: '已取消' }
    ],
    
    // 預設值
    defaults: {
      repairStatus: '進行中',
      priority: 'normal',
      progress: 0
    },

    // 設備產品線 / 機型對照（用於維修建單的快速選擇）
    // 規則：選擇「產品線」後，設備名稱清單會自動套用對應機型。
    // 可依公司實際機種持續擴充。
    machineCatalog: {
      MAR: [
        'FlexTRAK-SH',
        'FlexTRAK-F3',
        'FlexTRAK-S',
        'AP-600',
        'AP-1000',
        'ExoSPHERE',
        'StratoSPHERE'
      ],
      MAP: [
        '2400',
        '2800',
        'MaxVIA',
        'ProVIA'
      ]
    }
  },
  
  // ========================================
  // 週報配置
  // ========================================
  weekly: {
    // 文字排版
    textLayout: {
      font: 'Consolas, monospace',
      fontSize: 12,
      lineWidth: 80,
      indent: 2
    },
    
    // 週報模式
    modes: [
      { value: 'engineer', label: '工程完整版' },
      { value: 'manager', label: '管理摘要版' }
    ],
    
    // 必填欄位
    requiredFields: [
      'dept',
      'reporter',
      'items'
    ]
  },
  
  // ========================================
  // UI 配置
  // ========================================
  ui: {
    // 斷點
    breakpoints: {
      mobile: 768,
      tablet: 1024,
      desktop: 1280
    },
    
    // 顏色主題
    colors: {
  // 企業系統風（淺色、低彩度、三層背景）
  primary: '#2563eb',
  primaryHover: '#1d4ed8',
  primarySoft: 'rgba(37, 99, 235, 0.10)',
  secondary: '#0ea5e9',
  success: '#16a34a',
  warning: '#d97706',
  error: '#dc2626',

  // 版面層次（稍深底色 + 白色卡片；提高層次、降低「灰白一片」的單調感）
  background: '#f4f6fb',
  surface: '#ffffff',
  surfaceMuted: '#f2f5fa',
  panel: '#ffffff',
  panelAlt: '#f7f9fd',

  text: '#0f172a',
  textSecondary: '#475569',
  border: '#dbe2ef',
  shadow: 'rgba(15, 23, 42, 0.08)',
  backdrop: 'rgba(15, 23, 42, 0.40)'
},


    // 動畫
    animation: {
      duration: 200,
      easing: 'ease-in-out'
    },
    
    // Toast 配置
    toast: {
      duration: 3000,
      position: 'top-right'
    },
    
    // Modal 配置
    modal: {
      closeOnBackdrop: true,
      closeOnEscape: true
    }
  },
  
  // ========================================
  // 功能開關（Feature Flags）
  // ========================================
  features: {
    enableOrders: true,           // 訂單追蹤功能
    enableQuotes: true,           // 報價功能
    enableParts: true,            // 零件管理/追蹤
    enableNotifications: false,   // 推送通知
    enableOfflineMode: true,      // 離線模式
    enableAutoBackup: true,       // 自動備份
    enableAuditLog: true,         // 審計日誌
    enableAdvancedSearch: false,  // 進階搜尋
    enableExport: true,           // 匯出功能
    enableImport: false           // 匯入功能
  },
  
  // ========================================
  // 錯誤處理配置
  // ========================================
  error: {
    showStackTrace: false,        // 生產環境關閉
    enableSentry: false,          // 第三方錯誤追蹤
    maxErrorLogs: 100,            // 最多保留錯誤日誌數
    
    // 錯誤等級
    levels: {
      CRITICAL: 1,  // 系統無法運行
      HIGH: 2,      // 核心功能失效
      MEDIUM: 3,    // 部分功能失效
      LOW: 4        // UI 小問題
    }
  },
  
  // ========================================
  // 開發模式
  // ========================================
  isDevelopment() {
    return window.location.hostname === 'localhost' || 
           window.location.hostname === '127.0.0.1';
  },
  
  // ========================================
  // 裝置檢測
  // ========================================
  device: {
    isMobile() {
      return window.innerWidth < AppConfig.ui.breakpoints.mobile;
    },
    
    isTablet() {
      const width = window.innerWidth;
      return width >= AppConfig.ui.breakpoints.mobile && 
             width < AppConfig.ui.breakpoints.desktop;
    },
    
    isDesktop() {
      return window.innerWidth >= AppConfig.ui.breakpoints.desktop;
    },
    
    getDeviceType() {
      if (this.isMobile()) return 'mobile';
      if (this.isTablet()) return 'tablet';
      return 'desktop';
    }
  },
  
  // ========================================
  // 輔助方法
  // ========================================
  getVersion() {
    return `${this.VERSION} (${this.VERSION_DATE})`;
  },
  
  getFullVersion() {
    return `${this.VERSION}.${this.BUILD_NUMBER} - ${this.VERSION_NAME}`;
  },

  /**
   * 取得「設備產品線 / 機型」對照表（合併預設 + 使用者設定）
   *
   * 合併規則：
   * - 若使用者設定有某個產品線（key 存在），則該產品線以使用者設定為準（可新增/刪除/調整順序）。
   * - 若使用者設定未包含該產品線，則沿用預設。
   */
  getMachineCatalog() {
    const base = (this.business && this.business.machineCatalog && typeof this.business.machineCatalog === 'object')
      ? this.business.machineCatalog
      : {};

    let custom = {};
    try {
      const ss = (typeof window !== 'undefined' && typeof window._svc === 'function')
        ? window._svc('SettingsService')
        : (typeof window !== 'undefined' ? window.SettingsService : null);
      const s = (ss && ss.settings) ? ss.settings : null;
      const c = s && s.machineCatalog && typeof s.machineCatalog === 'object' ? s.machineCatalog : null;
      if (c) custom = c;
    } catch (_) {
      custom = {};
    }

    const keys = new Set([
      ...Object.keys(base || {}),
      ...Object.keys(custom || {})
    ]);

    const out = {};
    for (const k of keys) {
      const source = (custom && Object.prototype.hasOwnProperty.call(custom, k)) ? custom[k] : base[k];
      out[k] = Array.isArray(source) ? source.map(v => String(v || '').trim()).filter(Boolean) : [];
    }
    return out;
  },
  
  getStatusByValue(value) {
    return this.business.repairStatus.find(s => s.value === value);
  },
  
  getRoleByValue(value) {
    return this.business.roles.find(r => r.value === value);
  },
  
  hasPermission(userRole, permission) {
    const role = this.getRoleByValue(userRole);
    if (!role) return false;
    
    if (role.permissions.includes('all')) return true;
    return role.permissions.includes(permission);
  }
};

// 凍結配置物件，防止意外修改
Object.freeze(AppConfig);
Object.freeze(AppConfig.firebase);
Object.freeze(AppConfig.system);
Object.freeze(AppConfig.business);
Object.freeze(AppConfig.weekly);
Object.freeze(AppConfig.ui);
Object.freeze(AppConfig.features);
Object.freeze(AppConfig.error);

// 輸出到全域
if (typeof window !== 'undefined') {
  window.AppConfig = AppConfig;
}

// 也支援 ES6 模組匯出（未來可能用到）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AppConfig;
}

console.log(`✅ Config loaded: ${AppConfig.getFullVersion()}`);
