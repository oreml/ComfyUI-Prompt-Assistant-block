/**
 * 翻譯緩存管理器
 * 設定頁入口：以獨立視窗檢視所有翻譯字詞對應
 */

import { app } from "../../../../scripts/app.js";
import { logger } from "../utils/logger.js";
import { TranslateCacheService } from "../services/cache.js";
import { APIService } from "../services/api.js";
import {
    createSettingsDialog,
    createConfirmPopup,
    createLoadingButton
} from "./uiComponents.js";

class TranslateCacheManager {
    constructor() {
        this._activeTab = "words";
        this._root = null;
        this._searchKeyword = "";
        this._searchTimer = null;
        this._syncListener = null;
    }

    showTranslateCacheModal() {
        try {
            createSettingsDialog({
                title: '<i class="pi pi-book" style="margin-right: 8px;"></i>翻譯緩存管理器',
                dialogClassName: "translate-cache-manager-dialog",
                disableBackdropAndCloseOnClickOutside: true,
                hideFooter: true,
                renderContent: (container) => {
                    this._root = container;
                    this._activeTab = "words";
                    this._searchKeyword = "";
                    this._buildUI(container);
                },
            });
        } catch (error) {
            logger.error(`開啟翻譯緩存管理器失敗: ${error.message}`);
            app.extensionManager?.toast?.add?.({
                severity: "error",
                summary: "開啟失敗",
                detail: error.message,
                life: 3000,
            });
        }
    }

    _buildUI(container) {
        container.innerHTML = "";
        container.className = "translate-cache-manager-content";

        const persistPathBar = document.createElement("div");
        persistPathBar.className = "translate-cache-manager-persist-path";

        const persistInfo = document.createElement("div");
        persistInfo.className = "translate-cache-manager-persist-info";

        const persistPathText = document.createElement("div");
        persistPathText.dataset.role = "persist-path";
        persistPathText.textContent = "持久化路徑：載入中...";

        const syncStatusText = document.createElement("div");
        syncStatusText.dataset.role = "sync-status";
        syncStatusText.className = "translate-cache-manager-sync-status";
        syncStatusText.textContent = "同步狀態：初始化中...";

        persistInfo.appendChild(persistPathText);
        persistInfo.appendChild(syncStatusText);

        const actionBar = document.createElement("div");
        actionBar.className = "translate-cache-manager-persist-actions";

        const refreshPathBtn = document.createElement("button");
        refreshPathBtn.type = "button";
        refreshPathBtn.className = "comfy-btn";
        refreshPathBtn.textContent = "刷新路徑";
        refreshPathBtn.addEventListener("click", () => this._renderPersistPath());

        const syncNowBtn = document.createElement("button");
        syncNowBtn.type = "button";
        syncNowBtn.className = "comfy-btn";
        syncNowBtn.textContent = "立即同步";
        syncNowBtn.addEventListener("click", async () => {
            syncNowBtn.disabled = true;
            syncNowBtn.textContent = "同步中...";
            try {
                await TranslateCacheService.forcePersistToBackend();
                this._renderSyncStatus();
            } finally {
                syncNowBtn.disabled = false;
                syncNowBtn.textContent = "立即同步";
            }
        });

        actionBar.appendChild(refreshPathBtn);
        actionBar.appendChild(syncNowBtn);

        persistPathBar.appendChild(persistInfo);
        persistPathBar.appendChild(actionBar);
        container.appendChild(persistPathBar);

        const toolbar = document.createElement("div");
        toolbar.className = "translate-cache-manager-toolbar";

        const tabBar = document.createElement("div");
        tabBar.className = "translate-cache-manager-tabs";
        const tabs = [
            { id: "words", label: "單字對應" },
            { id: "full", label: "完整條目" },
        ];
        tabs.forEach((tab) => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "translate-cache-manager-tab";
            if (tab.id === this._activeTab) {
                btn.classList.add("active");
            }
            btn.textContent = tab.label;
            btn.dataset.tab = tab.id;
            btn.addEventListener("click", () => {
                this._activeTab = tab.id;
                this._searchKeyword = "";
                this._updateTabButtons();
                searchInput.value = "";
                searchInput.placeholder = this._activeTab === "words" ? "搜尋單字或譯文..." : "搜尋原文或譯文...";
                this._renderList();
            });
            tabBar.appendChild(btn);
        });

        const searchInput = document.createElement("input");
        searchInput.type = "text";
        searchInput.className = "translate-cache-manager-search";
        searchInput.placeholder = this._activeTab === "words" ? "搜尋單字或譯文..." : "搜尋原文或譯文...";
        searchInput.value = this._searchKeyword;
        searchInput.addEventListener("input", (e) => {
            this._searchKeyword = e.target.value;
            if (this._searchTimer) {
                clearTimeout(this._searchTimer);
            }
            this._searchTimer = setTimeout(() => {
                this._searchTimer = null;
                this._renderList();
            }, 150);
        });

        const refreshBtn = document.createElement("button");
        refreshBtn.type = "button";
        refreshBtn.className = "comfy-btn";
        refreshBtn.textContent = "重新整理";
        refreshBtn.addEventListener("click", () => this._renderList());

        toolbar.appendChild(tabBar);
        toolbar.appendChild(searchInput);
        toolbar.appendChild(refreshBtn);
        container.appendChild(toolbar);

        const stats = document.createElement("div");
        stats.className = "translate-cache-manager-stats";
        stats.dataset.role = "stats";
        container.appendChild(stats);

        const list = document.createElement("div");
        list.className = "translate-cache-manager-list";
        list.dataset.role = "list";
        container.appendChild(list);

        this._renderPersistPath();
        this._renderSyncStatus();
        this._bindSyncStatusListener();
        this._renderList();
    }

    _updateTabButtons() {
        if (!this._root) {
            return;
        }
        const tabButtons = this._root.querySelectorAll(".translate-cache-manager-tab");
        tabButtons.forEach((btn) => {
            const isActive = btn.dataset.tab === this._activeTab;
            btn.classList.toggle("active", isActive);
        });
    }

    async _renderPersistPath() {
        if (!this._root) {
            return;
        }
        const pathEl = this._root.querySelector('[data-role="persist-path"]');
        if (!pathEl) {
            return;
        }
        pathEl.textContent = "持久化路徑：載入中...";
        try {
            const res = await APIService.getTranslateCacheConfig();
            const path = res?.path || "未提供（請確認後端已更新）";
            pathEl.textContent = `持久化路徑：${path}`;
        } catch (error) {
            pathEl.textContent = `持久化路徑讀取失敗：${error.message}`;
        }
    }

    _renderSyncStatus() {
        if (!this._root) {
            return;
        }
        const syncEl = this._root.querySelector('[data-role="sync-status"]');
        if (!syncEl) {
            return;
        }
        const status = TranslateCacheService.getSyncStatus();
        const timeText = status.lastSyncAt
            ? `（${new Date(status.lastSyncAt).toLocaleTimeString()}）`
            : "";
        if (status.status === "pending") {
            syncEl.textContent = "同步狀態：待同步";
            return;
        }
        if (status.status === "syncing") {
            syncEl.textContent = "同步狀態：同步中...";
            return;
        }
        if (status.status === "success") {
            syncEl.textContent = `同步狀態：已同步 ${timeText}`;
            return;
        }
        if (status.status === "error") {
            syncEl.textContent = `同步狀態：失敗（${status.error || "未知錯誤"}）`;
            return;
        }
        syncEl.textContent = "同步狀態：待命";
    }

    _bindSyncStatusListener() {
        if (this._syncListener) {
            window.removeEventListener("pa-translate-cache-sync", this._syncListener);
        }
        this._syncListener = () => this._renderSyncStatus();
        window.addEventListener("pa-translate-cache-sync", this._syncListener);
    }

    _renderList() {
        if (!this._root) {
            return;
        }
        const statsEl = this._root.querySelector('[data-role="stats"]');
        const listEl = this._root.querySelector('[data-role="list"]');
        if (!statsEl || !listEl) {
            return;
        }

        const keyword = (this._searchKeyword || "").trim().toLowerCase();

        if (this._activeTab === "words") {
            this._renderWordPairs(statsEl, listEl, keyword);
        } else {
            this._renderFullEntries(statsEl, listEl, keyword);
        }
    }

    _renderWordPairs(statsEl, listEl, keyword) {
        const wordCache = TranslateCacheService.getWordTranslateCache();
        let entries = Array.from(wordCache.entries()).sort((a, b) =>
            a[0].localeCompare(b[0], undefined, { sensitivity: "base" })
        );

        if (keyword) {
            entries = entries.filter(
                ([word, translated]) =>
                    word.toLowerCase().includes(keyword) ||
                    translated.toLowerCase().includes(keyword)
            );
        }

        const totalStats = TranslateCacheService.getTranslateCacheStats();
        statsEl.textContent = keyword
            ? `找到 ${entries.length} 個單字對應（共 ${wordCache.size} 個，完整條目 ${totalStats.total} 條）`
            : `共 ${wordCache.size} 個單字對應（完整條目 ${totalStats.total} 條，使用率 ${totalStats.usage}）`;

        listEl.innerHTML = "";
        if (entries.length === 0) {
            listEl.innerHTML = `<div class="translate-cache-manager-empty">${
                keyword ? "沒有符合的單字對應" : "暫無翻譯單字緩存"
            }</div>`;
            return;
        }

        entries.forEach(([word, translated]) => {
            listEl.appendChild(this._createPairRow(word, translated, () => {
                this._deleteWordPair(word, listEl);
            }));
        });
    }

    _renderFullEntries(statsEl, listEl, keyword) {
        let cache = TranslateCacheService.getAllTranslateCache();
        let entries = Array.from(cache.entries());

        if (keyword) {
            const results = TranslateCacheService.searchTranslateCache(this._searchKeyword);
            entries = results.map((r) => [r.source, r.translated]);
        } else {
            entries.sort((a, b) => b[0].length - a[0].length);
        }

        const totalStats = TranslateCacheService.getTranslateCacheStats();
        statsEl.textContent = keyword
            ? `找到 ${entries.length} 條（共 ${totalStats.total} 條）`
            : `共 ${totalStats.total} 條完整緩存（使用率 ${totalStats.usage}）`;

        listEl.innerHTML = "";
        if (entries.length === 0) {
            listEl.innerHTML = `<div class="translate-cache-manager-empty">${
                keyword ? "沒有符合的緩存條目" : "暫無翻譯緩存"
            }</div>`;
            return;
        }

        entries.forEach(([source, translated]) => {
            const row = document.createElement("div");
            row.className = "translate-cache-manager-full-item";

            const body = document.createElement("div");
            body.className = "translate-cache-manager-full-body";

            const sourceDiv = document.createElement("div");
            sourceDiv.className = "translate-cache-manager-full-source";
            sourceDiv.textContent = source;
            sourceDiv.title = source;

            const translatedDiv = document.createElement("div");
            translatedDiv.className = "translate-cache-manager-full-translated";
            translatedDiv.textContent = translated;
            translatedDiv.title = translated;

            body.appendChild(sourceDiv);
            body.appendChild(translatedDiv);

            const delBtn = document.createElement("button");
            delBtn.type = "button";
            delBtn.className = "translate-cache-manager-delete";
            delBtn.title = "刪除";
            delBtn.innerHTML = '<i class="pi pi-trash"></i>';
            delBtn.addEventListener("click", () => {
                this._deleteFullEntry(source);
            });

            row.appendChild(body);
            row.appendChild(delBtn);
            listEl.appendChild(row);
        });
    }

    _createPairRow(source, translated, onDelete) {
        const row = document.createElement("div");
        row.className = "translate-cache-manager-pair-item";

        const sourceSpan = document.createElement("span");
        sourceSpan.className = "translate-cache-manager-pair-source";
        sourceSpan.textContent = source;
        sourceSpan.title = source;

        const arrow = document.createElement("span");
        arrow.className = "translate-cache-manager-pair-arrow";
        arrow.textContent = "→";

        const translatedSpan = document.createElement("span");
        translatedSpan.className = "translate-cache-manager-pair-translated";
        translatedSpan.textContent = translated;
        translatedSpan.title = translated;

        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "translate-cache-manager-delete";
        delBtn.title = "刪除";
        delBtn.innerHTML = '<i class="pi pi-trash"></i>';
        delBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            onDelete();
        });

        row.appendChild(sourceSpan);
        row.appendChild(arrow);
        row.appendChild(translatedSpan);
        row.appendChild(delBtn);
        return row;
    }

    _deleteFullEntry(source) {
        createConfirmPopup({
            target: this._root || document.body,
            message: "確定要刪除這條翻譯緩存嗎？",
            icon: "pi-exclamation-triangle",
            iconColor: "var(--p-red-500)",
            confirmLabel: "刪除",
            cancelLabel: "取消",
            confirmDanger: true,
            onConfirm: () => {
                TranslateCacheService.deleteTranslateCacheEntries([source]);
                this._renderList();
            },
        });
    }

    _deleteWordPair(word) {
        const cache = TranslateCacheService.getAllTranslateCache();
        const updatedEntries = new Map();

        cache.forEach((translated, source) => {
            if (source === word) {
                return;
            }

            const sourceWords = source.split(/[,，、]/).map((w) => w.trim()).filter(Boolean);
            const translatedWords = translated.split(/[,，、]/).map((w) => w.trim()).filter(Boolean);

            if (sourceWords.length === translatedWords.length && sourceWords.length > 0) {
                const wordIndex = sourceWords.indexOf(word);
                if (wordIndex !== -1) {
                    sourceWords.splice(wordIndex, 1);
                    translatedWords.splice(wordIndex, 1);
                    if (sourceWords.length > 0) {
                        updatedEntries.set(sourceWords.join(", "), translatedWords.join(", "));
                    }
                } else {
                    updatedEntries.set(source, translated);
                }
            } else {
                updatedEntries.set(source, translated);
            }
        });

        // 直接一次性保存，避免逐条写入造成多次同步排程
        TranslateCacheService.saveAllTranslateCache(updatedEntries);
        this._renderList();
    }
}

const translateCacheManager = new TranslateCacheManager();

export { TranslateCacheManager, translateCacheManager };
