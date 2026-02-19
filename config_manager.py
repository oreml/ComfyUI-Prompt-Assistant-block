import os
import json
import csv
import tempfile
import shutil
import folder_paths

class ConfigManager:
    # 預設服務商ID列表（不可刪除）
    PRESET_SERVICE_IDS = ['openrouter', 'zhipu', 'xFlow', 'ollama']
    def __init__(self):
        # 插件目录
        self.dir_path = os.path.dirname(os.path.abspath(__file__))
        
        # 获取 ComfyUI 用户目录
        try:
            user_dir = folder_paths.get_user_directory()
            if user_dir and os.path.isdir(user_dir):
                # 使用 user/default/prompt-assistant 作为基础目录
                self.base_dir = os.path.join(user_dir, "default", "prompt-assistant")
                # self._log(f"使用用户配置目录: {self.base_dir}")
            else:
                # 回退到插件目录
                self.base_dir = self.dir_path
                self._log(f"回退到插件配置目录: {self.base_dir}")
        except Exception as e:
            # 异常处理，回退到插件目录
            self.base_dir = self.dir_path
            self._log(f"无法获取用户目录({str(e)})，使用插件配置目录")
        
        # 定义各个子目录
        self.config_dir = os.path.join(self.base_dir, "config")
        self.rules_dir = os.path.join(self.base_dir, "rules")
        self.tags_dir = os.path.join(self.base_dir, "tags")
        
        # 确保目录存在
        os.makedirs(self.config_dir, exist_ok=True)
        os.makedirs(self.rules_dir, exist_ok=True)
        os.makedirs(self.tags_dir, exist_ok=True)

        # 配置文件路径（用户配置和选择）
        self.config_path = os.path.join(self.config_dir, "config.json")
        self.active_prompts_path = os.path.join(self.config_dir, "active_prompts.json")
        self.tags_user_path = os.path.join(self.config_dir, "tags_user.json")
        self.tags_selection_path = os.path.join(self.config_dir, "tags_selection.json")
        
        # 规则文件路径（规则定义和模板）
        self.system_prompts_path = os.path.join(self.rules_dir, "system_prompts.json")
        self.kontext_presets_path = os.path.join(self.rules_dir, "kontext_presets.json")

        # ---模板目录（插件内置）---
        self.templates_dir = os.path.join(self.dir_path, "config")
        
        # 存储模板版本号（用于版本比对）
        self._template_versions = {}

        # ---加载默认配置（从模板文件）---
        self.default_config = self._load_template("config", {"version": "2.0", "model_services": []})
        self.default_system_prompts = self._load_template("system_prompts", {})
        self.default_kontext_presets = self._load_template("kontext_presets", {})
        
        # ---简单默认配置（无需模板，直接定义）---
        self.default_active_prompts = {
            "expand": "expand_扩写-通用",
            "vision_zh": "vision_zh_图像描述-Tag风格",
            "vision_en": "vision_en_Detail_Caption"
        }
        self.default_user_tags = {"favorites": []}
        
        # 默认标签选择
        self.default_tags_selection = {"selected_file": "用户标签.csv"}



        # 执行数据迁移和配置文件初始化
        # migration_tool 统一处理：确保文件存在 -> CSV标签迁移 -> 旧版迁移 -> 增量更新
        self._run_migrations()

        # 验证并修复激活提示词（静默模式，仅异常时修复）
        self.validate_and_fix_active_prompts()

        # 验证并修复模型参数配置
        self.validate_and_fix_model_params()

    # --- 数据迁移 ---
    def _run_migrations(self):
        """
        执行数据迁移（按需调用，不影响性能）
        仅在需要时才导入和运行迁移工具
        """
        try:
            from .utils.migration_tool import run_migrations
            
            # 准备默认配置数据用于增量更新
            default_configs = {
                'config': self.default_config,
                'system_prompts': self.default_system_prompts,
                'active_prompts': self.default_active_prompts,
                'tags_user': self.default_user_tags,
                'kontext_presets': self.default_kontext_presets
            }
            
            # 运行迁移
            results = run_migrations(
                plugin_dir=self.dir_path,
                user_base_dir=self.base_dir,
                logger=self._log,
                default_configs=default_configs
            )
            
            # 记录迁移结果
            if results.get('tags_migration'):
                self._log("[用户标签.csv] 数据迁移完成")
                
        except Exception as e:
            self._log(f"数据迁移失败: {str(e)}")
            # 迁移失败不影响正常运行，仅记录日志

    # --- 统一日志输出 ---
    def _log(self, msg: str):
        """统一控制台日志前缀"""
        from .utils.common import _ANSI_CLEAR_EOL
        print(f"\r{_ANSI_CLEAR_EOL}✨ {msg}", flush=True)

    # ---模板加载---
    def _load_template(self, template_name: str, fallback: dict = None) -> dict:
        """
        从模板文件加载默认配置
        
        参数:
            template_name: 模板名称（不含扩展名和_template后缀）
            fallback: 加载失败时的回退默认值
            
        返回:
            配置字典（包含 __config_version 用于版本管理）
        """
        template_path = os.path.join(self.templates_dir, f"{template_name}_template.json")
        try:
            with open(template_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                # 获取版本号并保存，用于后续比对
                template_version = data.get("__config_version", "2.0")
                self._template_versions[template_name] = template_version
                return data
        except Exception as e:
            self._log(f"加载模板 {template_name} 失败: {str(e)}，使用回退值")
            # 确保 fallback 也包含版本号
            if fallback is None:
                fallback = {}
            # 如果 fallback 没有版本号，添加默认版本号
            if "__config_version" not in fallback:
                fallback = {"__config_version": "2.0", **fallback}
            self._template_versions[template_name] = "2.0"
            return fallback

    def _get_config_version(self, config: dict) -> str:
        """
        获取配置版本号（兼容新旧两种版本字段）
        
        版本字段优先级:
        1. __config_version (新版本字段，如 "2.0.0")
        2. version (旧版本字段，如 "2.0" 或 "1.0")
        3. 默认返回 "1.0"（无版本字段视为最旧版本）
        
        返回:
            版本字符串，如 "2.0.0"、"2.0" 或 "1.0"
        """
        # 优先使用新版本字段
        if "__config_version" in config:
            return config["__config_version"]
        # 兼容旧版本字段
        return config.get("version", "1.0")
    
    def _is_v2_config(self, config: dict) -> bool:
        """
        检查配置是否为 v2.0 或更高版本
        
        返回:
        True 表示 v2.0 或更高版本 (1.9 也视为 v2 格式，用于增量测试)
        """
        version = self._get_config_version(config)
        try:
            v_float = float(version)
            return v_float >= 1.9
        except ValueError:
            # 如果不是数字（如 "2.0.0"），取主版本号比较
            major_version = version.split(".")[0]
            try:
                return int(major_version) >= 2
            except ValueError:
                return False

    # --- 注意：以下方法已迁移到 migration_tool.py ---
    # - _apply_migrated_api_keys
    # - _migrate_provider_to_service
    # - _create_or_update_custom_service
    # - _match_service_by_provider
    # - _check_and_add_missing_services
    # 配置文件的创建、迁移和增量更新统一由 migration_tool 处理


    def _atomic_write_json(self, file_path: str, data: dict) -> bool:
        """
        原子性写入 JSON 文件
        
        采用"写临时文件 + 原子性重命名"的策略，确保文件写入的原子性：
        - 如果写入成功，新文件会替换旧文件
        - 如果写入失败或被中断，旧文件保持不变
        
        参数:
            file_path: 目标文件路径
            data: 要保存的数据字典
            
        返回:
            bool: 保存成功返回 True，失败返回 False
        """
        temp_fd = None
        temp_path = None
        
        try:
            # ---步骤1：写入临时文件---
            # 在同一目录下创建临时文件（确保在同一文件系统，rename 才是原子的）
            temp_fd, temp_path = tempfile.mkstemp(
                dir=os.path.dirname(file_path),
                suffix='.tmp',
                prefix='.tmp_'
            )
            
            # 完整写入新配置到临时文件
            with os.fdopen(temp_fd, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
                temp_fd = None  # 文件已关闭，避免重复关闭
            
            # ---步骤2：原子性替换---
            # rename 操作是原子的，要么成功替换，要么失败不变
            shutil.move(temp_path, file_path)
            temp_path = None  # 已移动，避免清理时删除
            
            return True
            
        except Exception as e:
            self._log(f"原子性写入 JSON 文件失败 [{os.path.basename(file_path)}]: {str(e)}")
            return False
            
        finally:
            # 清理临时文件（如果写入失败）
            if temp_fd is not None:
                try:
                    os.close(temp_fd)
                except:
                    pass
            
            if temp_path is not None and os.path.exists(temp_path):
                try:
                    os.unlink(temp_path)
                except:
                    pass

    def load_config(self):
        """加载配置文件"""
        try:
            with open(self.config_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            self._log(f"加载配置文件失败: {str(e)}")
            return self.default_config

    def save_config(self, config):
        """保存配置文件"""
        return self._atomic_write_json(self.config_path, config)

    def load_system_prompts(self):
        """加载系统提示词配置"""
        try:
            with open(self.system_prompts_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            self._log(f"加载系统提示词配置失败: {str(e)}")
            return self.default_system_prompts

    def save_system_prompts(self, system_prompts):
        """保存系统提示词配置"""
        return self._atomic_write_json(self.system_prompts_path, system_prompts)

    def load_active_prompts(self):
        """加载激活的提示词配置"""
        try:
            with open(self.active_prompts_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            self._log(f"加载激活的提示词配置失败: {str(e)}")
            return self.default_active_prompts

    def save_active_prompts(self, active_prompts):
        """保存激活的提示词配置"""
        return self._atomic_write_json(self.active_prompts_path, active_prompts)

    def load_user_tags(self):
        """加载用户标签配置"""
        try:
            with open(self.tags_user_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            self._log(f"加载用户标签配置失败: {str(e)}")
            return self.default_user_tags

    def save_user_tags(self, user_tags):
        """保存用户标签配置"""
        return self._atomic_write_json(self.tags_user_path, user_tags)

    def load_kontext_presets(self):
        """加载Kontext预设配置"""
        try:
            with open(self.kontext_presets_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            self._log(f"加载Kontext预设配置失败: {str(e)}")
            return {}

    def save_kontext_presets(self, kontext_presets):
        """保存Kontext预设配置"""
        return self._atomic_write_json(self.kontext_presets_path, kontext_presets)



    # --- 注意：ensure_tags_csv_exists 和 CSV 标签迁移已迁移到 migration_tool.py ---



    def list_tags_files(self) -> list:
        """列出tags目录下所有CSV文件"""
        try:
            files = []
            for filename in os.listdir(self.tags_dir):
                if filename.endswith(".csv"):
                    files.append(filename)
            return sorted(files)
        except Exception as e:
            self._log(f"列出标签文件失败: {str(e)}")
            return []

    def load_tags_csv(self, filename: str) -> dict:
        """加载CSV标签文件，返回嵌套字典结构"""
        csv_path = os.path.join(self.tags_dir, filename)
        if not os.path.exists(csv_path):
            self._log(f"CSV文件不存在: {filename}")
            return {}
        
        # 尝试多种编码，优先尝试 utf-8-sig (Excel默认UTF-8)，然后是 gbk (Excel默认ANSI)，最后是 utf-8
        encodings = ['utf-8-sig', 'gbk', 'gb18030', 'utf-8']
        
        for encoding in encodings:
            try:
                result = {}
                with open(csv_path, "r", encoding=encoding, newline="") as f:
                    reader = csv.reader(f)
                    try:
                        header = next(reader, None)  # 跳过表头
                    except StopIteration:
                        return {} # 空文件
                    
                    for row in reader:
                        # 过滤无效行
                        if not row or not any(cell.strip() for cell in row):
                            continue
                            
                        # 至少需要两列：标签名, 标签值
                        if len(row) < 2:
                            continue
                        
                        tag_name = row[0].strip()
                        tag_value = row[1].strip()
                        
                        if not tag_name:
                            continue
                            
                        # 分类路径：从第3列开始，过滤空值
                        categories = [c.strip() for c in row[2:] if c.strip()]
                        
                        # 构建嵌套结构
                        current = result
                        for cat in categories:
                            if cat not in current or not isinstance(current[cat], dict):
                                current[cat] = {}
                            current = current[cat]
                        
                        # 处理空分类占位符：只创建分类结构，不添加标签
                        if tag_name == "__empty__" or tag_name == "__placeholder__":
                            continue
                        
                        # 添加标签
                        current[tag_name] = tag_value
                
                return result
            except UnicodeDecodeError:
                continue
            except Exception as e:
                self._log(f"加载CSV标签失败 ({encoding}): {str(e)}")
                continue
        
        self._log(f"无法加载CSV文件: {filename}，尝试了所有编码均失败")
        return {}

    def save_tags_csv(self, filename: str, tags: dict) -> bool:
        """保存标签数据到CSV文件"""
        csv_path = os.path.join(self.tags_dir, filename)
        
        try:
            rows = []
            max_depth = 0
            
            def extract_tags(obj, path: list):
                nonlocal max_depth
                # 确保 obj 是字典类型
                if not isinstance(obj, dict):
                    return
                
                # 如果是空分类（空字典），添加占位行
                if len(obj) == 0 and path:
                    # 使用 __empty__ 作为占位符标记空分类
                    rows.append(["__empty__", ""] + path)
                    max_depth = max(max_depth, len(path))
                    return
                
                for key, value in obj.items():
                    if isinstance(value, str):
                        rows.append([key, value] + path)
                        max_depth = max(max_depth, len(path))
                    elif isinstance(value, dict):
                        extract_tags(value, path + [key])
            
            # 提取所有标签
            extract_tags(tags, [])
            
            if not rows:
                self._log(f"保存CSV标签: 数据为空")
                # 如果数据为空，写入只含表头的文件或保持现状？
                # 通常为了防止误删，如果 tags 为空暂不操作或清空文件。
                # 这里选择写入表头：
                with open(csv_path, "w", encoding="utf-8-sig", newline="") as f:
                    writer = csv.writer(f)
                    writer.writerow(["标签名", "标签值"])
                return True

            # 动态构建表头
            header = ["标签名", "标签值"]
            for i in range(max_depth):
                num_zh = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"]
                suffix = num_zh[i] if i < len(num_zh) else str(i + 1)
                header.append(f"{suffix}级分类")
            
            with open(csv_path, "w", encoding="utf-8-sig", newline="") as f:
                writer = csv.writer(f)
                writer.writerow(header)
                for row in rows:
                    # 补齐长度以匹配表头
                    while len(row) < len(header):
                        row.append("")
                    # 确保 row 长度不超过表头（防御性）
                    writer.writerow(row[:len(header)])
            
            return True
        except Exception as e:
            self._log(f"保存CSV标签失败: {str(e)}")
            return False

    def get_tags_selection(self) -> dict:
        """获取用户选择的标签文件"""
        try:
            if os.path.exists(self.tags_selection_path):
                with open(self.tags_selection_path, "r", encoding="utf-8") as f:
                    return json.load(f)
            return self.default_tags_selection
        except Exception as e:
            self._log(f"读取标签选择失败: {str(e)}")
            return self.default_tags_selection

    def save_tags_selection(self, selection: dict) -> bool:
        """保存用户选择的标签文件"""
        try:
            with open(self.tags_selection_path, "w", encoding="utf-8") as f:
                json.dump(selection, f, ensure_ascii=False, indent=2)
            return True
        except Exception as e:
            self._log(f"保存标签选择失败: {str(e)}")
            return False

    def get_favorites(self) -> dict:
        """获取收藏列表"""
        user_tags = self.load_user_tags()
        favorites = user_tags.get("favorites", {})
        
        # 兼容性处理：如果是列表，转换为字典
        if isinstance(favorites, list):
            new_favorites = {}
            for item in favorites:
                if isinstance(item, str):
                    new_favorites[item] = item
                elif isinstance(item, dict):
                    name = item.get("name", item.get("value"))
                    value = item.get("value")
                    if name and value:
                        new_favorites[name] = value
            return new_favorites
            
        return favorites

    def add_favorite(self, tag_value: str, tag_name: str = None, category: str = "默认") -> bool:
        """添加收藏"""
        try:
            user_tags = self.load_user_tags()
            favorites = user_tags.get("favorites", {})
            
            # 兼容性迁移：如果是一维字典 {name: value}，无需强制迁移，但新添加的会放入 category
            # 如果是列表，先迁移为字典
            if isinstance(favorites, list):
                favorites = self.get_favorites()
                
            name = tag_name if tag_name else tag_value
            
            # 使用嵌套结构 {分类: {名称: 值}}
            if category not in favorites:
                # 检查是否存在旧的平铺结构，如果有，且category是默认，可能混杂
                # 这里简单处理：如果 favorites 只有键值对且都不是字典，说明是旧版平铺
                # 但为了不破坏旧数据，我们在顶层只存储分类字典
                # 如果 favorites 中已有非字典的值，说明是旧版平铺结构 {name: value}
                # 我们将它们移动到 "默认" 分类
                has_legacy = any(not isinstance(v, dict) for v in favorites.values())
                if has_legacy:
                    legacy_items = {k: v for k, v in favorites.items() if not isinstance(v, dict)}
                    # 清除旧项
                    for k in legacy_items:
                        del favorites[k]
                    # 初始化默认分类
                    if "默认" not in favorites:
                        favorites["默认"] = {}
                    favorites["默认"].update(legacy_items)
                
                if category not in favorites:
                    favorites[category] = {}

            # 如果 favorites[category] 不是字典（防御性编程），初始化为字典
            if not isinstance(favorites.get(category), dict):
                favorites[category] = {}

            favorites[category][name] = tag_value
            
            user_tags["favorites"] = favorites
            return self.save_user_tags(user_tags)
        except Exception as e:
            self._log(f"添加收藏失败: {str(e)}")
            return False

    def remove_favorite(self, tag_value: str, category: str = None) -> bool:
        """移除收藏"""
        try:
            user_tags = self.load_user_tags()
            favorites = user_tags.get("favorites", {})
            
            # 兼容性迁移
            if isinstance(favorites, list):
                favorites = self.get_favorites()
            
            removed = False
            
            # 如果指定了分类，只在指定分类中删除
            if category:
                # 尝试直接匹配分类（完全匹配）
                target_categories = [category]
                
                # 如果没找到，尝试模糊匹配（处理文件名后缀差异）
                if category not in favorites:
                    # 比如 category 是 "foo"，favorites里有 "foo.csv" 或相反
                    # 但通常 favorites 里的 key 已经是去后缀的
                    pass

                for cat in target_categories:
                    if cat in favorites and isinstance(favorites[cat], dict):
                        # 根据值删除
                        keys_to_remove = [k for k, v in favorites[cat].items() if v == tag_value]
                        for k in keys_to_remove:
                            del favorites[cat][k]
                            removed = True
                            
                        # 如果该分类空了，是否删除分类键？暂时保留
            else:
                # 未指定分类，递归全部删除（旧逻辑）
                # 如果是旧版平铺结构
                if any(not isinstance(v, dict) for v in favorites.values()):
                    keys_to_remove = [k for k, v in favorites.items() if not isinstance(v, dict) and v == tag_value]
                    for k in keys_to_remove:
                        del favorites[k]
                        removed = True
                
                # 如果是新版嵌套结构
                for cat, items in favorites.items():
                    if isinstance(items, dict):
                        keys_to_remove = [k for k, v in items.items() if v == tag_value]
                        for k in keys_to_remove:
                            del items[k]
                            removed = True
            
            if removed:
                user_tags["favorites"] = favorites
                return self.save_user_tags(user_tags)
                
            return True
        except Exception as e:
            self._log(f"移除收藏失败: {str(e)}")
            return False

    def get_system_prompts(self):
        """获取系统提示词配置 (合并提示词定义和激活状态)"""
        system_prompts = self.load_system_prompts()
        active_prompts = self.load_active_prompts()
        system_prompts['active_prompts'] = active_prompts
        return system_prompts

    def update_system_prompts(self, system_prompts):
        """更新系统提示词配置 (仅更新提示词定义)"""
        prompts_to_save = system_prompts.copy()
        if 'active_prompts' in prompts_to_save:
            del prompts_to_save['active_prompts']
        return self.save_system_prompts(prompts_to_save)

    def update_active_prompts(self, active_prompts):
        """更新所有激活的提示词"""
        return self.save_active_prompts(active_prompts)

    def update_active_prompt(self, prompt_type, prompt_id):
        """更新单个激活的提示词"""
        active_prompts = self.load_active_prompts()
        active_prompts[prompt_type] = prompt_id
        return self.save_active_prompts(active_prompts)

    def get_google_translate_config(self):
        """获取 Google 翻译配置"""
        config = self.load_config()
        return config.get("google_translate", self.default_config.get("google_translate", {"api_key": ""}))

    def get_baidu_translate_config(self):
        """获取百度翻译配置"""
        config = self.load_config()
        return config.get("baidu_translate", self.default_config.get("baidu_translate", {"app_id": "", "secret_key": ""}))

    def get_llm_config(self):
        """获取LLM配置"""
        config = self.load_config()
        current_service_info = config.get('current_services', {}).get('llm')
        
        # 适配新旧格式:支持字符串(旧)和字典(新)
        if isinstance(current_service_info, str):
            # 旧格式: "service_id"
            current_service_id = current_service_info
            current_model_name = None
        elif isinstance(current_service_info, dict):
            # 新格式: {"service": "service_id", "model": "model_name"}
            current_service_id = current_service_info.get('service')
            current_model_name = current_service_info.get('model')
        else:
            # 未设置
            current_service_id = None
            current_model_name = None
        
        if not current_service_id:
            # 没有选中的服务，返回默认结构
            return self._get_empty_llm_config()
        
        # 查找对应的服务
        service = self._get_service_by_id(current_service_id)
        if not service:
            return self._get_empty_llm_config()
        
        # 获取LLM模型列表
        llm_models = service.get('llm_models', [])
        
        # 如果指定了模型名称,尝试查找
        target_model = None
        if current_model_name:
            target_model = next((m for m in llm_models if m.get('name') == current_model_name), None)
        
        # 如果未找到指定模型,使用默认模型或第一个模型
        if not target_model:
            target_model = next((m for m in llm_models if m.get('is_default')), 
                                llm_models[0] if llm_models else None)
        
        if not target_model:
            return self._get_empty_llm_config()
        
        # 直接获取API Key（明文存储）
        api_key = service.get('api_key', '')
        
        # 返回配置
        return {
            "provider": service.get('id', ''),  # 使用service_id作为provider
            "model": target_model.get('name', ''),
            "base_url": service.get('base_url', ''),
            "api_key": api_key,
            "temperature": target_model.get('temperature', 0.7),
            "max_tokens": target_model.get('max_tokens', 1000),
            "top_p": target_model.get('top_p', 0.9),
            "auto_unload": service.get('auto_unload', True) if service.get('type') == 'ollama' else None,
            "providers": {}  # v2.0中不再使用此字段
        }

    
    def _get_empty_llm_config(self):
        """返回空的LLM配置"""
        return {
            "provider": "",
            "model": "",
            "base_url": "",
            "api_key": "",
            "temperature": 0.7,
            "max_tokens": 1000,
            "top_p": 0.9,
            "providers": {}
        }
    
    def _get_service_by_id(self, service_id: str) -> dict:
        """根据ID获取服务配置"""
        config = self.load_config()
        services = config.get('model_services', [])
        for service in services:
            if service.get('id') == service_id:
                return service
        return None

    def get_vision_config(self):
        """获取视觉模型配置"""
        config = self.load_config()
        current_service_info = config.get('current_services', {}).get('vlm')
        
        # 适配新旧格式:支持字符串(旧)和字典(新)
        if isinstance(current_service_info, str):
            # 旧格式: "service_id"
            current_service_id = current_service_info
            current_model_name = None
        elif isinstance(current_service_info, dict):
            # 新格式: {"service": "service_id", "model": "model_name"}
            current_service_id = current_service_info.get('service')
            current_model_name = current_service_info.get('model')
        else:
            # 未设置
            current_service_id = None
            current_model_name = None
        
        if not current_service_id:
            # 没有选中的服务，返回默认结构
            return self._get_empty_vision_config()
        
        # 查找对应的服务
        service = self._get_service_by_id(current_service_id)
        if not service:
            return self._get_empty_vision_config()
        
        # 获取VLM模型列表
        vlm_models = service.get('vlm_models', [])
        
        # 如果指定了模型名称,尝试查找
        target_model = None
        if current_model_name:
            target_model = next((m for m in vlm_models if m.get('name') == current_model_name), None)
        
        # 如果未找到指定模型,使用默认模型或第一个模型
        if not target_model:
            target_model = next((m for m in vlm_models if m.get('is_default')), 
                                vlm_models[0] if vlm_models else None)
        
        if not target_model:
            return self._get_empty_vision_config()
        
        # 直接获取API Key（明文存储）
        api_key = service.get('api_key', '')
        
        # 返回配置
        return {
            "provider": service.get('id', ''),  # 使用service_id作为provider
            "model": target_model.get('name', ''),
            "base_url": service.get('base_url', ''),
            "api_key": api_key,
            "temperature": target_model.get('temperature', 0.7),
            "max_tokens": target_model.get('max_tokens', 1024),
            "top_p": target_model.get('top_p', 0.9),
            "auto_unload": service.get('auto_unload', True) if service.get('type') == 'ollama' else None,
            "providers": {}  # v2.0中不再使用此字段
        }
    
    def _get_empty_vision_config(self):
        """返回空的视觉模型配置"""
        return {
            "provider": "",
            "model": "",
            "base_url": "",
            "api_key": "",
            "temperature": 0.7,
            "max_tokens": 1024,
            "top_p": 0.9,
            "providers": {}
        }

    def get_translate_config(self):
        """获取翻译服务配置（支持百度翻译和LLM翻译）"""
        config = self.load_config()
        current_service_info = config.get('current_services', {}).get('translate')
        
        # 适配新旧格式:支持字符串(旧)和字典(新)
        if isinstance(current_service_info, str):
            # 旧格式: "service_id"
            current_service_id = current_service_info
            current_model_name = None
        elif isinstance(current_service_info, dict):
            # 新格式: {"service": "service_id", "model": "model_name"}
            current_service_id = current_service_info.get('service')
            current_model_name = current_service_info.get('model')
        else:
            # 未设置，默认使用 Google 翻译
            current_service_id = 'google'
            current_model_name = None
        
        # Google 翻译特殊处理（使用独立的 google_translate 配置）
        if current_service_id == 'google':
            google_config = self.get_google_translate_config()
            return {
                "provider": "google",
                "model": "",
                "base_url": "",
                "api_key": google_config.get("api_key", ""),
                "temperature": 0.7,
                "max_tokens": 1000,
                "top_p": 0.9,
                "providers": {}
            }
        
        # 百度翻译特殊处理（使用独立的baidu_translate配置）
        if current_service_id == 'baidu':
            baidu_config = self.get_baidu_translate_config()
            return {
                "provider": "baidu",
                "model": "",
                "base_url": "",
                "api_key": baidu_config.get('app_id', ''),
                "secret_key": baidu_config.get('secret_key', ''),
                "temperature": 0.7,
                "max_tokens": 1000,
                "top_p": 0.9,
                "providers": {}
            }
        
        # 查找对应的LLM服务
        service = self._get_service_by_id(current_service_id)
        if not service:
            # 服务不存在，回退到 Google 翻译
            google_config = self.get_google_translate_config()
            return {
                "provider": "google",
                "model": "",
                "base_url": "",
                "api_key": google_config.get("api_key", ""),
                "temperature": 0.7,
                "max_tokens": 1000,
                "top_p": 0.9,
                "providers": {}
            }
        
        # 获取LLM模型列表
        llm_models = service.get('llm_models', [])
        
        # 如果指定了模型名称,尝试查找
        target_model = None
        if current_model_name:
            target_model = next((m for m in llm_models if m.get('name') == current_model_name), None)
        
        # 如果未找到指定模型,使用默认模型或第一个模型
        if not target_model:
            target_model = next((m for m in llm_models if m.get('is_default')), 
                                llm_models[0] if llm_models else None)
        
        if not target_model:
            # 没有可用模型，回退到 Google 翻译
            google_config = self.get_google_translate_config()
            return {
                "provider": "google",
                "model": "",
                "base_url": "",
                "api_key": google_config.get("api_key", ""),
                "temperature": 0.7,
                "max_tokens": 1000,
                "top_p": 0.9,
                "providers": {}
            }
        
        # 返回LLM翻译配置
        api_key = service.get('api_key', '')
        return {
            "provider": service.get('id', ''),
            "model": target_model.get('name', ''),
            "base_url": service.get('base_url', ''),
            "api_key": api_key,
            "temperature": target_model.get('temperature', 0.7),
            "max_tokens": target_model.get('max_tokens', 1000),
            "top_p": target_model.get('top_p', 0.9),
            "auto_unload": service.get('auto_unload', True) if service.get('type') == 'ollama' else None,
            "providers": {}
        }

    def get_settings(self):
        """获取ComfyUI用户设置（从设置文件读取）"""
        try:
            # ComfyUI的设置文件通常位于 user/default/comfy.settings.json
            # 需要找到ComfyUI的根目录
            import sys
            
            # 尝试从多个可能的路径查找设置文件
            possible_paths = []
            
            # 方法1: 通过当前文件路径向上查找
            current_dir = os.path.dirname(os.path.abspath(__file__))
            # custom_nodes/comfyui_prompt_assistant -> custom_nodes -> ComfyUI
            comfyui_root = os.path.dirname(os.path.dirname(current_dir))
            possible_paths.append(os.path.join(comfyui_root, "user", "default", "comfy.settings.json"))
            
            # 方法2: 通过sys.path查找
            for path in sys.path:
                if 'ComfyUI' in path:
                    possible_paths.append(os.path.join(path, "user", "default", "comfy.settings.json"))
            
            # 尝试读取设置文件
            for settings_path in possible_paths:
                if os.path.exists(settings_path):
                    try:
                        with open(settings_path, 'r', encoding='utf-8') as f:
                            settings_data = json.load(f)
                            # 返回设置数据
                            return settings_data
                    except Exception as e:
                        self._log(f"读取设置文件失败: {settings_path}, 错误: {str(e)}")
                        continue
            
            # 如果都找不到，返回空字典
            return {}
            
        except Exception as e:
            # 如果无法获取，返回空字典
            self._log(f"获取用户设置失败: {str(e)}")
            return {}

    def update_google_translate_config(self, api_key=None):
        """更新 Google 翻译配置"""
        config = self.load_config()
        if "google_translate" not in config:
            config["google_translate"] = {}
        if api_key is not None:
            config["google_translate"]["api_key"] = api_key
        return self.save_config(config)

    def update_baidu_translate_config(self, app_id=None, secret_key=None):
        """更新百度翻译配置"""
        config = self.load_config()
        if "baidu_translate" not in config:
            config["baidu_translate"] = {}

        # 仅更新提供的参数
        if app_id is not None:
            config["baidu_translate"]["app_id"] = app_id
        if secret_key is not None:
            config["baidu_translate"]["secret_key"] = secret_key

        return self.save_config(config)




    # --- 注意：validate_and_fix_system_prompts 已迁移到 migration_tool.py ---
    # 系统提示词的验证和补全由 migration_tool 的增量更新逻辑统一处理


    def validate_and_fix_active_prompts(self):
        """
        验证激活提示词是否存在，如果不存在则修复
        
        注意：此方法只修复 active_prompts.json（切换到存在的提示词）
        不会恢复 system_prompts.json 中被删除的内容（尊重用户的删除操作）
        """
        try:
            system_prompts = self.load_system_prompts()
            active_prompts = self.load_active_prompts()

            # 标记是否需要更新激活提示词
            modified = False

            # 检查并修复扩写提示词
            if "expand" in active_prompts:
                expand_id = active_prompts["expand"]
                expand_prompts = system_prompts.get("expand_prompts", {})
                
                if expand_id not in expand_prompts:
                    # 激活的提示词不存在，切换到第一个可用的
                    if expand_prompts:
                        first_expand_id = next(iter(expand_prompts))
                        active_prompts["expand"] = first_expand_id
                        self._log(f"激活的扩写提示词 '{expand_id}' 不存在，已切换到 '{first_expand_id}'")
                        modified = True
                    else:
                        # 没有可用的扩写提示词，清空激活
                        active_prompts["expand"] = ""
                        self._log(f"警告：没有可用的扩写提示词")
                        modified = True

            # 检查并修复中文反推提示词
            if "vision_zh" in active_prompts:
                vision_zh_id = active_prompts["vision_zh"]
                vision_prompts = system_prompts.get("vision_prompts", {})
                zh_prompts = {k: v for k, v in vision_prompts.items() if k.startswith("vision_zh_")}
                
                if vision_zh_id not in vision_prompts:
                    if zh_prompts:
                        first_id = next(iter(zh_prompts))
                        active_prompts["vision_zh"] = first_id
                        self._log(f"激活的中文反推提示词 '{vision_zh_id}' 不存在，已切换到 '{first_id}'")
                        modified = True
                    else:
                        active_prompts["vision_zh"] = ""
                        self._log(f"警告：没有可用的中文反推提示词")
                        modified = True

            # 检查并修复英文反推提示词
            if "vision_en" in active_prompts:
                vision_en_id = active_prompts["vision_en"]
                vision_prompts = system_prompts.get("vision_prompts", {})
                en_prompts = {k: v for k, v in vision_prompts.items() if k.startswith("vision_en_")}
                
                if vision_en_id not in vision_prompts:
                    if en_prompts:
                        first_id = next(iter(en_prompts))
                        active_prompts["vision_en"] = first_id
                        self._log(f"激活的英文反推提示词 '{vision_en_id}' 不存在，已切换到 '{first_id}'")
                        modified = True
                    else:
                        active_prompts["vision_en"] = ""
                        self._log(f"警告：没有可用的英文反推提示词")
                        modified = True

            # 如果需要更新，保存修复后的激活提示词
            if modified:
                self.save_active_prompts(active_prompts)
                self._log("已完成激活提示词的验证和修复")

        except Exception as e:
            self._log(f"验证激活提示词异常: {str(e)}")



    def validate_and_fix_model_params(self):
        """
        验证并修复模型参数配置
        注意: v2.0版本中，模型参数直接存储在 model_services 数组的模型对象中，
        这个方法主要用于确保配置文件存在和格式正确
        """
        try:
            config = self.load_config()
            
            # 确保是 v2.0 格式
            if not self._is_v2_config(config):
                self._log("[config.json] 警告: 检测到旧版本配置，请手动创建新的配置文件或使用默认配置")
                return
            
            # v2.0 格式中，参数已经在各个服务的模型列表中，无需额外验证
            # 如果需要补全缺失的服务或模型参数，应该在服务商管理API中处理
            
        except Exception as e:
            self._log(f"[config.json] 验证模型参数配置时出错: {str(e)}")


    # --- API Key 安全相关方法（方案A）---
    
    @staticmethod
    def mask_api_key(api_key: str) -> str:
        """
        掩码API Key，只显示首尾部分
        用于前端安全显示，防止API Key在Network中明文可见
        
        参数:
            api_key: 明文API Key
            
        返回:
            str: 掩码后的API Key
            
        示例:
            - sk-abc123xyz789 -> sk-abc***xyz789
            - 短Key (< 8字符) -> ***
            - 空字符串 -> ""
        """
        if not api_key:
            return ""
        if len(api_key) < 8:
            return "***"
        # 显示前6个字符和后4个字符
        return f"{api_key[:6]}***{api_key[-4:]}"
    
    def get_llm_config_masked(self):
        """
        获取LLM配置（API Key掩码版本）
        用于前端显示，不暴露完整API Key
        
        返回:
            Dict: LLM配置，api_key字段被掩码
        """
        config = self.get_llm_config()
        
        if 'api_key' in config:
            # 掩码API Key
            config['api_key_masked'] = self.mask_api_key(config['api_key'])
            config['api_key_exists'] = bool(config['api_key'])
            # 移除明文API Key
            del config['api_key']
        
        # 处理所有providers的API Key
        if 'providers' in config:
            for provider_name, provider_config in config['providers'].items():
                if 'api_key' in provider_config:
                    provider_config['api_key_masked'] = self.mask_api_key(provider_config['api_key'])
                    provider_config['api_key_exists'] = bool(provider_config['api_key'])
                    del provider_config['api_key']
        
        return config
    
    def get_vision_config_masked(self):
        """
        获取视觉模型配置（API Key掩码版本）
        用于前端显示，不暴露完整API Key
        
        返回:
            Dict: 视觉模型配置，api_key字段被掩码
        """
        config = self.get_vision_config()
        
        if 'api_key' in config:
            # 掩码API Key
            config['api_key_masked'] = self.mask_api_key(config['api_key'])
            config['api_key_exists'] = bool(config['api_key'])
            # 移除明文API Key
            del config['api_key']
        
        # 处理所有providers的API Key
        if 'providers' in config:
            for provider_name, provider_config in config['providers'].items():
                if 'api_key' in provider_config:
                    provider_config['api_key_masked'] = self.mask_api_key(provider_config['api_key'])
                    provider_config['api_key_exists'] = bool(provider_config['api_key'])
                    del provider_config['api_key']
        
        return config
    
    # --- 服务商管理方法（CRUD）---
    
    def get_all_services(self):
        """
        获取所有服务商列表
        
        返回:
            List[Dict]: 服务商列表
        """
        config = self.load_config()
        
        if self._is_v2_config(config):
            services = config.get('model_services', [])
            
            # 記錄載入的服務列表
            service_ids = [s.get('id', 'unknown') for s in services]
            service_names = [s.get('name', 'unknown') for s in services]
            self._log(f"載入服務商列表 | 總數:{len(services)} | IDs:{', '.join(service_ids)}")
            
            # 檢查並補全缺失的預設服務
            import copy
            service_ids_set = {s.get('id') for s in services if s.get('id')}
            template_services = self.default_config.get('model_services', [])
            template_services_map = {s.get('id'): s for s in template_services if s.get('id')}
            
            missing_preset_services = []
            for preset_id in self.PRESET_SERVICE_IDS:
                if preset_id not in service_ids_set and preset_id in template_services_map:
                    # 從模板中複製預設服務
                    new_service = copy.deepcopy(template_services_map[preset_id])
                    services.append(new_service)
                    missing_preset_services.append(preset_id)
                    self._log(f"🔧 自動補全缺失的預設服務: {new_service.get('name', preset_id)} (ID: {preset_id})")
            
            # 如果有補全服務，保存配置
            if missing_preset_services:
                self._log(f"🔧 補全了 {len(missing_preset_services)} 個預設服務: {', '.join(missing_preset_services)}")
                config['model_services'] = services
                self.save_config(config)
            
            # 檢查 OpenRouter 是否存在
            openrouter_exists = any(s.get('id') == 'openrouter' for s in services)
            if not openrouter_exists:
                self._log(f"⚠️ OpenRouter 未在服務列表中 | 預設服務ID列表:{', '.join(self.PRESET_SERVICE_IDS)}")
                # 檢查 OpenRouter 的 vlm_models
                for service in services:
                    if service.get('id') == 'openrouter':
                        vlm_models = service.get('vlm_models', [])
                        self._log(f"OpenRouter vlm_models 數量: {len(vlm_models)}")
                        if not vlm_models:
                            self._log(f"⚠️ OpenRouter 的 vlm_models 為空")
            else:
                openrouter_service = next((s for s in services if s.get('id') == 'openrouter'), None)
                if openrouter_service:
                    vlm_models = openrouter_service.get('vlm_models', [])
                    self._log(f"✅ OpenRouter 已載入 | vlm_models 數量:{len(vlm_models)}")
            
            return services
        else:
            # v1.0不支持此功能
            self._log("⚠️ 配置版本過低 (v1.0)，無法載入服務商列表")
            return []
    
    def get_service(self, service_id: str):
        """
        获取指定服务商的完整配置
        
        参数:
            service_id: 服务商ID
            
        返回:
            Dict: 服务商配置，不存在返回None
        """
        return self._get_service_by_id(service_id)
    
    def create_service(self, service_type: str, name: str = "", base_url: str = "", 
                      api_key: str = "", description: str = ""):
        """
        创建新的服务商
        
        参数:
            service_type: 服务类型 ('openai_compatible' 或 'ollama')
            name: 服务商名称（如果为空，自动生成）
            base_url: Base URL
            api_key: API Key（明文存储）
            description: 描述
            
        返回:
            str: 新创建的service_id，失败返回None
        """
        try:
            config = self.load_config()
            
            if not self._is_v2_config(config):
                self._log("创建服务商失败: 配置版本过低，请先迁移到v2.0")
                return None
            
            # 获取现有服务商列表
            current_services = config.get('model_services', [])
            
            # 生成服务商ID和名称
            service_id, auto_name = self._generate_service_id_and_name(service_type, current_services)
            
            # 如果用户没有提供名称，使用自动生成的名称
            if not name:
                name = auto_name
            
            # 创建服务配置
            new_service = {
                "id": service_id,
                "type": service_type,
                "name": name,
                "description": description,
                "base_url": base_url,
                "api_key": api_key or "",
                "disable_thinking": True,
                "enable_advanced_params": True,
                "filter_thinking_output": True,
                "llm_models": [],
                "vlm_models": []
            }
            
            # Ollama特有配置
            if service_type == "ollama":
                new_service["auto_unload"] = True
            
            # 添加到配置
            if 'model_services' not in config:
                config['model_services'] = []
            
            config['model_services'].append(new_service)
            
            # 保存配置
            if self.save_config(config):
                self._log(f"成功创建服务商: {name} (ID: {service_id})")
                return service_id
            else:
                self._log(f"保存服务商配置失败: {name}")
                return None
                
        except Exception as e:
            self._log(f"创建服务商异常: {str(e)}")
            import traceback
            traceback.print_exc()
            return None
    
    def _generate_service_id_and_name(self, service_type: str, current_services: list) -> tuple:
        """
        生成服务商ID和默认名称
        
        参数:
            service_type: 服务类型
            current_services: 现有服务商列表
            
        返回:
            tuple: (service_id, default_name)
        """
        import random
        
        # 类型映射
        type_map = {
            "ollama": {
                "name_prefix": "Ollama服务",
                "id_prefix": "ollama"
            },
            "openai_compatible": {
                "name_prefix": "通用服务",
                "id_prefix": "service"
            }
        }
        
        # 获取类型配置
        type_config = type_map.get(service_type, {
            "name_prefix": "新服务",
            "id_prefix": service_type
        })
        
        name_prefix = type_config["name_prefix"]
        id_prefix = type_config["id_prefix"]
        
        # 收集已使用的编号
        existing_numbers = set()
        for service in current_services:
            sid = service.get('id', '')
            # 匹配格式：{id_prefix}_{数字}
            if sid.startswith(f"{id_prefix}_"):
                try:
                    num_str = sid.split('_')[-1]
                    if num_str.isdigit():
                        existing_numbers.add(int(num_str))
                except:
                    pass
        
        # 生成随机三位数（100-999），最多尝试100次
        max_attempts = 100
        for _ in range(max_attempts):
            random_number = random.randint(100, 999)
            if random_number not in existing_numbers:
                break
        else:
            # 如果100次都重复，使用更大的随机数（4位数）
            random_number = random.randint(1000, 9999)
            while random_number in existing_numbers:
                random_number = random.randint(1000, 9999)
        
        # 生成ID和名称
        service_id = f"{id_prefix}_{random_number}"
        default_name = f"{name_prefix}-{random_number}"
        
        return service_id, default_name
    
    def delete_service(self, service_id: str):
        """
        删除服务商
        
        参数:
            service_id: 服务商ID
            
        返回:
            bool: 成功返回True
        """
        try:
            # 檢查是否為預設服務，預設服務不可刪除
            if service_id in self.PRESET_SERVICE_IDS:
                self._log(f"删除服务商失败: 預設服務商不可刪除 (ID: {service_id})")
                return False
            
            config = self.load_config()
            
            if not self._is_v2_config(config):
                self._log("删除服务商失败: 配置版本过低")
                return False
            
            services = config.get('model_services', [])
            
            # 查找并删除服务
            original_length = len(services)
            config['model_services'] = [s for s in services if s.get('id') != service_id]
            
            if len(config['model_services']) == original_length:
                self._log(f"删除服务商失败: 服务商不存在 (ID: {service_id})")
                return False
            
            # 如果删除的是当前服务，清除current_services引用
            current_services = config.get('current_services', {})
            if current_services.get('llm') == service_id:
                current_services['llm'] = None
            if current_services.get('vlm') == service_id:
                current_services['vlm'] = None
            if current_services.get('translate') == service_id:
                current_services['translate'] = None
            
            # 保存配置
            if self.save_config(config):
                self._log(f"成功删除服务商: {service_id}")
                return True
            else:
                self._log(f"保存配置失败")
                return False
                
        except Exception as e:
            self._log(f"删除服务商异常: {str(e)}")
            import traceback
            traceback.print_exc()
            return False

    def update_services_order(self, service_ids: list) -> bool:
        """
        更新服务商顺序

        参数:
            service_ids: 服务商ID列表,按新顺序排列

        返回:
            bool: 成功返回True
        """
        try:
            config = self.load_config()

            if not self._is_v2_config(config):
                self._log("更新服务商顺序失败: 配置版本过低")
                return False

            services = config.get('model_services', [])

            # 创建ID到服务的映射
            service_map = {s.get('id'): s for s in services}

            # 验证所有service_id都存在
            for service_id in service_ids:
                if service_id not in service_map:
                    self._log(f"更新服务商顺序失败: 服务商不存在 (ID: {service_id})")
                    return False

            # 按新顺序重建services数组
            new_services = []
            for service_id in service_ids:
                new_services.append(service_map[service_id])

            # 添加未在service_ids中的服务(防止遗漏)
            for service_id, service in service_map.items():
                if service_id not in service_ids:
                    new_services.append(service)
                    self._log(f"警告: 服务商 {service_id} 不在新顺序中,已追加到末尾")

            config['model_services'] = new_services

            # 保存配置
            if self.save_config(config):
                self._log(f"成功更新服务商顺序: {', '.join(service_ids)}")
                return True
            else:
                self._log("保存配置失败")
                return False

        except Exception as e:
            self._log(f"更新服务商顺序异常: {str(e)}")
            import traceback
            traceback.print_exc()
            return False

    
    def update_service(self, service_id: str, **kwargs):
        """
        更新服务商配置
        
        参数:
            service_id: 服务商ID
            **kwargs: 要更新的字段（name, description, base_url, api_key, auto_unload等）
            
        返回:
            bool: 成功返回True
        """
        try:
            config = self.load_config()
            
            if not self._is_v2_config(config):
                self._log("更新服务商失败: 配置版本过低")
                return False
            
            # 查找服务
            services = config.get('model_services', [])
            service = None
            service_index = -1
            
            for i, s in enumerate(services):
                if s.get('id') == service_id:
                    service = s
                    service_index = i
                    break
            
            if not service:
                self._log(f"更新服务商失败: 服务商不存在 (ID: {service_id})")
                return False
            
            # 更新字段
            if 'name' in kwargs:
                service['name'] = kwargs['name']
            
            if 'description' in kwargs:
                service['description'] = kwargs['description']
            
            if 'base_url' in kwargs:
                service['base_url'] = kwargs['base_url']
            
            if 'api_key' in kwargs:
                # 直接使用明文API Key
                service['api_key'] = kwargs['api_key'] or ""
            
            if 'auto_unload' in kwargs and service.get('type') == 'ollama':
                service['auto_unload'] = kwargs['auto_unload']
            
            if 'disable_thinking' in kwargs:
                service['disable_thinking'] = kwargs['disable_thinking']
            
            if 'enable_advanced_params' in kwargs:
                service['enable_advanced_params'] = kwargs['enable_advanced_params']
            
            if 'filter_thinking_output' in kwargs:
                service['filter_thinking_output'] = kwargs['filter_thinking_output']
            
            # 更新services数组
            config['model_services'][service_index] = service
            
            # 保存配置
            if self.save_config(config):
                self._log(f"成功更新服务商: {service_id}")
                return True
            else:
                self._log(f"保存配置失败")
                return False
                
        except Exception as e:
            self._log(f"更新服务商异常: {str(e)}")
            import traceback
            traceback.print_exc()
            return False
    
    def set_current_service(self, service_type: str, service_id: str, model_name: str = None):
        """
        设置当前使用的服务商和模型
        
        参数:
            service_type: 服务类型 ('llm', 'vlm', 或 'translate')
            service_id: 服务商ID
            model_name: 模型名称(可选,如果不提供则使用该服务的默认模型或第一个模型)
            
        返回:
            bool: 成功返回True
        """
        try:
            config = self.load_config()
            
            if not self._is_v2_config(config):
                self._log("设置当前服务商失败: 配置版本过低")
                return False
            
            # ---Google 翻译特殊处理---
            if service_id == 'google':
                if service_type not in ['llm', 'translate']:
                    self._log(f"设置当前服务商失败: Google 翻译不支持{service_type}服务类型")
                    return False
                if 'google_translate' not in config:
                    config['google_translate'] = {"api_key": ""}
                if 'current_services' not in config:
                    config['current_services'] = {}
                config['current_services'][service_type] = {"service": "google", "model": ""}
                if self.save_config(config):
                    self._log(f"当前服务商已切换: Google 翻译 ({service_type})")
                    return True
                return False

            # ---百度翻译特殊处理---
            # 百度翻译使用独立的baidu_translate配置,不在model_services中
            if service_id == 'baidu':
                # 百度翻译支持LLM服务类型(旧兼容)和translate服务类型
                if service_type not in ['llm', 'translate']:
                    self._log(f"设置当前服务商失败: 百度翻译不支持{service_type}服务类型")
                    return False
                
                # 确保baidu_translate配置存在
                if 'baidu_translate' not in config:
                    config['baidu_translate'] = {"app_id": "", "secret_key": ""}
                
                # 确保current_services结构存在
                if 'current_services' not in config:
                    config['current_services'] = {}
                
                # 设置百度为当前服务(无模型概念)
                config['current_services'][service_type] = {
                    "service": "baidu",
                    "model": ""
                }
                
                # 保存配置
                if self.save_config(config):
                    self._log(f"当前服务商已切换: 百度翻译 ({service_type})")
                    return True
                else:
                    self._log("设置当前服务商失败: 保存配置失败")
                    return False
            
            # ---其他服务:验证服务存在---
            service = self._get_service_by_id(service_id)
            if not service:
                self._log(f"设置当前服务商失败: 服务商不存在 (ID: {service_id})")
                return False
            
            # 根据service_type确定模型列表字段
            model_list_key = f'{service_type}_models'
            if service_type == 'translate':
                model_list_key = 'llm_models'
            
            # 如果提供了model_name,验证模型是否存在
            if model_name:
                model_list = service.get(model_list_key, [])
                model_exists = any(m.get('name') == model_name for m in model_list)
                
                if not model_exists:
                    self._log(f"设置当前服务商失败: 模型不存在 (模型: {model_name}, 服务: {service_id})")
                    return False
           
            # 确保current_services结构存在
            if 'current_services' not in config:
                config['current_services'] = {}
            
            # 获取当前服务信息(兼容旧格式)
            current_info = config['current_services'].get(service_type)
            
            # 设置新格式的current_services
            if model_name:
                # 明确指定了模型
                config['current_services'][service_type] = {
                    "service": service_id,
                    "model": model_name
                }
            else:
                # 未指定模型,使用默认模型或第一个模型
                model_list = service.get(model_list_key, [])
                
                # 如果是百度服务,没有模型
                if service.get('id') == 'baidu' or service.get('type') == 'baidu':
                    config['current_services'][service_type] = {
                        "service": service_id,
                        "model": ""
                    }
                else:
                    # 查找默认模型或第一个模型
                    default_model = next((m for m in model_list if m.get('is_default')), 
                                        model_list[0] if model_list else None)
                    
                    if default_model:
                        config['current_services'][service_type] = {
                            "service": service_id,
                            "model": default_model.get('name', '')
                        }
                    else:
                        # 没有模型,只设置服务
                        config['current_services'][service_type] = {
                            "service": service_id,
                            "model": ""
                        }
            
            # 保存配置
            if self.save_config(config):
                service_name = service.get('name', service_id)
                log_model = f" | 模型:{model_name}" if model_name else ""
                self._log(f"成功设置当前{service_type}服务: {service_name}{log_model}")
                return True
            else:
                self._log(f"保存配置失败")
                return False
                
        except Exception as e:
            import traceback
            traceback.print_exc()
            return False
    
    # --- 模型管理方法 ---
    
    def add_model_to_service(self, service_id: str, model_type: str, model_name: str, 
                            temperature: float = 0.7, top_p: float = 0.9, max_tokens: int = 1024):
        """添加模型到服务商"""
        try:
            config = self.load_config()
            services = config.get('model_services', [])
            
            for i, service in enumerate(services):
                if service.get('id') == service_id:
                    model_list_key = 'llm_models' if model_type == 'llm' else 'vlm_models'
                    
                    if model_list_key not in service:
                        service[model_list_key] = []
                    
                    # 检查是否已存在
                    if any(m.get('name') == model_name for m in service[model_list_key]):
                        self._log(f"模型已存在: {model_name}")
                        return False
                    
                    # 添加新模型
                    new_model = {
                        "name": model_name,
                        "is_default": len(service[model_list_key]) == 0,
                        "temperature": temperature,
                        "top_p": top_p,
                        "max_tokens": max_tokens
                    }
                    service[model_list_key].append(new_model)
                    config['model_services'][i] = service
                    
                    if self.save_config(config):
                        self._log(f"成功添加模型: {model_name}")
                        return True
                    return False
            
            self._log(f"服务商不存在: {service_id}")
            return False
        except Exception as e:
            self._log(f"添加模型异常: {str(e)}")
            return False
    
    def delete_model_from_service(self, service_id: str, model_type: str, model_name: str):
        """从服务商删除模型"""
        try:
            config = self.load_config()
            services = config.get('model_services', [])
            
            for i, service in enumerate(services):
                if service.get('id') == service_id:
                    model_list_key = 'llm_models' if model_type == 'llm' else 'vlm_models'
                    
                    if model_list_key not in service:
                        return False
                    
                    original_length = len(service[model_list_key])
                    service[model_list_key] = [m for m in service[model_list_key] if m.get('name') != model_name]
                    
                    if len(service[model_list_key]) == original_length:
                        self._log(f"模型不存在: {model_name}")
                        return False
                    
                    # 如果删除的是默认模型，设置第一个为默认
                    if len(service[model_list_key]) > 0:
                        if not any(m.get('is_default') for m in service[model_list_key]):
                            service[model_list_key][0]['is_default'] = True
                    
                    config['model_services'][i] = service
                    
                    if self.save_config(config):
                        self._log(f"成功删除模型: {model_name}")
                        return True
                    return False
            
            self._log(f"服务商不存在: {service_id}")
            return False
        except Exception as e:
            self._log(f"删除模型异常: {str(e)}")
            return False
    
    def set_default_model(self, service_id: str, model_type: str, model_name: str):
        """设置默认模型"""
        try:
            config = self.load_config()
            services = config.get('model_services', [])
            
            for i, service in enumerate(services):
                if service.get('id') == service_id:
                    model_list_key = 'llm_models' if model_type == 'llm' else 'vlm_models'
                    
                    if model_list_key not in service:
                        return False
                    
                    found = False
                    for model in service[model_list_key]:
                        if model.get('name') == model_name:
                            model['is_default'] = True
                            found = True
                        else:
                            model['is_default'] = False
                    
                    if not found:
                        self._log(f"模型不存在: {model_name}")
                        return False
                    
                    config['model_services'][i] = service
                    
                    if self.save_config(config):
                        self._log(f"成功设置默认模型: {model_name}")
                        return True
                    return False
            
            self._log(f"服务商不存在: {service_id}")
            return False
        except Exception as e:
            self._log(f"设置默认模型异常: {str(e)}")
            return False
    
    def update_model_order(self, service_id: str, model_type: str, model_names: list):
        """更新模型顺序"""
        try:
            config = self.load_config()
            services = config.get('model_services', [])
            
            for i, service in enumerate(services):
                if service.get('id') == service_id:
                    model_list_key = 'llm_models' if model_type == 'llm' else 'vlm_models'
                    
                    if model_list_key not in service:
                        return False
                    
                    # 创建模型字典
                    model_dict = {m.get('name'): m for m in service[model_list_key]}
                    
                    # 按新顺序重新排列
                    new_model_list = []
                    for name in model_names:
                        if name in model_dict:
                            new_model_list.append(model_dict[name])
                    
                    service[model_list_key] = new_model_list
                    config['model_services'][i] = service
                    
                    if self.save_config(config):
                        self._log(f"成功更新模型顺序")
                        return True
                    return False
            
            self._log(f"服务商不存在: {service_id}")
            return False
        except Exception as e:
            self._log(f"更新模型顺序异常: {str(e)}")
            return False
    
    def update_model_parameter(self, service_id: str, model_type: str, model_name: str, 
                               parameter_name: str, parameter_value):
        """更新模型参数"""
        try:
            config = self.load_config()
            services = config.get('model_services', [])
            
            for i, service in enumerate(services):
                if service.get('id') == service_id:
                    model_list_key = 'llm_models' if model_type == 'llm' else 'vlm_models'
                    
                    if model_list_key not in service:
                        return False
                    
                    # 查找模型并更新参数
                    for model in service[model_list_key]:
                        if model.get('name') == model_name:
                            model[parameter_name] = parameter_value
                            config['model_services'][i] = service
                            
                            if self.save_config(config):
                                self._log(f"成功更新模型参数: {model_name}.{parameter_name} = {parameter_value}")
                                return True
                            return False
                    
                    self._log(f"模型不存在: {model_name}")
                    return False
            
            self._log(f"服务商不存在: {service_id}")
            return False
        except Exception as e:
            self._log(f"更新模型参数异常: {str(e)}")
            return False

# 创建全局配置管理器实例
config_manager = ConfigManager()