import { createLogger } from '../shared/logger';

const log = createLogger('ForeshadowConfigManager');

export interface ForeshadowTypeConfig {
    id: string;
    name: string;
    description: string;
    keywords: string[];
    priority: number;
    enabled: boolean;
    color?: string;
}

export interface ForeshadowConfig {
    types: ForeshadowTypeConfig[];
    version: string;
}

export const DEFAULT_FORESHADOW_TYPES: ForeshadowTypeConfig[] = [
    {
        id: 'item',
        name: '物品',
        description: '武器、道具、丹药、书籍等实体物品',
        keywords: ['剑', '刀', '枪', '玉佩', '玉', '珠', '宝', '戒', '戒指', '镯', '链', '坠', '簪', '瓶', '葫芦', '鼎', '炉', '塔', '印', '玺', '令', '牌', '符', '丹', '药', '草', '花', '果', '酒', '茶', '书', '图', '卷', '衣', '袍', '甲', '盔', '靴', '扇', '伞', '琴', '棋', '画'],
        priority: 100,
        enabled: true,
        color: '#4CAF50'
    },
    {
        id: 'skill',
        name: '功法/技能',
        description: '武功秘籍、法术、修炼功法、特殊技能',
        keywords: ['诀', '功', '法', '术', '式', '典', '经', '谱', '录', '秘', '心法', '秘法', '神功', '绝技', '绝招', '武学', '武道', '剑道', '刀法', '枪法', '拳法', '掌法', '指法', '腿法', '身法', '步法'],
        priority: 90,
        enabled: true,
        color: '#2196F3'
    },
    {
        id: 'character',
        name: '人物',
        description: '重要角色、神秘人物、关键NPC',
        keywords: ['神秘人', '神秘老者', '神秘女子', '神秘少年', '黑衣人', '白衣人', '灰衣人', '面具人', '斗篷人', '来历不明', '身份成谜', '背景不详'],
        priority: 80,
        enabled: true,
        color: '#FF9800'
    },
    {
        id: 'setting',
        name: '地点/秘境',
        description: '神秘地点、秘境、禁地、传送阵',
        keywords: ['秘境', '禁地', '传说', '神话', '上古', '远古', '太古', '洪荒', '仙界', '魔界', '妖界', '鬼界', '神界', '人界', '凡间', '世俗', '大阵', '结界', '禁制', '封印', '传承', '遗迹'],
        priority: 70,
        enabled: true,
        color: '#9C27B0'
    },
    {
        id: 'event',
        name: '事件/预言',
        description: '预言、诅咒、约定、大事件',
        keywords: ['预言', '诅咒', '约定', '誓言', '承诺', '赌约', '宿命', '前世', '今生', '轮回', '转世', '重生', '穿越', '系统', '任务', '大劫', '浩劫', '灾变', '乱世', '大战', '决战', '终局', '末日'],
        priority: 60,
        enabled: true,
        color: '#E91E63'
    },
    {
        id: 'secret',
        name: '秘密/阴谋',
        description: '隐藏的秘密、阴谋、计划',
        keywords: ['秘密', '阴谋', '计划', '布局', '算计', '图谋', '诡计', '圈套', '陷阱', '暗谋', '秘辛', '隐秘'],
        priority: 50,
        enabled: true,
        color: '#607D8B'
    },
    {
        id: 'organization',
        name: '势力/组织',
        description: '门派、势力、组织、家族',
        keywords: ['族', '派', '门', '宗', '教', '会', '盟', '帮', '团', '社', '世家', '家族', '商会', '佣兵团'],
        priority: 40,
        enabled: true,
        color: '#00BCD4'
    },
    {
        id: 'bloodline',
        name: '血脉/体质',
        description: '特殊血脉、体质、天赋',
        keywords: ['血脉', '体质', '天赋', '灵根', '道体', '圣体', '仙体', '魔体', '神体', '血脉之力', '天赋神通'],
        priority: 30,
        enabled: true,
        color: '#8BC34A'
    }
];

export const DEFAULT_FORESHADOW_CONFIG: ForeshadowConfig = {
    types: [...DEFAULT_FORESHADOW_TYPES],
    version: '1.0.0'
};

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

    setOnConfigChange(callback: () => void): void {
        this.onConfigChange = callback;
    }

    getConfig(): ForeshadowConfig {
        return { ...this.config };
    }

    getTypes(): ForeshadowTypeConfig[] {
        return this.config.types
            .filter(t => t.enabled)
            .sort((a, b) => b.priority - a.priority);
    }

    getAllTypes(): ForeshadowTypeConfig[] {
        return [...this.config.types];
    }

    getTypeById(id: string): ForeshadowTypeConfig | undefined {
        return this.config.types.find(t => t.id === id);
    }

    addType(type: Omit<ForeshadowTypeConfig, 'id'>): ForeshadowTypeConfig {
        const newType: ForeshadowTypeConfig = {
            ...type,
            id: type.name.toLowerCase().replace(/\s+/g, '-') + '-' + Date.now()
        };
        this.config.types.push(newType);
        this.notifyChange();
        return newType;
    }

    updateType(id: string, updates: Partial<ForeshadowTypeConfig>): boolean {
        const index = this.config.types.findIndex(t => t.id === id);
        if (index === -1) return false;
        
        this.config.types[index] = { ...this.config.types[index], ...updates };
        this.notifyChange();
        return true;
    }

    deleteType(id: string): boolean {
        const index = this.config.types.findIndex(t => t.id === id);
        if (index === -1) return false;
        
        this.config.types.splice(index, 1);
        this.notifyChange();
        return true;
    }

    toggleType(id: string, enabled: boolean): boolean {
        return this.updateType(id, { enabled });
    }

    addKeyword(typeId: string, keyword: string): boolean {
        const type = this.config.types.find(t => t.id === typeId);
        if (!type) return false;
        
        if (!type.keywords.includes(keyword)) {
            type.keywords.push(keyword);
            this.notifyChange();
        }
        return true;
    }

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

    exportConfig(): string {
        return JSON.stringify(this.config, null, 2);
    }

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