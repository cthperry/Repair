/**
 * 維修管理 - UI 層（續）
 * V160 - Repairs Module - UI Layer (Forms & Details)
 * 
 * 擴充 RepairUI 類別，新增表單和詳情渲染功能
 */

// 擴充 RepairUI 原型
Object.assign(RepairUI.prototype, {
  /**
   * 渲染表單（新增/編輯）
   */
  renderForm() {
    const isEdit = !!this.currentRepair;
    // 新增模式要吃 AppConfig 預設值，否則 <select> 會落到第一個 option（目前是「低」）
    const repair = this.currentRepair || {
      status: AppConfig.business.defaults.repairStatus,
      progress: AppConfig.business.defaults.progress,
      priority: AppConfig.business.defaults.priority
    };

    // 注意：新增維修單不得帶入「上一次選擇」的預設值（避免造成誤填/誤判為內建值）
    // - 版本：V161.133 起取消 localStorage 的 recent defaults 行為
    // - 仍保留 AppConfig 的系統預設值（status/progress/priority）
    const statuses = AppConfig.business.repairStatus;
    const priorities = AppConfig.business.priority;

    const escapeHtml = (input) => {
      const s = (input === null || input === undefined) ? '' : String(input);
      return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    };
    const escapeAttr = (input) => escapeHtml(input).split('\\n').join(' ').split('\\r').join(' ');

    // 公司清單（以 customers.name 去重）
    const companies = (window.CustomerService && typeof window.CustomerService.getCompanies === 'function')
      ? window.CustomerService.getCompanies()
      : (window.CustomerService && typeof window.CustomerService.getAll === 'function'
          ? Array.from(new Set(window.CustomerService.getAll().map(c => (c.name || '').toString().trim()).filter(Boolean)))
          : []);
    const companyOptions = (companies || []).map(name => {
      const safe = escapeAttr(name || '');
      return safe ? `<option value="${safe}"></option>` : '';
    }).join('');

    // 聯絡人清單（依公司動態）
    const companyName = (repair.customer || '').toString().trim();
    const contacts = (window.CustomerService && typeof window.CustomerService.getContactsByCompanyName === 'function' && companyName)
      ? window.CustomerService.getContactsByCompanyName(companyName)
      : [];
    const contactOptions = Array.from(new Set((contacts || []).map(c => (c.contact || '').toString().trim()).filter(Boolean)))
      .map(n => {
        const safe = escapeAttr(n || '');
        return safe ? `<option value="${safe}"></option>` : '';
      }).join('');

    // 維修日期（createdDate：YYYY-MM-DD）
    const todayStr = (window.RepairModel && typeof window.RepairModel.getTaiwanDateString === 'function')
      ? window.RepairModel.getTaiwanDateString(new Date())
      : new Date().toISOString().slice(0, 10);
    const createdDateValue = escapeAttr((repair.createdDate || todayStr) || todayStr);

    // 設備產品線 / 機型清單（選擇產品線後，設備名稱提供對應機型）
    const machineCatalog = (window.AppConfig && typeof window.AppConfig.getMachineCatalog === 'function')
      ? window.AppConfig.getMachineCatalog()
      : ((window.AppConfig && window.AppConfig.business && window.AppConfig.business.machineCatalog)
        ? window.AppConfig.business.machineCatalog
        : {});

    const inferProductLine = (machineName) => {
      try {
        const name = (machineName || '').toString().trim();
        if (!name) return '';
        for (const [line, models] of Object.entries(machineCatalog || {})) {
          if (Array.isArray(models) && models.includes(name)) return line;
        }
      } catch (_) {}
      return '';
    };

    const initialProductLine = (repair.productLine || '').toString().trim() || inferProductLine(repair.machine);
    const productLines = Array.from(new Set([
      ...Object.keys(machineCatalog || {}),
      ...(initialProductLine ? [initialProductLine] : [])
    ])).filter(Boolean);

    // 固定順序（若有 MAR/MAP 優先）
    const preferredOrder = ['MAR', 'MAP'];
    productLines.sort((a, b) => {
      const ia = preferredOrder.indexOf(a);
      const ib = preferredOrder.indexOf(b);
      if (ia !== -1 || ib !== -1) {
        return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
      }
      return a.localeCompare(b);
    });

    const productLineOptions = productLines.map(line => {
      const safe = escapeAttr(line);
      return `<option value="${safe}" ${initialProductLine === line ? 'selected' : ''}>${escapeHtml(line)}</option>`;
    }).join('');

    const modelsForLine = (initialProductLine && Array.isArray(machineCatalog[initialProductLine])) ? machineCatalog[initialProductLine] : [];
    const currentMachine = (repair.machine || '').toString().trim();
    const machineInList = !!(modelsForLine && modelsForLine.includes(currentMachine));
    const useSelectInitially = !!(initialProductLine && modelsForLine && modelsForLine.length > 0);

    const machineSelectOptions = [
      `<option value="">請選擇設備名稱</option>`,
      ...(modelsForLine || []).map(m => {
        const safe = escapeAttr(m);
        return `<option value="${safe}" ${(machineInList && currentMachine === m) ? 'selected' : ''}>${escapeHtml(m)}</option>`;
      }),
      `<option value="__manual__" ${useSelectInitially && currentMachine && !machineInList ? 'selected' : ''}>其他 / 手動輸入</option>`
    ].join('');

    const machineManualValue = (!useSelectInitially || (useSelectInitially && currentMachine && !machineInList)) ? currentMachine : '';
    // 顯示手動輸入：
    // 1) 未選產品線或無對照表 -> 手動輸入
    // 2) 已選產品線但現有值不在清單 -> 手動輸入（以保留既有資料）
    const showManualInitially = (!useSelectInitially) || (useSelectInitially && currentMachine && !machineInList);
    
    return `
      <div class="modal-dialog">
        <div class="modal-header">
          <h3>${isEdit ? '編輯維修單' : '新增維修單'}</h3>
          <button class="modal-close" onclick="RepairUI.closeModal()">✕</button>
        </div>
        
        <form id="repair-form" class="modal-body" onsubmit="RepairUI.handleSubmit(event)">
          
          
          <!-- 狀態與優先級 -->
          <div class="form-section">
            <h4 class="form-section-title">狀態管理</h4>
            
            <div class="form-grid">
              <div class="form-group">
                <label class="form-label">維修日期</label>
                <input
                  type="date"
                  name="createdDate"
                  class="input"
                  value="${createdDateValue}"
                />
              </div>

              <div class="form-group">
                <label class="form-label">狀態</label>
                <select name="status" class="input" onchange="RepairUI.handleStatusChange(event)">
                  ${statuses.map(s => `
                    <option value="${s.value}" ${repair.status === s.value ? 'selected' : ''}>
                      ${s.label}
                    </option>
                  `).join('')}
                </select>
              </div>
              
              <div class="form-group">
                <label class="form-label">進度 (<span id="progress-value">${repair.progress || 0}</span>%)</label>
                <input
                  type="range"
                  name="progress"
                  class="input-range"
                  min="0"
                  max="100"
                  step="10"
                  value="${repair.progress || 0}"
                  oninput="RepairUI.handleProgressChange(event)"
                />
              </div>
              
              <div class="form-group">
                <label class="form-label">優先級</label>
                <select name="priority" class="input">
                  ${priorities.map(p => `
                    <option value="${p.value}" ${repair.priority === p.value ? 'selected' : ''}>
                      ${p.label}
                    </option>
                  `).join('')}
                </select>
              </div>
            </div>
          </div>
          
          <!-- 零件相關 -->
          <!-- 客戶資訊 -->
          <div class="form-section">
            <h4 class="form-section-title">客戶資訊</h4>
            <!-- 模板（V161.105） -->
            <div class="form-row template-row">
              <div class="form-label">模板</div>
              <div class="form-field template-field">
                <select class="input" id="repair-template-select">
                  <option value="">（不使用模板）</option>
                </select>
                <button class="btn" type="button" id="btn-template-manage" onclick="RepairUI.templateManage && RepairUI.templateManage()">管理模板</button>
              </div>
            </div>


            <div class="quick-picks" id="company-quick-picks">
              <div class="quick-row">
                <div class="quick-label">常用公司</div>
                <div class="quick-chips" id="pinned-company-chips"><span class="muted">載入中...</span></div>
              </div>
              <div class="quick-row">
                <div class="quick-label">最近使用</div>
                <div class="quick-chips" id="recent-company-chips"></div>
              </div>
            </div>
            
            <div class="form-grid">
              <div class="form-group">
                <label class="form-label required label-with-actions">
                  <span>公司名稱</span>
                  <span class="label-actions">
                    <button type="button" class="btn ghost mini" id="btn-pin-company">釘選</button>
                    <button type="button" class="btn ghost mini" id="btn-history-company">歷史帶入</button>
                  </span>
                </label>
                <div class="input-with-dropdown">
                  <input
                    type="text"
                    name="customer"
                    class="input"
                    value="${escapeAttr(repair.customer || '')}"
                    placeholder="請輸入公司名稱"
                    list="company-list" oninput="RepairUI.handleCustomerPick(event)" autocomplete="off"
                    required
                  />
                  <button type="button" class="input-dropdown-btn" data-dd="company" onclick="RepairUI.toggleCompanyDropdown(event)" aria-label="選擇公司" title="選擇公司">▾</button>
                </div>
                <datalist id="company-list">${companyOptions}</datalist>
              </div>
              
              <div class="form-group">
                <label class="form-label">聯絡人</label>
                <div class="input-with-dropdown">
                  <input
                    type="text"
                    name="contact"
                    class="input"
                    value="${escapeAttr(repair.contact || '')}"
                    placeholder="請輸入聯絡人"
                    list="contact-list" oninput="RepairUI.handleContactPick(event)" autocomplete="off"
                  />
                  <button type="button" class="input-dropdown-btn" data-dd="contact" onclick="RepairUI.toggleContactDropdown(event)" aria-label="選擇聯絡人" title="選擇聯絡人">▾</button>
                </div>
                <datalist id="contact-list">${contactOptions}</datalist>
              </div>
              
              <div class="form-group">
                <label class="form-label">電話</label>
                <input
                  type="tel"
                  name="phone"
                  class="input"
                  value="${escapeAttr(repair.phone || '')}"
                  placeholder="請輸入電話"
                />
              </div>
              
              <div class="form-group">
                <label class="form-label">Email</label>
                <input
                  type="email"
                  name="email"
                  class="input"
                  value="${escapeAttr(repair.email || '')}"
                  placeholder="請輸入 Email"
                />
              </div>
            </div>
          </div>
          
          <!-- 設備資訊 -->
          <div class="form-section">
            <h4 class="form-section-title">設備資訊</h4>
            
            <div class="form-grid three">
              <div class="form-group">
                <label class="form-label">產品線</label>
                <select name="productLine" id="product-line" class="input" onchange="RepairUI.handleProductLineChange(event)">
                  <option value="" ${!initialProductLine ? 'selected' : ''}>（不指定）</option>
                  ${productLineOptions}
                </select>
                <div class="help">選擇產品線後，設備名稱會提供對應機型清單。</div>
              </div>

              <div class="form-group">
                <label class="form-label required machine-label"><span>設備名稱</span><button type="button" class="btn ghost sm machine-filter-btn" style="visibility:hidden;pointer-events:none;" onclick="RepairUI.toggleMachineFilter(event)">篩選</button></label>
<!-- 最終寫回的欄位（保持既有資料結構：machine） -->
<input type="hidden" name="machine" id="machine-final" value="${escapeAttr(currentMachine)}" />

<!-- 下拉搜尋（type-to-filter） -->
<div id="machine-search-wrap" class="machine-search-wrap" style="${(useSelectInitially && this._machineFilterOpen) ? '' : 'display:none;'}">
  <input
    type="text"
    id="machine-search"
    name="_machineSearch"
    class="input"
    value=""
    placeholder="搜尋機型（輸入即可篩選）"
    oninput="RepairUI.handleMachineSearchInput(event)"
    autocomplete="off"
  />
</div>

                <!-- 產品線模式：下拉清單 -->
                <select
                  name="_machinePick"
                  id="machine-select"
                  class="input"
                  style="${useSelectInitially ? '' : 'display:none;'}"
                  onchange="RepairUI.handleMachineSelectChange(event)"
                >
                  ${machineSelectOptions}
                </select>

                <!-- 手動輸入（產品線未指定或選擇『其他/手動輸入』時顯示） -->
                <input
                  type="text"
                  name="_machineManual"
                  id="machine-manual"
                  class="input"
                  value="${escapeAttr(machineManualValue)}"
                  placeholder="請輸入設備名稱"
                  style="${showManualInitially ? '' : 'display:none;'}"
                  oninput="RepairUI.handleMachineManualInput(event)"
                  autocomplete="off"
                />

                <div class="help" id="machine-help">${useSelectInitially ? '可從清單選擇；若清單沒有，請選擇「其他 / 手動輸入」。' : '未指定產品線時，請直接輸入設備名稱。'}</div>
              </div>
              
              <div class="form-group">
                <label class="form-label">序號</label>
                <input
                  type="text"
                  name="serialNumber"
                  class="input"
                  value="${escapeAttr(repair.serialNumber || '')}"
                  placeholder="請輸入設備序號"
                />
<div class="serial-suggest" id="serial-suggest" style="display:none;">
  <div class="serial-label">最近序號</div>
  <div class="quick-chips" id="serial-suggest-chips"></div>
</div>
              </div>
            </div>
          </div>
          
          <!-- 問題描述 -->
          <div class="form-section">
            <h4 class="form-section-title">問題描述</h4>
            
            <div class="form-group">
              <label class="form-label required">問題摘要</label>
              <input
                type="text"
                name="issue"
                class="input"
                value="${escapeAttr(repair.issue || '')}"
                placeholder="簡短描述問題"
                required
              />
            </div>
            
            <div class="form-group">
              <label class="form-label">工作內容（週報用）</label>
              <textarea
                name="content"
                class="input"
                rows="4"
                placeholder="請填寫本次實際處理內容（週報的「工作內容」會使用此欄位）"
              >${escapeHtml(repair.content || '')}</textarea>
            </div>
          </div>
          <!-- 零件相關 -->
          <div class="form-section">
            <h4 class="form-section-title">零件管理</h4>
            
            <div class="form-grid">
              <div class="form-group">
                <label class="form-checkbox">
                  <input
                    type="checkbox"
                    name="needParts"
                    ${repair.needParts ? 'checked' : ''}
                  onchange="RepairUI.handleNeedPartsChange(event)"
                  />
                  <span>需要零件</span>
                </label>
              </div>
              
              <div class="form-group">
                <label class="form-checkbox">
                  <input
                    type="checkbox"
                    name="partsOrdered"
                    ${repair.partsOrdered ? 'checked' : ''}
                  />
                  <span>已訂購</span>
                </label>
              </div>
              
              <div class="form-group">
                <label class="form-checkbox">
                  <input
                    type="checkbox"
                    name="partsArrived"
                    ${repair.partsArrived ? 'checked' : ''}
                  />
                  <span>已到貨</span>
                </label>
              </div>

              <div class="form-group">
                <label class="form-checkbox">
                  <input
                    type="checkbox"
                    name="partsReplaced"
                    ${repair.partsReplaced ? 'checked' : ''}
                  />
                  <span>已更換</span>
                </label>
              </div>
            </div>
          </div>
          
          <!-- 備註 -->
          <div class="form-section">
            <h4 class="form-section-title">備註</h4>
            
            <div class="form-group">
              <textarea
                name="notes"
                class="input"
                rows="3"
                placeholder="其他備註事項"
              >${escapeHtml(repair.notes || '')}</textarea>
            </div>
          </div>
          
          <input type="hidden" name="id" value="${escapeAttr(repair.id || '')}" />
        </form>
        
        <div class="modal-footer">
          <button type="button" class="btn" onclick="RepairUI.closeModal()">
            取消
          </button>
          <button type="submit" form="repair-form" class="btn primary">
            ${isEdit ? '更新' : '建立'}
          </button>
        </div>
      </div>
    `;
  },
  
  /**
   * 渲染詳情頁面
   */
  renderDetail() {
    const repair = this.currentRepair;
    if (!repair) return '';
    
    const display = window.RepairModel.toDisplay(repair);
    const history = window.RepairService.getHistory(repair.id);
    const historyCount = Array.isArray(history) ? history.length : 0;
    const historyTabLabel = historyCount ? `變更記錄 (${historyCount})` : '變更記錄';
    

    const escapeHtml = (input) => {
      const s = (input === null || input === undefined) ? '' : String(input);
      return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    };
    const escapeAttr = (input) => escapeHtml(input).split('\\n').join(' ').split('\\r').join(' ');
    const safeTelHref = (phone) => {
      const raw = (phone === null || phone === undefined) ? '' : String(phone);
      const cleaned = raw.replace(/[^0-9+]/g, '');
      return cleaned ? `tel:${cleaned}` : '';
    };
    const safeMailtoHref = (email) => {
      const raw = (email === null || email === undefined) ? '' : String(email).trim();
      // mailto: 後方只允許基本字元，避免引號/尖括號破壞 DOM
      const cleaned = raw.replace(/[^a-zA-Z0-9@._+\-]/g, '');
      return cleaned ? `mailto:${cleaned}` : '';
    };

    const safeId = escapeHtml(repair.id);
    const safeCustomer = escapeHtml(repair.customer);
    const safeContact = escapeHtml(repair.contact);
    const safePhone = escapeHtml(repair.phone);
    const safeEmail = escapeHtml(repair.email);
    const machineCatalog = (window.AppConfig && typeof window.AppConfig.getMachineCatalog === 'function')
      ? window.AppConfig.getMachineCatalog()
      : ((window.AppConfig && window.AppConfig.business && window.AppConfig.business.machineCatalog)
        ? window.AppConfig.business.machineCatalog
        : {});
    const inferProductLine = (machineName) => {
      try {
        const name = (machineName || '').toString().trim();
        if (!name) return '';
        for (const [line, models] of Object.entries(machineCatalog || {})) {
          if (Array.isArray(models) && models.includes(name)) return line;
        }
      } catch (_) {}
      return '';
    };
    const productLineValue = (repair.productLine || '').toString().trim() || inferProductLine(repair.machine);
    const safeProductLine = escapeHtml(productLineValue);
    const safeMachine = escapeHtml(repair.machine);
    const safeSerial = escapeHtml(repair.serialNumber);
    const safeIssue = escapeHtml(repair.issue);
    const safeContent = escapeHtml(repair.content || '').replace(/\n/g, '<br>');
    const safeNotes = escapeHtml(repair.notes || '').replace(/\n/g, '<br>');
    const safeCreatedDate = escapeHtml((repair.createdDate || '').toString());

    return `
      <div class="modal-dialog modal-wide">
        <div class="modal-header">
          <div class="detail-header-left">
            <button class="btn" onclick="RepairUI.closeModal()">← 返回</button>
            <div>
              <h3>${safeId}</h3>
            <span class="muted">📅 維修日期：${safeCreatedDate || display.createdAtFormatted.slice(0, 10)}</span>
          </div>
          </div>
          <button class="modal-close" onclick="RepairUI.closeModal()">✕</button>
        </div>
        
        <div class="modal-body">
          <!-- 標籤（P3：變更記錄） -->
          <div class="detail-tabbar chip-row" role="tablist" aria-label="維修詳情標籤">
            <button type="button" class="chip active" id="repair-detail-tab-btn-main" onclick="RepairUI.switchDetailTab('main')">總覽</button>
            <button type="button" class="chip" id="repair-detail-tab-btn-history" onclick="RepairUI.switchDetailTab('history')">${historyTabLabel}</button>
          </div>

          <div id="repair-detail-tab-main">
          <!-- 狀態與動作 -->
          <div class="detail-actions">
            <div class="detail-status">
              <span class="status-badge custom" style="--badge-color:${display.statusColor};">
                ${display.statusLabel}
              </span>
              <div class="progress-bar" style="flex: 1; --bar-color:${display.statusColor};">
                <div class="progress-fill" style="width: ${repair.progress}%;"></div>
              </div>
              <span class="progress-text">${repair.progress}%</span>
            </div>
            
            <div class="detail-buttons">
              <button class="btn" onclick="RepairUI.openForm('${repair.id}')">
                ✏️ 編輯
              </button>
              <button class="btn" type="button" onclick="RepairUI.duplicateRepair('${repair.id}')" title="複製成新維修單">
                📄 複製
              </button>
              <button class="btn danger" onclick="RepairUI.confirmDelete('${repair.id}')">
                🗑️ 刪除
              </button>
            </div>
          </div>
          
          <!-- 客戶資訊 -->
          <div class="detail-section">
            <h4 class="detail-section-title">客戶資訊</h4>
            <div class="detail-grid">
              <div class="detail-item">
                <div class="detail-label">客戶名稱</div>
                <div class="detail-value">${safeCustomer}</div>
              </div>
              
              ${repair.contact ? `
                <div class="detail-item">
                  <div class="detail-label">聯絡人</div>
                  <div class="detail-value">${safeContact}</div>
                </div>
              ` : ''}
              
              ${repair.phone ? `
                <div class="detail-item">
                  <div class="detail-label">電話</div>
                  <div class="detail-value">
                    <a href="${safeTelHref(repair.phone)}">${safePhone}</a>
                  </div>
                </div>
              ` : ''}
              
              ${repair.email ? `
                <div class="detail-item">
                  <div class="detail-label">Email</div>
                  <div class="detail-value">
                    <a href="${safeMailtoHref(repair.email)}">${safeEmail}</a>
                  </div>
                </div>
              ` : ''}
            </div>
          </div>
          
          <!-- 設備資訊 -->
          <div class="detail-section">
            <h4 class="detail-section-title">設備資訊</h4>
            <div class="detail-grid">
              ${safeProductLine ? `
                <div class="detail-item">
                  <div class="detail-label">產品線</div>
                  <div class="detail-value">${safeProductLine}</div>
                </div>
              ` : ''}

              <div class="detail-item">
                <div class="detail-label">設備名稱</div>
                <div class="detail-value">${safeMachine}</div>
              </div>
              
              ${repair.serialNumber ? `
                <div class="detail-item">
                  <div class="detail-label">序號</div>
                  <div class="detail-value">${safeSerial}</div>
                </div>
              ` : ''}
            </div>
          </div>

          <!-- 🛠 保養 / 結案連動（MNT-4） -->
          <section class="detail-block" id="repair-maintenance-mini">
            <div class="detail-title">🛠️ 保養 / 結案連動</div>
            <div class="detail-body">
              <div class="mini-summary" id="maintenance-summary" data-repair-id="${repair.id}">載入中...</div>
              <div class="chip-row" style="margin-top:10px;justify-content:flex-end;flex-wrap:wrap;" id="maintenance-actions" data-repair-id="${repair.id}">
                <button class="chip" type="button" onclick="RepairUI.openMaintenanceFromRepair('${repair.id}')">開啟保養</button>
                <button class="chip" type="button" onclick="RepairUI.createMaintenanceEquipmentFromRepair('${repair.id}')">建立設備</button>
                <button class="chip" type="button" onclick="RepairUI.addMaintenanceRecordFromRepair('${repair.id}')">＋建紀錄</button>
                <button class="chip" type="button" onclick="RepairUI.closeAndWriteMaintenance('${repair.id}')">✅ 結案並寫入保養</button>
              </div>
            </div>
          </section>
          
          <!-- 問題描述 -->
          <div class="detail-section">
            <h4 class="detail-section-title">問題描述</h4>
            <div class="detail-content">
              <div class="detail-issue">${repair.issue}</div>
              ${repair.content ? `
                <div class="detail-text">${safeContent}</div>
              ` : ''}
            </div>
          </div>
          
          <!-- 其他資訊 -->
          <div class="detail-section">
            <h4 class="detail-section-title">其他資訊</h4>
            <div class="detail-grid">
              <div class="detail-item">
                <div class="detail-label">優先級</div>
                <div class="detail-value">
                  <span class="badge custom" style="--badge-color:${display.priorityColor};">
                    ${display.priorityLabel}
                  </span>
                </div>
              </div>
              
              <div class="detail-item">
                <div class="detail-label">負責人</div>
                <div class="detail-value">${repair.ownerName}</div>
              </div>

              <div class="detail-item">
                <div class="detail-label">維修日期</div>
                <div class="detail-value">${safeCreatedDate || display.createdAtFormatted.slice(0, 10)}</div>
              </div>
              
              <div class="detail-item">
                <div class="detail-label">建立時間</div>
                <div class="detail-value">${display.createdAtFormatted}</div>
              </div>
              
              <div class="detail-item">
                <div class="detail-label">更新時間</div>
                <div class="detail-value">${display.updatedAtFormatted}</div>
              </div>
              
              <div class="detail-item">
                <div class="detail-label">維修天數</div>
                <div class="detail-value">${display.ageInDays} 天</div>
              </div>
              
              <div class="detail-item">
                <div class="detail-label">零件需求</div>
                <div class="detail-value">
                  ${repair.needParts ? `
                    <span class="badge badge-warning">需要零件</span>
                    ${repair.partsOrdered ? '<span class="badge badge-info">已訂購</span>' : ''}
                    ${repair.partsArrived ? '<span class="badge badge-success">已到貨</span>' : ''}
                    ${repair.partsReplaced ? '<span class="badge badge-success">已更換</span>' : ''}
                  ` : '不需要'}
                </div>
              </div>
            </div>
          </div>
          
          ${repair.notes ? `
            <div class="detail-section">
              <h4 class="detail-section-title">備註</h4>
              <div class="detail-content">
                <div class="detail-text">${safeNotes}</div>
              </div>
            </div>
          ` : ''}

          <!-- 零件追蹤（與維修單連動） -->
          <div class="detail-section" id="repair-detail-parts">
            <h4 class="detail-section-title">零件追蹤</h4>
            <div class="detail-content">
              <div class="muted" style="margin-bottom:8px;line-height:1.5">
                用於追蹤更換零件狀態（需求 → 報價 → 下單 → 到貨 → 更換）。
              </div>
              <div id="repair-parts-mini" data-repair-id="${repair.id}">
                <div class="muted">載入中...</div>
              </div>
              <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
                <button class="btn" onclick="RepairUI.openRepairParts('${repair.id}')">管理零件</button>
                <button class="btn" onclick="RepairUI.openRepairParts('${repair.id}', { quickAdd: true })">+ 新增用料</button>
              </div>
            </div>
          </div>
          
          <!-- 報價 / 訂單（V161.105） -->
          <section class="detail-block" id="repair-quote-order-mini">
            <div class="detail-title">報價 / 訂單</div>
            <div class="detail-body">
              <!-- 摘要 Chips（由 RepairUI.refreshQuoteOrderSummary() 渲染） -->
              <div class="mini-summary" id="quote-order-summary">載入中...</div>

              <!-- 動作 Chips（建立/開啟） -->
              <div class="chip-row" style="margin-top:10px;justify-content:flex-end;" id="quote-order-actions">
                <button class="chip" type="button" id="btn-open-create-quote" data-action="quote-open-create">建立報價</button>
                <button class="chip" type="button" id="btn-open-create-order" data-action="order-open-create">建立訂單</button>
              </div>
            </div>
          </section>

          <!-- 附件（未啟用）（V161.105） -->
          <section class="detail-block" id="repair-attachments-placeholder">
            <div class="detail-title">附件</div>
            <div class="detail-body">
              <div class="muted">附件功能尚未啟用（目前僅保留占位）。</div>
              <div style="margin-top:8px;">
                <button class="btn" type="button" disabled>上傳附件（尚未啟用）</button>
              </div>
            </div>
          </section>

          </div><!-- /repair-detail-tab-main -->

          <div id="repair-detail-tab-history" style="display:none;">
            <div class="detail-section" id="repair-detail-history">
              <h4 class="detail-section-title">變更記錄</h4>
              ${historyCount > 0 ? `
                <div class="detail-timeline">
                  ${history.map(h => this.renderHistoryItem(h)).join('')}
                </div>
              ` : `<div class="muted">尚無變更記錄</div>`}
            </div>
          </div><!-- /repair-detail-tab-history -->
        </div>
      </div>
    `;
  },
  
  /**
   * 渲染歷程項目
   */
  renderHistoryItem(history) {
  const date = window.RepairModel.formatDateTime(history.timestamp);

  // HTML 安全：避免歷史內容包含引號/尖括號導致 DOM 破壞或無法操作
  const escapeHtml = (input) => {
    const s = (input === null || input === undefined) ? '' : String(input);
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };
  const escapeAttr = (input) => escapeHtml(input).split('\\n').join(' ').split('\\r').join(' ');

  // 欄位名稱對照
  const fieldLabel = {
    customer: '客戶名稱',
    contact: '聯絡人',
    phone: '電話',
    email: 'Email',
    machine: '設備名稱',
    serialNumber: '序號',
    issue: '問題描述',
    content: '處理內容',
    status: '狀態',
    progress: '進度',
    priority: '優先級',
    needParts: '需要零件',
    partsOrdered: '已下單',
    partsArrived: '已到貨',
    partsReplaced: '已更換',
    notes: '備註',
    tags: '標籤',
    attachments: '附件'
  };

  const action = (history.action || '').toString().toUpperCase();
  const byName = history.byName || '';

  const toText = (v) => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'boolean') return v ? '是' : '否';
    if (Array.isArray(v)) return v.join(', ');
    return String(v);
  };

  const clip = (s, n = 60) => {
    const str = (s || '').toString();
    if (str.length <= n) return str;
    return str.slice(0, n) + '…';
  };

  // 依 action 決定標題
  let title = '';
  if (action === 'CREATE') title = '建立維修單';
  else if (action === 'DELETE') title = '刪除維修單';
  else if (action === 'UPDATE') title = '更新維修單';
  else if (history.fromStatus || history.toStatus) title = '狀態更新';
  else title = '更新';

  // 舊版相容：若有 fromStatus/toStatus，顯示狀態箭頭
  const statusLine = (history.fromStatus || history.toStatus) && (history.fromStatus !== history.toStatus)
    ? `${history.fromStatus || ''} → ${history.toStatus || ''}`
    : '';

  // 變更清單（最多顯示 6 筆）
  const changes = Array.isArray(history.changed) ? history.changed : [];
  const maxItems = 6;
  const shown = changes.slice(0, maxItems);
  const moreCount = Math.max(0, changes.length - shown.length);

  const changeHtml = shown.length > 0 ? `
    <div class="timeline-changes">
      ${shown.map(c => {
        const label = fieldLabel[c.field] || c.field;
        const from = clip(toText(c.from), 40);
        const to = clip(toText(c.to), 40);
        const safeTitle = escapeAttr(`${label}: ${toText(c.from)} → ${toText(c.to)}`);
        return `
          <div class="timeline-change" title="${safeTitle}">
            <span class="timeline-change-label">${escapeHtml(label)}</span>
            <span class="timeline-change-value">${escapeHtml(from)} → ${escapeHtml(to)}</span>
          </div>
        `;
      }).join('')}
      ${moreCount > 0 ? `<div class="timeline-more">＋${moreCount} 項變更</div>` : ''}
    </div>
  ` : '';

  const safeTitleText = escapeHtml(title);
  const safeStatusLine = escapeHtml(statusLine);
  const safeNote = history.note ? escapeHtml(history.note).replace(/\n/g, '<br>') : '';
  const safeByName = escapeHtml(byName);

  return `
    <div class="timeline-item">
      <div class="timeline-marker"></div>
      <div class="timeline-content">
        <div class="timeline-header">
          <span class="timeline-action">
            ${safeTitleText}${statusLine ? `：${safeStatusLine}` : ''}
          </span>
          <span class="timeline-date">${date}</span>
        </div>

        ${history.note ? `<div class="timeline-note">${safeNote}</div>` : ''}

        ${changeHtml}

        <div class="timeline-user">👤 ${safeByName}</div>
      </div>
    </div>
  `;
},

/**
 * 表單送出（新增/更新）
 * - 一律 preventDefault，避免瀏覽器原生 submit 造成整頁 reload（看起來像「重登」）
 */
  async handleSubmit(event) {
    event.preventDefault();

    if (this._submitting) return;

    const form = event.target;
    // P3：必填欄位即時驗證（僅針對既有 required 欄位）
    try {
      if (form && window.FormValidate) {
        window.FormValidate.bindForm(form);
        const ok = window.FormValidate.validateForm(form);
        if (!ok) {
          if (window.UI && typeof window.UI.toast === 'function') window.UI.toast('請補齊必填欄位', { type: 'warning' });
          return;
        }
      } else if (form && typeof form.reportValidity === 'function') {
        // 保底：使用瀏覽器原生驗證（若有 required）
        if (!form.reportValidity()) return;
      }
    } catch (e) {
      console.warn('form validate failed:', e);
    }

    this._submitting = true;

    const submitBtn = document.querySelector('button[form="repair-form"][type="submit"]');
    const originalText = submitBtn ? submitBtn.textContent : '';

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = '儲存中...';
    }

    try {
      const formData = new FormData(form);
      const data = {};
      for (const [key, value] of formData.entries()) {
        data[key] = (value ?? '').toString();
      }

      const id = (data.id || '').trim();
      delete data.id;

      // 表單輔助欄位（不寫入資料庫）
      delete data._machinePick;
      delete data._machineManual;
      delete data._machineSearch;// P0：機型搜尋欄位不寫入資料庫


      // Checkbox（未勾選時 FormData 不會帶值）
      const boolVal = (name) => !!form.querySelector(`input[name="${name}"]`)?.checked;
      data.needParts = boolVal('needParts');
      data.partsOrdered = boolVal('partsOrdered');
      data.partsArrived = boolVal('partsArrived');
      data.partsReplaced = boolVal('partsReplaced');

      // 數值
      const p = Number(data.progress || 0);
      data.progress = Number.isFinite(p) ? p : 0;

      // 字串 trim（避免搜尋/顯示混亂）
      [
        'customer','contact','phone','email',
        'productLine','machine','serialNumber','issue','content','notes'
      ].forEach(k => {
        if (typeof data[k] === 'string') data[k] = data[k].trim();
      });

      // P0：資料品質檢查（電話/Email）
      const email = (data.email || '').toString().trim();
      if (email) {
        const okEmail = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
        if (!okEmail) {
          const msg = 'Email 格式不正確';
          if (window.UI && typeof window.UI.toast === 'function') window.UI.toast(msg, { type: 'warning' });
          else alert(msg);
          try { form.querySelector('input[name="email"]')?.focus?.(); } catch (_) {}
          return;
        }
      }
      const phone = (data.phone || '').toString().trim();
      if (phone) {
        const digits = phone.replace(/[^0-9]/g, '');
        const okPhone = digits.length >= 6 && digits.length <= 20;
        if (!okPhone) {
          const msg = '電話格式不正確（建議至少 6 碼數字）';
          if (window.UI && typeof window.UI.toast === 'function') window.UI.toast(msg, { type: 'warning' });
          else alert(msg);
          try { form.querySelector('input[name="phone"]')?.focus?.(); } catch (_) {}
          return;
        }
      }

      // 維修日期（YYYY-MM-DD）
      if (typeof data.createdDate === 'string') data.createdDate = data.createdDate.trim();

      if (!window.RepairService) throw new Error('RepairService not found');

      // 狀態/進度規則由 Model 統一正規化（create/update 內會處理）
      if (id) {
        await window.RepairService.update(id, data);
      } else {
        await window.RepairService.create(data);
      }

      // 注意：V161.133 起不再把「產品線/設備/優先級」寫入 localStorage 作為下一次新增預設
      // （避免新增表單出現使用者未選擇的內建值）

      // 成功後關閉 modal
      if (window.RepairUI && typeof window.RepairUI.closeModal === 'function') {
        window.RepairUI.closeModal();
      }
    } catch (error) {
      console.error('Repair submit error:', error);
      const msg = '儲存失敗：' + (error?.message || error);
      if (window.UI && typeof window.UI.toast === 'function') window.UI.toast(msg, { type: 'error' });
      else alert(msg);
    } finally {
      this._submitting = false;
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText || '儲存';
      }
    }
  },

  /**
   * 狀態變更：同步進度與「需要零件」勾選
   */
  handleStatusChange(event) {
    try {
      const status = (event?.target?.value || '').toString();
      const form = document.getElementById('repair-form');
      if (!form) return;

      const progressEl = form.querySelector('input[name="progress"]');
      const progressValueEl = document.getElementById('progress-value');
      const needPartsEl = form.querySelector('input[name="needParts"]');

      // 依狀態給預設進度
      const defaultProgress = (window.RepairModel && typeof window.RepairModel.getProgressByStatus === 'function')
        ? window.RepairModel.getProgressByStatus(status)
        : (status === '已完成' ? 100 : (status === '需要零件' ? 50 : 10));

      if (needPartsEl) {
        needPartsEl.checked = status === '需要零件';
        if (status === '已完成') needPartsEl.checked = false;
      }

      if (progressEl) progressEl.value = String(defaultProgress);
      if (progressValueEl) progressValueEl.textContent = String(defaultProgress);
    } catch (e) {
      console.warn('handleStatusChange failed:', e);
    }
  },

  /**
   * 需要零件：勾選時強制狀態=需要零件（反之回到進行中）
   */
  handleNeedPartsChange(event) {
    try {
      const checked = !!event?.target?.checked;
      const form = document.getElementById('repair-form');
      if (!form) return;

      const statusEl = form.querySelector('select[name="status"]');
      const progressEl = form.querySelector('input[name="progress"]');
      const progressValueEl = document.getElementById('progress-value');

      const status = checked ? '需要零件' : '進行中';
      const defaultProgress = (window.RepairModel && typeof window.RepairModel.getProgressByStatus === 'function')
        ? window.RepairModel.getProgressByStatus(status)
        : (checked ? 50 : 10);

      if (statusEl) statusEl.value = status;
      if (progressEl) progressEl.value = String(defaultProgress);
      if (progressValueEl) progressValueEl.textContent = String(defaultProgress);
    } catch (e) {
      console.warn('handleNeedPartsChange failed:', e);
    }
  },

  /**
   * 進度拉桿：即時更新顯示，並同步狀態（100% -> 已完成）
   */
  handleProgressChange(event) {
    try {
      const value = Number(event?.target?.value || 0);
      const progress = Number.isFinite(value) ? value : 0;

      const progressValueEl = document.getElementById('progress-value');
      if (progressValueEl) progressValueEl.textContent = String(progress);

      const form = document.getElementById('repair-form');
      if (!form) return;

      const statusEl = form.querySelector('select[name="status"]');
      const needPartsEl = form.querySelector('input[name="needParts"]');

      if (progress >= 100) {
        if (statusEl) statusEl.value = '已完成';
        if (needPartsEl) needPartsEl.checked = false;
      } else if (needPartsEl?.checked) {
        if (statusEl) statusEl.value = '需要零件';
      } else {
        if (statusEl) statusEl.value = '進行中';
      }
    } catch (e) {
      console.warn('handleProgressChange failed:', e);
    }
  }

  ,
  // ------------------------------
  // 設備產品線 / 機型級聯選擇
  // ------------------------------
  initEquipmentPicker() {
    try {
      const form = document.getElementById('repair-form');
      if (!form) return;

      const plEl = document.getElementById('product-line');
      const selectEl = document.getElementById('machine-select');
      const manualEl = document.getElementById('machine-manual');
      const finalEl = document.getElementById('machine-final');
      const helpEl = document.getElementById('machine-help');

      const searchWrapEl = document.getElementById('machine-search-wrap');
      const searchEl = document.getElementById('machine-search');


       // 預設不顯示機型篩選輸入框（避免設備名稱欄位變成兩排，必要時由使用者手動展開）
       this._machineFilterOpen = false;
       if (searchWrapEl) searchWrapEl.style.display = 'none';
       if (searchEl) searchEl.value = '';
      if (!plEl || !selectEl || !manualEl || !finalEl) return;

      // 以目前值重算一次（避免瀏覽器回填 / 快取導致顯示不同步）
      this._syncEquipmentPickerState({
        productLine: (plEl.value || '').toString(),
        currentMachine: (finalEl.value || '').toString()
      });

// 搜尋框：Enter 快速套用（當篩選後只剩 1 個選項時）
if (searchEl && !searchEl.dataset.bound) {
  searchEl.dataset.bound = '1';
  searchEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    try {
      const sel = document.getElementById('machine-select');
      if (!sel || sel.disabled || sel.style.display === 'none') return;
      const options = Array.from(sel.options || []).filter(o => o && o.value && o.value !== '__manual__');
      if (options.length === 1) {
        sel.value = options[0].value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
    } catch (_) {}
  });
}

      // required 切換（只讓「目前可輸入的欄位」要求必填）
      const applyRequired = () => {
        const manualVisible = manualEl.style.display !== 'none';
        const selectVisible = selectEl.style.display !== 'none';
        manualEl.required = !!manualVisible;
        selectEl.required = !!selectVisible;
        // 避免 select 在 disabled 時觸發 required 報錯
        if (selectEl.disabled) selectEl.required = false;
      };

      applyRequired();

       // 初始時同步篩選按鈕狀態（避免 display 切換造成欄位上下跳動）
       // - 使用 visibility 隱藏以保留版面空間，避免「選產品線後設備名稱欄位位置跑掉」
       try {
         const listMode = !!(plEl.value && !selectEl.disabled && selectEl.style.display !== 'none');
         const filterBtn = document.querySelector('.machine-filter-btn');
         if (filterBtn) {
           filterBtn.style.visibility = listMode ? 'visible' : 'hidden';
           filterBtn.style.pointerEvents = listMode ? '' : 'none';
         }
       } catch (_) {}

      // 再掛一層，確保任何切換後都會更新
      this._applyEquipmentRequired = applyRequired;

      // 初始提示
      if (helpEl) {
        helpEl.textContent = (plEl.value ? '可從清單選擇；若清單沒有，請選擇「其他 / 手動輸入」。' : '未指定產品線時，請直接輸入設備名稱。');
      }
    } catch (e) {
      console.warn('initEquipmentPicker failed:', e);
    }
  },

  _syncEquipmentPickerState({ productLine, currentMachine } = {}) {
    const catalog = (window.AppConfig && typeof window.AppConfig.getMachineCatalog === 'function')
      ? window.AppConfig.getMachineCatalog()
      : ((window.AppConfig && window.AppConfig.business && window.AppConfig.business.machineCatalog)
        ? window.AppConfig.business.machineCatalog
        : {});

    const plEl = document.getElementById('product-line');
    const selectEl = document.getElementById('machine-select');
    const manualEl = document.getElementById('machine-manual');
    const finalEl = document.getElementById('machine-final');
    const helpEl = document.getElementById('machine-help');

    if (!plEl || !selectEl || !manualEl || !finalEl) return;

    const line = (productLine ?? plEl.value ?? '').toString().trim();
    const models = (line && Array.isArray(catalog[line])) ? catalog[line] : [];
    const searchWrapEl = document.getElementById('machine-search-wrap');
    const searchEl = document.getElementById('machine-search');

    // machine picker state cache (for type-to-filter)
    const prevLine = (this._machinePickerPrevLine || '').toString();
    const lineChanged = prevLine !== line;
    this._machinePickerPrevLine = line;
    this._machinePickerModels = Array.isArray(models) ? models.slice() : [];

    const listMode = !!(line && models.length > 0);

    // 篩選按鈕：僅在清單模式可用，但不切 display（避免造成 reflow / 欄位上下跳動）
    const filterBtn = document.querySelector('.machine-filter-btn');
    if (filterBtn) {
      filterBtn.style.visibility = listMode ? 'visible' : 'hidden';
      filterBtn.style.pointerEvents = listMode ? '' : 'none';
    }
    if (!listMode) this._machineFilterOpen = false;


    // 顯示/隱藏搜尋框；產品線變更時清空搜尋，避免殘留造成「看起來沒資料」
    if (searchWrapEl) searchWrapEl.style.display = (listMode && this._machineFilterOpen) ? '' : 'none';
    if (searchEl) {
      if (!listMode || !this._machineFilterOpen) searchEl.value = '';
      else if (lineChanged) searchEl.value = '';
    }

    const machineVal = (currentMachine ?? finalEl.value ?? '').toString().trim();

    // 清單模式
    if (line && models.length > 0) {
      // 顯示 select
      selectEl.style.display = '';
      selectEl.disabled = false;
      // 更新 options（避免產品線切換後仍殘留上一線的選項）
      // - 支援 type-to-filter：依搜尋字串篩選機型
      // - 若目前 machineVal 不符合篩選條件，仍保留一筆「目前」選項（避免值消失）
      const term = (searchEl?.value || '').toString().trim().toLowerCase();
      const filtered = term
        ? (models || []).filter(m => (m || '').toString().toLowerCase().includes(term))
        : (models || []);

      const inList = models.includes(machineVal);
      const includeCurrent = !!(term && machineVal && inList && !filtered.includes(machineVal));

      const optionsHtml = [
        `<option value="">${term ? '（請選擇）' : '請選擇設備名稱'}</option>`,
        ...(includeCurrent ? [`<option value="${this._escapeAttr(machineVal)}">${this._escapeHtml(machineVal)}（目前）</option>`] : []),
        ...filtered.map(m => `<option value="${this._escapeAttr(m)}">${this._escapeHtml(m)}</option>`),
        `<option value="__manual__">其他 / 手動輸入</option>`
      ].join('');
      selectEl.innerHTML = optionsHtml;

      if (machineVal && inList) {
        selectEl.value = machineVal;
        manualEl.style.display = 'none';
        manualEl.value = '';
        finalEl.value = machineVal;
      } else if (machineVal) {
        // 現有值不在清單：改走手動
        selectEl.value = '__manual__';
        manualEl.style.display = '';
        manualEl.value = machineVal;
        finalEl.value = machineVal;
      } else {
        // 尚未填寫：保持等待選擇
        selectEl.value = '';
        manualEl.style.display = 'none';
        manualEl.value = '';
        finalEl.value = '';
      }


      if (helpEl) helpEl.textContent = '可從清單選擇；若清單沒有，請選擇「其他 / 手動輸入」。';
    } else {
      // 手動模式（未指定產品線）
      selectEl.style.display = 'none';
      selectEl.disabled = true;
      if (searchWrapEl) searchWrapEl.style.display = 'none';
      if (searchEl) searchEl.value = '';
      manualEl.style.display = '';
      manualEl.value = machineVal;
      finalEl.value = machineVal;
      if (helpEl) helpEl.textContent = '未指定產品線時，請直接輸入設備名稱。';
    }

    // required 同步
    try { if (typeof this._applyEquipmentRequired === 'function') this._applyEquipmentRequired(); } catch (_) {}
  },

  handleProductLineChange(event) {
    try {
      const line = (event?.target?.value || '').toString();
      const finalEl = document.getElementById('machine-final');
      const current = (finalEl?.value || '').toString();
      this._syncEquipmentPickerState({ productLine: line, currentMachine: current });
      try { if (typeof this.updateSerialHints === 'function') this.updateSerialHints(); } catch (_) {}
    } catch (e) {
      console.warn('handleProductLineChange failed:', e);
    }
  },

  handleMachineSelectChange(event) {
    try {
      const value = (event?.target?.value || '').toString();
      const manualEl = document.getElementById('machine-manual');
      const finalEl = document.getElementById('machine-final');
      if (!finalEl || !manualEl) return;

      if (value === '__manual__') {
        manualEl.style.display = '';
        manualEl.focus?.();
        finalEl.value = (manualEl.value || '').toString().trim();
      } else {
        manualEl.style.display = 'none';
        manualEl.value = '';
        finalEl.value = (value || '').toString().trim();
      }

      try { if (typeof this._applyEquipmentRequired === 'function') this._applyEquipmentRequired(); } catch (_) {}

      try { if (typeof this.updateSerialHints === 'function') this.updateSerialHints(); } catch (_) {}
    } catch (e) {
      console.warn('handleMachineSelectChange failed:', e);
    }
  },

  handleMachineManualInput(event) {
    try {
      const value = (event?.target?.value || '').toString();
      const finalEl = document.getElementById('machine-final');
      if (finalEl) finalEl.value = value;
      try { if (typeof this.updateSerialHints === 'function') this.updateSerialHints(); } catch (_) {}
    } catch (e) {
      console.warn('handleMachineManualInput failed:', e);
    }
  },
  // 設備名稱下拉：type-to-filter（不影響最終 machine 值，僅協助快速定位）
  handleMachineSearchInput(event) {
    try {
      const term = (event?.target?.value || '').toString();
      this._applyMachineTypeFilter(term);
    } catch (e) {
      console.warn('handleMachineSearchInput failed:', e);
    }
  },

  // 設備名稱：展開/收合「機型篩選」輸入框（避免預設出現兩排控制項）
  toggleMachineFilter(event) {
    try {
      const wrap = document.getElementById('machine-search-wrap');
      const searchEl = document.getElementById('machine-search');
      if (!wrap) return;

      const isHidden = (wrap.style.display === 'none' || (window.getComputedStyle && window.getComputedStyle(wrap).display === 'none'));
      const nextShow = !!isHidden;
      this._machineFilterOpen = nextShow;
      wrap.style.display = nextShow ? '' : 'none';

      if (searchEl) {
        if (nextShow) {
          searchEl.focus?.();
        } else {
          // 收合時清空關鍵字並還原選項
          searchEl.value = '';
          try { if (typeof this._applyMachineTypeFilter === 'function') this._applyMachineTypeFilter(''); } catch (_) {}
        }
      }
    } catch (e) {
      console.warn('toggleMachineFilter failed:', e);
    }
  },

  _applyMachineTypeFilter(termRaw = '') {
    const selectEl = document.getElementById('machine-select');
    const finalEl = document.getElementById('machine-final');
    const manualEl = document.getElementById('machine-manual');
    const searchEl = document.getElementById('machine-search');
    if (!selectEl || !finalEl) return;
    if (selectEl.style.display === 'none' || selectEl.disabled) return;

    const models = Array.isArray(this._machinePickerModels) ? this._machinePickerModels : [];
    const term = (termRaw || searchEl?.value || '').toString().trim().toLowerCase();

    const filtered = term
      ? models.filter(m => (m || '').toString().toLowerCase().includes(term))
      : models;

    const currentSelectValue = (selectEl.value || '').toString();
    const machineVal = (finalEl.value || '').toString().trim();

    const selectedModel = (currentSelectValue && currentSelectValue !== '__manual__') ? currentSelectValue : (models.includes(machineVal) ? machineVal : '');
    const includeSelected = !!(selectedModel && !filtered.includes(selectedModel) && models.includes(selectedModel));

    const optionsHtml = [
      `<option value="">${term ? '（請選擇）' : '請選擇設備名稱'}</option>`,
      ...(includeSelected ? [`<option value="${this._escapeAttr(selectedModel)}">${this._escapeHtml(selectedModel)}（目前）</option>`] : []),
      ...filtered.map(m => `<option value="${this._escapeAttr(m)}">${this._escapeHtml(m)}</option>`),
      `<option value="__manual__">其他 / 手動輸入</option>`
    ].join('');

    selectEl.innerHTML = optionsHtml;

    // 還原選擇與 UI 狀態（不強制覆寫 finalEl）
    if (currentSelectValue === '__manual__') {
      selectEl.value = '__manual__';
      if (manualEl) manualEl.style.display = '';
    } else if (selectedModel && (includeSelected || filtered.includes(selectedModel))) {
      selectEl.value = selectedModel;
    } else {
      selectEl.value = '';
    }

    try { if (typeof this._applyEquipmentRequired === 'function') this._applyEquipmentRequired(); } catch (_) {}
  },


  _escapeHtml(input) {
    const s = (input === null || input === undefined) ? '' : String(input);
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  _escapeAttr(input) {
    return this._escapeHtml(input).split('\n').join(' ').split('\r').join(' ');
  }
});

console.log('✅ RepairUI (Forms & Details) loaded');


// Static delegates：讓 HTML inline handler 可直接呼叫 RepairUI.xxx
// （RepairUI 實作主要在 window.repairUI 實例上）
Object.assign(RepairUI, {
  handleSubmit: (event) => {
    try { if (typeof window.repairUI?.handleSubmit === 'function') return window.repairUI.handleSubmit(event); }
    catch (e) { console.warn('handleSubmit failed:', e); }
  },
  handleStatusChange: (event) => {
    try { if (typeof window.repairUI?.handleStatusChange === 'function') return window.repairUI.handleStatusChange(event); }
    catch (e) { console.warn('handleStatusChange failed:', e); }
  },
  handleProgressChange: (event) => {
    try { if (typeof window.repairUI?.handleProgressChange === 'function') return window.repairUI.handleProgressChange(event); }
    catch (e) { console.warn('handleProgressChange failed:', e); }
  },
  handleNeedPartsChange: (event) => {
    try { if (typeof window.repairUI?.handleNeedPartsChange === 'function') return window.repairUI.handleNeedPartsChange(event); }
    catch (e) { console.warn('handleNeedPartsChange failed:', e); }
  },
  handleCustomerPick: (event) => {
    try { if (typeof window.repairUI?.handleCustomerPick === 'function') return window.repairUI.handleCustomerPick(event); }
    catch (e) { console.warn('handleCustomerPick failed:', e); }
  },
  handleContactPick: (event) => {
    try { if (typeof window.repairUI?.handleContactPick === 'function') return window.repairUI.handleContactPick(event); }
    catch (e) { console.warn('handleContactPick failed:', e); }
  },
  handleProductLineChange: (event) => {
    try { if (typeof window.repairUI?.handleProductLineChange === 'function') return window.repairUI.handleProductLineChange(event); }
    catch (e) { console.warn('handleProductLineChange failed:', e); }
  },
  handleMachineSelectChange: (event) => {
    try { if (typeof window.repairUI?.handleMachineSelectChange === 'function') return window.repairUI.handleMachineSelectChange(event); }
    catch (e) { console.warn('handleMachineSelectChange failed:', e); }
  },
  handleMachineManualInput: (event) => {
    try { if (typeof window.repairUI?.handleMachineManualInput === 'function') return window.repairUI.handleMachineManualInput(event); }
    catch (e) { console.warn('handleMachineManualInput failed:', e); }
  },
  handleMachineSearchInput: (event) => {
    try { if (typeof window.repairUI?.handleMachineSearchInput === 'function') return window.repairUI.handleMachineSearchInput(event); }
    catch (e) { console.warn('handleMachineSearchInput failed:', e); }
  },
  toggleMachineFilter: (event) => {
    try { if (typeof window.repairUI?.toggleMachineFilter === 'function') return window.repairUI.toggleMachineFilter(event); }
    catch (e) { console.warn('toggleMachineFilter failed:', e); }
  },
  confirmDelete: (id) => {
    try { if (typeof window.repairUI?.confirmDelete === 'function') return window.repairUI.confirmDelete(id); }
    catch (e) { console.warn('confirmDelete failed:', e); }
  },

  // MNT-4：維修單 ↔ 保養連動
  openMaintenanceFromRepair: (id) => {
    try { if (typeof window.repairUI?.openMaintenanceFromRepair === 'function') return window.repairUI.openMaintenanceFromRepair(id); }
    catch (e) { console.warn('openMaintenanceFromRepair failed:', e); }
  },
  createMaintenanceEquipmentFromRepair: (id) => {
    try { if (typeof window.repairUI?.createMaintenanceEquipmentFromRepair === 'function') return window.repairUI.createMaintenanceEquipmentFromRepair(id); }
    catch (e) { console.warn('createMaintenanceEquipmentFromRepair failed:', e); }
  },
  addMaintenanceRecordFromRepair: (id) => {
    try { if (typeof window.repairUI?.addMaintenanceRecordFromRepair === 'function') return window.repairUI.addMaintenanceRecordFromRepair(id); }
    catch (e) { console.warn('addMaintenanceRecordFromRepair failed:', e); }
  },
  closeAndWriteMaintenance: (id) => {
    try { if (typeof window.repairUI?.closeAndWriteMaintenance === 'function') return window.repairUI.closeAndWriteMaintenance(id); }
    catch (e) { console.warn('closeAndWriteMaintenance failed:', e); }
  }
});
