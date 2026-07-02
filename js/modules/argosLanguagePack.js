/**
 * Argos Translate 語言包狀態與 UI 安裝
 */

import { app } from "../../../../scripts/app.js";
import { APIService } from "../services/api.js";
import { logger } from "../utils/logger.js";

/** 從後端錯誤訊息解析缺少的語言對 */
export function parseMissingPair(errorMessage) {
    if (!errorMessage || typeof errorMessage !== "string") {
        return null;
    }
    const match = errorMessage.match(/未安裝語言包\s*([a-z]+)→([a-z]+)/i)
        || errorMessage.match(/translate-([a-z]+)_([a-z]+)/i);
    if (!match) {
        return null;
    }
    return { from: match[1], to: match[2] };
}

function pairLabel(from, to) {
    const labels = { en: "英文", zh: "中文" };
    return `${labels[from] || from} → ${labels[to] || to}`;
}

function toast(severity, summary, detail, life = 4000) {
    app.extensionManager?.toast?.add?.({ severity, summary, detail, life });
}

function buildArgosStatusError(status, detail = "") {
    if (status === 400) {
        return `HTTP 400：請求格式異常或前端狀態過期。建議先重新整理頁面後再試。${detail ? `（${detail}）` : ""}`;
    }
    if (status === 404) {
        return "HTTP 404：找不到 Argos 狀態路由。請確認外掛已正確載入，必要時完整重啟 ComfyUI。";
    }
    if (status === 405) {
        return "HTTP 405：目前後端路由可能為熱重載中間狀態。請完整重啟 ComfyUI 後再試。";
    }
    if (status >= 500) {
        return `HTTP ${status}：後端服務異常，請查看後端日誌。${detail ? `（${detail}）` : ""}`;
    }
    return `HTTP ${status}${detail ? `：${detail}` : ""}`;
}

export const ArgosLanguagePack = {
    async fetchStatus() {
        const response = await fetch(APIService.getApiUrl("/argos/status"));
        if (!response.ok) {
            let detail = "";
            try {
                const raw = await response.text();
                if (raw) {
                    try {
                        const parsed = JSON.parse(raw);
                        detail = parsed?.error || parsed?.message || raw;
                    } catch {
                        detail = raw;
                    }
                }
            } catch {
                // ignore
            }
            throw new Error(buildArgosStatusError(response.status, detail));
        }
        return response.json();
    },

    async install(from, to) {
        const attempts = [
            { path: "/argos/status", body: { action: "install", from, to } },
            { path: "/argos/translate", body: { action: "install", from, to, request_id: `install-${Date.now()}` } },
            { path: "/argos/install", body: { from, to } },
        ];
        let lastError = null;
        for (const { path, body } of attempts) {
            const res = await APIService.postJson(path, body);
            if (res.ok && res.data?.success) {
                window.dispatchEvent(new CustomEvent("pa-argos-langpack-changed"));
                return res.data;
            }
            if (res.status === 405) {
                lastError = `405: ${path}`;
                continue;
            }
            throw new Error(res.data?.error || `安裝失敗 (${res.status})`);
        }
        throw new Error(
            lastError
                ? `${lastError} — 請完整重啟 ComfyUI 後再試（熱重載可能未註冊新安裝路由）`
                : "安裝失敗，請完整重啟 ComfyUI 後再試"
        );
    },

    /**
     * 彈出確認並安裝；成功返回 true
     */
    async promptAndInstall(from, to, anchorEl = null) {
        const label = pairLabel(from, to);
        const ok = window.confirm(`Argos 尚未安裝語言包「${label}」。\n\n是否現在從網路下載並安裝？（首次可能需要數分鐘）`);
        if (!ok) {
            return false;
        }
        try {
            if (anchorEl) {
                anchorEl.disabled = true;
                anchorEl.textContent = "安裝中...";
            }
            await this.install(from, to);
            toast("success", "Argos 語言包", `${label} 安裝完成`);
            return true;
        } catch (error) {
            logger.error(`Argos 語言包安裝失敗: ${error.message}`);
            toast("error", "安裝失敗", error.message, 6000);
            return false;
        } finally {
            if (anchorEl) {
                anchorEl.disabled = false;
            }
        }
    },

    /**
     * 設定頁：語言包管理列
     */
    createSettingsRow() {
        const row = document.createElement("tr");
        row.className = "promptwidget-settings-row";

        const labelCell = document.createElement("td");
        labelCell.className = "comfy-menu-label";
        row.appendChild(labelCell);

        const cell = document.createElement("td");
        const container = document.createElement("div");
        container.className = "pa-argos-langpack-panel";
        container.style.cssText = "display:flex;flex-direction:column;gap:8px;min-width:260px;font-size:12px;";
        cell.appendChild(container);
        row.appendChild(cell);

        const render = async () => {
            container.innerHTML = '<span style="color:var(--p-text-muted-color);">載入語言包狀態...</span>';
            try {
                const status = await this.fetchStatus();
                container.innerHTML = "";

                if (!status.available) {
                    const hint = document.createElement("div");
                    hint.style.color = "var(--p-orange-400)";
                    hint.textContent = status.error || "Argos Translate 未安裝";
                    container.appendChild(hint);
                    return;
                }

                const title = document.createElement("div");
                title.style.color = "var(--p-text-muted-color)";
                title.textContent = "中英翻譯所需語言包（離線，需聯網下載一次）";
                container.appendChild(title);

                const list = document.createElement("div");
                list.style.cssText = "display:flex;flex-direction:column;gap:6px;";
                const pairs = status.recommended_pairs || [];
                if (pairs.length === 0) {
                    list.innerHTML = '<span style="color:var(--p-text-muted-color);">無推薦語言包資訊</span>';
                } else {
                    pairs.forEach((pair) => {
                        const line = document.createElement("div");
                        line.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:8px;";

                        const name = document.createElement("span");
                        name.textContent = pair.label || pairLabel(pair.from, pair.to);
                        line.appendChild(name);

                        if (pair.installed) {
                            const badge = document.createElement("span");
                            badge.style.color = "var(--p-green-400)";
                            badge.textContent = "✓ 已安裝";
                            line.appendChild(badge);
                        } else {
                            const btn = document.createElement("button");
                            btn.type = "button";
                            btn.className = "comfy-btn";
                            btn.textContent = "安裝";
                            btn.style.padding = "2px 10px";
                            btn.addEventListener("click", async () => {
                                btn.disabled = true;
                                btn.textContent = "安裝中...";
                                try {
                                    await this.install(pair.from, pair.to);
                                    toast("success", "Argos 語言包", `${name.textContent} 安裝完成`);
                                    await render();
                                } catch (error) {
                                    logger.error(`安裝語言包失敗: ${error.message}`);
                                    toast("error", "安裝失敗", error.message, 6000);
                                    btn.disabled = false;
                                    btn.textContent = "安裝";
                                }
                            });
                            line.appendChild(btn);
                        }
                        list.appendChild(line);
                    });
                }
                container.appendChild(list);

                const refreshBtn = document.createElement("button");
                refreshBtn.type = "button";
                refreshBtn.className = "comfy-btn";
                refreshBtn.textContent = "重新整理狀態";
                refreshBtn.style.alignSelf = "flex-start";
                refreshBtn.style.marginTop = "4px";
                refreshBtn.addEventListener("click", () => render());
                container.appendChild(refreshBtn);
            } catch (error) {
                container.innerHTML = `<span style="color:var(--p-red-400);">載入失敗: ${error.message}</span>`;
            }
        };

        render();
        window.addEventListener("pa-argos-langpack-changed", render);

        return row;
    },
};
