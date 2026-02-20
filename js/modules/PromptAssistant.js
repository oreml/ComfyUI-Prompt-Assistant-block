/**
 * 提示詞小助手核心类
 * 統一管理小助手的生命周期、實例創建、UI交互等功能
 */

import { app } from "../../../../scripts/app.js";
import { logger } from '../utils/logger.js';
import { FEATURES } from "../services/features.js";
import { HistoryManager } from "./history.js";
import { TagManager } from "./tag.js";
import { TextGridManager } from "./textGrid.js";
import { HistoryCacheService, TagCacheService, TranslateCacheService, CACHE_CONFIG, CacheService } from "../services/cache.js";
import { EventManager } from "../utils/eventManager.js";
import { ResourceManager } from "../utils/resourceManager.js";
import { UIToolkit } from "../utils/UIToolkit.js";
import { PromptFormatter } from "../utils/promptFormatter.js";
import { APIService } from "../services/api.js";

import { buttonMenu } from "../services/btnMenu.js";
import { rulesConfigManager } from "./rulesConfigManager.js";
import { nodeMountService, RENDER_MODE } from "../services/NodeMountService.js";
import { AssistantContainer, ANCHOR_POSITION } from "./AssistantContainer.js";
import { PopupManager } from "../utils/popupManager.js";
import { MarkdownNoteTranslate } from "../utils/markdownNoteTranslate.js";



// ====================== 工具函數 ======================

/**
 * 計算小助手UI的预设宽度
 * 根據當前啟用的功能數量返回對應的固定宽度值
 * @returns {number} 宽度值（像素）
 */
function calculateAssistantWidth() {
    // 統計啟用的功能
    const hasHistory = window.FEATURES.history;
    const hasTag = window.FEATURES.tag;
    const hasExpand = window.FEATURES.expand;
    const hasTranslate = window.FEATURES.translate;

    // 統計非歷史功能的數量
    const otherFeaturesCount = [hasTag, hasExpand, hasTranslate].filter(Boolean).length;

    // 根據功能组合返回预设常量宽度
    if (hasHistory && otherFeaturesCount === 3) {
        return 143; // 所有功能全開 (歷史3 + 分隔线1 + 其它3)
    } else if (hasHistory && otherFeaturesCount === 2) {
        return 121; // 歷史 + 两个其它
    } else if (hasHistory && otherFeaturesCount === 1) {
        return 99;  // 歷史 + 一个其它
    } else if (hasHistory && otherFeaturesCount === 0) {
        return 77;  // 只有歷史功能
    } else if (!hasHistory && otherFeaturesCount === 3) {
        return 72;  // 關閉歷史的三个功能
    } else if (!hasHistory && otherFeaturesCount === 2) {
        return 50;  // 只有两个按钮
    } else if (!hasHistory && otherFeaturesCount === 1) {
        return 28;  // 只有一个按钮
    }

    return 28; // 預設
}



/**
 * 防抖函數
 * 限制函數調用频率，避免频繁觸發導致性能問題
 */
function debounce(func, wait = 100) {
    return EventManager.debounce(func, wait);
}

/**
 * 獲取輸入元素的内容
 * 支持普通textarea、Tiptap编辑器、ProseMirror编辑器等
 * @param {object} widget - 小助手widget对象
 * @returns {string} 輸入内容
 */
function getInputValue(widget, options = {}) {
    if (!widget || !widget.inputEl) {
        return '';
    }

    const inputEl = widget.inputEl;
    const returnHtml = options.html === true;

    // 標準textarea
    if (inputEl.tagName === 'TEXTAREA' && inputEl.value !== undefined) {
        return inputEl.value;
    }

    // Tiptap/ProseMirror/comfy-markdown编辑器
    if (inputEl.classList.contains('tiptap') ||
        inputEl.classList.contains('ProseMirror') ||
        inputEl.classList.contains('comfy-markdown')) {

        let targetEl = inputEl;
        // 對於 comfy-markdown，查找內部编辑器元素
        if (inputEl.classList.contains('comfy-markdown')) {
            const editorEl = inputEl.querySelector('.tiptap, .ProseMirror');
            if (editorEl) {
                targetEl = editorEl;
            }
        }

        if (returnHtml) {
            return targetEl.innerHTML || '';
        }

        const textContent = targetEl.textContent || targetEl.innerText || '';
        if (textContent.trim()) {
            return textContent;
        }

        // 從widget.value獲取
        if (widget.value !== undefined) {
            return widget.value;
        }

        // 從node.widgets找到對應的widget.value
        if (widget.node && widget.node.widgets) {
            const matchingWidget = widget.node.widgets.find(w =>
                w.name === widget.inputId || w.name === 'text'
            );
            if (matchingWidget && matchingWidget.value !== undefined) {
                return matchingWidget.value;
            }
        }
    }

    // contenteditable元素
    if (inputEl.isContentEditable || inputEl.getAttribute('contenteditable') === 'true') {
        if (returnHtml) {
            return inputEl.innerHTML || '';
        }
        return inputEl.textContent || inputEl.innerText || '';
    }

    // widget.value
    if (widget.value !== undefined && typeof widget.value === 'string') {
        return widget.value;
    }

    // inputWidget.value
    if (widget.inputWidget && widget.inputWidget.value !== undefined) {
        return widget.inputWidget.value;
    }

    return '';
}

/**
 * 設置輸入元素的内容
 * 支持普通textarea、Tiptap编辑器、ProseMirror编辑器等
 * @param {object} widget - 小助手widget对象
 * @param {string} content - 要設置的內容
 * @param {object} options - 配置選項
 * @param {boolean} options.html - 是否作為 HTML 内容設置
 * @param {boolean} options.silent - 是否靜默更新（不觸發事件，用于流式輸出）
 * @returns {boolean} 是否設置成功
 */
function setInputValue(widget, content, options = {}) {
    if (!widget || !widget.inputEl) {
        return false;
    }

    const inputEl = widget.inputEl;
    const useHtml = options.html === true;
    const silent = options.silent === true;  // 流式更新時不觸發事件

    try {
        // 標準textarea
        if (inputEl.tagName === 'TEXTAREA' && inputEl.value !== undefined) {
            inputEl.value = content;

            // 關鍵修復：即使是 silent 模式，也需要同步 widget.value 和 node.widgets[].value
            // 否則后续 getInputValue 会读取到舊值
            if (widget.value !== undefined) {
                widget.value = content;
            }
            if (widget.node && widget.node.widgets) {
                const matchingWidget = widget.node.widgets.find(w =>
                    w.name === widget.inputId || w.name === 'text'
                );
                if (matchingWidget) {
                    matchingWidget.value = content;
                }
            }

            if (!silent) {
                inputEl.dispatchEvent(new Event('input', { bubbles: true }));
                inputEl.dispatchEvent(new Event('change', { bubbles: true }));
            }
            return true;
        }

        // comfy-markdown或Tiptap/ProseMirror编辑器
        if (inputEl.classList.contains('comfy-markdown') ||
            inputEl.classList.contains('tiptap') ||
            inputEl.classList.contains('ProseMirror')) {

            // 對於 comfy-markdown，找到內部编辑器
            let targetEl = inputEl;
            if (inputEl.classList.contains('comfy-markdown')) {
                const editorEl = inputEl.querySelector('.tiptap, .ProseMirror');
                if (editorEl) {
                    targetEl = editorEl;
                }
            }

            // 設置textContent/innerHTML
            if (targetEl.isContentEditable || targetEl.getAttribute('contenteditable') === 'true') {
                if (useHtml) {
                    targetEl.innerHTML = content;
                } else {
                    targetEl.textContent = content;
                }
            } else {
                targetEl.innerHTML = content;
            }

            // 觸發輸入事件（静默模式下跳過）
            if (!silent) {
                targetEl.dispatchEvent(new Event('input', { bubbles: true }));
                targetEl.dispatchEvent(new Event('change', { bubbles: true }));
            }

            // 同時更新widget.value（無論是否 silent 都需要同步）
            if (widget.value !== undefined) {
                widget.value = content;
            }

            // 同時更新node.widgets[].value（無論是否 silent 都需要同步）
            if (widget.node && widget.node.widgets) {
                const matchingWidget = widget.node.widgets.find(w =>
                    w.name === widget.inputId || w.name === 'text'
                );
                if (matchingWidget) {
                    matchingWidget.value = content;
                }
            }

            return true;
        }

        // contenteditable元素
        if (inputEl.isContentEditable || inputEl.getAttribute('contenteditable') === 'true') {
            if (useHtml) {
                inputEl.innerHTML = content;
            } else {
                inputEl.textContent = content;
            }

            // 關鍵修復：同步 widget.value 和 node.widgets[].value
            if (widget.value !== undefined) {
                widget.value = content;
            }
            if (widget.node && widget.node.widgets) {
                const matchingWidget = widget.node.widgets.find(w =>
                    w.name === widget.inputId || w.name === 'text'
                );
                if (matchingWidget) {
                    matchingWidget.value = content;
                }
            }

            if (!silent) {
                inputEl.dispatchEvent(new Event('input', { bubbles: true }));
                inputEl.dispatchEvent(new Event('change', { bubbles: true }));
            }
            return true;
        }

        // widget.value
        if (widget.value !== undefined) {
            widget.value = content;
            return true;
        }

        return false;
    } catch (error) {
        logger.error(`[setInputValue] 設置失敗 | 錯誤: ${error.message}`);
        return false;
    }
}

// ====================== 主类实现 ======================

/**
 * 提示詞小助手主类
 * 統一管理小助手的生命周期、實例和资源
 */
class PromptAssistant {
    /** 存储所有小助手實例的Map集合 */
    static instances = new Map();

    constructor() {
        this.initialized = false;
    }

    /**
     * 【核心優化】統一獲取助手實例的唯一键名
     * 解决子圖節點 ID 冲突及不同掃描模式下的键名不一致問題
     */
    _getAssistantKey(node, inputId) {
        if (!node) return null;
        const graph = node.graph || app.graph;
        // 优先順序：graph.id (Locator ID) -> graph._workflow_id -> 'main'
        const graphId = graph?.id || graph?._workflow_id || 'main';
        return `${graphId}_${node.id}_${inputId}`;
    }

    // ---生命周期管理功能---
    /**
     * 判斷功能是否被禁用
     */
    areAllFeaturesDisabled() {
        return !window.FEATURES.enabled;
    }

    /**
     * 初始化提示詞小助手
     */
    initialize() {
        if (this.initialized) return;

        try {
            // 檢查版本號
            if (!window.PromptAssistant_Version) {
                logger.error("初始化時未找到版本号！這可能導致UI顯示異常");
            } else {
                logger.debug(`初始化時检测到版本号: ${window.PromptAssistant_Version}`);
            }

            // 初始化事件管理器
            EventManager.init();

            // 從配置載入所有功能開關狀態
            FEATURES.loadSettings();
            // 同步到 window.FEATURES 以兼容旧代码
            window.FEATURES.enabled = FEATURES.enabled;

            // 記錄總開關狀態（改為調試級別）
            logger.debug(`初始化時检测總開關狀態 | 狀態:${FEATURES.enabled ? "啟用" : "禁用"}`);

            // 初始化资源管理器
            ResourceManager.init();

            // 只有在總開關打開时才做完整初始化
            if (window.FEATURES.enabled) {

            }

            this.initialized = true;
            logger.log("初始化完成 | 小助手已完全啟動");
        } catch (error) {
            logger.error(`初始化失敗 | 錯誤: ${error.message}`);
            // 重置狀態
            this.initialized = false;
            window.FEATURES.enabled = false;
            // 確保清理
            this.cleanup();
        }
    }

    /**
     * 统一控制總開關功能
     * 集中管理所有受總開關控制的服務功能
     */
    async toggleGlobalFeature(enable, force = false) {
        // 更新狀態
        const oldValue = window.FEATURES.enabled;
        window.FEATURES.enabled = enable;

        // 狀態未變化时不執行操作，除非force为true
        if (!force && oldValue === enable) {
            return;
        }

        // 仅当狀態真正變化或強制執行时才記錄日誌
        if (oldValue !== enable || force === true) {
            logger.log(`總開關 | 動作:${enable ? "啟用" : "禁用"}`);
        }

        try {
            if (enable) {
                // === 啟用所有服務 ===
                // 確保管理器已初始化
                if (!EventManager.initialized) {
                    EventManager.init();
                }

                if (!ResourceManager.isInitialized()) {
                    ResourceManager.init();
                }

                // 1. 重置節點初始化標記，准备重新检测
                if (app.canvas && app.canvas.graph) {
                    const nodes = app.canvas.graph._nodes || [];
                    nodes.forEach(node => {
                        if (node) {
                            node._promptAssistantInitialized = false;
                        }
                    });
                }

                // 2. 設置或恢復節點選擇事件監聽
                if (app.canvas) {
                    // 避免重複設置監聽器
                    if (!app.canvas._promptAssistantSelectionHandler) {
                        app.canvas._promptAssistantSelectionHandler = function (selected_nodes) {
                            // 当總開關关闭时，跳過所有節點處理
                            if (!window.FEATURES.enabled) {
                                return;
                            }

                            if (selected_nodes && Object.keys(selected_nodes).length > 0) {
                                Object.keys(selected_nodes).forEach(nodeId => {
                                    const node = app.canvas.graph.getNodeById(nodeId);
                                    if (!node) return;

                                    // 初始化未初始化的節點
                                    if (!node._promptAssistantInitialized) {
                                        node._promptAssistantInitialized = true;
                                        this.checkAndSetupNode(node);
                                    }
                                });
                            }
                        }.bind(this);
                    }

                    // 保存当前監聽器并設置新的
                    if (app.canvas.onSelectionChange && app.canvas.onSelectionChange !== app.canvas._promptAssistantSelectionHandler) {
                        app.canvas._originalSelectionChange = app.canvas.onSelectionChange;
                    }

                    app.canvas.onSelectionChange = app.canvas._promptAssistantSelectionHandler;

                    // 3. 如果開啟了自動創建，立即掃描所有有效節點
                    const creationMode = app.ui.settings.getSettingValue("PromptAssistant.Settings.CreationMode") || "auto";
                    if (creationMode === "auto") {
                        const nodes = app.canvas.graph._nodes || [];
                        nodes.forEach(node => {
                            if (node && !node._promptAssistantInitialized) {
                                // 避免在掃描過程中重复處理
                                node._promptAssistantInitialized = true;
                                this.checkAndSetupNode(node);
                            }
                        });
                    }
                }
            } else {
                // === 禁用所有服務 ===

                // 1. 計數并清理所有實例
                const instanceCount = PromptAssistant.instances.size;
                this.cleanup(null, true);

                // 2. 恢復原始節點選擇事件監聽
                if (app.canvas) {
                    if (app.canvas._originalSelectionChange) {
                        app.canvas.onSelectionChange = app.canvas._originalSelectionChange;
                    } else {
                        app.canvas.onSelectionChange = null;
                    }
                }
            }

            // 按钮可见性更新在features中单独處理
            window.FEATURES.updateButtonsVisibility();


        } catch (error) {
            logger.error(`總開關操作失敗 | 錯誤: ${error.message}`);
            // 恢復原始狀態
            window.FEATURES.enabled = oldValue;
        }
    }

    // ---资源管理功能---
    /**
     * 清理所有资源
     */
    cleanup(nodeId = null, silent = false) {
        // 如果正在切換工作流程，则只清理UI實例，不刪除緩存
        if (window.PROMPT_ASSISTANT_WORKFLOW_SWITCHING) {
            // 簡化日誌：工作流程切換期间不逐条打印節點清理日誌，避免高频刷屏
            // 如需排查問題，可将下行改回 debug 单条輸出
            // if (nodeId !== null) { logger.debug(`[清理跳過] 正在切換工作流程，仅清理提示詞小助手UI，節點ID: ${nodeId}`); }

            const keysToDelete = Array.from(PromptAssistant.instances.keys())
                .filter(key => nodeId === null || key.startsWith(`${String(nodeId)}_`));

            keysToDelete.forEach(key => {
                const instance = PromptAssistant.getInstance(key);
                if (instance) {
                    this._cleanupInstance(instance, key, false); // false表示從實例集合中移除
                }
            });

            // 如果是全局清理，清空實例集合
            if (nodeId === null) {
                PromptAssistant.instances.clear();
            }
            return;
        }

        // 檢查Id是否有效
        if (nodeId !== null && nodeId !== undefined) {
            // 確保nodeId是字符串類型，便于后续比较
            const searchId = String(nodeId);

            // 獲取所有匹配的實例键
            // 逻辑：匹配精确键 (graphId_nodeId_inputId) 或者以 nodeId_ 开头的旧键，或者包含 _nodeId_ 的全量键
            const keysToDelete = Array.from(PromptAssistant.instances.keys())
                .filter(key => {
                    // 1. 精确匹配（如果传入的是 assistantKey）
                    if (key === searchId) return true;
                    // 2. 匹配 nodeId (旧格式)
                    if (key.startsWith(`${searchId}_`)) return true;
                    // 3. 匹配带 graphId 前缀的格式 (graphId_nodeId_inputId)
                    const parts = key.split('_');
                    return parts.length >= 2 && parts[1] === searchId;
                });

            // 如果有實例需要清理
            if (keysToDelete.length > 0) {
                let historyCount = 0;
                let tagCount = 0;
                let instanceNames = [];

                try {
                    // 統計并清理歷史記錄
                    const allHistory = HistoryCacheService.getAllHistory();
                    historyCount = allHistory.filter(item => item.node_id === nodeId).length;
                    HistoryCacheService.clearNodeHistory(nodeId);

                    // 統計并清理標籤緩存
                    keysToDelete.forEach(key => {
                        const instance = PromptAssistant.getInstance(key);
                        if (instance && instance.inputId) {
                            const tags = TagCacheService.getAllRawTags(nodeId, instance.inputId);
                            tagCount += tags ? tags.length : 0;
                            TagCacheService.clearCache(nodeId, instance.inputId);
                            instanceNames.push(instance.inputId);
                        }
                    });

                    // 清理實例
                    keysToDelete.forEach(key => {
                        const instance = PromptAssistant.getInstance(key);
                        if (instance) {
                            this._cleanupInstance(instance, key, true);
                            PromptAssistant.instances.delete(key);
                        }
                    });

                    if (!silent) {
                        // 獲取当前剩余的統計信息
                        const remainingInstances = PromptAssistant.instances.size;
                        // 獲取標籤緩存統計
                        const tagStats = TagCacheService.getTagStats();
                        const remainingTags = tagStats.total;
                        const remainingHistory = HistoryCacheService.getAllHistory().length;

                        logger.log(`[清理汇总] 節點ID: ${nodeId} | 清理實例: ${instanceNames.join(', ')} | 歷史記錄清理: ${historyCount}条 | 標籤緩存清理: ${tagCount}个`);
                    }
                } catch (error) {
                    logger.error(`[節點清理] 失敗 | 節點ID: ${nodeId} | 錯誤: ${error.message}`);
                }
            }
            return;
        }

        // 清理所有實例和歷史
        const beforeCleanupSize = PromptAssistant.instances.size;
        if (beforeCleanupSize > 0) {
            let totalHistoryCount = 0;
            let totalTagCount = 0;
            let allInstanceNames = [];

            try {
                // 統計并清理所有歷史記錄
                const allHistory = HistoryCacheService.getAllHistory();
                totalHistoryCount = allHistory.length;
                HistoryCacheService.clearAllHistory();

                // 統計標籤緩存
                const tagStats = TagCacheService.getTagStats();
                totalTagCount = tagStats.total;

                // 清理所有標籤緩存
                TagCacheService.clearAllTagCache();

                // 清理所有實例
                for (const [key, instance] of PromptAssistant.instances) {
                    if (instance) {
                        allInstanceNames.push(instance.inputId || key);
                        this._cleanupInstance(instance, key, true);
                    }
                }

                // 清空實例集合
                PromptAssistant.instances.clear();

                if (!silent) {
                    logger.log(`[全局清理] 實例: ${allInstanceNames.join(', ')} | 歷史: ${totalHistoryCount}条 | 標籤: ${totalTagCount}个`);
                    logger.log(`[剩余統計] 小助手實例: 0个 | 標籤緩存: 0个 | 節點歷史緩存: 0条`);
                }
            } catch (error) {
                logger.error(`[全局清理] 失敗 | 錯誤: ${error.message}`);
            }
        }
    }

    // ---節點類型检测工具---

    /**
     * 檢查節點是否為使用comfy-markdown的節點
     * 包括 Note、MarkdownNote、PreviewTextNode 等
     * @param {object} node - 節點对象
     * @returns {boolean}
     */
    _isMarkdownNode(node) {
        if (!node || !node.type) return false;
        const markdownNodeTypes = ['Note', 'MarkdownNote', 'PreviewAny', 'PreviewTextNode'];
        if (markdownNodeTypes.includes(node.type)) {
            return true;
        }
        const typeLower = node.type.toLowerCase();
        return typeLower.includes('markdown') ||
            (typeLower.includes('preview') && typeLower.includes('text')) ||
            typeLower.includes('subgraph'); // 增加对子圖的基础判定支持
    }

    /**
     * 檢查節點是否為子圖節點 (Subgraph)
     * 子圖節點的類型名为 UUID 格式
     * @param {object} node - 節點对象
     * @returns {boolean}
     */
    _isSubgraphNode(node) {
        if (!node || !node.type) return false;
        // UUID 格式：8-4-4-4-12 字符
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(node.type);
    }

    // ---實例管理功能---
    /**
     * 檢查節點是否有效
     * Vue mode下Note/MarkdownNote/Subgraph節點需要特殊處理
     */
    static isValidNode(node) {
        if (!node || typeof node.id === 'undefined' || node.id === -1) {
            return false;
        }

        if (typeof node.type !== 'string') {
            return false;
        }

        // Vue mode下的特殊節點類型（可能没有標準widgets属性）
        const isVueMode = typeof LiteGraph !== 'undefined' && LiteGraph.vueNodesMode === true;
        const vueSpecialNodeTypes = ['Note', 'MarkdownNote', 'PreviewAny', 'PreviewTextNode'];

        // 檢查是否為markdown類型節點
        const isMarkdownNode = vueSpecialNodeTypes.includes(node.type) ||
            (node.type && node.type.toLowerCase().includes('markdown')) ||
            (node.type && node.type.toLowerCase().includes('preview') && node.type.toLowerCase().includes('text'));

        // 檢查是否為子圖節點
        // 1. UUID 格式類型名 (Node 2.0 動態創建)
        const isUUIDType = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(node.type);
        // 2. 原生 Subgraph 關鍵字或 workflow/ 前缀
        const isSubgraphType = node.type === 'Subgraph' ||
            node.type.startsWith('workflow/') ||
            (node.constructor && node.constructor.name === 'Subgraph');

        if (isVueMode && (isMarkdownNode || isUUIDType || isSubgraphType)) {
            // Vue mode下這些節點類型直接視為有效
            return true;
        }

        // 標準檢查：需要有widgets属性
        return !!node.widgets;
    }

    /**
     * 添加實例到管理器
     */
    static addInstance(nodeId, widget) {
        if (nodeId != null && widget != null) {
            this.instances.set(String(nodeId), widget);
            return true;
        }
        return false;
    }

    /**
     * 獲取實例
     */
    static getInstance(key) {
        if (key == null) return null;
        return this.instances.get(String(key));
    }

    /**
     * 檢查實例是否存在
     */
    static hasInstance(key) {
        if (key == null) return false;
        return this.instances.has(String(key));
    }

    /**
     * 檢查節點并設置小助手
     * 查找節點中的有效輸入控件并創建小助手
     */
    checkAndSetupNode(node) {
        // 快速檢查
        if (!window.FEATURES.enabled || !node) return;

        const isVueMode = LiteGraph.vueNodesMode === true;



        // Vue mode下特殊節點（Note/Markdown/Subgraph）即使没有 LiteGraph widgets 也是有效的
        if (!node.widgets) {

            if (isVueMode && PromptAssistant.isValidNode(node)) {
                this._handleVueDomScanNode(node);
            }
            return;
        }

        // 后续檢查：如果虽然有 widgets 但不是我们識別的有效節點，也回退處理
        const isValid = PromptAssistant.isValidNode(node);
        if (!isValid) {

            return;
        }

        // 獲取所有有效的輸入控件
        const validInputs = node.widgets.filter(widget => {
            if (!widget.node) widget.node = node;
            const isValidInput = UIToolkit.isValidInput(widget, { debug: false, node: node });

            return isValidInput;
        });



        if (validInputs.length === 0) {
            // 非目標節點類型（如 LoadImage）没有文本控件是正常的，使用 debug 級別
            logger.debug(`[checkAndSetupNode] 節點無有效控件 | ID: ${node.id} | 類型: ${node.type}`);

            // Vue mode下節點可能暂时没有識別到 LiteGraph 控件，強制回退到 DOM 掃描模式
            if (isVueMode && isValid) {
                this._handleVueDomScanNode(node);
            }
            return;
        }

        // 为每个有效控件創建小助手
        validInputs.forEach((inputWidget, widgetIndex) => {
            const inputId = inputWidget.name || inputWidget.id;

            // --- 核心修復：多图支持的唯一键 ---
            let assistantKey = this._getAssistantKey(node, inputId);

            // 檢查是否存在同名的輸入框，如果存在则使用索引或 DOM 元素的唯一标识
            const sameNameWidgets = validInputs.filter(w => (w.name || w.id) === inputId);
            if (sameNameWidgets.length > 1) {
                // 多个同名輸入框，使用索引或輸入框元素的内存地址作为唯一标识
                const inputEl = inputWidget.inputEl || inputWidget.element;
                if (inputEl) {
                    // 为輸入框元素添加唯一标识
                    if (!inputEl.dataset.promptAssistantUniqueId) {
                        inputEl.dataset.promptAssistantUniqueId = `${graphId}_${node.id}_${inputId}_${widgetIndex}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                    }
                    assistantKey = inputEl.dataset.promptAssistantUniqueId;
                } else {
                    // 降级方案：使用索引
                    assistantKey = `${graphId}_${node.id}_${inputId}_${widgetIndex}`;
                }
            }

            // 檢查實例是否已存在
            if (PromptAssistant.hasInstance(assistantKey)) {
                // 如果實例存在，檢查輸入控件是否已更新，或者 UI 元素是否已丟失
                const instance = PromptAssistant.getInstance(assistantKey);
                const currentInputEl = inputWidget.inputEl;
                const instanceInputEl = instance?.text_element;
                const instanceUIEl = instance?.element;

                // 檢查 UI 元素是否仍然在 DOM 中
                const isVueMode = nodeMountService.isVueNodesMode();
                const nodeContainer = isVueMode ? document.querySelector(`[data-node-id="${node.id}"]`) : null;
                const isUIPresent = isVueMode ? nodeContainer?.contains(instanceUIEl) : document.body.contains(instanceUIEl);

                // --- 修復：處理挂载竞争狀態 ---
                // 如果 UI 元素丟失，或者輸入元素引用變化且原元素已移除，则清理并重建
                // 增加 _isMounting 標記檢查，避免异步挂载期间被误判为丟失
                if (!instanceUIEl || (!isUIPresent && !instance._isMounting)) {
                    logger.debug(() => `[checkAndSetupNode] UI 元素已丟失，清理實例以觸發重建 | 節點ID: ${node.id} | 键: ${assistantKey}`);
                    // 传入完整的 assistantKey 以確保精确清理
                    this.cleanup(assistantKey);
                } else if (!isUIPresent && instance._isMounting) {
                    // 正在挂载中，跳過
                    return;
                } else if (instanceInputEl && currentInputEl && instanceInputEl !== currentInputEl) {
                    // 进一步檢查：確保确实需要重建（避免误判）
                    // 如果当前元素已经從 DOM 中移除，才需要清理
                    if (!document.body.contains(instanceInputEl)) {
                        logger.debug(() => `[checkAndSetupNode] 輸入元素已失效，清理實例 | 節點ID: ${node.id}`);
                        this.cleanup(node.id);
                    } else {
                        return;
                    }
                } else {
                    // 實例存在且一切正常，跳過
                    return;
                }
            }

            // 再次檢查總開關狀態，確保在創建過程中没有被禁用
            if (!window.FEATURES.enabled) {
                return;
            }

            // 【防重复挂载檢查】在創建前檢查 inputEl 是否已被其他實例挂载
            const inputEl = inputWidget.inputEl || inputWidget.element;
            if (inputEl && inputEl._promptAssistantMounted) {
                return;
            }

            // 創建小助手實例
            const assistant = this.setupNodeAssistant(node, inputWidget, assistantKey);
            if (assistant) {
                logger.debugSample(() => `[小助手] 創建實例 | 節點:${node.id} | 控件:${inputId} | 索引:${widgetIndex}`);
            }
        });
    }

    /**
 * Vue mode 下对特殊或動態節點（Note/Subgraph等）的 DOM 掃描處理
 * 当 LiteGraph widgets 尚未就绪时，直接從 DOM 中掃描 textarea 并挂载
 */
    _handleVueDomScanNode(node) {
        if (!node) return;

        const isMarkdown = this._isMarkdownNode(node);
        const isSubgraph = this._isSubgraphNode(node);

        // 仅處理我们識別的有效節點
        if (!isMarkdown && !isSubgraph) return;

        const nodeId = node.id;

        // 使用 NodeMountService 提供的逻辑，在 DOM 容器中查找所有潜在的輸入框
        const nodeContainer = document.querySelector(`[data-node-id="${nodeId}"]`);
        if (!nodeContainer) {
            // 如果容器还没渲染，则啟動一次带重试的单次挂载嘗試（针对主要輸入框）
            if (isMarkdown) {
                this._retryDomScan(node, 'text');
            }
            return;
        }

        // 查找所有 textarea（优先找 PrimeVue 的 .p-textarea）
        const primeTextareas = Array.from(nodeContainer.querySelectorAll('textarea.p-textarea'));
        const textareas = primeTextareas.length > 0 ? primeTextareas : Array.from(nodeContainer.querySelectorAll('textarea'));

        if (textareas.length === 0) {
            // 可能是 TipTap 编辑器（针对 Note 節點）
            const editor = nodeContainer.querySelector('.tiptap') || nodeContainer.querySelector('.ProseMirror');
            if (editor) {
                this._mountDomAssistant(node, editor, 'text', 0);
            }
            return;
        }

        // 遍历所有找到的 textarea 并嘗試挂载
        textareas.forEach((el, index) => {
            // 生成 Key：對於 Note 節點通常只有一个，對於子圖有多个
            const inputId = textareas.length === 1 ? 'text' : `input_${index}`;
            this._mountDomAssistant(node, el, inputId, index);
        });
    }

    /**
     * 執行实际的 DOM 挂载
     */
    _mountDomAssistant(node, element, inputId, index) {
        const assistantKey = this._getAssistantKey(node, inputId);
        if (PromptAssistant.hasInstance(assistantKey)) {
            const instance = PromptAssistant.getInstance(assistantKey);
            const isVueMode = nodeMountService.isVueNodesMode();
            const nodeContainer = isVueMode ? document.querySelector(`[data-node-id="${node.id}"]`) : null;
            const isUIPresent = isVueMode ? nodeContainer?.contains(instance?.element) : document.body.contains(instance?.element);

            if (instance?.element && isUIPresent) {
                return;
            }

            // 實例存在但 UI 丟失，清理旧實例以便重建
            logger.debug(() => `[_mountDomAssistant] 检测到孤立實例，清理重建 | 節點ID: ${node.id}`);
            this.cleanup(node.id);
        }

        // 檢查元素是否已被挂载 (基于 DOM 属性判斷)
        if (element._promptAssistantMounted) {
            // 如果属性还在但實例在 Map 中没了，或者 UI 确实不可见了，应该允许重新挂载
            // 這裡我们保持原样，通过上面的 cleanup 保证一致性
            return;
        }

        // 創建虚拟 widget
        const virtualWidget = {
            name: inputId, id: inputId, type: 'textarea',
            inputEl: element, element: element, node: node,
            _domIndex: index // 記錄 DOM 索引
        };

        const nodeInfo = {
            workflow_id: app.graph?._workflow_id || 'unknown',
            nodeType: node.type, inputType: 'text',
            isNoteNode: this._isMarkdownNode(node),
            isSubgraph: this._isSubgraphNode(node),
            isVueMode: true,
            domIndex: index
        };

        const assistant = this.createAssistant(node, inputId, virtualWidget, nodeInfo, assistantKey);
        if (assistant) {
            this.showAssistantUI(assistant);
            logger.debugSample(() => `[DOM掃描] ${node.type}節點挂载成功 | ID: ${node.id} | Key: ${assistantKey}`);
        }
    }

    /**
     * 针对初始 DOM 未就绪的情况进行一次带重试的掃描
     */
    _retryDomScan(node, inputId) {
        const widgetStub = { name: inputId, node: node };
        nodeMountService.findMountContainerWithRetry(node, widgetStub, { timeout: 2000 })
            .then(result => {
                if (result && result.textarea) {
                    this._mountDomAssistant(node, result.textarea, inputId, 0);
                }
            });
    }

    /**
     * 为節點設置小助手
     * 創建小助手實例并初始化顯示狀態
     */
    setupNodeAssistant(node, inputWidget, assistantKey = null) {


        // 簡化参数檢查
        if (!node || !inputWidget) {
            logger.error(`[setupNodeAssistant] 参数無效 | node: ${!!node} | inputWidget: ${!!inputWidget}`);
            return null;
        }

        try {
            const nodeId = node.id;
            const inputId = inputWidget.name || inputWidget.id || Math.random().toString(36).substring(2, 10);
            const isNoteNode = this._isMarkdownNode(node);
            const isVueMode = typeof LiteGraph !== 'undefined' && LiteGraph.vueNodesMode === true;



            // 簡化節點信息
            const nodeInfo = {
                workflow_id: app.graph?._workflow_id || 'unknown',
                nodeType: node.type,
                inputType: inputId,
                isNoteNode: isNoteNode,
                isVueMode: isVueMode
            };

            // 處理inputWidget的inputEl引用
            let processedWidget = inputWidget;
            if (isNoteNode) {
                const inputEl = inputWidget.element || inputWidget.inputEl;
                processedWidget = {
                    ...inputWidget,
                    inputEl: inputEl,
                    _needsDelayedTextareaLookup: isVueMode && !inputEl
                };

            } else {

            }

            // 創建小助手實例

            const assistant = this.createAssistant(
                node,
                inputId,
                processedWidget,
                nodeInfo,
                assistantKey
            );

            if (assistant) {

                // 初始化顯示狀態
                // 初始化顯示狀態
                this.showAssistantUI(assistant);
                return assistant;
            } else {
                console.warn(`[setupNodeAssistant] ⚠️ createAssistant 返回 null`);
            }

            return null;
        } catch (error) {
            logger.error(`[setupNodeAssistant] ❌ 異常 | 節點: ${node.id} | 錯誤:`, error);
            logger.error(`創建小助手失敗 | 節點ID: ${node.id} | 原因: ${error.message}`);
            return null;
        }
    }

    /**
     * 創建小助手實例
     * 根據節點和輸入控件构建小助手对象并初始化UI
     */
    createAssistant(node, inputId, inputWidget, nodeInfo = {}, assistantKey = null) {


        // 簡化前置檢查
        if (!window.FEATURES.enabled || !node || !inputId || !inputWidget) {
            logger.error(`[createAssistant] ❌ 前置檢查失敗 | enabled: ${window.FEATURES.enabled} | node: ${!!node} | inputId: ${inputId} | inputWidget: ${!!inputWidget}`);
            return null;
        }


        // 確保widget設置了node引用
        if (!inputWidget.node) {
            inputWidget.node = node;
        }

        // 验证是否為有效輸入

        if (!UIToolkit.isValidInput(inputWidget, { node: node })) {
            console.warn(`[createAssistant] ⚠️ 輸入無效 | 節點: ${node?.id} | 控件: ${inputId}`);
            return null;
        }


        // 獲取輸入元素
        let inputEl = inputWidget.inputEl || inputWidget.element;
        const isVueMode = typeof LiteGraph !== 'undefined' && LiteGraph.vueNodesMode === true;



        // 非Vue mode下，inputEl必须存在
        if (!inputEl && !isVueMode) {
            logger.error(`[createAssistant] ❌ 非Vue模式下inputEl不存在 | 節點: ${node?.id}`);
            return null;
        }

        const nodeId = node.id;
        const widgetKey = assistantKey || this._getAssistantKey(node, inputId);



        // 檢查是否已存在實例
        if (PromptAssistant.hasInstance(widgetKey)) {

            return PromptAssistant.getInstance(widgetKey);
        }



        // 創建小助手对象
        const widget = {
            type: "prompt_assistant",
            name: inputId,
            nodeId,
            inputId,
            widgetKey,
            buttons: {},
            text_element: inputEl,
            inputEl: inputEl,
            isDestroyed: false,
            _isMounting: true, // 標記挂载中狀態
            nodeInfo: {
                ...nodeInfo,
                nodeId: nodeId,
                nodeType: node.type,
                isVueMode: isVueMode
            },
            isTransitioning: false,
            // 保存初始節點引用作为后备（Vue Node 2.0 子圖切換场景）
            _initialNode: node
        };

        // 動態獲取節點的 getter，避免持有已刪除節點的引用
        // 【修復】优先從 graph 獲取，失敗时回退到初始引用（解决子圖切換时画布未同步問題）
        Object.defineProperty(widget, 'node', {
            get() {
                if (this.isDestroyed) return null;
                // 优先從当前画布 graph 動態獲取
                const graphNode = app.canvas?.graph?._nodes_by_id?.[this.nodeId];
                if (graphNode) return graphNode;
                // 回退：使用初始節點引用（如果仍有效）
                if (this._initialNode && this._initialNode.id === this.nodeId) {
                    return this._initialNode;
                }
                return null;
            },
            configurable: true
        });



        // 創建全局輸入框映射
        if (!window.PromptAssistantInputWidgetMap) {
            window.PromptAssistantInputWidgetMap = {};
        }

        window.PromptAssistantInputWidgetMap[widgetKey] = {
            inputEl: inputEl,
            widget: widget
        };



        // 創建UI并添加到實例集合
        this.createAssistantUI(widget, inputWidget);

        PromptAssistant.addInstance(widgetKey, widget);



        // 初始化绑定
        if (inputEl) {
            this._initializeInputElBindings(widget, inputWidget, node, inputId, nodeInfo);
        } else {

        }


        return widget;
    }

    /**
     * 初始化inputEl相关的事件绑定
     * 在传统模式下立即調用，Vue mode下在找到textarea后調用
     */
    _initializeInputElBindings(widget, inputWidget, node, inputId, nodeInfo) {
        const inputEl = inputWidget.inputEl || widget.inputEl;
        if (!inputEl) {
            logger.warn(`[_initializeInputElBindings] inputEl不存在 | 節點ID: ${node?.id}`);
            return;
        }

        const nodeId = node.id;

        // 初始化撤销狀態（只初始化一次，使用widget級別的標記）
        if (!widget._undoStateInitialized) {
            const initialValue = inputEl.value || '';
            // 如果初始值不为空，则直接添加到歷史記錄中，確保可以撤销回初始狀態
            if (initialValue.trim()) {
                HistoryCacheService.addHistoryAndUpdateUndoState(nodeId, inputId, initialValue, 'input');
            } else {
                HistoryCacheService.initUndoState(nodeId, inputId, initialValue);
            }
            widget._undoStateInitialized = true;
        }
        // 初始化時立即更新撤销/重做按钮狀態
        UIToolkit.updateUndoRedoButtonState(widget, HistoryCacheService);

        // 檢查是否已绑定事件（避免重複绑定）
        // 【關鍵修復】使用 widget 級別的標記来精确控制绑定狀態
        // 確保不会因为 _eventCleanupFunctions 中包含其他清理函數（如按钮菜单）而误判
        if (widget._inputEventsBound) {
            logger.debug(`[_initializeInputElBindings] 跳過绑定 | 節點ID: ${nodeId} | 原因: 已绑定`);
            return;
        }

        // 如果检测到遗留標記，静默處理

        inputEl._promptAssistantBound = true;
        widget._inputEventsBound = true;
        widget._eventCleanupFunctions = widget._eventCleanupFunctions || [];

        // 绑定輸入框失焦事件，写入歷史
        // 使用事件管理器添加DOM事件監聽
        const removeBlurListener = EventManager.addDOMListener(inputEl, 'blur', async () => {
            // logger.debug(`歷史写入准备｜ 原因：失焦事件觸發 node_id=${node.id} input_id=${inputId}`);
            HistoryCacheService.addHistory({
                workflow_id: nodeInfo?.workflow_id || '',
                node_id: node.id,
                input_id: inputId,
                content: inputEl.value,
                operation_type: 'input',
                timestamp: Date.now()
            });
            // 重置撤销狀態
            HistoryCacheService.initUndoState(node.id, inputId, inputEl.value);
            // 更新按钮狀態
            UIToolkit.updateUndoRedoButtonState(widget, HistoryCacheService);
            // logger.debug(`歷史写入完成｜原因：輸入框失焦 node_id=${node.id} input_id=${inputId}`);
        });

        // 保存清理函數引用，以便后续清理
        widget._eventCleanupFunctions = widget._eventCleanupFunctions || [];
        widget._eventCleanupFunctions.push(removeBlurListener);

        // 添加輸入事件監聽，实时更新撤销/重做按钮狀態和位置调整
        const removeInputListener = EventManager.addDOMListener(inputEl, 'input', () => {
            UIToolkit.updateUndoRedoButtonState(widget, HistoryCacheService);
            // 检测滚动条狀態并调整位置
            this._adjustPositionForScrollbar(widget, inputEl);
        });
        widget._eventCleanupFunctions.push(removeInputListener);

        // 添加ResizeObserver監聽輸入框尺寸變化
        if (window.ResizeObserver) {
            const resizeObserver = new ResizeObserver(() => {
                // 延迟執行，確保浏览器完成布局更新
                setTimeout(() => {
                    this._adjustPositionForScrollbar(widget, inputEl);
                }, 10);
            });

            resizeObserver.observe(inputEl);

            // 添加清理函數
            widget._eventCleanupFunctions.push(() => {
                resizeObserver.disconnect();
            });
        } else {
            // 降级方案：監聽window resize事件
            const removeResizeListener = EventManager.addDOMListener(window, 'resize',
                EventManager.debounce(() => {
                    this._adjustPositionForScrollbar(widget, inputEl);
                }, 100)
            );
            widget._eventCleanupFunctions.push(removeResizeListener);
        }
    }

    // ---UI管理功能---
    /**
     * 創建小助手UI
     * 构建DOM元素并設置事件監聽和初始样式
     */
    createAssistantUI(widget, inputWidget) {
        const nodeId = widget.nodeId;
        const inputId = widget.inputId;



        try {

            // Get location setting
            const locationSetting = app.ui.settings.getSettingValue(
                "PromptAssistant.Location"
            );



            // Create AssistantContainer instance
            const container = new AssistantContainer({
                nodeId: nodeId,
                type: 'prompt',
                anchorPosition: locationSetting,
                enableDragSort: true,
                onButtonOrderChange: (order) => {
                    logger.debug(`[排序更新] 節點:${nodeId} | 新順序: ${order.join(',')}`);
                },
                shouldCollapse: () => {
                    return !this._checkAssistantActiveState(widget);
                }
            });



            // Render container
            const containerEl = container.render();



            // Set Icon
            const mainIcon = ResourceManager.getIcon('icon-main.svg');
            if (mainIcon) {
                if (container.indicator) {
                    container.indicator.innerHTML = '';
                    container.indicator.appendChild(mainIcon);
                }
            }



            // Save references
            widget.container = container;
            widget.element = containerEl;
            widget.innerContent = container.content;
            widget.hoverArea = container.hoverArea;
            widget.indicator = container.indicator;
            widget.buttons = {};

            Object.defineProperty(widget, 'isCollapsed', {
                get: () => container.isCollapsed,
                set: (val) => {
                    if (val) container.collapse(); else container.expand();
                }
            });
            Object.defineProperty(widget, 'isTransitioning', {
                get: () => container.isTransitioning,
                set: (val) => { container.isTransitioning = val; }
            });



            // Initialize buttons
            this.addFunctionButtons(widget);



            // Restore button order
            container.restoreOrder();



            // Setup Positioning
            const inputEl = inputWidget.inputEl || widget.inputEl;
            const graphCanvasContainer = document.querySelector('.graphcanvas');
            const canvasContainerRect = graphCanvasContainer?.getBoundingClientRect();




            this._setupUIPosition(widget, inputEl, containerEl, canvasContainerRect, (success) => {

                if (widget.isDestroyed) {
                    logger.debug(`[定位] 回调跳過：實例已销毁 | ID: ${nodeId}`);
                    return;
                }

                if (!success) {
                    logger.debugSample(() => `[小助手] 創建暂缓 | 節點ID: ${nodeId} | 原因: 定位容器未就绪 (等待DOM渲染)`);
                    container.destroy();
                    const widgetKey = widget.widgetKey;
                    if (widgetKey && PromptAssistant.instances.has(widgetKey)) {
                        PromptAssistant.instances.delete(widgetKey);
                    }
                    if (window.PromptAssistantInputWidgetMap && widgetKey) {
                        delete window.PromptAssistantInputWidgetMap[widgetKey];
                    }
                    return;
                }

                // 定位成功后更新尺寸
                container.updateDimensions();
                // 挂载完成，清除標記
                widget._isMounting = false;
            });

            return containerEl;
        } catch (error) {
            console.error(`[createAssistantUI] ❌ 異常 | 節點: ${nodeId} | 錯誤:`, error);
            logger.error(`創建小助手失敗 | 節點ID: ${nodeId} | 原因: ${error.message}`);
            return null;
        }
    }

    /**
     * 顯示小助手UI
     * 控制UI顯示动画和狀態，創建时直接以折叠狀態顯示
     */
    showAssistantUI(widget, forceAnimation = false) {
        if (!widget?.element) return;

        // 避免重複顯示
        if (widget.element.classList.contains('assistant-show')) {
            // 確保元素可见
            widget.element.style.display = 'flex';
            widget.element.style.opacity = '1';
            return;
        }

        // 直接顯示，无动画过渡
        widget.element.style.opacity = '1';
        widget.element.style.display = 'flex';
        widget.element.classList.add('assistant-show');

        // 確保悬停区域可见（用于折叠狀態下的交互）
        if (widget.isCollapsed && widget.hoverArea) {
            widget.hoverArea.style.display = 'block';
        }

        // 重置过渡狀態
        widget.isTransitioning = false;

        // 只有当明确不是折叠狀態时才觸發自動折叠
        if (!widget.isCollapsed) {
            this.triggerAutoCollapse(widget);
        }
    }

    /**
     * 檢查并觸發自動折叠（如果需要）
     */
    _triggerAutoCollapseIfNeeded(widget) {
        if (widget && widget.container) {
            widget.container.collapse();
        }
    }




    /**
     * 展开小助手
     */
    _expandAssistant(widget) {
        if (widget && widget.container) {
            widget.container.expand();
        }
    }



    /**
     * 公开方法：觸發小助手自動折叠
     * 供外部模块調用，用于在操作完成后折叠小助手UI
     */
    triggerAutoCollapse(widget) {
        return this._triggerAutoCollapseIfNeeded(widget);
    }

    /**
     * 更新小助手可见性
     * 始终顯示小助手，不再根據鼠标悬停狀態来决定
     */
    updateAssistantVisibility(widget) {
        if (!widget) return;

        // 總開關关闭时不處理可见性更新
        if (!window.FEATURES || !window.FEATURES.enabled) {
            return;
        }

        // 檢查是否有按钮处于激活或處理中狀態
        const hasActiveButtons = this._checkAssistantActiveState(widget);

        // 如果有激活的按钮，強制顯示小助手（带动画）并取消自動折叠
        if (hasActiveButtons) {
            this.showAssistantUI(widget, true);

            // 取消可能的自動折叠定时器
            if (widget._autoCollapseTimer) {
                clearTimeout(widget._autoCollapseTimer);
                widget._autoCollapseTimer = null;
            }

            // 如果当前是折叠狀態，则展开 - 使用requestAnimationFrame
            if (widget.isCollapsed) {
                requestAnimationFrame(() => {
                    this._expandAssistant(widget);
                });
            }

            return;
        }

        // 始终顯示小助手，不再檢查鼠标狀態
        const isCurrentlyShown = widget.element?.classList.contains('assistant-show');
        if (!isCurrentlyShown) {
            this.showAssistantUI(widget, false);
            logger.debug(`UI顯示 | 節點:${widget.nodeId} | 原因:始终顯示`);
        } else {
            // 已经顯示，檢查是否需要自動折叠
            this.triggerAutoCollapse(widget);
        }
    }

    /**
     * 檢查小助手是否有按钮处于激活狀態
     */
    _checkAssistantActiveState(widget) {
        if (!widget || !widget.buttons) return false;

        // 0. 檢查是否正在切換弹窗（切換期间不允许折叠）
        if (PopupManager._isTransitioning) {
            return true;
        }

        // 1. 檢查右键菜单是否可见（并且属于当前 widget）
        if (buttonMenu.isMenuVisible && buttonMenu.menuContext?.widget === widget) {
            return true;
        }

        // 2. 檢查中央按钮狀態管理器是否有该widget的激活按钮
        const activeButtonInfo = UIToolkit.getActiveButtonInfo();
        if (activeButtonInfo && activeButtonInfo.widget === widget) {
            return true;
        }

        // 3. 檢查 PopupManager 的活动弹窗是否属于当前 widget
        if (PopupManager.activePopupInfo?.buttonInfo?.widget === widget) {
            return true;
        }

        // 4. 檢查按钮的 active/processing 狀態
        for (const buttonId in widget.buttons) {
            const button = widget.buttons[buttonId];
            if (button.classList.contains('button-active') ||
                button.classList.contains('button-processing')) {
                return true;
            }
        }

        return false;
    }

    /**
     * 更新所有實例的可见性
     * 在按钮狀態變化时調用
     */
    updateAllInstancesVisibility() {
        PromptAssistant.instances.forEach(widget => {
            this.updateAssistantVisibility(widget);
        });
    }

    /**
     * 更新所有實例的预设宽度
     * 在功能开关变更时調用，重新計算并設置宽度
     */
    updateAllInstancesWidth() {
        // 優化：不再手动計算宽度并注入，而是觸發每个容器自身的常量布局逻辑
        logger.debug(`[布局更新] 觸發所有實例尺寸重算 | 實例數量:${PromptAssistant.instances.size}`);

        PromptAssistant.instances.forEach((widget) => {
            if (widget && widget.container && typeof widget.container.updateDimensions === 'function') {
                widget.container.updateDimensions();
            }
        });
    }

    /**
     * 顯示狀態提示
     * 創建临时提示信息气泡
     */
    showStatusTip(anchorElement, type, message, position = null) {
        return UIToolkit.showStatusTip(anchorElement, type, message, position);
    }

    // ---事件處理功能---
    /**
     * 設置UI事件處理
     * 配置按钮事件監聽 - 簡化版本
     */
    _setupUIEventHandling(widget, inputEl, containerDiv) {
        // 事件處理已委托给 AssistantContainer
        // 我们保留此方法是为了兼容外部調用，但现在它不執行任何操作。
    }



    // ---辅助功能---
    /**
     * 更新輸入框内容并添加高亮效果
     */
    updateInputWithHighlight(widget, content, options = {}) {
        if (!widget?.inputEl) return;

        try {
            // 更新輸入框内容 - 使用统一的setInputValue函數
            const success = setInputValue(widget, content, options);

            if (!success) {
                logger.warn(`輸入框更新 | 结果:失敗 | setInputValue返回false`);
                return;
            }

            // 使用统一的高亮工具方法 (處理了定时器管理和重绘)
            UIToolkit._highlightInput(widget.inputEl);
        } catch (error) {
            logger.error(`輸入框更新 | 结果:異常 | 錯誤:${error.message}`);
        }
    }

    // ---按钮管理功能---
    /**
     * 添加功能按钮
     */
    addFunctionButtons(widget) {
        if (!widget?.element) {
            logger.error('添加按钮 | 结果:失敗 | 原因: 容器不存在');
            return;
        }

        // 檢查總開關狀態
        if (!FEATURES.enabled) {
            logger.debug('添加按钮 | 结果:跳過 | 原因: 总功能已禁用');
            return;
        }

        // 檢查是否有至少一个功能啟用
        const hasEnabledFeatures = FEATURES.history || FEATURES.tag || FEATURES.expand || FEATURES.translate;
        if (!hasEnabledFeatures) {
            logger.debug('添加按钮 | 结果:跳過 | 原因: 没有啟用任何功能');
            return;
        }

        // 檢查是否是Note/MarkdownNote節點
        const isNoteNode = widget.nodeInfo && (widget.nodeInfo.isNoteNode === true || widget.nodeInfo.nodeType === 'MarkdownNote');

        // 獲取歷史狀態（用于初始化撤销/重做按钮狀態）
        const canUndo = HistoryCacheService.canUndo(widget.nodeId, widget.inputId);
        const canRedo = HistoryCacheService.canRedo(widget.nodeId, widget.inputId);

        // 按钮配置
        const buttonConfigs = [
            {
                id: 'history',
                title: '歷史',
                icon: 'icon-history',
                onClick: (e, widget) => {
                    UIToolkit.handlePopupButtonClick(
                        e,
                        widget,
                        'history',
                        HistoryManager.showHistoryPopup.bind(HistoryManager),
                        HistoryManager.hideHistoryPopup.bind(HistoryManager)
                    );
                },
                visible: !isNoteNode && FEATURES.history, // Note節點不顯示此按钮
                initialState: { disabled: false }
            },
            {
                id: 'undo',
                title: '撤销',
                icon: 'icon-undo',
                onClick: (e, widget) => {
                    e.preventDefault();
                    e.stopPropagation();
                    logger.debug('按钮点击 | 動作: 撤销');

                    // 執行撤销操作
                    const undoContent = HistoryCacheService.undo(widget.nodeId, widget.inputId);
                    if (undoContent !== null) {
                        // 更新輸入框内容并添加高亮效果
                        this.updateInputWithHighlight(widget, undoContent);

                        // 更新按钮狀態
                        UIToolkit.updateUndoRedoButtonState(widget, HistoryCacheService);

                        logger.debug(`撤销操作 | 结果:成功 | 節點:${widget.nodeId}`);
                    } else {
                        logger.debug(`撤销操作 | 结果:失敗 | 節點:${widget.nodeId} | 原因:无可用内容`);
                    }
                },
                visible: !isNoteNode && FEATURES.history,
                initialState: { disabled: !canUndo }
            },
            {
                id: 'redo',
                title: '重做',
                icon: 'icon-redo',
                onClick: (e, widget) => {
                    e.preventDefault();
                    e.stopPropagation();
                    logger.debug('按钮点击 | 動作: 重做');

                    // 執行重做操作
                    const redoContent = HistoryCacheService.redo(widget.nodeId, widget.inputId);
                    if (redoContent !== null) {
                        // 更新輸入框内容并添加高亮效果
                        this.updateInputWithHighlight(widget, redoContent);

                        // 更新按钮狀態
                        UIToolkit.updateUndoRedoButtonState(widget, HistoryCacheService);

                        logger.debug(`重做操作 | 结果:成功 | 節點:${widget.nodeId}`);
                    } else {
                        logger.debug(`重做操作 | 结果:失敗 | 節點:${widget.nodeId} | 原因:无可用内容`);
                    }
                },
                visible: !isNoteNode && FEATURES.history,
                initialState: { disabled: !canRedo }
            },
            {
                id: 'divider1',
                type: 'divider',
                visible: !isNoteNode && FEATURES.history // Note節點不顯示，且跟随歷史功能开关
            },
            {
                id: 'textGrid',
                title: '文字 Grid',
                icon: 'icon-textGrid',
                onClick: (e, widget) => {
                    // 創建一個帶有文字選擇功能的顯示函數
                    const showTextGridPopup = (options) => {
                        // 處理文字選擇功能（現在只顯示，不插入）
                        const enhancedOptions = {
                            ...options,
                            // 移除 onTextSelect，因為現在不允許點擊插入
                            // 可以從輸入框獲取文字項目，或使用默認項目
                            textItems: this._getTextGridItems(widget),
                            widget: widget // 傳遞 widget 引用，用於更新輸入框
                        };

                        // 調用文字 Grid 管理器顯示彈窗
                        TextGridManager.showTextGridPopup(enhancedOptions);
                    };

                    // 使用統一的彈窗按鈕點擊處理
                    UIToolkit.handlePopupButtonClick(
                        e,
                        widget,
                        'textGrid',
                        showTextGridPopup,
                        TextGridManager.hideTextGridPopup.bind(TextGridManager)
                    );
                },
                visible: !isNoteNode && FEATURES.tag // Note節點不顯示此按钮，使用標籤功能的開關
            },
            {
                id: 'tag',
                title: '標籤工具',
                icon: 'icon-tag',
                onClick: (e, widget) => {
                    // 創建一个带有標籤選擇功能的顯示函數
                    const showTagPopup = (options) => {
                        // 處理標籤選擇功能
                        const enhancedOptions = {
                            ...options,
                            onTagSelect: (tag) => {
                                // 獲取当前輸入框的值和光标位置
                                const currentValue = widget.inputEl.value;
                                const cursorPos = widget.inputEl.selectionStart;
                                const beforeText = currentValue.substring(0, cursorPos);
                                const afterText = currentValue.substring(widget.inputEl.selectionEnd);

                                // 添加標籤（英文值）
                                const newValue = beforeText + tag.en + afterText;

                                // 更新輸入框内容并添加高亮效果
                                this.updateInputWithHighlight(widget, newValue);

                                // 更新光标位置
                                const newPos = cursorPos + tag.en.length;
                                widget.inputEl.setSelectionRange(newPos, newPos);

                                // 保持焦点在輸入框
                                widget.inputEl.focus();
                            }
                        };

                        // 調用標籤管理器顯示弹窗
                        TagManager.showTagPopup(enhancedOptions);
                    };

                    // 使用统一的弹窗按钮点击處理
                    UIToolkit.handlePopupButtonClick(
                        e,
                        widget,
                        'tag',
                        showTagPopup,
                        TagManager.hideTagPopup.bind(TagManager)
                    );
                },
                visible: !isNoteNode && FEATURES.tag // Note節點不顯示此按钮
            },
            {
                id: 'expand',
                title: '提示詞優化',
                icon: 'icon-expand',
                onClick: async (e, widget) => {
                    logger.debug('按钮点击 | 動作: 提示詞優化');

                    // 如果按钮处于 processing 狀態且被点击，直接返回，
                    // 讓UIToolkit中的取消逻辑接管
                    if (e.currentTarget.classList.contains('button-processing')) {
                        return;
                    }

                    await UIToolkit.handleAsyncButtonOperation(
                        widget,
                        'expand',
                        e.currentTarget,
                        async (notifyCancelReady) => {
                            try {
                                // 獲取輸入值 - 使用统一的getInputValue函數
                                const inputValue = getInputValue(widget);
                                logger.debug(`[提示詞優化] 獲取到的輸入值长度: ${inputValue?.length || 0}`);

                                if (!inputValue || inputValue.trim() === '') {
                                    throw new Error('请輸入要優化的提示詞');
                                }

                                // 生成唯一request_id
                                const request_id = APIService.generateRequestId('exp', null, widget.nodeId);

                                // 通知UI可以准备取消操作了
                                notifyCancelReady(request_id);

                                // 根據开关選擇流式或阻塞式 API
                                let result;
                                let streamContent = '';

                                if (FEATURES.enableStreaming !== false) {
                                    // 顯示流式優化中提示
                                    const btnRect = e.currentTarget.getBoundingClientRect();
                                    UIToolkit.showStatusTip(
                                        e.currentTarget,
                                        'loading',
                                        '提示詞優化中',
                                        { x: btnRect.left + btnRect.width / 2, y: btnRect.top }
                                    );

                                    result = await APIService.llmExpandPromptStream(
                                        inputValue,
                                        request_id,
                                        (chunk) => {
                                            // 流式回调：实时更新輸入框内容
                                            streamContent += chunk;
                                            // 使用 setInputValue 更新輸入框（不觸發事件，避免频繁抖动）
                                            setInputValue(widget, streamContent, { silent: true });
                                        }
                                    );
                                } else {
                                    // 顯示阻塞式優化中提示
                                    const btnRect = e.currentTarget.getBoundingClientRect();
                                    UIToolkit.showStatusTip(
                                        e.currentTarget,
                                        'loading',
                                        '提示詞優化中',
                                        { x: btnRect.left + btnRect.width / 2, y: btnRect.top }
                                    );

                                    result = await APIService.llmExpandPrompt(inputValue, request_id);
                                }

                                // 流式完成后，獲取最终内容
                                const finalContent = streamContent || result?.data?.expanded || '';

                                if (result && result.success && finalContent) {
                                    // 最终更新（觸發事件和高亮）
                                    this.updateInputWithHighlight(widget, finalContent);

                                    // 添加扩写结果到歷史記錄（只記錄最终结果）
                                    HistoryCacheService.addHistory({
                                        workflow_id: widget.nodeInfo?.workflow_id || '',
                                        node_id: widget.nodeId,
                                        input_id: widget.inputId,
                                        content: finalContent,
                                        operation_type: 'expand',
                                        request_id: request_id,
                                        timestamp: Date.now()
                                    });

                                    // 重置撤销狀態
                                    HistoryCacheService.initUndoState(widget.nodeId, widget.inputId, finalContent);

                                    // 更新按钮狀態
                                    UIToolkit.updateUndoRedoButtonState(widget, HistoryCacheService);

                                    return {
                                        success: true,
                                        useCache: false,
                                        tipType: 'success',
                                        tipMessage: '提示詞優化完成'
                                    };
                                } else {
                                    // 不在這裡顯示錯誤提示，直接拋出錯誤讓 handleAsyncButtonOperation 處理
                                    throw new Error(result?.error || '扩写失敗');
                                }
                            } catch (error) {
                                // 不在這裡顯示錯誤提示，直接拋出錯誤讓 handleAsyncButtonOperation 處理
                                throw error;
                            }
                        }
                    );
                },
                visible: !isNoteNode && FEATURES.expand, // Note節點不顯示此按钮
                // 添加右键菜单配置
                contextMenu: async (widget) => {
                    // 獲取服務列表和当前激活狀態
                    let services = [];
                    let currentLLMService = null;
                    let currentLLMModel = null;

                    // 獲取扩写规则
                    let activePromptId = null;
                    let expandPrompts = [];

                    try {
                        // 獲取服務列表
                        const servicesResp = await fetch(APIService.getApiUrl('/services'));
                        if (servicesResp.ok) {
                            const servicesData = await servicesResp.json();
                            if (servicesData.success) {
                                services = servicesData.services || [];
                            }
                        }

                        // 獲取当前激活的LLM服務和模型
                        const llmResp = await fetch(APIService.getApiUrl('/config/llm'));
                        if (llmResp.ok) {
                            const llmConfig = await llmResp.json();
                            currentLLMService = llmConfig.provider || null;
                            currentLLMModel = llmConfig.model || null;
                        }

                        // 獲取扩写规则
                        const response = await fetch(APIService.getApiUrl('/config/system_prompts'));
                        if (response.ok) {
                            const data = await response.json();
                            activePromptId = data.active_prompts?.expand || null;

                            if (data.expand_prompts) {
                                const originalOrder = Object.keys(data.expand_prompts);
                                originalOrder.forEach(key => {
                                    const prompt = data.expand_prompts[key];
                                    const showIn = prompt.showIn || ['frontend', 'node'];

                                    // 仅当配置包含 'frontend' 时才在前端菜单顯示
                                    if (showIn.includes('frontend')) {
                                        expandPrompts.push({
                                            id: key,
                                            name: prompt.name || key,
                                            category: prompt.category || '',
                                            content: prompt.content,
                                            showIn: showIn,
                                            isActive: key === activePromptId
                                        });
                                    }
                                });
                                expandPrompts.sort((a, b) =>
                                    originalOrder.indexOf(a.id) - originalOrder.indexOf(b.id)
                                );
                            }
                        }
                    } catch (error) {
                        logger.error(`獲取提示詞優化配置失敗: ${error.message}`);
                    }

                    // 創建服務菜单项(只顯示有LLM模型的服務,不包括百度)
                    const serviceMenuItems = services
                        .filter(service => service.llm_models && service.llm_models.length > 0)
                        .map(service => {
                            const isCurrentService = currentLLMService === service.id;

                            // 創建模型子菜单
                            const modelChildren = (service.llm_models || []).map(model => {
                                const isCurrentModel = isCurrentService && currentLLMModel === model.name;
                                return {
                                    label: model.display_name || model.name,
                                    icon: `<span class="pi ${isCurrentModel ? 'pi-check-circle active-status' : 'pi-circle-off inactive-status'}"></span>`,
                                    onClick: async (context) => {
                                        try {
                                            const res = await fetch(APIService.getApiUrl('/services/current'), {
                                                method: 'POST',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({ service_type: 'llm', service_id: service.id, model_name: model.name })
                                            });
                                            if (!res.ok) throw new Error(`服務器返回錯誤: ${res.status}`);
                                            const modelLabel = model.display_name || model.name;
                                            UIToolkit.showStatusTip(context.buttonElement, 'success', `已切換到: ${service.name} - ${modelLabel}`);
                                            logger.log(`提示詞優化服務切換 | 服務: ${service.name} | 模型: ${modelLabel}`);
                                        } catch (err) {
                                            logger.error(`切換提示詞優化模型失敗: ${err.message}`);
                                            UIToolkit.showStatusTip(context.buttonElement, 'error', `切換失敗: ${err.message}`);
                                        }
                                    }
                                };
                            });

                            return {
                                label: service.name || service.id,
                                icon: `<span class="pi ${isCurrentService ? 'pi-check-circle active-status' : 'pi-circle-off inactive-status'}"></span>`,
                                onClick: async (context) => {
                                    try {
                                        const res = await fetch(APIService.getApiUrl('/services/current'), {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({ service_type: 'llm', service_id: service.id })
                                        });
                                        if (!res.ok) throw new Error(`服務器返回錯誤: ${res.status}`);
                                        UIToolkit.showStatusTip(context.buttonElement, 'success', `已切換到: ${service.name}`);
                                        logger.log(`提示詞優化服務切換 | 服務: ${service.name}`);
                                    } catch (err) {
                                        logger.error(`切換提示詞優化服務失敗: ${err.message}`);
                                        UIToolkit.showStatusTip(context.buttonElement, 'error', `切換失敗: ${err.message}`);
                                    }
                                },
                                children: modelChildren.length > 0 ? modelChildren : undefined
                            };
                        });

                    // ---創建规则菜单项（支持分类分组）---
                    const ruleMenuItems = [];

                    // 辅助函數：創建单个规则菜单项
                    const createRuleMenuItem = (prompt) => ({
                        label: prompt.name,
                        icon: `<span class="pi ${prompt.isActive ? 'pi-check-circle active-status' : 'pi-circle-off inactive-status'}"></span>`,
                        onClick: async (context) => {
                            logger.log(`右键菜单 | 動作: 切換提示詞優化 | ID: ${prompt.id}`);
                            try {
                                const response = await fetch(APIService.getApiUrl('/config/active_prompt'), {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ type: 'expand', prompt_id: prompt.id })
                                });
                                if (response.ok) {
                                    UIToolkit.showStatusTip(context.buttonElement, 'success', `已切換到: ${prompt.name}`);
                                } else {
                                    throw new Error(`服務器返回錯誤: ${response.status}`);
                                }
                            } catch (error) {
                                logger.error(`切換提示詞優化失敗: ${error.message}`);
                                UIToolkit.showStatusTip(context.buttonElement, 'error', `切換失敗: ${error.message}`);
                            }
                        }
                    });

                    // 按分类分组规则
                    const uncategorizedPrompts = expandPrompts.filter(p => !p.category);
                    const categorizedPrompts = expandPrompts.filter(p => p.category);

                    // 收集所有分类并排序
                    const categories = [...new Set(categorizedPrompts.map(p => p.category))].sort();

                    // 添加无分类的规则（放在顶层）
                    uncategorizedPrompts.forEach(prompt => {
                        ruleMenuItems.push(createRuleMenuItem(prompt));
                    });

                    // 添加分类分组（每个分类作为二级菜单）
                    categories.forEach(category => {
                        const promptsInCategory = categorizedPrompts.filter(p => p.category === category);
                        const hasActivePrompt = promptsInCategory.some(p => p.isActive);

                        ruleMenuItems.push({
                            label: category,
                            icon: `<span class="pi ${hasActivePrompt ? 'pi-folder-open' : 'pi-folder'}"></span>`,
                            submenuAlign: 'center',
                            children: promptsInCategory.map(prompt => createRuleMenuItem(prompt))
                        });
                    });


                    // 添加规则管理選項
                    ruleMenuItems.push({ type: 'separator' });
                    ruleMenuItems.push({
                        label: '规则管理',
                        icon: '<span class="pi pi-pen-to-square"></span>',
                        onClick: () => {
                            rulesConfigManager.showRulesConfigModal();
                        }
                    });

                    return [
                        ...ruleMenuItems,
                        // { type: 'separator' },
                        {
                            label: "選擇服務",
                            icon: '<span class="pi pi-sparkles"></span>',
                            submenuAlign: 'bottom',
                            children: serviceMenuItems
                        }
                    ];
                }
            },
            {
                id: 'translate',
                title: '翻譯',
                icon: 'icon-translate',
                onClick: async (e, widget) => {
                    logger.debug('按钮点击 | 動作: 翻譯');

                    // 如果按钮处于 processing 狀態且被点击，直接返回，
                    // 讓UIToolkit中的取消逻辑接管
                    if (e.currentTarget.classList.contains('button-processing')) {
                        return;
                    }

                    await UIToolkit.handleAsyncButtonOperation(
                        widget,
                        'translate',
                        e.currentTarget,
                        async (notifyCancelReady) => {
                            try {
                                // --- Markdown LiteGraph 模式處理 ---
                                // 增强判斷逻辑：除了檢查nodeType，也檢查DOM类名
                                const hasMarkdownClass = widget.inputEl?.classList?.contains('comfy-markdown');
                                const isMarkdownLiteGraph = (widget.nodeInfo?.nodeType === 'MarkdownNote' || hasMarkdownClass) &&
                                    widget.nodeInfo?.isVueMode !== true;

                                logger.debug(`[翻譯調試] Markdown检测: ${isMarkdownLiteGraph} (Type: ${widget.nodeInfo?.nodeType}, HasClass: ${hasMarkdownClass})`);

                                // 獲取輸入值 - 根據模式决定是否獲取HTML
                                const inputValue = getInputValue(widget, { html: isMarkdownLiteGraph });

                                if (!inputValue || inputValue.trim() === '') {
                                    throw new Error('请輸入要翻譯的内容');
                                }

                                let contentToTranslate = inputValue;
                                let mdData = null;

                                if (isMarkdownLiteGraph) {
                                    mdData = MarkdownNoteTranslate.protectAndExtract(inputValue);
                                    if (mdData.texts && mdData.texts.length > 0) {
                                        contentToTranslate = mdData.texts.join('\n');
                                    } else {
                                        // 如果提取后没有文本（只有標籤/代码），则认为空或者无需翻譯
                                        if (!contentToTranslate || contentToTranslate.trim() === '') {
                                            // 保持原样或拋出錯誤，這裡選擇拋出提示
                                            throw new Error('没有检测到可翻譯的内容');
                                        }
                                        // 如果原内容有东西但提取为空，可能全是代码块，保留原内容作为待翻譯（实际上API可能跳過）
                                        // 或者這裡 contentToTranslate 為 inputValue ?
                                        // 不，protectAndExtract 没提取到，说明不该翻譯。
                                        // 但为了流程继续，如果不抛错，我们假设 contentToTranslate 为空導致后续报错
                                    }
                                }

                                if (!contentToTranslate || contentToTranslate.trim() === '') {
                                    throw new Error('请輸入要翻譯的内容');
                                }

                                // 顯示翻譯中提示
                                const btnRect = e.currentTarget.getBoundingClientRect();
                                UIToolkit.showStatusTip(
                                    e.currentTarget,
                                    'loading',
                                    '翻譯中',
                                    { x: btnRect.left + btnRect.width / 2, y: btnRect.top }
                                );

                                // 1. 查询緩存
                                let cacheResult = null;
                                if (FEATURES.useTranslateCache) {
                                    cacheResult = TranslateCacheService.queryTranslateCache(contentToTranslate);
                                }

                                if (cacheResult) {
                                    let rawResultText = '';
                                    let tipMessage = '';
                                    let useCache = true;

                                    // 根據緩存匹配類型處理
                                    if (cacheResult.type === 'source') {
                                        // 命中原文，返回译文
                                        rawResultText = cacheResult.translatedText;
                                        tipMessage = '译文';
                                    } else if (cacheResult.type === 'translated') {
                                        // 命中译文，返回原文
                                        rawResultText = cacheResult.sourceText;
                                        tipMessage = '原文';
                                    }

                                    // 處理 Markdown 格式还原
                                    let finalResultText = rawResultText;
                                    if (isMarkdownLiteGraph && mdData) {
                                        const translatedSegments = rawResultText.split('\n');
                                        finalResultText = MarkdownNoteTranslate.restoreWithTranslations(mdData.placeholderHTML, mdData.placeholders, translatedSegments);
                                    }

                                    // 更新輸入框内容并添加高亮效果
                                    this.updateInputWithHighlight(widget, finalResultText, { html: isMarkdownLiteGraph });

                                    // 添加翻譯结果到歷史記錄
                                    HistoryCacheService.addHistory({
                                        workflow_id: widget.nodeInfo?.workflow_id || '',
                                        node_id: widget.nodeId,
                                        input_id: widget.inputId,
                                        content: finalResultText,
                                        operation_type: 'translate',
                                        timestamp: Date.now()
                                    });

                                    // 重置撤销狀態
                                    HistoryCacheService.initUndoState(widget.nodeId, widget.inputId, finalResultText);

                                    // 更新按钮狀態
                                    UIToolkit.updateUndoRedoButtonState(widget, HistoryCacheService);

                                    return {
                                        success: true,
                                        useCache: useCache,
                                        tipType: 'info',
                                        tipMessage: tipMessage,
                                        buttonElement: e.currentTarget // 传递按钮元素
                                    };
                                }

                                // 緩存未命中，使用API翻譯

                                // 生成唯一request_id
                                const request_id = APIService.generateRequestId('trans', null, widget.nodeId);

                                // 通知UI可以准备取消操作了
                                notifyCancelReady(request_id);

                                // 检测语言 (使用提取后的文本)
                                const langResult = PromptFormatter.detectLanguage(contentToTranslate);

                                // 獲取翻譯服務配置
                                let result;
                                let streamContent = '';  // 用于流式收集内容
                                try {
                                    // 獲取翻譯配置
                                    const configResp = await fetch(APIService.getApiUrl('/config/translate'));
                                    let isGoogle = false;
                                    let isBaidu = false;

                                    if (configResp.ok) {
                                        const config = await configResp.json();
                                        if (config.provider === 'google') {
                                            isGoogle = true;
                                        } else if (config.provider === 'baidu') {
                                            isBaidu = true;
                                        }
                                    }

                                    if (isGoogle) {
                                        result = await APIService.googleTranslate(
                                            contentToTranslate,
                                            langResult.from,
                                            langResult.to,
                                            request_id
                                        );
                                    } else if (isBaidu) {
                                        result = await APIService.baiduTranslate(
                                            contentToTranslate,
                                            langResult.from,
                                            langResult.to,
                                            request_id
                                        );
                                    } else if (FEATURES.enableStreaming !== false) {
                                        // ---流式輸出：LLM翻譯使用流式 API---
                                        result = await APIService.llmTranslateStream(
                                            contentToTranslate,
                                            langResult.from,
                                            langResult.to,
                                            request_id,
                                            (chunk) => {
                                                // 流式回调：实时更新輸入框内容
                                                streamContent += chunk;
                                                // 使用 silent 模式更新，避免频繁觸發事件
                                                setInputValue(widget, streamContent, { silent: true, html: isMarkdownLiteGraph });
                                            }
                                        );
                                    } else {
                                        // ---阻塞輸出：LLM翻譯使用普通 API---
                                        result = await APIService.llmTranslate(
                                            contentToTranslate,
                                            langResult.from,
                                            langResult.to,
                                            request_id
                                        );
                                    }

                                    if (!result) {
                                        throw new Error('翻譯服務返回空结果');
                                    }
                                } catch (error) {
                                    logger.error(`翻譯失敗 | 錯誤:${error.message}`);
                                    throw new Error(`翻譯失敗: ${error.message}`);
                                }

                                if (result.success) {
                                    // 格式化翻譯结果（优先使用流式收集的内容，否則使用API返回的内容）
                                    const rawTranslated = streamContent || result.data?.translated || '';
                                    const formattedText = PromptFormatter.formatTranslatedText(rawTranslated);

                                    // 處理 Markdown 格式还原
                                    let finalResultText = formattedText;
                                    if (isMarkdownLiteGraph && mdData) {
                                        const translatedSegments = formattedText.split('\n');
                                        finalResultText = MarkdownNoteTranslate.restoreWithTranslations(mdData.placeholderHTML, mdData.placeholders, translatedSegments);
                                    }

                                    // 添加翻譯结果到歷史記錄
                                    HistoryCacheService.addHistory({
                                        workflow_id: widget.nodeInfo?.workflow_id || '',
                                        node_id: widget.nodeId,
                                        input_id: widget.inputId,
                                        content: finalResultText,
                                        operation_type: 'translate',
                                        request_id: request_id,
                                        timestamp: Date.now()
                                    });

                                    // 更新輸入框内容并添加高亮效果
                                    this.updateInputWithHighlight(widget, finalResultText, { html: isMarkdownLiteGraph });

                                    // 重置撤销狀態
                                    HistoryCacheService.initUndoState(widget.nodeId, widget.inputId, finalResultText);

                                    // 更新按钮狀態
                                    UIToolkit.updateUndoRedoButtonState(widget, HistoryCacheService);

                                    // 只有開啟緩存时才写入緩存 (使用提取文本和翻譯后的片段文本，以便下次能复用)
                                    if (FEATURES.useTranslateCache) {
                                        // 檢查是否是混合语言
                                        const isMixedLang = PromptFormatter.isMixedChineseEnglish(contentToTranslate);

                                        // 只有当不是混合语言，或者用户允许緩存混合语言时才写入緩存
                                        if (!isMixedLang || FEATURES.cacheMixedLangTranslation) {
                                            TranslateCacheService.addTranslateCache(contentToTranslate, formattedText);
                                        } else {
                                            logger.debug(`翻譯緩存 | 跳過:混合语言内容`);
                                        }
                                    }

                                    return {
                                        success: true,
                                        useCache: false,
                                        tipType: 'success',
                                        tipMessage: '翻譯完成'
                                    };
                                } else {
                                    // 不在這裡顯示錯誤提示，直接拋出錯誤讓 handleAsyncButtonOperation 處理
                                    throw new Error(result.error);
                                }
                            } catch (error) {
                                // 不在這裡顯示錯誤提示，直接拋出錯誤讓 handleAsyncButtonOperation 處理
                                throw error;
                            }
                        }
                    );
                },
                visible: FEATURES.translate, // Note節點只顯示此按钮
                // 添加右键菜单配置
                contextMenu: async (widget) => {
                    const useTranslateCache = app.ui.settings.getSettingValue("PromptAssistant.Features.UseTranslateCache");

                    // 獲取所有服務列表和当前激活狀態
                    let services = [];
                    let currentTranslateService = null;
                    let currentTranslateModel = null;

                    try {
                        // 獲取服務列表
                        const servicesResp = await fetch(APIService.getApiUrl('/services'));
                        if (servicesResp.ok) {
                            const servicesData = await servicesResp.json();
                            if (servicesData.success) {
                                services = servicesData.services || [];
                            }
                        }

                        // 獲取当前激活的翻譯服務和模型
                        const translateResp = await fetch(APIService.getApiUrl('/config/translate'));
                        if (translateResp.ok) {
                            const translateConfig = await translateResp.json();
                            currentTranslateService = translateConfig.provider || null;
                            currentTranslateModel = translateConfig.model || null;
                        }
                    } catch (e) {
                        logger.error(`獲取服務列表失敗: ${e.message}`);
                    }

                    // 創建服務菜单项
                    const serviceMenuItems = [];

                    // Google 翻譯项（首位）
                    const isGoogleCurrent = currentTranslateService === 'google';
                    serviceMenuItems.push({
                        label: 'Google 翻譯',
                        icon: `<span class="pi ${isGoogleCurrent ? 'pi-check-circle active-status' : 'pi-circle-off inactive-status'}"></span>`,
                        onClick: async (context) => {
                            try {
                                const res = await fetch(APIService.getApiUrl('/services/current'), {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ service_type: 'translate', service_id: 'google' })
                                });
                                if (!res.ok) throw new Error(`服務器返回錯誤: ${res.status}`);
                                UIToolkit.showStatusTip(context.buttonElement, 'success', `已切換到: Google 翻譯`);
                                logger.log(`翻譯服務切換 | 服務: Google 翻譯`);
                                window.dispatchEvent(new CustomEvent('pa-service-changed', {
                                    detail: { service_type: 'translate', service_id: 'google' }
                                }));
                            } catch (err) {
                                logger.error(`切換翻譯服務失敗: ${err.message}`);
                                UIToolkit.showStatusTip(context.buttonElement, 'error', `切換失敗: ${err.message}`);
                            }
                        }
                    });

                    // 百度翻譯项
                    const isBaiduCurrent = currentTranslateService === 'baidu';
                    serviceMenuItems.push({
                        label: '百度翻譯',
                        icon: `<span class="pi ${isBaiduCurrent ? 'pi-check-circle active-status' : 'pi-circle-off inactive-status'}"></span>`,
                        onClick: async (context) => {
                            try {
                                const res = await fetch(APIService.getApiUrl('/services/current'), {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ service_type: 'translate', service_id: 'baidu' })
                                });
                                if (!res.ok) throw new Error(`服務器返回錯誤: ${res.status}`);
                                UIToolkit.showStatusTip(context.buttonElement, 'success', `已切換到: 百度翻譯`);
                                logger.log(`翻譯服務切換 | 服務: 百度翻譯`);
                                window.dispatchEvent(new CustomEvent('pa-service-changed', {
                                    detail: { service_type: 'translate', service_id: 'baidu' }
                                }));
                            } catch (err) {
                                logger.error(`切換翻譯服務失敗: ${err.message}`);
                                UIToolkit.showStatusTip(context.buttonElement, 'error', `切換失敗: ${err.message}`);
                            }
                        }
                    });

                    // 動態添加其他LLM服務
                    const otherServiceMenuItems = services
                        .filter(service => service.llm_models && service.llm_models.length > 0)
                        .map(service => {
                            const isCurrentService = currentTranslateService === service.id;

                            // 創建模型子菜单
                            const modelChildren = (service.llm_models || []).map(model => {
                                const isCurrentModel = isCurrentService && currentTranslateModel === model.name;
                                return {
                                    label: model.display_name || model.name,
                                    icon: `<span class="pi ${isCurrentModel ? 'pi-check-circle active-status' : 'pi-circle-off inactive-status'}"></span>`,
                                    onClick: async (context) => {
                                        try {
                                            const res = await fetch(APIService.getApiUrl('/services/current'), {
                                                method: 'POST',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({ service_type: 'translate', service_id: service.id, model_name: model.name })
                                            });
                                            if (!res.ok) throw new Error(`服務器返回錯誤: ${res.status}`);
                                            const modelLabel = model.display_name || model.name;
                                            UIToolkit.showStatusTip(context.buttonElement, 'success', `已切換到: ${service.name} - ${modelLabel}`);
                                            logger.log(`翻譯服務切換 | 服務: ${service.name} | 模型: ${modelLabel}`);

                                            // 派发全局事件通知其他组件同步
                                            window.dispatchEvent(new CustomEvent('pa-service-changed', {
                                                detail: { service_type: 'translate', service_id: service.id, model_name: model.name }
                                            }));
                                        } catch (err) {
                                            logger.error(`切換翻譯模型失敗: ${err.message}`);
                                            UIToolkit.showStatusTip(context.buttonElement, 'error', `切換失敗: ${err.message}`);
                                        }
                                    }
                                };
                            });

                            return {
                                label: service.name || service.id,
                                icon: `<span class="pi ${isCurrentService ? 'pi-check-circle active-status' : 'pi-circle-off inactive-status'}"></span>`,
                                onClick: async (context) => {
                                    try {
                                        const res = await fetch(APIService.getApiUrl('/services/current'), {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({ service_type: 'translate', service_id: service.id })
                                        });
                                        if (!res.ok) throw new Error(`服務器返回錯誤: ${res.status}`);
                                        UIToolkit.showStatusTip(context.buttonElement, 'success', `已切換到: ${service.name}`);
                                        logger.log(`翻譯服務切換 | 服務: ${service.name}`);

                                        // 派发全局事件通知其他组件同步
                                        window.dispatchEvent(new CustomEvent('pa-service-changed', {
                                            detail: { service_type: 'translate', service_id: service.id }
                                        }));
                                    } catch (err) {
                                        logger.error(`切換翻譯服務失敗: ${err.message}`);
                                        UIToolkit.showStatusTip(context.buttonElement, 'error', `切換失敗: ${err.message}`);
                                    }
                                },
                                children: modelChildren.length > 0 ? modelChildren : undefined
                            };
                        });

                    // 将其他服務添加到serviceMenuItems
                    serviceMenuItems.push(...otherServiceMenuItems);

                    return [
                        {
                            label: "選擇服務",
                            icon: '<span class="pi pi-sparkles"></span>',
                            children: serviceMenuItems
                        },
                        { type: 'separator' },
                        {
                            label: "翻譯緩存",
                            icon: `<span class="pi ${useTranslateCache ? 'pi-check-circle active-status' : 'pi-circle-off inactive-status'}"></span>`,
                            onClick: (context) => {
                                const newStatus = !useTranslateCache;
                                app.ui.settings.setSettingValue("PromptAssistant.Features.UseTranslateCache", newStatus);
                                const statusText = newStatus ? '已開啟' : '已关闭';
                                logger.log(`右键菜单 | 動作: 切換翻譯緩存 | 狀態: ${statusText}`);
                                UIToolkit.showStatusTip(context.buttonElement, 'success', `翻譯緩存${statusText}`);
                            }
                        }
                    ];
                }
            },
        ];

        // 記錄添加的按钮
        let historyButtons = [];
        let otherButtons = [];
        let divider = null;

        // ---Add buttons to AssistantContainer---
        for (const config of buttonConfigs) {
            if (config.type === 'divider') {
                // Check visibility for divider
                if (config.visible === false) continue;

                const divider = document.createElement('div');
                divider.className = 'prompt-assistant-divider';
                // Add divider to container
                widget.container.addButton(divider, config.id || `divider_${Date.now()}`);
                // Save reference if needed
                if (config.id) widget.buttons[config.id] = divider;
                continue;
            }

            // Check visibility
            if (config.visible === false) continue;

            // Create button using existing helper
            // Note: addButtonWithIcon returns the button element and saves it to widget.buttons
            const button = this.addButtonWithIcon(widget, config);
            if (!button) continue;

            // Set initial state
            if (config.initialState) {
                Object.entries(config.initialState).forEach(([stateType, value]) => {
                    UIToolkit.setButtonState(widget, config.id, stateType, value);
                });
            }

            // Add to container
            widget.container.addButton(button, config.id);
        }


    }

    /**
     * 添加带图标的按钮
     */
    addButtonWithIcon(widget, config) {
        if (!widget?.element || !widget?.innerContent) return null;

        const { id, title, icon, onClick, contextMenu } = config;

        // 創建按钮
        const button = document.createElement('button');
        button.className = 'prompt-assistant-button';
        button.title = title || '';
        button.dataset.id = id || `btn_${Date.now()}`;

        // 添加图标 - 使用UIToolkit的SVG图标方法
        if (icon) {
            UIToolkit.addIconToButton(button, icon, title || '');
        }

        // 添加事件
        if (typeof onClick === 'function') {
            button.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();

                // 如果按钮被禁用，不執行操作
                if (button.classList.contains('button-disabled')) {
                    return;
                }

                // 執行点击回调
                onClick(e, widget);
            });
        }

        // 添加右键菜单（如果有）
        if (contextMenu && typeof contextMenu === 'function') {
            this._setupButtonContextMenu(button, contextMenu, widget);
        }

        // 保存引用
        if (id) {
            widget.buttons[id] = button;
        }

        return button;
    }

    /**
     * 检测輸入框是否有滚动条
     * @param {HTMLElement} inputEl - 輸入框元素
     * @returns {boolean} 是否有垂直滚动条
     */
    _detectScrollbar(inputEl) {
        if (!inputEl || inputEl.tagName !== 'TEXTAREA') {
            return false;
        }

        try {
            // 檢查垂直滚动条：scrollHeight > clientHeight
            const hasVerticalScrollbar = inputEl.scrollHeight > inputEl.clientHeight;
            // 日誌簡化：详细滚动条检测日誌移至 _adjustPositionForScrollbar，并仅在狀態变更时輸出
            return hasVerticalScrollbar;
        } catch (error) {
            logger.error(`[滚动条检测] 检测失敗 | 錯誤: ${error.message}`);
            return false;
        }
    }

    /**
     * 根據滚动条狀態调整小助手位置
     * @param {Object} widget - 小助手實例
     * @param {HTMLElement} inputEl - 輸入框元素
     * @param {Boolean} forceUpdate - 是否強制更新（用于初始化）
     */
    _adjustPositionForScrollbar(widget, inputEl, forceUpdate = false) {
        if (!widget?.element || !inputEl) return;

        const hasScrollbar = this._detectScrollbar(inputEl);
        const containerDiv = widget.element;

        // 仅在滚动条狀態发生變化时更新位置（除非強制更新）
        const prevState = containerDiv.dataset.hasScrollbar === 'true';
        if (!forceUpdate && prevState === hasScrollbar) {
            return; // 狀態未变，不做任何操作
        }

        // 【關鍵修復】在位置/布局调整前，显式移除輸入框的高亮狀態
        // 防止浏览器在重排（Relayout）過程中产生动画残留
        UIToolkit.removeHighlight(inputEl);

        containerDiv.dataset.hasScrollbar = String(hasScrollbar);

        // 有滚动条时向左偏移，避开滚动条
        const rightOffset = hasScrollbar ? '16px' : '4px';
        containerDiv.style.right = rightOffset;
    }

    /**
     * 設置UI位置
     * 支持 Vue node2.0 和 litegraph.js 两种渲染模式
     * @param {Function} onComplete - 定位完成回调，接收boolean参数，true表示成功，false表示失敗
     */
    _setupUIPosition(widget, inputEl, containerDiv, canvasContainerRect, onComplete) {


        // 清理函數列表
        widget._eventCleanupFunctions = widget._eventCleanupFunctions || [];

        // 【關鍵修復】直接使用 widget.node 而不是通过 app.graph.getNodeById 查找
        // 因为进入子圖后 app.graph 已经切換到子圖的 graph，无法找到主画布節點
        const node = widget.node;
        if (!node) {
            logger.debug(`[定位] widget.node 不存在 | ID: ${widget.nodeId}`);
            if (onComplete) onComplete(false);
            return;
        }


        // 創建widget对象用于容器查找
        const widgetObj = {
            inputEl: inputEl,
            element: inputEl,
            name: widget.inputId,
            id: widget.inputId
        };

        // 使用 NodeMountService 进行带重试的容器查找
        // Vue mode下需要更多重试次数和更长间隔
        const isVueMode = typeof LiteGraph !== 'undefined' && LiteGraph.vueNodesMode === true;
        nodeMountService.findMountContainerWithRetry(node, widgetObj, {
            maxRetries: isVueMode ? 5 : 3,
            retryInterval: isVueMode ? 800 : 500
        }).then(containerInfo => {
            if (!containerInfo) {
                // logger.debug(`[定位] 容器查找失敗 | 節點ID: ${widget.nodeId}`);
                if (onComplete) onComplete(false);
                return;
            }

            // 根據渲染模式应用不同的定位策略
            if (containerInfo.mode === RENDER_MODE.VUE_NODES) {
                this._applyVueNodesPositioning(widget, containerDiv, containerInfo);
            } else {
                this._applyLitegraphPositioning(widget, containerDiv, containerInfo);
            }

            // 保存渲染模式到widget，用于后续调整
            widget._renderMode = containerInfo.mode;

            // 觸發回流確保样式生效
            void containerDiv.offsetWidth;

            // 最终成功日誌保持精简
            logger.debug(`[定位] 成功 | ID: ${widget.nodeId} | 模式: ${containerInfo.mode} | 锚点: ${widget.container?.anchorPosition}`);
            if (onComplete) onComplete(true);

        }).catch(error => {
            logger.error(`[定位] 異常 | 節點ID: ${widget.nodeId} | 錯誤: ${error.message}`);
            if (onComplete) onComplete(false);
        });
    }

    /**
     * Vue node2.0 模式下的定位逻辑
     */
    _applyVueNodesPositioning(widget, containerDiv, containerInfo) {
        let { container, textarea, nodeContainer, isNoteNode } = containerInfo;

        // 【特殊處理】Note節點在Vue mode下可能需要二次查找textarea
        if (!textarea && isNoteNode && nodeContainer) {
            const textareas = nodeContainer.querySelectorAll('textarea');
            if (textareas.length > 0) {
                textarea = textareas[0];
                container = textarea.parentElement;
            } else {
                logger.warn(`[Vue定位] Note節點仍未找到textarea | 節點ID: ${widget.nodeId}`);
            }
        }

        // 定期更新輸入框引用及事件绑定
        if (textarea && textarea !== widget.inputEl) {
            widget.inputEl = textarea;
            widget.text_element = textarea;
            if (window.PromptAssistantInputWidgetMap && window.PromptAssistantInputWidgetMap[widget.widgetKey]) {
                window.PromptAssistantInputWidgetMap[widget.widgetKey].inputEl = textarea;
            }

            if (!textarea._promptAssistantBound) {
                textarea._promptAssistantBound = true;
                widget._eventCleanupFunctions = widget._eventCleanupFunctions || [];

                widget._eventCleanupFunctions.push(EventManager.addDOMListener(textarea, 'blur', async () => {
                    HistoryCacheService.addHistory({
                        workflow_id: widget.nodeInfo?.workflow_id || '',
                        node_id: widget.nodeId,
                        input_id: widget.inputId,
                        content: textarea.value,
                        operation_type: 'input',
                        timestamp: Date.now()
                    });
                    HistoryCacheService.initUndoState(widget.nodeId, widget.inputId, textarea.value);
                    UIToolkit.updateUndoRedoButtonState(widget, HistoryCacheService);
                }));

                widget._eventCleanupFunctions.push(EventManager.addDOMListener(textarea, 'input', () => {
                    UIToolkit.updateUndoRedoButtonState(widget, HistoryCacheService);
                    this._adjustPositionForScrollbar(widget, textarea);
                }));

                if (window.ResizeObserver) {
                    const resizeObserver = new ResizeObserver(() => {
                        setTimeout(() => this._adjustPositionForScrollbar(widget, textarea), 10);
                    });
                    resizeObserver.observe(textarea);
                    widget._eventCleanupFunctions.push(() => resizeObserver.disconnect());
                }

                if (!widget._undoStateInitialized) {
                    HistoryCacheService.initUndoState(widget.nodeId, widget.inputId, textarea.value);
                    widget._undoStateInitialized = true;
                }
            }
            UIToolkit.updateUndoRedoButtonState(widget, HistoryCacheService);
        }

        // 防重复挂载檢查
        if (textarea && textarea._promptAssistantMounted && textarea._promptAssistantWidgetKey !== widget.widgetKey) {
            this._cleanupRedundantWidget(widget);
            return;
        }

        const existingAssistant = container.querySelector('.assistant-container-common');
        if (existingAssistant && !container.contains(containerDiv)) {
            this._cleanupRedundantWidget(widget);
            return;
        }

        if (textarea) {
            textarea._promptAssistantMounted = true;
            textarea._promptAssistantWidgetKey = widget.widgetKey;
        }

        containerDiv.style.position = 'absolute';
        containerDiv.style.zIndex = '10';
        if (window.getComputedStyle(container).position === 'static') {
            container.style.position = 'relative';
        }

        containerDiv.classList.add('vue-node-mode');
        if (!container.contains(containerDiv)) {
            container.appendChild(containerDiv);
        }

        if (textarea) {
            requestAnimationFrame(() => this._adjustPositionForScrollbar(widget, textarea, true));
            setTimeout(() => this._adjustPositionForScrollbar(widget, textarea, true), 150);
        }
    }

    /**
     * 清理冗余的 Widget 實例（当由于并发原因導致重复創建时）
     * @private
     */
    _cleanupRedundantWidget(widget) {
        if (widget.widgetKey && PromptAssistant.instances.has(widget.widgetKey)) {
            PromptAssistant.instances.delete(widget.widgetKey);
        }
        if (widget.container) {
            widget.container.destroy();
        }
    }

    /**
     * litegraph.js 模式下的定位逻辑
     * 【修復】添加后备事件绑定逻辑，与 Vue mode 保持一致
     */
    _applyLitegraphPositioning(widget, containerDiv, containerInfo) {
        const { container: domWidgetContainer, textarea } = containerInfo;

        // 【關鍵修復】確保 inputEl 引用正确
        if (textarea && textarea !== widget.inputEl) {
            widget.inputEl = textarea;
            widget.text_element = textarea;

            // 更新全局輸入框映射
            if (window.PromptAssistantInputWidgetMap && window.PromptAssistantInputWidgetMap[widget.widgetKey]) {
                window.PromptAssistantInputWidgetMap[widget.widgetKey].inputEl = textarea;
            }

            // logger.debug(`[Litegraph定位] 更新inputEl引用 | 節點ID: ${widget.nodeId}`);
        }

        // 【關鍵修復】確保事件绑定（与 Vue mode 一致的后备逻辑）
        const inputEl = widget.inputEl || textarea;

        // 使用 widget 級別的 flag 判斷
        const isBound = widget._inputEventsBound;

        // 精简定位开始日誌
        // logger.debug(`[_setupUIPosition] 开始定位 | 節點ID: ${widget.nodeId}`);
        // logger.debug(`[Litegraph定位] 事件绑定檢查 | 節點ID: ${widget.nodeId} | inputEl存在: ${!!inputEl} | isBound: ${isBound}`);

        // 如果没有绑定，则绑定事件
        if (inputEl && !isBound) {
            // 如果是遗留標記，記錄日誌
            if (inputEl._promptAssistantBound) {
                logger.debug(`[Litegraph定位] 检测到遗留標記，重新绑定 | 節點ID: ${widget.nodeId}`);
            }

            inputEl._promptAssistantBound = true;
            widget._inputEventsBound = true; // 設置標記
            widget._eventCleanupFunctions = widget._eventCleanupFunctions || [];
            // logger.debug(`[Litegraph定位] 开始绑定事件 | 節點ID: ${widget.nodeId}`);

            // 绑定blur事件用于歷史記錄
            const removeBlurListener = EventManager.addDOMListener(inputEl, 'blur', async () => {
                // logger.debug(`[Litegraph] 歷史写入准备 | 原因：失焦事件觸發 node_id=${widget.nodeId} input_id=${widget.inputId}`);
                HistoryCacheService.addHistory({
                    workflow_id: widget.nodeInfo?.workflow_id || '',
                    node_id: widget.nodeId,
                    input_id: widget.inputId,
                    content: inputEl.value,
                    operation_type: 'input',
                    timestamp: Date.now()
                });
                // 重置撤销狀態
                HistoryCacheService.initUndoState(widget.nodeId, widget.inputId, inputEl.value);
                // 更新按钮狀態
                UIToolkit.updateUndoRedoButtonState(widget, HistoryCacheService);
            });
            widget._eventCleanupFunctions.push(removeBlurListener);

            // 绑定input事件用于实时更新按钮狀態
            const removeInputListener = EventManager.addDOMListener(inputEl, 'input', () => {
                UIToolkit.updateUndoRedoButtonState(widget, HistoryCacheService);
                this._adjustPositionForScrollbar(widget, inputEl);
            });
            widget._eventCleanupFunctions.push(removeInputListener);

            if (!widget._undoStateInitialized) {
                HistoryCacheService.initUndoState(widget.nodeId, widget.inputId, inputEl.value);
                widget._undoStateInitialized = true;
            }

            UIToolkit.updateUndoRedoButtonState(widget, HistoryCacheService);
            // logger.debug(`[Litegraph定位] 事件绑定完成 | 節點ID: ${widget.nodeId}`);
        } else if (inputEl && inputEl._promptAssistantBound) {
            // 已绑定，只更新按钮狀態
            UIToolkit.updateUndoRedoButtonState(widget, HistoryCacheService);
        }

        // 【防重复挂载檢查】檢查 inputEl 是否已被小助手绑定
        if (inputEl && inputEl._promptAssistantMounted) {
            logger.debug(`[Litegraph定位] 跳過挂载 | 原因: inputEl 已被其他小助手绑定 | 節點ID: ${widget.nodeId}`);
            // 清理当前 widget 實例（因为无法正确挂载）
            if (widget.widgetKey && PromptAssistant.instances.has(widget.widgetKey)) {
                PromptAssistant.instances.delete(widget.widgetKey);
            }
            if (widget.container) {
                widget.container.destroy();
            }
            return;
        }

        // 【防重复挂载檢查】檢查容器内是否已存在小助手元素
        const existingAssistant = domWidgetContainer.querySelector('.assistant-container-common');
        if (existingAssistant) {
            logger.debug(`[Litegraph定位] 跳過挂载 | 原因: 容器内已存在小助手 | 節點ID: ${widget.nodeId}`);
            // 清理当前 widget 實例（因为无法正确挂载）
            if (widget.widgetKey && PromptAssistant.instances.has(widget.widgetKey)) {
                PromptAssistant.instances.delete(widget.widgetKey);
            }
            if (widget.container) {
                widget.container.destroy();
            }
            return;
        }

        // 在 inputEl 上添加挂载標記
        if (inputEl) {
            inputEl._promptAssistantMounted = true;
            inputEl._promptAssistantWidgetKey = widget.widgetKey;
        }

        // 確保 dom-widget 容器有相对定位
        const containerPosition = window.getComputedStyle(domWidgetContainer).position;
        if (containerPosition === 'static') {
            domWidgetContainer.style.position = 'relative';
        }

        // 標準模式使用绝对定位
        containerDiv.style.position = 'absolute';



        // 直接添加到dom-widget容器
        domWidgetContainer.appendChild(containerDiv);

        // 觸發回流，確保样式更新
        void containerDiv.offsetWidth;

        // 挂载完成后检测并调整滚动条位置
        if (inputEl) {
            requestAnimationFrame(() => this._adjustPositionForScrollbar(widget, inputEl, true));
        }
    }

    /**
     * 清理单个實例的资源
     */
    _cleanupInstance(instance, instanceKey, skipRemove = false) {
        try {
            // 檢查實例是否有效
            if (!instance) {
                logger.debug(`實例清理 | 结果:跳過 | 實例:${instanceKey || 'unknown'} | 原因:實例不存在`);
                return;
            }

            // 標記實例为已销毁
            instance.isDestroyed = true;

            // 1. 重置所有按钮狀態
            if (instance.buttons) {
                Object.keys(instance.buttons).forEach(buttonId => {
                    try {
                        const button = instance.buttons[buttonId];
                        if (button) {
                            // 移除所有狀態类
                            button.classList.remove('button-active', 'button-processing', 'button-disabled');
                            // 移除所有事件監聽器
                            button.replaceWith(button.cloneNode(true));
                        }
                    } catch (err) {
                        logger.debug(`按钮清理 | 按钮:${buttonId} | 錯誤:${err.message}`);
                    }
                });
                // 清空按钮引用
                instance.buttons = {};
            }

            // 2. 清理事件監聽器
            if (instance.cleanupListeners && typeof instance.cleanupListeners === 'function') {
                try {
                    instance.cleanupListeners();
                } catch (err) {
                    logger.debug(`監聽器清理 | 錯誤:${err.message}`);
                }
            }

            // 3. 清理所有保存的事件清理函數
            if (instance._eventCleanupFunctions && Array.isArray(instance._eventCleanupFunctions)) {
                instance._eventCleanupFunctions.forEach(cleanup => {
                    if (typeof cleanup === 'function') {
                        try {
                            cleanup();
                        } catch (err) {
                            logger.debug(`事件清理 | 錯誤:${err.message}`);
                        }
                    }
                });
                instance._eventCleanupFunctions = [];
            }

            // 3.5【關鍵修復】重置 inputEl 上的事件绑定標記
            // 確保模式切換后可以重新绑定事件
            if (instance.inputEl && instance.inputEl._promptAssistantBound) {
                instance.inputEl._promptAssistantBound = false;
            }
            if (instance.text_element && instance.text_element._promptAssistantBound) {
                instance.text_element._promptAssistantBound = false;
            }

            // 3.6【防重复挂载修復】重置 textarea 上的挂载標記
            // 確保清理后可以重新挂载小助手
            if (instance.inputEl && instance.inputEl._promptAssistantMounted) {
                instance.inputEl._promptAssistantMounted = false;
                delete instance.inputEl._promptAssistantWidgetKey;
            }
            if (instance.text_element && instance.text_element._promptAssistantMounted && instance.text_element !== instance.inputEl) {
                instance.text_element._promptAssistantMounted = false;
                delete instance.text_element._promptAssistantWidgetKey;
            }

            // 同時重置 widget 級別的標記
            instance._undoStateInitialized = false;
            instance._inputEventsBound = false; // 重置輸入事件绑定標記


            // 4. 從DOM中移除元素
            if (instance.element) {
                try {
                    // 確保在移除元素前清理所有子元素的事件
                    const allButtons = instance.element.querySelectorAll('button');
                    allButtons.forEach(button => {
                        button.replaceWith(button.cloneNode(true));
                    });

                    // 清理指示器元素
                    if (instance.indicator && instance.indicator.parentNode) {
                        instance.indicator.innerHTML = '';
                    }

                    if (instance.element.parentNode) {
                        instance.element.parentNode.removeChild(instance.element);
                    }
                } catch (err) {
                    logger.debug(`DOM元素清理 | 錯誤:${err.message}`);
                }
            }

            // 5. 清理輸入框映射
            if (window.PromptAssistantInputWidgetMap && instanceKey) {
                try {
                    delete window.PromptAssistantInputWidgetMap[instanceKey];
                } catch (err) {
                    logger.debug(`輸入框映射清理 | 錯誤:${err.message}`);
                }
            }

            // 6. 清理弹窗狀態
            if (window.FEATURES && window.FEATURES.updateButtonsVisibility) {
                try {
                    window.FEATURES.updateButtonsVisibility();
                } catch (err) {
                    logger.debug(`按钮可见性更新 | 錯誤:${err.message}`);
                }
            }

            // 7. 從實例集合中移除（除非明确指定跳過）
            if (!skipRemove && instanceKey) {
                try {
                    PromptAssistant.instances.delete(instanceKey);
                } catch (err) {
                    logger.debug(`實例集合清理 | 錯誤:${err.message}`);
                }
            }

            // 8. 清理實例属性
            try {
                Object.keys(instance).forEach(key => {
                    try {
                        delete instance[key];
                    } catch (err) {
                        logger.debug(`属性清理 | 属性:${key} | 錯誤:${err.message}`);
                    }
                });
            } catch (err) {
                logger.debug(`属性清理 | 錯誤:${err.message}`);
            }

            // logger.debug(`實例清理 | 结果:成功 | 實例:${instanceKey || 'unknown'}`);
        } catch (error) {
            logger.error(`實例清理失敗 | 實例:${instanceKey || 'unknown'} | 錯誤:${error.message}`);
        }
    }

    /**
     * 設置按钮右键菜单
     * @param {HTMLElement} button 按钮元素
     * @param {Function} getMenuItems 獲取菜单项的函數
     * @param {Object} widget 小助手實例
     */
    _setupButtonContextMenu(button, getMenuItems, widget) {
        if (!button || typeof getMenuItems !== 'function') return;

        // 設置右键菜单
        const cleanup = buttonMenu.setupButtonMenu(button, () => {
            // 調用getMenuItems函數獲取菜单项，传入widget作为上下文
            return getMenuItems(widget);
        }, { widget, buttonElement: button });

        // 保存清理函數到widget的事件清理函數列表中
        if (cleanup) {
            widget._eventCleanupFunctions = widget._eventCleanupFunctions || [];
            widget._eventCleanupFunctions.push(cleanup);
        }
    }

    /**
     * 獲取文字 Grid 項目列表
     * 從輸入框內容中解析並提取文字項目
     */
    _getTextGridItems(widget) {
        const inputValue = widget.inputEl.value || '';
        
        if (!inputValue.trim()) {
            // 如果輸入框為空，返回空數組
            return [];
        }
        
        // 解析輸入框文字，提取詞組
        // 支持多種分隔符：逗號、換行、多個空格等
        const items = [];
        
        // 先按換行分割
        const lines = inputValue.split(/\r?\n/);
        
        lines.forEach(line => {
            // 移除首尾空白
            const trimmedLine = line.trim();
            if (!trimmedLine) return;
            
            // 按逗號分割（支持中英文逗號）
            const parts = trimmedLine.split(/[,，、]/);
            
            parts.forEach(part => {
                // 移除首尾空白和括號
                let text = part.trim();
                
                // 移除常見的括號和標記
                text = text.replace(/^[\(（\[\【\{「『]+|[\)）\]\】\}」』]+$/g, '');
                text = text.trim();
                
                // 如果文字不為空且長度合理，添加到列表
                if (text && text.length > 0 && text.length <= 100) {
                    // 檢查是否已存在（避免重複）
                    const exists = items.some(item => item.text === text || item.value === text);
                    if (!exists) {
                        // 嘗試從翻譯緩存獲取翻譯
                        let translated = null;
                        let original = null;
                        try {
                            const cacheResult = TranslateCacheService.queryTranslateCache(text);
                            if (cacheResult && cacheResult.type === 'source' && cacheResult.translatedText) {
                                translated = cacheResult.translatedText;
                            } else if (cacheResult && cacheResult.type === 'translated' && cacheResult.sourceText) {
                                original = cacheResult.sourceText; // 當前輸入是譯文，原文為 sourceText
                            }
                        } catch (err) {
                            // 忽略緩存查詢錯誤
                        }
                        items.push({
                            text: text,
                            value: text,
                            translated: translated || undefined,
                            original: original || undefined
                        });
                    }
                }
            });
        });
        
        // 如果解析後沒有項目，嘗試按空格分割（作為備用方案）
        if (items.length === 0 && inputValue.trim()) {
            const words = inputValue.trim().split(/\s+/);
            words.forEach(word => {
                const trimmedWord = word.trim();
                if (trimmedWord && trimmedWord.length > 0 && trimmedWord.length <= 50) {
                    let translated = null;
                    try {
                        const cacheResult = TranslateCacheService.queryTranslateCache(trimmedWord);
                        if (cacheResult && cacheResult.type === 'source' && cacheResult.translatedText) {
                            translated = cacheResult.translatedText;
                        }
                    } catch (err) {}
                    items.push({
                        text: trimmedWord,
                        value: trimmedWord,
                        translated: translated || undefined
                    });
                }
            });
        }
        
        // 如果還是沒有項目，至少顯示整個輸入內容（如果不太長）
        if (items.length === 0 && inputValue.trim().length <= 100) {
            const t = inputValue.trim();
            let translated = null;
            try {
                const cacheResult = TranslateCacheService.queryTranslateCache(t);
                if (cacheResult && cacheResult.type === 'source' && cacheResult.translatedText) {
                    translated = cacheResult.translatedText;
                }
            } catch (err) {}
            items.push({
                text: t,
                value: t,
                translated: translated || undefined
            });
        }
        
        logger.debug('解析輸入框文字', { 
            inputLength: inputValue.length,
            itemsCount: items.length,
            items: items.slice(0, 10) // 只記錄前10個
        });
        
        return items;
    }
}

// 創建单例實例
const promptAssistant = new PromptAssistant();

// 导出
export { promptAssistant, PromptAssistant };
