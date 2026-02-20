# -*- coding: utf-8 -*-
"""
CLIP Text Encode (Prompt) Block 節點
與 ComfyUI 內建 CLIPTextEncode 行為一致，將文字提示編碼為 CONDITIONING。
歸類在 ✨Prompt Assistant，輸入文字下方可由前端掛載可拖動 grid。
"""


class CLIPTextEncodePromptBlock:
    """
    CLIP 文字編碼（提示詞）Block
    輸入 CLIP 模型與文字，輸出 CONDITIONING 供後續採樣使用。
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "text": ("STRING", {
                    "multiline": True,
                    "default": "",
                    "placeholder": "Enter your prompt...",
                    "tooltip": "要編碼的提示詞文字",
                }),
                "clip": ("CLIP", {
                    "tooltip": "用於編碼的 CLIP 模型（通常來自 Checkpoint Loader 或 CLIP Loader）",
                }),
            },
        }

    RETURN_TYPES = ("CONDITIONING",)
    RETURN_NAMES = ("CONDITIONING",)
    FUNCTION = "encode"
    CATEGORY = "✨Prompt Assistant"
    OUTPUT_NODE = False

    def encode(self, clip, text):
        if clip is None:
            raise RuntimeError(
                "CLIP 輸入無效（為 None）。\n"
                "若 CLIP 來自 Checkpoint Loader，請確認該 checkpoint 包含有效的 CLIP/文字編碼器。"
            )
        tokens = clip.tokenize(text)
        # 相容新舊 ComfyUI：優先使用 encode_from_tokens_scheduled
        encode_fn = getattr(clip, "encode_from_tokens_scheduled", None) or getattr(clip, "encode_from_tokens", None)
        if encode_fn is None:
            raise RuntimeError("此 CLIP 實例不支援 encode_from_tokens_scheduled 或 encode_from_tokens")
        conditioning = encode_fn(tokens)
        return (conditioning,)


NODE_CLASS_MAPPINGS = {
    "CLIPTextEncodePromptBlock": CLIPTextEncodePromptBlock,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "CLIPTextEncodePromptBlock": "CLIP Text Encode (Prompt Block)",
}
