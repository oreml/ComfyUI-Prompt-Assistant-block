"""
Google 翻譯服務
優先使用 Google Cloud Translation API v2（Basic），需配置 API Key。
若未配置 API Key，則使用 googletrans 免費庫作為備選。
"""
import random
import time
import httpx
import asyncio
from typing import Optional

from ..utils.common import ProgressBar, TASK_TRANSLATE, WARN_PREFIX

# 嘗試導入 googletrans（備選方案）
try:
    from googletrans import Translator
    GOOGLETRANS_AVAILABLE = True
except ImportError:
    GOOGLETRANS_AVAILABLE = False
    Translator = None


# Google 目標語言碼與本專案一致：zh / en；API 使用 zh-CN 表示簡體中文
def _to_google_lang(code: str) -> str:
    if code == "zh":
        return "zh-CN"
    if code == "en":
        return "en"
    if code == "auto":
        return ""  # 不傳 source 即為自動檢測
    return code


def _from_google_lang(code: str) -> str:
    if not code:
        return "auto"
    if code.startswith("zh"):
        return "zh"
    return code if code == "en" else code


class GoogleTranslateService:
    """
    Google 翻譯服務
    優先使用 Google Cloud Translation API v2（需 API Key）
    若無 API Key，則使用 googletrans 免費庫
    """

    # 單次請求約 5KB 以內較穩妥，與百度分段邏輯類似
    MAX_CHUNK_LEN = 4500

    @staticmethod
    def split_text_by_paragraphs(text: str, max_length: int = MAX_CHUNK_LEN):
        """按段落分割文本，便於長文翻譯"""
        if not text:
            return []
        lines = text.split("\n")
        chunks = []
        current = ""
        for line in lines:
            if len(line) > max_length:
                if current:
                    chunks.append(current)
                    current = ""
                rest = line
                while rest:
                    chunks.append(rest[:max_length])
                    rest = rest[max_length:]
            elif current and (len(current) + len(line) + 1 > max_length):
                chunks.append(current)
                current = line
            else:
                current = f"{current}\n{line}" if current else line
        if current:
            chunks.append(current)
        return chunks

    @staticmethod
    async def translate_chunk(
        client: httpx.AsyncClient,
        chunk: str,
        api_key: str,
        from_lang: str,
        to_lang: str,
        retry_count: int = 2,
    ) -> str:
        """翻譯單一區塊"""
        target = _to_google_lang(to_lang)
        source = _to_google_lang(from_lang) if from_lang and from_lang != "auto" else None
        url = "https://translation.googleapis.com/language/translate/v2"
        params = {"key": api_key}
        body = {"q": [chunk], "target": target, "format": "text"}
        if source:
            body["source"] = source

        for attempt in range(retry_count):
            try:
                resp = await client.post(url, params=params, json=body, timeout=15.0)
                if resp.status_code != 200:
                    if attempt < retry_count - 1:
                        await asyncio.sleep(1)
                        continue
                    err = resp.text
                    try:
                        data = resp.json()
                        err = data.get("error", {}).get("message", err)
                    except Exception:
                        pass
                    raise Exception(f"Google 翻译: 请求失败 ({resp.status_code}) {err}")

                data = resp.json()
                trans = data.get("data", {}).get("translations")
                if not trans or not trans[0].get("translatedText"):
                    raise Exception("Google 翻译: 返回结果为空")
                return trans[0]["translatedText"]

            except (httpx.HTTPError, asyncio.TimeoutError) as e:
                if attempt < retry_count - 1:
                    print(f"\r{WARN_PREFIX} Google 翻译请求重试 ({attempt + 1}/{retry_count}): {e}")
                    await asyncio.sleep(1)
                else:
                    raise Exception(f"Google 翻译: 网络请求失败 ({type(e).__name__})")
        raise Exception("Google 翻译: 超过最大重试次数")

    @staticmethod
    async def _translate_with_googletrans(
        text: str,
        from_lang: str,
        to_lang: str,
        pbar: Optional[ProgressBar] = None,
        cancel_event: Optional[asyncio.Event] = None,
    ) -> dict:
        """
        使用 googletrans 免費庫進行翻譯（備選方案）
        支持長文本分段翻譯
        """
        if not GOOGLETRANS_AVAILABLE:
            return {
                "success": False,
                "error": "Google 翻译: googletrans 庫未安裝，請運行 pip install googletrans==4.0.0rc1"
            }

        try:
            # googletrans 語言碼映射
            lang_map = {
                "zh": "zh-cn",
                "en": "en",
                "auto": "auto"
            }
            src_lang = lang_map.get(from_lang, from_lang) if from_lang != "auto" else "auto"
            dest_lang = lang_map.get(to_lang, to_lang)

            # 分段處理長文本（googletrans 單次請求限制約 5000 字符）
            chunks = GoogleTranslateService.split_text_by_paragraphs(text, max_length=4500)
            if not chunks:
                chunks = [text]

            translated_parts = []
            start_time = time.perf_counter()

            # 在線程池中執行同步的 googletrans 調用
            def _sync_translate_chunk(chunk_text):
                translator = Translator()
                result = translator.translate(chunk_text, src=src_lang, dest=dest_lang)
                return result.text

            # 串行翻譯每個區塊
            for i, chunk in enumerate(chunks):
                # 檢查中斷
                try:
                    from server import PromptServer
                    if cancel_event and cancel_event.is_set():
                        if pbar:
                            pbar.cancel(f"{WARN_PREFIX} 任务被中断 | 服务:Google 翻译 (googletrans)")
                        return {"success": False, "error": "任务被中断", "interrupted": True}
                    if hasattr(PromptServer, "instance") and getattr(PromptServer.instance, "execution_interrupted", False):
                        if pbar:
                            pbar.cancel(f"{WARN_PREFIX} 任务被中断 | 服务:Google 翻译 (googletrans)")
                        return {"success": False, "error": "任务被中断", "interrupted": True}
                except Exception:
                    pass

                # 執行翻譯
                if hasattr(asyncio, "to_thread"):
                    translated_chunk = await asyncio.to_thread(_sync_translate_chunk, chunk)
                else:
                    loop = asyncio.get_event_loop()
                    translated_chunk = await loop.run_in_executor(None, _sync_translate_chunk, chunk)

                translated_parts.append(translated_chunk)

                # 避免請求過快
                if i < len(chunks) - 1:
                    await asyncio.sleep(0.5)

            translated_text = "\n".join(translated_parts)
            elapsed = int((time.perf_counter() - start_time) * 1000)

            if pbar:
                pbar.done(char_count=len(translated_text), elapsed_ms=elapsed)

            return {
                "success": True,
                "data": {
                    "translated": translated_text,
                    "from": from_lang,
                    "to": to_lang,
                    "original": text,
                },
            }
        except asyncio.CancelledError:
            if pbar:
                pbar.cancel(f"{WARN_PREFIX} 任务被外部取消 | 服务:Google 翻译 (googletrans)")
            return {"success": False, "error": "任务被取消", "interrupted": True}
        except Exception as e:
            error_msg = str(e)
            if pbar:
                pbar.error(error_msg)
            return {
                "success": False,
                "error": f"Google 翻译 (googletrans): {error_msg}"
            }

    @staticmethod
    async def translate(
        text: str,
        from_lang: str = "auto",
        to_lang: str = "zh",
        request_id: Optional[str] = None,
        is_auto: bool = False,
        cancel_event: Optional[asyncio.Event] = None,
        task_type: Optional[str] = None,
        source: Optional[str] = None,
    ):
        """
        非流式調用 Google 翻譯。
        優先使用 Google Cloud Translation API v2（需 API Key），
        若無 API Key 則使用 googletrans 免費庫。
        返回格式與 BaiduTranslateService 一致。
        """
        from ..config_manager import config_manager
        from ..server import is_streaming_progress_enabled

        request_id = request_id or f"google_trans_{int(time.time())}_{random.randint(1000, 9999)}"
        if not text or not text.strip():
            return {"success": False, "error": "Google 翻译: 待翻译文本不能为空"}

        config = config_manager.get_google_translate_config()
        api_key = (config or {}).get("api_key", "").strip()

        # 如果沒有 API Key，使用 googletrans 備選方案
        if not api_key:
            if not GOOGLETRANS_AVAILABLE:
                return {
                    "success": False,
                    "error": "Google 翻译: 未配置 API Key 且 googletrans 庫未安裝。請在 API 管理中配置 Google 翻譯的 API Key，或運行 pip install googletrans==4.0.0rc1"
                }

            # 使用 googletrans
            task_type = task_type or TASK_TRANSLATE
            pbar = ProgressBar(
                request_id=request_id,
                service_name="Google 翻译 (googletrans)",
                streaming=is_streaming_progress_enabled(),
                extra_info=f"长度:{len(text)}",
                task_type=task_type,
                source=source,
            )
            return await GoogleTranslateService._translate_with_googletrans(
                text, from_lang, to_lang, pbar, cancel_event
            )

        task_type = task_type or TASK_TRANSLATE
        chunks = GoogleTranslateService.split_text_by_paragraphs(text)
        if not chunks:
            chunks = [text]

        translated_parts = []
        pbar = ProgressBar(
            request_id=request_id,
            service_name="Google 翻译",
            streaming=is_streaming_progress_enabled(),
            extra_info=f"长度:{len(text)}",
            task_type=task_type,
            source=source,
        )
        start = time.perf_counter()

        try:
            async with httpx.AsyncClient(timeout=15.0) as http_client:
                for i, chunk in enumerate(chunks):
                    try:
                        from server import PromptServer
                        if cancel_event and cancel_event.is_set():
                            pbar.cancel(f"{WARN_PREFIX} 任务被中断 | 服务:Google 翻译")
                            return {"success": False, "error": "任务被中断", "interrupted": True}
                        if hasattr(PromptServer, "instance") and getattr(PromptServer.instance, "execution_interrupted", False):
                            pbar.cancel(f"{WARN_PREFIX} 任务被中断 | 服务:Google 翻译")
                            return {"success": False, "error": "任务被中断", "interrupted": True}
                    except Exception:
                        pass

                    part = await GoogleTranslateService.translate_chunk(
                        http_client, chunk, api_key, from_lang, to_lang
                    )
                    translated_parts.append(part)
                    if i < len(chunks) - 1:
                        await asyncio.sleep(0.3)
            translated_text = "\n".join(translated_parts)
            elapsed = int((time.perf_counter() - start) * 1000)
            pbar.done(char_count=len(translated_text), elapsed_ms=elapsed)
            return {
                "success": True,
                "data": {
                    "translated": translated_text,
                    "from": from_lang,
                    "to": to_lang,
                    "original": text,
                },
            }
        except asyncio.CancelledError:
            if "pbar" in locals() and pbar:
                pbar.cancel(f"{WARN_PREFIX} 任务被外部取消 | 服务:Google 翻译")
            return {"success": False, "error": "任务被取消", "interrupted": True}
        except Exception as e:
            if "pbar" in locals() and pbar:
                pbar.error(str(e))
            return {"success": False, "error": str(e)}

    @staticmethod
    async def batch_translate(texts: list, from_lang: str = "auto", to_lang: str = "zh"):
        """批量翻譯，串行調用"""
        results = []
        for t in texts:
            r = await GoogleTranslateService.translate(t, from_lang, to_lang)
            results.append(r)
        return results
