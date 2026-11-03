import { createLogger } from '@/shared/logger';
import {
    DEFAULT_FORESHADOW_CONFIG,
    DEFAULT_FORESHADOW_TYPES,
    type ForeshadowConfig,
    type ForeshadowTypeConfig,
} from '@/shared/foreshadow-config';

const log = createLogger('ForeshadowConfigManager');

// 配置类型与默认值已下沉到 shared/foreshadow-config.ts（core 生成 DEFAULT_SETTINGS 需要）
export type { ForeshadowConfig, ForeshadowTypeConfig };
export { DEFAULT_FORESHADOW_CONFIG, DEFAULT_FORESHADOW_TYPES };


/**
 * 伏笔配置管理器。
 */
export class ForeshadowConfigManager {
    private config: ForeshadowConfig;
    private onConfigChange?: () => void;

    constructor(config?: ForeshadowConfig) {
        if (config) {
            this.config = {
                ...config,
                types: JSON.parse(JSON.stringify(config.types))
            };
        } else {
            this.config = {
                ...DEFAULT_FORESHADOW_CONFIG,
                types: JSON.parse(JSON.stringify(DEFAULT_FORESHADOW_TYPES))
            };
        }
    }

    /**
     * 注册配置变更回调。
     *
     * @param callback - 回调
     */
    setOnConfigChange(callback: () => void): void {
        this.onConfigChange = callback;
    }

    /**
     * 读取伏笔配置。
     * @returns 配置
     */
    getConfig(): ForeshadowConfig {
        return { ...this.config };
    }

    /**
     * 读取启用的伏笔类型。
     * @returns 类型数组
     */
    getTypes(): ForeshadowTypeConfig[] {
        return this.config.types
            .filter(t => t.enabled)
            .sort((a, b) => b.priority - a.priority);
    }

    /**
     * 读取全部伏笔类型。
     * @returns 类型数组
     */
    getAllTypes(): ForeshadowTypeConfig[] {
        return [...this.config.types];
    }

    /**
     * 按 id 取类型。
     *
     * @param id - 标识
     * @returns 类型或 undefined
     */
    getTypeById(id: string): ForeshadowTypeConfig | undefined {
        return this.config.types.find(t => t.id === id);
    }

    /**
     * 新增伏笔类型。
     *
     * @param type - 类型
     * @returns 类型
     */
    addType(type: Omit<ForeshadowTypeConfig, 'id'>): ForeshadowTypeConfig {
        const newType: ForeshadowTypeConfig = {
            ...type,
            id: type.name.toLowerCase().replace(/\s+/g, '-') + '-' + Date.now()
        };
        this.config.types.push(newType);
        this.notifyChange();
        return newType;
    }

    /**
     * 更新伏笔类型。
     *
     * @param id - 标识
     * @param updates - 更新字段
     * @returns 是否更新
     */
    updateType(id: string, updates: Partial<ForeshadowTypeConfig>): boolean {
        const index = this.config.types.findIndex(t => t.id === id);
        if (index === -1) return false;
        
        this.config.types[index] = { ...this.config.types[index], ...updates };
        this.notifyChange();
        return true;
    }

    /**
     * 删除伏笔类型。
     *
     * @param id - 标识
     * @returns 是否删除
     */
    deleteType(id: string): boolean {
        const index = this.config.types.findIndex(t => t.id === id);
        if (index === -1) return false;
        
        this.config.types.splice(index, 1);
        this.notifyChange();
        return true;
    }

    /**
     * 启用/停用类型。
     *
     * @param id - 标识
     * @param enabled - 是否启用
     * @returns 是否成功
     */
    toggleType(id: string, enabled: boolean): boolean {
        return this.updateType(id, { enabled });
    }

    /**
     * 添加类型关键词。
     *
     * @param typeId - 类型 ID
     * @param keyword - 关键词
     * @returns 是否添加
     */
    addKeyword(typeId: string, keyword: string): boolean {
        const type = this.config.types.find(t => t.id === typeId);
        if (!type) return false;
        
        if (!type.keywords.includes(keyword)) {
            type.keywords.push(keyword);
            this.notifyChange();
        }
        return true;
    }

    /**
     * 移除类型关键词。
     *
     * @param typeId - 类型 ID
     * @param keyword - 关键词
     * @returns 是否移除
     */
    removeKeyword(typeId: string, keyword: string): boolean {
        const type = this.config.types.find(t => t.id === typeId);
        if (!type) return false;
        
        const index = type.keywords.indexOf(keyword);
        if (index !== -1) {
            type.keywords.splice(index, 1);
            this.notifyChange();
        }
        return true;
    }

    /**
     * 按名称匹配类型。
     *
     * @param name - 名称
     * @returns 类型或 undefined
     */
    matchType(name: string): ForeshadowTypeConfig | undefined {
        const normalizedName = name.toLowerCase().trim();
        
        for (const type of this.getTypes()) {
            for (const keyword of type.keywords) {
                if (normalizedName.includes(keyword.toLowerCase())) {
                    return type;
                }
            }
        }
        
        return undefined;
    }

    /**
     * 按名称匹配全部类型。
     *
     * @param name - 名称
     * @returns 类型数组
     */
    matchAllTypes(name: string): ForeshadowTypeConfig[] {
        const normalizedName = name.toLowerCase().trim();
        const matches: ForeshadowTypeConfig[] = [];
        
        for (const type of this.getTypes()) {
            for (const keyword of type.keywords) {
                if (normalizedName.includes(keyword.toLowerCase())) {
                    matches.push(type);
                    break;
                }
            }
        }
        
        return matches.sort((a, b) => b.priority - a.priority);
    }

    /**
     * 校验配置。
     *
     * @param config - 配置
     * @returns {valid,errors}
     */
    validateConfig(config: ForeshadowConfig): { valid: boolean; errors: string[] } {
        const errors: string[] = [];
        
        if (!config.types || !Array.isArray(config.types)) {
            errors.push('types 必须是数组');
            return { valid: false, errors };
        }
        
        const ids = new Set<string>();
        for (const type of config.types) {
            if (!type.id || typeof type.id !== 'string') {
                errors.push('每个类型必须有 id');
            } else if (ids.has(type.id)) {
                errors.push(`类型 id 重复: ${type.id}`);
            } else {
                ids.add(type.id);
            }
            
            if (!type.name || typeof type.name !== 'string' || type.name.trim().length === 0) {
                errors.push(`类型 ${type.id || 'unknown'} 必须有名称`);
            }
            
            if (!type.keywords || !Array.isArray(type.keywords)) {
                errors.push(`类型 ${type.name || type.id} 的 keywords 必须是数组`);
            }
            
            if (typeof type.priority !== 'number') {
                errors.push(`类型 ${type.name || type.id} 的 priority 必须是数字`);
            }
            
            if (typeof type.enabled !== 'boolean') {
                errors.push(`类型 ${type.name || type.id} 的 enabled 必须是布尔值`);
            }
        }
        
        return { valid: errors.length === 0, errors };
    }

    /**
     * 导出配置 JSON。
     * @returns JSON 文本
     */
    exportConfig(): string {
        return JSON.stringify(this.config, null, 2);
    }

    /**
     * 导入配置 JSON。
     *
     * @param jsonString - JSON 字符串
     * @returns {success,errors}
     */
    importConfig(jsonString: string): { success: boolean; errors: string[] } {
        try {
            const config = JSON.parse(jsonString);
            const validation = this.validateConfig(config);
            
            if (!validation.valid) {
                return { success: false, errors: validation.errors };
            }
            
            this.config = config;
            this.notifyChange();
            return { success: true, errors: [] };
        } catch (e) {
            return { success: false, errors: ['JSON 解析失败: ' + (e as Error).message] };
        }
    }

    /**
     * 恢复默认配置。
     */
    resetToDefault(): void {
        this.config = {
            ...DEFAULT_FORESHADOW_CONFIG,
            types: JSON.parse(JSON.stringify(DEFAULT_FORESHADOW_TYPES))
        };
        this.notifyChange();
    }

    private notifyChange(): void {
        if (this.onConfigChange) {
            this.onConfigChange();
        }
    }
}