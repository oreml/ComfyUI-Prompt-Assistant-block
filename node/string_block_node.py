# -*- coding: utf-8 -*-
"""
String Block (Prompt) 節點
僅 STRING 進/出，無 CLIP。歸類在 ✨Prompt Assistant，
輸入文字下方可由前端掛載可拖動 grid，供角色、動作等單獨編輯後再接到 Join Strings。
"""


class StringBlockPromptBlock:
    """
    String Block（提示詞片段）Block
    單一 STRING 輸入、輸出，可與其他 String Block 一起接到 Join Strings 節點合併使用。
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "text": ("STRING", {
                    "multiline": True,
                    "default": "",
                    "placeholder": "Enter text (e.g. character, action)...",
                    "tooltip": "此段的提示詞文字（如角色、動作等），下方可掛載 grid 編輯",
                }),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("STRING",)
    FUNCTION = "pass_through"
    CATEGORY = "✨Prompt Assistant"
    OUTPUT_NODE = False

    def pass_through(self, text):
        return (text or "",)


NODE_CLASS_MAPPINGS = {
    "StringBlockPromptBlock": StringBlockPromptBlock,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "StringBlockPromptBlock": "String Block (Prompt Block)",
}
