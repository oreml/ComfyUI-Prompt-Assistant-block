/**
 * 小助手設置服務
 * 負責管理小助手的設置選項，提供開關控制功能
 */

import { app } from "../../../../scripts/app.js";
import { logger } from '../utils/logger.js';
import { PromptAssistant } from "./PromptAssistant.js";
import { ImageCaption } from "./imageCaption.js";
import { EventManager } from "../utils/eventManager.js";
import { ResourceManager } from "../utils/resourceManager.js";
import { HistoryCacheService, TagCacheService, TranslateCacheService, CACHE_CONFIG } from "../services/cache.js";
import { UIToolkit } from "../utils/UIToolkit.js";
import { FEATURES, handleFeatureChange } from "../services/features.js";
import { APIService } from "../services/api.js";

import { apiConfigManager } from "./apiConfigManager.js";
import { rulesConfigManager } from "./rulesConfigManager.js";
import {
    createSettingsDialog,
    closeModalWithAnimation,
    createFormGroup,
    createInputGroup,
    createSelectGroup,
    createHorizontalFormGroup,
    createLoadingButton
} from "./uiComponents.js";

// 標記是否是首次加載頁面
let isFirstLoad = true;

// ---服務選擇器配置---
const SERVICE_TYPES = {
    translate: {
        name: '翻譯',
        configEndpoint: '/config/translate',
        serviceType: 'translate',
        filterKey: 'llm_models',
        includeGoogle: true,
        includeBaidu: true
    },
    llm: {
        name: '提示詞優化',
        configEndpoint: '/config/llm',
        serviceType: 'llm',
        filterKey: 'llm_models',
        includeBaidu: false
    },
    vlm: {
        name: '圖像反推',
        configEndpoint: '/config/vision',
        serviceType: 'vlm',
        filterKey: 'vlm_models',
        includeBaidu: false
    }
};

// ---服務選擇器---
const serviceSelector = {
    _servicesCache: null,
    _cacheTime: 0,
    _cacheDuration: 2000, // 緩存2秒

    /**
     * 清除服務緩存
     */
    clearCache() {
        this._servicesCache = null;
        this._cacheTime = 0;
        logger.debug('服務列表緩存已清除');
    },

    // 獲取服務列表（帶緩存）
    async getServices(forceRefresh = false) {
        const now = Date.now();
        if (!forceRefresh && this._servicesCache && (now - this._cacheTime) < this._cacheDuration) {
            return this._servicesCache;
        }

        try {
            const response = await fetch(APIService.getApiUrl('/services'));
            if (response.ok) {
                const data = await response.json();
                if (data.success) {
                    this._servicesCache = data.services || [];
                    this._cacheTime = now;
                    return this._servicesCache;
                }
            }
        } catch (error) {
            logger.error(`獲取服務列表失敗: ${error.message}`);
        }
        return [];
    },

    // 獲取指定類型的當前服務ID
    async getCurrentService(type) {
        const config = SERVICE_TYPES[type];
        if (!config) return null;

        try {
            const response = await fetch(APIService.getApiUrl(config.configEndpoint));
            if (response.ok) {
                const data = await response.json();
                return data.provider || null;
            }
        } catch (error) {
            logger.error(`獲取${config.name}當前服務失敗: ${error.message}`);
        }
        return null;
    },

    // 設置指定類型的服務
    async setCurrentService(type, serviceId) {
        const config = SERVICE_TYPES[type];
        if (!config) return false;

        try {
            const response = await fetch(APIService.getApiUrl('/services/current'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    service_type: config.serviceType,
                    service_id: serviceId
                })
            });

            if (response.ok) {
                logger.log(`${config.name}服務切換 | 服務ID: ${serviceId}`);

                // 派發全局事件通知其他組件同步
                window.dispatchEvent(new CustomEvent('pa-service-changed', {
                    detail: { service_type: config.serviceType, service_id: serviceId }
                }));

                return true;
            }
        } catch (error) {
            logger.error(`切換${config.name}服務失敗: ${error.message}`);
        }
        return false;
    },

    // 獲取指定類型可用的服務選項列表
    async getServiceOptions(type) {
        const config = SERVICE_TYPES[type];
        if (!config) return [];

        const services = await this.getServices();
        const options = [];

        // 添加機器翻譯選項（Google 為首位，僅翻譯類型）
        if (config.includeGoogle) {
            options.push({ value: 'google', text: 'Google 翻譯' });
        }
        if (config.includeBaidu) {
            options.push({ value: 'baidu', text: '百度翻譯' });
        }

        // 過濾並添加其他服務
        services
            .filter(service => {
                const models = service[config.filterKey];
                return models && models.length > 0;
            })
            .forEach(service => {
                options.push({
                    value: service.id,
                    text: service.name || service.id
                });
            });

        return options;
    }
};

// 將服務選擇器掛載到全局 app 對象，方便其他模組（如 PromptAssistant.js, imageCaption.js）調用，
// 同時避免模組間的循環引用問題。
app.paServiceSelector = serviceSelector;

// ---版本檢查工具函數---

// 版本檢查狀態緩存
let versionCheckCache = {
    checked: false,        // 是否已檢查過
    latestVersion: null,   // 最新版本號
    hasUpdate: false       // 是否有更新
};

/**
 * 從 jsDelivr 獲取最新版本號（通過讀取 pyproject.toml）
 * @returns {Promise<string|null>} 返回最新版本號，格式如 "1.2.3"，失敗返回 null
 */
async function fetchLatestVersion() {
    // 如果已經檢查過，直接返回緩存結果
    if (versionCheckCache.checked) {
        return versionCheckCache.latestVersion;
    }

    try {
        const response = await fetch('https://cdn.jsdelivr.net/gh/yawiii/ComfyUI-Prompt-Assistant@main/pyproject.toml', {
            cache: 'no-cache'
        });

        if (!response.ok) {
            logger.warn(`[版本檢查] 請求失敗: ${response.status}`);
            versionCheckCache.checked = true;
            return null;
        }

        const tomlContent = await response.text();
        const versionMatch = tomlContent.match(/^version\s*=\s*["']([^"']+)["']/m);
        const version = versionMatch ? versionMatch[1] : null;

        // 緩存檢查結果
        versionCheckCache.checked = true;
        versionCheckCache.latestVersion = version;

        return version;
    } catch (error) {
        logger.warn(`[版本檢查] 獲取失敗: ${error.message}`);
        versionCheckCache.checked = true;
        return null;
    }
}

/**
 * 比較兩個版本號
 * @param {string} v1 - 第一個版本號
 * @param {string} v2 - 第二個版本號
 * @returns {number} v1 > v2 返回 1，v1 < v2 返回 -1，v1 === v2 返回 0
 */
function compareVersion(v1, v2) {
    // 將版本號分割為數字數組
    const parts1 = v1.split('.').map(n => parseInt(n, 10) || 0);
    const parts2 = v2.split('.').map(n => parseInt(n, 10) || 0);

    // 確保兩個數組長度相同
    const maxLength = Math.max(parts1.length, parts2.length);

    for (let i = 0; i < maxLength; i++) {
        const num1 = parts1[i] || 0;
        const num2 = parts2[i] || 0;

        if (num1 > num2) return 1;
        if (num1 < num2) return -1;
    }

    return 0;
}


// ====================== 設置管理 ======================

/**
 * 顯示API配置彈窗
 */
function showAPIConfigModal() {
    try {
        // 調用API配置管理器的顯示彈窗方法
        apiConfigManager.showAPIConfigModal();
    } catch (error) {
        logger.error(`打開API配置彈窗失敗: ${error.message}`);
        app.extensionManager.toast.add({
            severity: "error",
            summary: "打開配置失敗",
            detail: error.message || "打開配置彈窗過程中發生錯誤",
            life: 3000
        });
    }
}

/**
 * 顯示規則配置彈窗
 */
function showRulesConfigModal() {
    try {
        // 調用規則配置管理器的顯示彈窗方法
        rulesConfigManager.showRulesConfigModal();
    } catch (error) {
        logger.error(`打開規則配置彈窗失敗: ${error.message}`);
        app.extensionManager.toast.add({
            severity: "error",
            summary: "打開配置失敗",
            detail: error.message || "打開配置彈窗過程中發生錯誤",
            life: 3000
        });
    }
}

/**
 * 創建服務選擇器下拉框
 * @param {string} type - 服務類型: 'translate' | 'llm' | 'vlm'
 * @param {string} label - 顯示名稱
 * @returns {HTMLElement} 設置行元素
 */
function createServiceSelector(type, label) {
    const row = document.createElement("tr");
    row.className = "promptwidget-settings-row";

    const labelCell = document.createElement("td");
    labelCell.className = "comfy-menu-label";
    row.appendChild(labelCell);

    const selectCell = document.createElement("td");

    // 創建載入佔位容器
    const container = document.createElement("div");
    container.style.minWidth = "180px";
    container.innerHTML = '<span style="color: var(--p-text-muted-color); font-size: 12px;">載入中...</span>';

    selectCell.appendChild(container);
    row.appendChild(selectCell);

    let currentOptions = []; // 儲存當前選項引用
    let updateDropdownOptions = null; // 儲存更新函數

    /**
     * 更新下拉框內容
     * @param {boolean} force - 是否強制刷新數據
     */
    const updateContent = async (force = false) => {
        try {
            if (force) {
                // 如果是強制刷新（如配置變更或點擊觸發），先清除緩存
                serviceSelector.clearCache();
            }

            // 獲取服務列表和當前選中的服務
            const [options, currentService] = await Promise.all([
                serviceSelector.getServiceOptions(type),
                serviceSelector.getCurrentService(type)
            ]);

            // 如果已經存在下拉框實例，則嘗試增量更新
            if (updateDropdownOptions) {
                updateDropdownOptions(options, currentService);
                currentOptions = options;
                return;
            }

            // ---首次載入邏輯---
            container.innerHTML = '';

            if (options.length === 0) {
                container.innerHTML = '<span style="color: var(--p-text-muted-color); font-size: 12px;">暫無可用服務</span>';
                return;
            }

            currentOptions = options;
            const res = createSelectGroup(label, options, currentService, { showLabel: false });
            const { group, select } = res;
            updateDropdownOptions = res.updateOptions;

            // 将 group 的子元素添加到容器
            while (group.firstChild) {
                container.appendChild(group.firstChild);
            }

            // 监听点击/按下事件：当用户准备点击下拉框时，尝试静默同步最新配置
            const dropdownContainer = container.querySelector('.pa-dropdown');
            if (dropdownContainer) {
                dropdownContainer.addEventListener('mousedown', () => {
                    // 点击时触发刷新，但不显示“同步中”以避免干扰 UI
                    updateContent(true);
                });
            }

            // 监听变更事件
            select.addEventListener('change', async () => {
                const newValue = select.value;
                if (!newValue) return;

                const dropdown = container.querySelector('.pa-dropdown');
                if (dropdown) {
                    dropdown.style.opacity = '0.6';
                    dropdown.style.pointerEvents = 'none';
                }

                try {
                    const success = await serviceSelector.setCurrentService(type, newValue);
                    if (success) {
                        logger.log(`设置${label}服务 | 服务: ${newValue}`);
                    } else {
                        logger.error(`设置${label}服务失败`);
                        const oldValue = await serviceSelector.getCurrentService(type);
                        if (oldValue && updateDropdownOptions) {
                            updateDropdownOptions(currentOptions, oldValue);
                        }
                    }
                } catch (error) {
                    logger.error(`设置${label}服务异常: ${error.message}`);
                } finally {
                    if (dropdown) {
                        dropdown.style.opacity = '';
                        dropdown.style.pointerEvents = '';
                    }
                }
            });

        } catch (error) {
            logger.error(`同步${label}配置失敗: ${error.message}`);
            if (!updateDropdownOptions) {
                container.innerHTML = '<span style="color: var(--p-red-400); font-size: 12px;">載入失敗</span>';
            }
        }
    };

    // 初始載入
    updateContent();

    // 監聽配置更新事件（當 API 配置管理器修改配置後觸發）
    const onConfigUpdated = () => {
        logger.debug(`收到配置更新通知，同步${label}狀態...`);
        updateContent(true);
    };
    window.addEventListener('pa-config-updated', onConfigUpdated);

    // 銷毀監聽器的清理函數（簡單處理，因為設置面板通常隨頁面銷毀）
    // 如果之後有更複雜的組件掛載邏輯，可以在這裡返回一個清理函數給外部調用

    return row;
}


/**
 * 註冊設置選項
 * 將設置選項添加到ComfyUI設置面板
 */
export function registerSettings() {
    try {
        app.registerExtension({
            name: "PromptAssistant.Settings",
            settings: [
                // 總開關 - 獨立控制小助手系統級功能
                {
                    id: "PromptAssistant.Features.Enabled",
                    name: "啟用小助手",
                    category: ["✨提示詞小助手", "小助手功能開關", "總開關"],
                    type: "boolean",
                    defaultValue: true,
                    tooltip: "關閉後，提示詞小助手所有功能將禁用",
                    onChange: async (value) => {
                        try {
                            // 獲取當前狀態，用於判斷是否是初始化
                            const currentState = window.FEATURES.enabled;

                            // 只有狀態真正變化時才輸出日誌
                            if (currentState !== value) {
                                logger.log(`總開關狀態變更 | 狀態:${value ? "啟用" : "禁用"}`);
                            } else {
                                // 如果狀態沒有變化，使用調試級別日誌
                                logger.debug(`總開關狀態保持不變 | 狀態:${value ? "啟用" : "禁用"}`);
                            }

                            // 更新全局狀態
                            window.FEATURES.enabled = value;

                            // 從全局 app 對象獲取 promptAssistant 實例
                            const promptAssistantInstance = app.promptAssistant;
                            const imageCaptionInstance = app.imageCaption;

                            if (!promptAssistantInstance) {
                                logger.error("總開關切換失敗 | 錯誤:未找到PromptAssistant實例");
                                return;
                            }

                            // 根據開關狀態執行相應操作
                            if (value) {
                                // 啟用功能
                                await promptAssistantInstance.toggleGlobalFeature(true, currentState !== value);
                                if (imageCaptionInstance) {
                                    await imageCaptionInstance.toggleGlobalFeature(true, currentState !== value);
                                }

                                // 只在狀態真正變化且不是首次載入時記錄日誌和顯示提示
                                if (currentState !== value) {
                                    logger.debug("功能啟用完成");
                                    // 只在狀態發生變化且不是首次載入時顯示提示
                                    if (!isFirstLoad) {
                                        app.extensionManager.toast.add({
                                            severity: "info",
                                            summary: "提示詞小助手已啟用",
                                            life: 3000
                                        });
                                    }
                                }
                            } else {
                                // 禁用功能
                                await promptAssistantInstance.toggleGlobalFeature(false, currentState !== value);
                                if (imageCaptionInstance) {
                                    await imageCaptionInstance.toggleGlobalFeature(false, currentState !== value);
                                }

                                // 只在狀態真正變化且不是首次載入時記錄日誌和顯示提示
                                if (currentState !== value) {
                                    logger.debug("功能禁用完成");
                                    // 只在狀態發生變化且不是首次載入時顯示提示
                                    if (!isFirstLoad) {
                                        app.extensionManager.toast.add({
                                            severity: "warn",
                                            summary: "提示詞小助手已禁用",
                                            life: 3000
                                        });
                                    }
                                }
                            }

                            // 設置首次載入標誌為 false，表示已經完成首次載入
                            isFirstLoad = false;
                        } catch (error) {
                            logger.error(`總開關切換異常 | 錯誤:${error.message}`);
                        }
                    }
                },

                // 小助手創建方式設置
                {
                    id: "PromptAssistant.Settings.CreationMode",
                    name: "小助手創建方式（提示詞）",
                    category: ["✨提示詞小助手", "系統", "提示詞小助手創建方式"],
                    type: "combo",
                    options: [
                        { text: "自動創建", value: "auto" },
                        { text: "選中節點時創建", value: "manual" }
                    ],
                    defaultValue: "auto",
                    tooltip: "自動創建：節點創建或載入時自動顯示小助手；選中節點時創建：僅選中節點時顯示",
                    onChange: (value) => {
                        logger.log(`小助手創建方式變更 | 模式:${value === 'auto' ? '自動創建' : '選中節點時創建'}`);
                        // 如果切換到自動創建，立即嘗試初始化所有節點
                        if (value === 'auto' && window.FEATURES.enabled && app.graph) {
                            const nodes = app.graph._nodes || [];
                            nodes.forEach(node => {
                                if (node && !node._promptAssistantInitialized) {
                                    app.promptAssistant.checkAndSetupNode(node);
                                }
                            });
                        }
                    }
                },

                // 反推小助手創建方式設置
                {
                    id: "PromptAssistant.Settings.ImageCaptionCreationMode",
                    name: "小助手創建方式（圖像反推）",
                    category: ["✨提示詞小助手", "系統", "圖像小助手創建方式"],
                    type: "combo",
                    options: [
                        { text: "自動創建", value: "auto" },
                        { text: "選中節點時創建", value: "manual" }
                    ],
                    defaultValue: "auto",
                    tooltip: "自動創建：節點創建或載入時自動顯示反推小助手；選中節點時創建：僅選中節點時顯示",
                    onChange: (value) => {
                        logger.log(`反推小助手創建方式變更 | 模式:${value === 'auto' ? '自動創建' : '選中節點時創建'}`);
                        // 如果切換到自動創建，立即嘗試初始化所有節點
                        if (value === 'auto' && window.FEATURES.enabled && window.FEATURES.imageCaption && app.graph) {
                            const nodes = app.graph._nodes || [];
                            nodes.forEach(node => {
                                if (node && !node._imageCaptionInitialized) {
                                    app.imageCaption.checkAndSetupNode(node);
                                }
                            });
                        }
                    }
                },

                // 小助手佈局（提示詞）
                {
                    id: "PromptAssistant.Location",
                    name: "小助手佈局（提示詞）",
                    category: ["✨提示詞小助手", "界面", "提示詞小助手佈局"],
                    type: "combo",
                    options: [
                        // { text: "左上（橫向）", value: "top-left-h" },
                        // { text: "左上（垂直）", value: "top-left-v" },
                        // { text: "中上（橫向）", value: "top-center-h" },
                        // { text: "⇗ ━", value: "top-right-h" },
                        // { text: "⇗ ┃", value: "top-right-v" },
                        { text: "右中（垂直）", value: "right-center-v" },
                        { text: "右下（橫向）", value: "bottom-right-h" },
                        { text: "右下（垂直）", value: "bottom-right-v" },
                        { text: "下中（橫向）", value: "bottom-center-h" },
                        { text: "左下（橫向）", value: "bottom-left-h" },
                        // { text: "左下（垂直）", value: "bottom-left-v" },
                        // { text: "左中（垂直）", value: "left-center-v" }
                    ],
                    defaultValue: "bottom-right-h", // 默認右下橫向
                    tooltip: "設置提示詞小助手在輸入框周圍的佈局和展開方向",
                    onChange: (value) => {
                        logger.log(`提示詞小助手佈局變更 | 佈局:${value}`);
                        // 通知所有實例更新佈局（通過 CSS 類處理）
                        PromptAssistant.instances.forEach(widget => {
                            if (widget.container && widget.container.setAnchorPosition) {
                                widget.container.setAnchorPosition(value);
                            }
                        });
                    }
                },
                // 小助手位置設置（圖像反推）
                {
                    id: "ImageCaption.Location",
                    name: "小助手佈局（圖像反推）",
                    category: ["✨提示詞小助手", "界面", "圖像小助手佈局"],
                    type: "combo",
                    options: [
                        { text: "橫", value: "bottom-left-h" },
                        { text: "豎", value: "bottom-left-v" }
                    ],
                    defaultValue: "bottom-left-h", // 默認橫向
                    tooltip: "設置圖像反推小助手的展開方向（位置固定在左下角）",
                    onChange: (value) => {
                        logger.log(`圖像反推小助手佈局變更 | 佈局:${value}`);
                        // 通知所有實例更新佈局
                        ImageCaption.instances.forEach(assistant => {
                            if (assistant.container && assistant.container.setAnchorPosition) {
                                assistant.container.setAnchorPosition(value);
                            }
                        });
                    },
                },

                // API 配置按鈕
                {
                    id: "PromptAssistant.Features.APIConfig",
                    name: "百度和大語言模型API配置",
                    category: ["✨提示詞小助手", " 配置", "API配置"],
                    tooltip: "配置或修改API信息",
                    type: () => {
                        const row = document.createElement("tr");
                        row.className = "promptwidget-settings-row";

                        const labelCell = document.createElement("td");
                        labelCell.className = "comfy-menu-label";
                        row.appendChild(labelCell);

                        const buttonCell = document.createElement("td");
                        const button = createLoadingButton("API管理器", async () => {
                            showAPIConfigModal();
                        }, false); // 設置 showSuccessToast 為 false

                        buttonCell.appendChild(button);
                        row.appendChild(buttonCell);
                        return row;
                    }
                },

                // ---服務類別設置---
                // 翻譯服務選擇
                {
                    id: "PromptAssistant.Service.Translate",
                    name: "選擇翻譯服務",
                    category: ["✨提示詞小助手", " 配置", "翻譯"],
                    tooltip: "選擇一個服務商用於翻譯，也可以通過右鍵翻譯按鈕來切換",
                    type: () => {
                        return createServiceSelector('translate', '翻譯');
                    }
                },

                // 提示詞優化服務選擇
                {
                    id: "PromptAssistant.Service.LLM",
                    name: "選擇提示詞優化服務",
                    category: ["✨提示詞小助手", " 配置", "提示詞優化"],
                    tooltip: "選擇一個服務商用於提示詞優化，也可以通過右鍵提示詞優化按鈕來切換",
                    type: () => {
                        return createServiceSelector('llm', '提示詞優化');
                    }
                },

                // 圖像反推服務選擇
                {
                    id: "PromptAssistant.Service.VLM",
                    name: "選擇圖像反推服務",
                    category: ["✨提示詞小助手", " 配置", "圖像反推"],
                    tooltip: "選擇一個服務商用於圖像反推，也可以通過右鍵反推按鈕來切換",
                    type: () => {
                        return createServiceSelector('vlm', '圖像反推');
                    }
                },

                // 歷史功能（包含歷史、撤銷、重做按鈕）
                {
                    id: "PromptAssistant.Features.History",
                    name: "啟用歷史功能",
                    category: ["✨提示詞小助手", "小助手功能開關", "歷史功能"],
                    type: "boolean",
                    defaultValue: true,
                    tooltip: "開啟或關閉歷史、撤銷、重做功能",
                    onChange: (value) => {
                        const oldValue = FEATURES.history;
                        FEATURES.history = value;
                        handleFeatureChange('歷史功能', value, oldValue);
                        logger.log(`歷史功能 - 已${value ? "啟用" : "禁用"}`);
                    }
                },

                // 標籤工具
                {
                    id: "PromptAssistant.Features.Tag",
                    name: "啟用標籤工具",
                    category: ["✨提示詞小助手", "小助手功能開關", "標籤功能"],
                    type: "boolean",
                    defaultValue: true,
                    tooltip: "開啟或關閉標籤工具功能",
                    onChange: (value) => {
                        const oldValue = FEATURES.tag;
                        FEATURES.tag = value;
                        handleFeatureChange('標籤工具', value, oldValue);
                        logger.log(`標籤工具 - 已${value ? "啟用" : "禁用"}`);
                    }
                },

                // 擴寫功能
                {
                    id: "PromptAssistant.Features.Expand",
                    name: "啟用提示詞優化功能",
                    category: ["✨提示詞小助手", "小助手功能開關", "提示詞優化功能"],
                    type: "boolean",
                    defaultValue: true,
                    tooltip: "開啟或關閉提示詞優化功能",
                    onChange: (value) => {
                        const oldValue = FEATURES.expand;
                        FEATURES.expand = value;
                        handleFeatureChange('提示詞優化功能', value, oldValue);
                        logger.log(`提示詞優化功能 - 已${value ? "啟用" : "禁用"}`);
                    }
                },

                // 翻譯功能
                {
                    id: "PromptAssistant.Features.Translate",
                    name: "啟用翻譯功能",
                    category: ["✨提示詞小助手", "小助手功能開關", "翻譯功能"],
                    type: "boolean",
                    defaultValue: true,
                    tooltip: "開啟或關閉翻譯功能",
                    onChange: (value) => {
                        const oldValue = FEATURES.translate;
                        FEATURES.translate = value;
                        handleFeatureChange('翻譯功能', value, oldValue);
                        logger.log(`翻譯功能 - 已${value ? "啟用" : "禁用"}`);
                    }
                },

                // 使用翻譯緩存功能
                {
                    id: "PromptAssistant.Features.UseTranslateCache",
                    name: "使用翻譯緩存",
                    category: ["✨提示詞小助手", " 翻譯功能設置", "翻譯緩存"],
                    type: "boolean",
                    defaultValue: true,
                    tooltip: "開啟後，如果翻譯內容翻譯過，則使用歷史翻譯結果，避免相同內容重複翻譯改變原意。如果需要重新翻譯，請隨便加一個空格即可跳過緩存。",
                    onChange: (value) => {
                        const oldValue = FEATURES.useTranslateCache;
                        FEATURES.useTranslateCache = value;
                        logger.log(`使用翻譯緩存 - 已${value ? "啟用" : "禁用"}`);
                    }
                },

                // 混合語言緩存選項
                {
                    id: "PromptAssistant.Features.CacheMixedLangTranslation",
                    name: "混合語言翻譯進行緩存",
                    category: ["✨提示詞小助手", " 翻譯功能設置", "混合語言緩存"],
                    type: "boolean",
                    defaultValue: false,
                    tooltip: "關閉時，中英文混合內容的翻譯結果不會寫入緩存，避免污染緩存。開啟後會正常緩存。",
                    onChange: (value) => {
                        FEATURES.cacheMixedLangTranslation = value;
                        logger.log(`混合語言緩存 - 已${value ? "啟用" : "禁用"}`);
                    }
                },

                // 混合語言翻譯規則
                {
                    id: "PromptAssistant.Features.MixedLangTranslateRule",
                    name: "混合語言翻譯規則",
                    category: ["✨提示詞小助手", " 翻譯功能設置", "混合語言規則"],
                    type: "combo",
                    options: [
                        { text: "翻譯成英文", value: "to_en" },
                        { text: "翻譯成中文", value: "to_zh" },
                        { text: "自動翻譯小比例語言", value: "auto_minor" },
                        { text: "自動翻譯大比例語言", value: "auto_major" }
                    ],
                    defaultValue: "to_en",
                    tooltip: "根據個人使用偏好設置混合中英文內容的翻譯規則",
                    onChange: (value) => {
                        FEATURES.mixedLangTranslateRule = value;
                        logger.log(`混合語言翻譯規則 - 已設置為:${value}`);
                    }
                },

                // 翻譯格式化選項
                {
                    id: "PromptAssistant.Features.TranslateFormatPunctuation",
                    name: "始終使用半角標點符號",
                    category: ["✨提示词小助手", " 翻译功能设置", "標點處理"],
                    type: "boolean",
                    defaultValue: false,
                    tooltip: "打開後，翻譯結果會自動將中文標點符號替換成英文標點符號",
                    onChange: (value) => {
                        FEATURES.translateFormatPunctuation = value;
                        logger.log(`標點符號轉換 - 已${value ? "启用" : "禁用"}`);
                    }
                },
                {
                    id: "PromptAssistant.Features.TranslateFormatSpace",
                    name: "自動移除多餘空格",
                    category: ["✨提示词小助手", " 翻译功能设置", "空格處理"],
                    type: "boolean",
                    defaultValue: false,
                    tooltip: "打开后，翻译结果会自動移除多餘空格",
                    onChange: (value) => {
                        FEATURES.translateFormatSpace = value;
                        logger.log(`移除多餘空格 - 已${value ? "启用" : "禁用"}`);
                    }
                },
                {
                    id: "PromptAssistant.Features.TranslateFormatDots",
                    name: "移除多餘連續點號",
                    category: ["✨提示词小助手", " 翻译功能设置", "點號處理"],
                    type: "boolean",
                    defaultValue: false,
                    tooltip: "打开后，翻译结果会将多余的“......”统一为“...”",
                    onChange: (value) => {
                        FEATURES.translateFormatDots = value;
                        logger.log(`處理連續點號 - 已${value ? "启用" : "禁用"}`);
                    }
                },
                {
                    id: "PromptAssistant.Features.TranslateFormatNewline",
                    name: "保留換行符",
                    category: ["✨提示词小助手", " 翻译功能设置", "換行處理"],
                    type: "boolean",
                    defaultValue: true,
                    tooltip: "打開後，翻譯結果會盡量保持原文的換行，避免翻譯後丟失段落",
                    onChange: (value) => {
                        FEATURES.translateFormatNewline = value;
                        logger.log(`保留換行符 - 已${value ? "启用" : "禁用"}`);
                    }
                },



                // 圖像反推功能
                {
                    id: "PromptAssistant.Features.ImageCaption",
                    name: "啟用圖像反推功能",
                    category: ["✨提示詞小助手", "小助手功能開關", "圖像反推"],
                    type: "boolean",
                    defaultValue: true,
                    tooltip: "開啟或關閉圖像反推提示詞功能",
                    onChange: (value) => {
                        const oldValue = FEATURES.imageCaption;
                        FEATURES.imageCaption = value;
                        handleFeatureChange('圖像反推', value, oldValue);
                        logger.log(`圖像反推功能 - 已${value ? "啟用" : "禁用"}`);
                    }
                },

                // 節點幫助翻譯功能
                {
                    id: "PromptAssistant.Features.NodeHelpTranslator",
                    name: "啟用節點信息翻譯",
                    category: ["✨提示詞小助手", "小助手功能開關", "節點信息翻譯"],
                    type: "boolean",
                    defaultValue: true,
                    tooltip: "開啟或關閉ComfyUI側邊欄節點幫助文檔的翻譯功能",
                    onChange: (value) => {
                        const oldValue = FEATURES.nodeHelpTranslator;
                        FEATURES.nodeHelpTranslator = value;
                        handleFeatureChange('節點信息翻譯', value, oldValue);
                        logger.log(`節點信息翻譯功能 - 已${value ? "啟用" : "禁用"}`);
                    }
                },

                // 系統設置
                {
                    id: "PromptAssistant.Settings.LogLevel",
                    name: "日誌級別",
                    category: ["✨提示詞小助手", "系統", "日誌級別"],
                    type: "hidden",
                    defaultValue: "0",
                    options: [
                        { text: "錯誤日誌", value: "0" },
                        { text: "基礎日誌", value: "1" },
                        { text: "詳細日誌", value: "2" }
                    ],
                    tooltip: "設置日誌輸出級別：錯誤日誌(僅錯誤)、基礎日誌(錯誤+基礎信息)、詳細日誌(錯誤+基礎信息+調試信息)",
                    onChange: (value) => {
                        const oldValue = window.FEATURES.logLevel;
                        window.FEATURES.logLevel = parseInt(value);
                        logger.setLevel(window.FEATURES.logLevel);
                        logger.log(`日誌級別已更新 | 原級別:${oldValue} | 新級別:${value}`);
                    }
                },

                // 顯示流式輸出進度
                {
                    id: "PromptAssistant.Settings.ShowStreamingProgress",
                    name: "控制台流式輸出進度日誌",
                    category: ["✨提示詞小助手", "系統", "終端日誌"],
                    type: "boolean",
                    defaultValue: false,
                    tooltip: "開啟後，控制台會顯示流式輸出過程，在某些終端可能導致刷屏；關閉後只顯示靜態的'生成中...'。",
                    onChange: async (value) => {
                        FEATURES.showStreamingProgress = value;
                        // 通知後端更新設置
                        try {
                            await fetch(APIService.getApiUrl('/settings/streaming_progress'), {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ enabled: value })
                            });
                        } catch (error) {
                            logger.error(`更新流式進度設置失敗: ${error.message}`);
                        }
                        logger.log(`流式輸出進度 - 已${value ? "啟用" : "禁用"}`);
                    }
                },

                // 流式輸出開關
                {
                    id: "PromptAssistant.Settings.EnableStreaming",
                    name: "流式輸出開關",
                    category: ["✨提示詞小助手", "系統", "流式體驗"],
                    type: "boolean",
                    defaultValue: true,
                    tooltip: "開啟時，翻譯、擴寫、識別等功能將以逐字生成的流式效果顯示；關閉時則恢復為全部生成後一次性顯示的阻塞模式。",
                    onChange: (value) => {
                        FEATURES.enableStreaming = value;
                        logger.log(`流式輸出開關 - 已${value ? "啟用" : "禁用"}`);
                    }
                },

                {
                    id: "PromptAssistant.Settings.IconOpacity",
                    name: " 小助手圖標不透明度",
                    category: ["✨提示詞小助手", "界面", "小助手圖標"],
                    type: "slider",
                    min: 0,
                    max: 100,
                    step: 1,
                    defaultValue: 20,
                    tooltip: "設置摺疊後小助手圖標的不透明度",
                    onChange: (value) => {
                        // 將0-100的值轉換為0-1的透明度
                        const opacity = value * 0.01;
                        document.documentElement.style.setProperty('--assistant-icon-opacity', opacity);
                        logger.log(`小助手圖標不透明度已更新 | 值:${value}% | 透明度:${opacity}`);
                    },
                    onLoad: (value) => {
                        // 初始化時應用默認值
                        const opacity = value * 0.01;
                        document.documentElement.style.setProperty('--assistant-icon-opacity', opacity);
                        logger.debug(`小助手圖標不透明度初始化 | 值:${value}% | 透明度:${opacity}`);
                    }
                },

                {
                    id: "PromptAssistant.Settings.ClearCache",
                    name: "清理歷史、標籤、翻譯緩存",
                    category: ["✨提示詞小助手", "系統", "清理緩存"],
                    tooltip: "清理所有緩存，包括歷史記錄、標籤、翻譯緩存、節點文檔翻譯緩存",
                    type: () => {
                        const row = document.createElement("tr");
                        row.className = "promptwidget-settings-row";

                        const labelCell = document.createElement("td");
                        labelCell.className = "comfy-menu-label";
                        row.appendChild(labelCell);

                        const buttonCell = document.createElement("td");
                        const button = createLoadingButton("清理所有緩存", async () => {
                            try {
                                // 獲取清理前的緩存統計
                                const beforeStats = {
                                    history: HistoryCacheService.getHistoryStats(),
                                    tags: 0,
                                    translate: TranslateCacheService.getTranslateCacheStats(),
                                    nodeHelpTranslate: 0 // 節點文檔翻譯緩存
                                };

                                // 統計所有標籤數量
                                const tagCacheKeys = Object.keys(localStorage)
                                    .filter(key => key.startsWith(CACHE_CONFIG.TAG_KEY_PREFIX));

                                // 計算所有緩存中的標籤總數
                                tagCacheKeys.forEach(key => {
                                    try {
                                        const cacheData = JSON.parse(localStorage.getItem(key));
                                        if (cacheData && typeof cacheData === 'object') {
                                            // 獲取緩存中的標籤數量
                                            const tagCount = Object.keys(cacheData).length;
                                            beforeStats.tags += tagCount;
                                        }
                                    } catch (e) {
                                        // 移除錯誤日誌，靜默處理解析錯誤
                                    }
                                });

                                // 統計節點文檔翻譯緩存數量
                                try {
                                    const nodeHelpCache = sessionStorage.getItem('pa_node_help_translations');
                                    if (nodeHelpCache) {
                                        const parsed = JSON.parse(nodeHelpCache);
                                        beforeStats.nodeHelpTranslate = Object.keys(parsed).length;
                                    }
                                } catch (e) {
                                    // 靜默處理
                                }

                                // 執行歷史記錄清理操作
                                HistoryCacheService.clearAllHistory();

                                // 清理所有標籤緩存
                                TagCacheService.clearAllTagCache();

                                // 清理翻譯緩存
                                TranslateCacheService.clearAllTranslateCache();

                                // 清理節點文檔翻譯緩存（sessionStorage）
                                sessionStorage.removeItem('pa_node_help_translations');

                                // 清理舊版本的標籤緩存（以PromptAssistant_tag_cache_開頭的所有記錄）
                                Object.keys(localStorage)
                                    .filter(key => key.startsWith('PromptAssistant_tag_cache_'))
                                    .forEach(key => localStorage.removeItem(key));

                                // 清除1.0.3以前版本遺留的三項配置信息，避免洩露
                                localStorage.removeItem("PromptAssistant_Settings_llm_api_key");
                                localStorage.removeItem("PromptAssistant_Settings_baidu_translate_secret");
                                localStorage.removeItem("PromptAssistant_Settings_baidu_translate_appid");

                                // 獲取清理後的緩存統計
                                const afterStats = {
                                    history: HistoryCacheService.getHistoryStats(),
                                    tags: 0, // 清理後標籤數應該為0
                                    translate: TranslateCacheService.getTranslateCacheStats()
                                };

                                // 計算清理數量
                                const clearedHistory = beforeStats.history.total - afterStats.history.total;
                                const clearedTags = beforeStats.tags;
                                const clearedTranslate = beforeStats.translate.total - afterStats.translate.total;
                                const clearedNodeHelp = beforeStats.nodeHelpTranslate;

                                // 只輸出最終統計結果
                                logger.log(`緩存清理完成 | 歷史記錄: ${clearedHistory}條 | 標籤: ${clearedTags}個 | 翻譯: ${clearedTranslate}條 | 節點文檔: ${clearedNodeHelp}個`);

                                // 更新所有實例的撤銷/重做按鈕狀態
                                PromptAssistant.instances.forEach((instance) => {
                                    if (instance && instance.nodeId && instance.inputId) {
                                        UIToolkit.updateUndoRedoButtonState(instance, HistoryCacheService);
                                    }
                                });

                            } catch (error) {
                                // 簡化錯誤日誌
                                logger.error(`緩存清理失敗`);
                                throw error;
                            }
                        });

                        buttonCell.appendChild(button);
                        row.appendChild(buttonCell);
                        return row;
                    }
                },

                // 規則配置按鈕
                {
                    id: "PromptAssistant.Features.RulesConfig",
                    name: "提示詞優化和反推規則修改",
                    category: ["✨提示詞小助手", " 配置", "規則"],
                    tooltip: "可以自定義提示詞優化規則，和反推提示詞規則，使得提示詞生成更加符合你的需求",
                    type: () => {
                        const row = document.createElement("tr");
                        row.className = "promptwidget-settings-row";

                        const labelCell = document.createElement("td");
                        labelCell.className = "comfy-menu-label";
                        row.appendChild(labelCell);

                        const buttonCell = document.createElement("td");
                        const button = createLoadingButton("規則管理器", async () => {
                            showRulesConfigModal();
                        }, false);

                        buttonCell.appendChild(button);
                        row.appendChild(buttonCell);
                        return row;
                    }
                },

            ]
        });

        logger.log("小助手設置註冊成功");
        return true;
    } catch (error) {
        logger.error(`小助手設置註冊失敗: ${error.message}`);
        return false;
    }
}