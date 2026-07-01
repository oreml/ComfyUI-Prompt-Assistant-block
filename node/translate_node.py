import asyncio
import random
import re
import time
import threading
import hashlib

import torch
from comfy.model_management import InterruptProcessingException

from ..services.llm import LLMService
from ..services.baidu import BaiduTranslateService
from ..services.google import GoogleTranslateService
from ..services.argos import ArgosTranslateService
from ..utils.common import format_api_error, format_model_with_thinking, generate_request_id, log_prepare, log_error, TASK_TRANSLATE, SOURCE_NODE
from ..services.thinking_control import build_thinking_suppression
from .base import LLMNodeBase


class PromptTranslate(LLMNodeBase):
    """
    提示詞翻譯節點
    自動識別輸入語言並翻譯成目標語言，支援多種翻譯服務
    """

    @classmethod
    def INPUT_TYPES(cls):
        # ---動態獲取翻譯服務/模型列表(Google 翻譯為首選)---
        service_options = cls.get_translate_service_options()
        default_service = service_options[0] if service_options else "Google 翻譯"
        
        return {
            "required": {
                "source_text": ("STRING", {"forceInput": True, "default": "", "multiline": True, "placeholder": "Input text to translate...", "tooltip": "需要翻譯的文本; 💡輸入觸發詞[R],可以讓節點每次都被執行"}),
                "target_language": (["English", "Chinese"], {"default": "English"}),
                "translate_service": (service_options, {"default": default_service, "tooltip": "Select translation service and model"}),
                # Ollama Automatic VRAM Unload
                "ollama_auto_unload": ("BOOLEAN", {"default": True, "label_on": "Enable", "label_off": "Disable", "tooltip": "Auto unload Ollama model after generation"}),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("translated_text",)
    FUNCTION = "translate"
    CATEGORY = "✨Prompt Assistant"
    OUTPUT_NODE = False
    
    @classmethod
    def IS_CHANGED(cls, source_text=None, target_language=None, translate_service=None, ollama_auto_unload=None, unique_id=None):
        """
        只在輸入內容真正變化時才觸發重新執行
        使用輸入參數的哈希值作為判斷依據
        """
        # 檢查是否包含強制刷新符號 [R]
        if cls._check_is_changed_bypass(source_text):
            return float("nan")

        # 計算文本的哈希值
        text_hash = ""
        if source_text:
            # 使用hashlib計算文本的哈希值，更安全和一致
            text_hash = hashlib.md5(source_text.encode('utf-8')).hexdigest()

        # 組合所有輸入的哈希值
        input_hash = hash((
            text_hash,
            target_language,
            translate_service,
            bool(ollama_auto_unload)
        ))

        return input_hash

    def _contains_chinese(self, text: str) -> bool:
        """檢查文本是否包含中文字符"""
        if not text:
            return False
        return bool(re.search('[\u4e00-\u9fa5]', text))

    def _detect_language(self, text: str) -> str:
        """自動檢測文本語言"""
        if not text:
            return "auto"

        # 檢查是否為純英文 (只包含ASCII可打印字符)
        is_pure_english = bool(re.fullmatch(r'[ -~]+', text))
        # 檢查是否包含中文字符
        contains_chinese = self._contains_chinese(text)

        if contains_chinese:
            return "zh"
        elif is_pure_english:
            return "en"
        else:
            return "auto"
    
    def translate(self, source_text, target_language, translate_service, ollama_auto_unload, unique_id=None):
        """
        翻譯文本函數
        """
        request_id = None  # 提升到方法級別作用域
        try:
            # 檢查輸入
            if not source_text or not source_text.strip():
                return ("",)

            # 自動檢測源語言
            detected_lang = self._detect_language(source_text)
            to_lang = "en" if target_language == "English" else "zh"

            # 智能跳過翻譯邏輯
            skip_translation = False
            if to_lang == 'en' and detected_lang == 'en':
                from ..utils.common import _ANSI_CLEAR_EOL
                print(f"\r{_ANSI_CLEAR_EOL}{self.REQUEST_PREFIX} 檢測到英文輸入，目標為英文，無需翻譯", flush=True)
                skip_translation = True
            elif to_lang == 'zh' and detected_lang == 'zh':
                from ..utils.common import _ANSI_CLEAR_EOL
                print(f"\r{_ANSI_CLEAR_EOL}{self.REQUEST_PREFIX} 檢測到中文輸入，目標為中文，無需翻譯", flush=True)
                skip_translation = True

            if skip_translation:
                return (source_text,)

            # 映射語言名稱
            lang_map = {'zh': '中文', 'en': '英文', 'auto': '原文'}
            from_lang_name = lang_map.get(detected_lang, detected_lang)
            to_lang_name = lang_map.get(to_lang, to_lang)
            
            # ---解析服務/模型字符串---
            service_id, model_name = self.parse_service_model(translate_service)
            if not service_id:
                raise ValueError(f"Invalid service selection: {translate_service}")
            
            # ---Google 翻譯---
            if service_id == 'google':
                request_id, result = self._translate_with_google(source_text, detected_lang, to_lang, translate_service, from_lang_name, to_lang_name, unique_id)
            # ---百度翻譯---
            elif service_id == 'baidu':
                request_id, result = self._translate_with_baidu(source_text, detected_lang, to_lang, translate_service, from_lang_name, to_lang_name, unique_id)
            elif service_id == 'argos':
                request_id, result = self._translate_with_argos(source_text, detected_lang, to_lang, translate_service, from_lang_name, to_lang_name, unique_id)
            else:
                # ---LLM翻譯:獲取服務配置---
                from ..config_manager import config_manager
                service = config_manager.get_service(service_id)
                if not service:
                    raise ValueError(f"Service config not found: {translate_service}")
                
                request_id, result = self._translate_with_llm(source_text, detected_lang, to_lang, service_id, model_name, service, translate_service, from_lang_name, to_lang_name, ollama_auto_unload, unique_id)

            if result and result.get('success'):
                translated_text = result.get('data', {}).get('translated', '').strip()
                if not translated_text:
                    error_msg = 'API returned empty result'
                    raise RuntimeError(f"❌Translation failed: {error_msg}")

                # 結果階段日誌由服務層統一輸出，節點層不再重複打印
                return (translated_text,)
            else:
                error_msg = result.get('error', 'Unknown error') if result else 'No result returned'
                # 如果是中斷錯誤,直接拋出InterruptProcessingException,不打印日誌(由基類打印)
                if error_msg == "任務被中斷":
                    raise InterruptProcessingException()
                log_error(TASK_TRANSLATE, request_id, error_msg)
                raise RuntimeError(f"Translation failed: {error_msg}")

        except InterruptProcessingException:
            # 不打印日志,由基类统一打印
            raise
        except Exception as e:
            error_msg = format_api_error(e, translate_service)
            log_error(TASK_TRANSLATE, request_id, error_msg)
            raise RuntimeError(f"Translation error: {error_msg}")

    def _translate_with_google(self, text, from_lang, to_lang, service_name, from_lang_name, to_lang_name, unique_id):
        """使用 Google 翻譯服務"""
        request_id = generate_request_id("trans", "google", unique_id)
        log_prepare(TASK_TRANSLATE, request_id, SOURCE_NODE, "Google 翻譯", None, None, {"方向": f"{from_lang_name}→{to_lang_name}", "長度": len(text)})
        result = self._run_llm_task(
            GoogleTranslateService.translate,
            service_name,
            text=text,
            from_lang=from_lang,
            to_lang=to_lang,
            request_id=request_id,
            task_type=TASK_TRANSLATE,
            source=SOURCE_NODE
        )
        return request_id, result

    def _translate_with_baidu(self, text, from_lang, to_lang, service_name, from_lang_name, to_lang_name, unique_id):
        """使用百度翻譯服務"""
        # 創建請求ID
        request_id = generate_request_id("trans", "baidu", unique_id)
        
        # 準備階段日誌
        log_prepare(TASK_TRANSLATE, request_id, SOURCE_NODE, "百度翻譯", None, None, {"方向": f"{from_lang_name}→{to_lang_name}", "長度": len(text)})
        
        # 執行翻譯（異步線程 + 可中斷）
        result = self._run_llm_task(
            BaiduTranslateService.translate,
            service_name,
            text=text,
            from_lang=from_lang,
            to_lang=to_lang,
            request_id=request_id,
            task_type=TASK_TRANSLATE,
            source=SOURCE_NODE
        )

        return request_id, result

    def _translate_with_argos(self, text, from_lang, to_lang, service_name, from_lang_name, to_lang_name, unique_id):
        """使用 Argos Translate 本地翻譯"""
        request_id = generate_request_id("trans", "argos", unique_id)
        log_prepare(TASK_TRANSLATE, request_id, SOURCE_NODE, "Argos Translate", None, None, {"方向": f"{from_lang_name}→{to_lang_name}", "長度": len(text)})
        result = self._run_llm_task(
            ArgosTranslateService.translate,
            service_name,
            text=text,
            from_lang=from_lang,
            to_lang=to_lang,
            request_id=request_id,
            task_type=TASK_TRANSLATE,
            source=SOURCE_NODE
        )
        return request_id, result

    def _translate_with_llm(self, text, from_lang, to_lang, service_id, model_name, service, service_display_name, from_lang_name, to_lang_name, auto_unload, unique_id):
        """使用LLM翻譯服務"""
        # ---構建provider_config---
        # 查找指定的模型或默認模型
        llm_models = service.get('llm_models', [])
        target_model = None
        
        if model_name:
            # 查找指定的模型
            target_model = next((m for m in llm_models if m.get('name') == model_name), None)
        
        if not target_model:
            # 使用默認模型或第一個模型
            target_model = next((m for m in llm_models if m.get('is_default')), 
                                llm_models[0] if llm_models else None)
        
        if not target_model:
            return {"success": False, "error": f"Service {service_display_name} has no available models"}
        
        # 構建配置對象
        provider_config = {
            'provider': service_id,
            'model': target_model.get('name', ''),
            'base_url': service.get('base_url', ''),
            'api_key': service.get('api_key', ''),
            'temperature': target_model.get('temperature', 0.7),
            'max_tokens': target_model.get('max_tokens', 1000),
            'top_p': target_model.get('top_p', 0.9),
        }
        
        # Ollama特殊處理:添加auto_unload配置
        if service.get('type') == 'ollama':
            provider_config['auto_unload'] = auto_unload

        # 創建請求ID
        request_id = generate_request_id("trans", "llm", unique_id)
        
        # 檢查是否關閉思維鏈
        model_full_name = provider_config.get('model')
        disable_thinking_enabled = service.get('disable_thinking', True)
        thinking_extra = build_thinking_suppression(service_id, model_full_name) if disable_thinking_enabled else None
        model_display = format_model_with_thinking(model_full_name, bool(thinking_extra))
        
        # 獲取服務顯示名稱
        service_display_name = service.get('name', service_id)
        
        # 準備階段日誌
        log_prepare(TASK_TRANSLATE, request_id, SOURCE_NODE, service_display_name, model_display, None, {"方向": f"{from_lang_name}→{to_lang_name}", "長度": len(text)})
        
        # 檢查API密鑰和模型
        api_key = provider_config.get('api_key', '')
        model = provider_config.get('model', '')
        
        if not api_key or not model:
            return {"success": False, "error": f"Please configure API key and model for {service_display_name}"}

        # 執行翻譯（異步線程 + 可中斷）
        result = self._run_llm_task(
            LLMService.translate,
            service_id,
            text=text,
            from_lang=from_lang,
            to_lang=to_lang,
            request_id=request_id,
            stream_callback=None,
            custom_provider=service_id,
            custom_provider_config=provider_config,
            task_type=TASK_TRANSLATE,
            source=SOURCE_NODE
        )

        return request_id, result


# 节点映射，用于向ComfyUI注册节点
NODE_CLASS_MAPPINGS = {
    "PromptTranslate": PromptTranslate,
}

# 节点显示名称映射
NODE_DISPLAY_NAME_MAPPINGS = {
    "PromptTranslate": "✨Prompt Translate",
}
