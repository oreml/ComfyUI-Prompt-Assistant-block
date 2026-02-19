/**
 * 文字 Grid 管理器
 * 負責管理文字 grid 面板的顯示和操作
 */

import { logger } from '../utils/logger.js';
import { UIToolkit } from "../utils/UIToolkit.js";
import { PopupManager } from "../utils/popupManager.js";
import { ResourceManager } from "../utils/resourceManager.js";
import { EventManager } from "../utils/eventManager.js";

/**
 * 文字 Grid 管理器類
 * 管理文字 grid 彈窗和文字選擇
 */
class TextGridManager {
    static currentPopup = null;
    static eventCleanups = [];
    static Sortable = null;         // Sortable 庫引用
    static sortableInstance = null; // Sortable 實例

    /**
     * 初始化 Sortable
     */
    static async _initSortable() {
        if (this.Sortable) return;
        
        try {
            this.Sortable = await ResourceManager.getSortable();
        } catch (error) {
            logger.warn('Sortable library not loaded', error);
        }
    }

    /**
     * 顯示文字 grid 彈窗
     */
    static async showTextGridPopup(options) {
        const {
            anchorButton,
            nodeId,
            inputId,
            onClose,
            buttonInfo,
            onTextSelect,
            textItems = [], // 文字項目數組，格式: [{text: '文字1', value: 'value1'}, ...]
            widget = null   // widget 引用，用於更新輸入框
        } = options;

        logger.debug('顯示文字 Grid 彈窗', { 
            hasAnchorButton: !!anchorButton,
            hasButtonInfo: !!buttonInfo,
            textItemsCount: textItems.length 
        });

        // 清理現有彈窗和事件
        this.hideTextGridPopup();

        // 初始化 Sortable
        await this._initSortable();

        try {
            // 創建彈窗容器
            const popup = document.createElement('div');
            popup.className = 'popup_container text_grid_popup';
            popup.style.display = 'flex';
            popup.style.flexDirection = 'column';
            popup.style.minHeight = '400px';
            popup.style.maxHeight = '80vh';
            popup.style.height = 'auto';
            popup.style.minWidth = '500px';
            popup.style.maxWidth = '800px';

            // 創建標題欄
            const titleBar = document.createElement('div');
            titleBar.className = 'popup_title_bar';

            const title = document.createElement('div');
            title.className = 'popup_title';
            title.textContent = '文字 Grid';

            // 添加圖標（如果有的話）
            const iconContainer = ResourceManager.getIcon('icon-tag.svg');
            if (iconContainer) {
                iconContainer.style.width = '18px';
                iconContainer.style.height = '18px';
                iconContainer.style.color = 'var(--p-dialog-color)';
                title.insertBefore(iconContainer, title.firstChild);
            }

            // 關閉按鈕
            const closeButton = document.createElement('button');
            closeButton.className = 'popup_close_button';
            closeButton.innerHTML = '<i class="pi pi-times"></i>';
            closeButton.onclick = () => this.hideTextGridPopup();

            titleBar.appendChild(title);
            titleBar.appendChild(closeButton);

            // 創建內容區域
            const contentArea = document.createElement('div');
            contentArea.className = 'text_grid_content';
            contentArea.style.flex = '1';
            contentArea.style.overflow = 'auto';
            contentArea.style.padding = '12px';

            // 創建 Grid 容器
            const gridContainer = document.createElement('div');
            gridContainer.className = 'text_grid_container';
            gridContainer.style.display = 'grid';
            gridContainer.style.gridTemplateColumns = 'repeat(auto-fill, minmax(120px, 1fr))';
            gridContainer.style.gap = '8px';
            gridContainer.style.padding = '8px';

            // 如果沒有提供文字項目，使用默認示例
            const itemsToShow = textItems.length > 0 ? textItems : [
                { text: '示例文字1', value: 'example1' },
                { text: '示例文字2', value: 'example2' },
                { text: '示例文字3', value: 'example3' },
                { text: '示例文字4', value: 'example4' },
                { text: '示例文字5', value: 'example5' },
                { text: '示例文字6', value: 'example6' },
            ];

            // 創建文字項目
            itemsToShow.forEach((item, index) => {
                const gridItem = document.createElement('div');
                gridItem.className = 'text_grid_item';
                gridItem.style.padding = '12px';
                gridItem.style.backgroundColor = 'color-mix(in srgb, var(--comfy-menu-secondary-bg), transparent 10%)';
                gridItem.style.borderRadius = '8px';
                gridItem.style.cursor = 'grab'; // 改為 grab 游標，表示可拖動
                gridItem.style.transition = 'all 0.2s ease';
                gridItem.style.textAlign = 'center';
                gridItem.style.userSelect = 'none';
                gridItem.style.border = '1px solid transparent';
                gridItem.dataset.textValue = item.value || item.text; // 保存文字值用於排序後更新
                gridItem.dataset.disabled = 'false'; // 初始狀態為啟用

                const itemText = document.createElement('div');
                itemText.className = 'text_grid_item_text';
                itemText.textContent = item.text || item.value || `項目 ${index + 1}`;
                itemText.style.fontSize = '14px';
                itemText.style.color = 'var(--p-inputtext-color)';
                itemText.style.wordBreak = 'break-word';

                gridItem.appendChild(itemText);

                // 點擊切換禁用狀態
                // 使用標記追蹤是否發生拖動
                let mouseDownTime = 0;
                let mouseDownPos = { x: 0, y: 0 };
                let hasMoved = false;
                
                gridItem.addEventListener('mousedown', (e) => {
                    mouseDownTime = Date.now();
                    mouseDownPos = { x: e.clientX, y: e.clientY };
                    hasMoved = false;
                });

                gridItem.addEventListener('mousemove', (e) => {
                    if (mouseDownTime > 0) {
                        const deltaX = Math.abs(e.clientX - mouseDownPos.x);
                        const deltaY = Math.abs(e.clientY - mouseDownPos.y);
                        // 如果移動超過 5 像素，認為是拖動
                        if (deltaX > 5 || deltaY > 5) {
                            hasMoved = true;
                        }
                    }
                });

                gridItem.addEventListener('mouseup', () => {
                    mouseDownTime = 0;
                    hasMoved = false;
                });

                gridItem.addEventListener('click', (e) => {
                    // 如果正在拖動或移動，不處理點擊
                    if (hasMoved || 
                        gridItem.classList.contains('sortable-chosen') ||
                        gridItem.classList.contains('sortable-drag')) {
                        hasMoved = false;
                        return;
                    }

                    e.stopPropagation();
                    e.preventDefault();
                    
                    // 切換禁用狀態
                    const isDisabled = gridItem.dataset.disabled === 'true';
                    gridItem.dataset.disabled = isDisabled ? 'false' : 'true';
                    
                    // 更新視覺樣式
                    this._updateItemDisabledState(gridItem, !isDisabled);
                    
                    // 更新輸入框內容（排除禁用的項目）
                    if (widget && widget.inputEl) {
                        this._updateInputFromGrid(gridContainer, widget);
                    }
                    
                    logger.debug(`文字 Grid 項目狀態切換 | 文字:${item.text} | 禁用:${!isDisabled}`);
                });

                // 懸停效果（拖動時不觸發）
                gridItem.addEventListener('mouseenter', (e) => {
                    // 檢查是否正在拖動
                    if (gridItem.classList.contains('sortable-ghost') || 
                        gridItem.classList.contains('sortable-chosen') ||
                        gridItem.classList.contains('sortable-drag')) {
                        return;
                    }
                    // 禁用狀態不顯示懸停效果
                    if (gridItem.dataset.disabled === 'true') {
                        return;
                    }
                    gridItem.style.backgroundColor = 'color-mix(in srgb, var(--p-primary-500), transparent 84%)';
                    gridItem.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                });

                gridItem.addEventListener('mouseleave', (e) => {
                    // 檢查是否正在拖動
                    if (gridItem.classList.contains('sortable-ghost') || 
                        gridItem.classList.contains('sortable-chosen') ||
                        gridItem.classList.contains('sortable-drag')) {
                        return;
                    }
                    // 根據禁用狀態設置背景色
                    if (gridItem.dataset.disabled === 'true') {
                        gridItem.style.backgroundColor = 'color-mix(in srgb, var(--comfy-menu-secondary-bg), transparent 30%)';
                    } else {
                        gridItem.style.backgroundColor = 'color-mix(in srgb, var(--comfy-menu-secondary-bg), transparent 10%)';
                    }
                    gridItem.style.borderColor = 'transparent';
                });

                gridContainer.appendChild(gridItem);
            });

            contentArea.appendChild(gridContainer);
            popup.appendChild(titleBar);
            popup.appendChild(contentArea);

            // 保存彈窗引用
            this.currentPopup = popup;

            // 初始化 Sortable 拖動排序
            if (this.Sortable) {
                this.sortableInstance = new this.Sortable(gridContainer, {
                    animation: 150,
                    ghostClass: 'sortable-ghost',
                    chosenClass: 'sortable-chosen',
                    dragClass: 'sortable-drag',
                    draggable: '.text_grid_item:not(.text_grid_item_disabled)', // 禁用的項目不可拖動
                    filter: '.text_grid_item_disabled', // 過濾掉禁用的項目
                    preventOnFilter: true,
                    onStart: (evt) => {
                        evt.item.style.cursor = 'grabbing'; // 拖動時改為 grabbing
                        logger.debug(`開始拖動文字 Grid 項目 | 索引:${evt.oldIndex}`);
                    },
                    onEnd: (evt) => {
                        // 根據禁用狀態恢復游標
                        const isDisabled = evt.item.dataset.disabled === 'true';
                        evt.item.style.cursor = isDisabled ? 'not-allowed' : 'grab';
                        logger.debug(`結束拖動文字 Grid 項目 | 舊索引:${evt.oldIndex} | 新索引:${evt.newIndex}`);
                        
                        // 如果順序改變，更新輸入框內容
                        if (evt.oldIndex !== evt.newIndex && widget && widget.inputEl) {
                            this._updateInputFromGrid(gridContainer, widget);
                        }
                    }
                });
            }

            // 使用 PopupManager 顯示彈窗
            PopupManager.showPopup({
                popup: popup,
                anchorButton: anchorButton,
                buttonInfo: buttonInfo,
                onClose: () => {
                    this.hideTextGridPopup();
                    if (onClose) {
                        onClose();
                    }
                }
            });

            logger.debug('文字 Grid 彈窗已顯示', { itemCount: itemsToShow.length });

        } catch (error) {
            logger.error('顯示文字 Grid 彈窗失敗', error);
        }
    }

    /**
     * 更新項目的禁用狀態樣式
     */
    static _updateItemDisabledState(gridItem, isDisabled) {
        const itemText = gridItem.querySelector('.text_grid_item_text');
        
        if (isDisabled) {
            // 禁用狀態：灰色背景、刪除線、降低透明度
            gridItem.classList.add('text_grid_item_disabled');
            gridItem.style.backgroundColor = 'color-mix(in srgb, var(--comfy-menu-secondary-bg), transparent 30%)';
            gridItem.style.opacity = '0.5';
            if (itemText) {
                itemText.style.textDecoration = 'line-through';
                itemText.style.color = 'var(--p-text-muted-color)';
            }
            gridItem.style.cursor = 'not-allowed';
        } else {
            // 啟用狀態：恢復正常樣式
            gridItem.classList.remove('text_grid_item_disabled');
            gridItem.style.backgroundColor = 'color-mix(in srgb, var(--comfy-menu-secondary-bg), transparent 10%)';
            gridItem.style.opacity = '1';
            if (itemText) {
                itemText.style.textDecoration = 'none';
                itemText.style.color = 'var(--p-inputtext-color)';
            }
            gridItem.style.cursor = 'grab';
        }
    }

    /**
     * 根據 Grid 順序更新輸入框內容（排除禁用的項目）
     */
    static _updateInputFromGrid(gridContainer, widget) {
        if (!gridContainer || !widget || !widget.inputEl) return;

        // 獲取所有啟用的項目文字值（按當前順序，排除禁用的）
        const items = Array.from(gridContainer.querySelectorAll('.text_grid_item'));
        const textValues = items
            .filter(item => item.dataset.disabled !== 'true') // 只包含未禁用的項目
            .map(item => item.dataset.textValue || item.textContent.trim())
            .filter(Boolean);

        // 組合成新的輸入內容（用逗號分隔）
        const newValue = textValues.join(', ');

        // 更新輸入框內容
        widget.inputEl.value = newValue;

        // 觸發輸入事件，確保其他監聽器能收到更新
        widget.inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        widget.inputEl.dispatchEvent(new Event('change', { bubbles: true }));

        logger.debug('已根據 Grid 順序更新輸入框（排除禁用項目）', { 
            newValue,
            enabledCount: textValues.length,
            totalCount: items.length
        });
    }

    /**
     * 隱藏文字 grid 彈窗
     */
    static hideTextGridPopup() {
        // 清理 Sortable 實例
        if (this.sortableInstance) {
            try {
                this.sortableInstance.destroy();
            } catch (error) {
                logger.debug('清理 Sortable 實例失敗', error);
            }
            this.sortableInstance = null;
        }

        // 清理事件監聽
        this._cleanupEvents();

        // 使用 PopupManager 關閉所有彈窗（與 TagManager 保持一致）
        if (this.currentPopup) {
            PopupManager.hidePopup(this.currentPopup);
            this.currentPopup = null;
        } else {
            // 如果沒有當前彈窗引用，關閉所有彈窗
            PopupManager.closeAllPopups();
        }
    }

    /**
     * 清理事件監聽
     */
    static _cleanupEvents() {
        this.eventCleanups.forEach(cleanup => {
            if (cleanup && typeof cleanup === 'function') {
                cleanup();
            }
        });
        this.eventCleanups = [];
    }
}

export { TextGridManager };
