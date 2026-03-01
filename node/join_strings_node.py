# -*- coding: utf-8 -*-
"""
Join Strings 節點
接收多個 STRING 輸入，以可選分隔符合併為一個 STRING 輸出。
常與多個 String Block (Prompt Block) 搭配使用。
"""


class JoinStrings:
    """
    將多個字串以分隔符 join 成一個字串。
    空輸入會略過或依需求保留為空段。
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "separator": ("STRING", {
                    "default": ", ",
                    "multiline": False,
                    "tooltip": "合併時使用的分隔符",
                }),
            },
            "optional": {
                "text_1": ("STRING", {"default": "", "forceInput": True}),
                "text_2": ("STRING", {"default": "", "forceInput": True}),
                "text_3": ("STRING", {"default": "", "forceInput": True}),
                "text_4": ("STRING", {"default": "", "forceInput": True}),
                "text_5": ("STRING", {"default": "", "forceInput": True}),
                "text_6": ("STRING", {"default": "", "forceInput": True}),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("STRING",)
    FUNCTION = "join"
    CATEGORY = "✨Prompt Assistant"
    OUTPUT_NODE = False

    def join(self, separator, text_1="", text_2="", text_3="", text_4="", text_5="", text_6=""):
        parts = [t for t in (text_1, text_2, text_3, text_4, text_5, text_6) if t is not None]
        result = (separator or ", ").join(parts)
        return (result,)


NODE_CLASS_MAPPINGS = {
    "JoinStrings": JoinStrings,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "JoinStrings": "Join Strings",
}
