/**
 * 設定 - 資料模型
 * V161 - Settings Module - Model Layer
 */

class SettingsModel {
  static DEFAULT_WEEKLY_RECIPIENTS = `Amy_Kuo<amy_kuo@premtek.com.tw>;
Frank_chen<frank_chen@premtek.com.tw>;
Marco_chai<marco_chai@premtek.com.tw>;
Perry_chuang<perry_chuang@premtek.com.tw>;
Ruby_Lee<ruby_lee@premtek.com.tw>;
Stone Shih<stone_shih@premtek.com.tw>;
Simon Kuo<simon_kuo@premtek.com.tw>;
Wayne_chang<wayne_chang@premtek.com.tw>;`;

  static defaultSettings() {
    return {
      weeklyRecipients: SettingsModel.DEFAULT_WEEKLY_RECIPIENTS,

      signature: '',
      uiDensity: 'comfortable', // comfortable / compact
      simpleMode: false, // 簡易模式：隱藏進階模組/功能
      pinnedTopN: 8, // 顯示的釘選公司數量（Top N）
      pinnedCompanies: [], // 以公司名稱為主（同公司多聯絡人也算同一個釘選）
      recentCompaniesLimit: 8, // 建單時「最近使用」公司顯示數量

      // 自訂：設備產品線 / 機型對照（空物件 = 未自訂；維修建單會自動合併預設清單）
      machineCatalog: {},

            updatedAt: new Date().toISOString()
    };
  }

  static normalize(raw) {
    if (!raw || typeof raw !== 'object') raw = {};
    const d = SettingsModel.defaultSettings();

    // machine catalog
    const normalizeMachineCatalog = (input) => {
      const out = {};
      if (!input || typeof input !== 'object') return out;
      const keys = Object.keys(input).slice(0, 60); // 避免過大設定造成效能問題
      for (const rawKey of keys) {
        const line = String(rawKey || '').trim();
        if (!line) continue;

        const v = input[rawKey];
        let arr = [];
        if (Array.isArray(v)) arr = v;
        else if (typeof v === 'string') arr = v.split(/\r?\n/);
        else continue;

        const seen = new Set();
        const models = (arr || [])
          .map(x => String(x || '').trim())
          .filter(Boolean)
          .filter(m => {
            const k = m.toLowerCase();
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
          })
          .slice(0, 200);

        out[line] = models;
      }
      return out;
    };

    // pinned / recent companies
    const topNRaw = Number(raw.pinnedTopN ?? d.pinnedTopN);
    const pinnedTopN = Number.isFinite(topNRaw) ? Math.max(1, Math.min(12, Math.round(topNRaw))) : (d.pinnedTopN || 8);

    const recentRaw = Number(raw.recentCompaniesLimit ?? d.recentCompaniesLimit);
    const recentCompaniesLimit = Number.isFinite(recentRaw) ? Math.max(0, Math.min(20, Math.round(recentRaw))) : (d.recentCompaniesLimit || 8);

    const arr = Array.isArray(raw.pinnedCompanies) ? raw.pinnedCompanies : (d.pinnedCompanies || []);
    const seen = new Set();
    const pinnedCompanies = (arr || [])
      .map(v => String(v || '').trim())
      .filter(Boolean)
      .filter(name => {
        const key = name.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 40);

    return {
      weeklyRecipients: String(raw.weeklyRecipients ?? d.weeklyRecipients ?? '').trim(),
      signature: String(raw.signature ?? d.signature ?? '').trim(),
      uiDensity: (raw.uiDensity === 'compact') ? 'compact' : 'comfortable',
      simpleMode: !!(raw.simpleMode),


      pinnedTopN,
      pinnedCompanies,
      recentCompaniesLimit,

      machineCatalog: normalizeMachineCatalog(raw.machineCatalog ?? d.machineCatalog),

      updatedAt: raw.updatedAt || new Date().toISOString()
    };
  }
}

window.SettingsModel = SettingsModel;
console.log('✅ SettingsModel loaded');
