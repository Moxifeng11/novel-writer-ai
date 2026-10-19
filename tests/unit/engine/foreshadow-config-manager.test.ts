import { beforeEach, describe, expect, it } from 'vitest';
import { ForeshadowConfigManager, DEFAULT_FORESHADOW_CONFIG, DEFAULT_FORESHADOW_TYPES } from '../../../engine/foreshadow-config-manager';

describe('ForeshadowConfigManager', () => {
    let manager: ForeshadowConfigManager;

    beforeEach(() => {
        manager = new ForeshadowConfigManager();
    });

    it('默认配置正确加载', () => {
        const config = manager.getConfig();
        expect(config.version).toBe('1.0.0');
        expect(config.types.length).toBe(DEFAULT_FORESHADOW_TYPES.length);
    });

    it('获取所有类型', () => {
        const types = manager.getAllTypes();
        expect(types.length).toBe(DEFAULT_FORESHADOW_TYPES.length);
        expect(types[0].name).toBe('物品');
    });

    it('获取启用的类型（按优先级排序）', () => {
        const types = manager.getTypes();
        expect(types.length).toBe(DEFAULT_FORESHADOW_TYPES.length);
        expect(types[0].priority).toBeGreaterThanOrEqual(types[1].priority);
    });

    it('按 ID 获取类型', () => {
        const type = manager.getTypeById('item');
        expect(type).toBeDefined();
        expect(type?.name).toBe('物品');
    });

    it('添加新类型', () => {
        const newType = manager.addType({
            name: '魔法道具',
            description: '具有魔法属性的道具',
            keywords: ['魔杖', '法杖', '魔法书'],
            priority: 110,
            enabled: true,
            color: '#FF5722'
        });
        
        expect(newType.id).toBeDefined();
        expect(newType.name).toBe('魔法道具');
        expect(newType.priority).toBe(110);
        
        const types = manager.getTypes();
        expect(types.length).toBe(DEFAULT_FORESHADOW_TYPES.length + 1);
    });

    it('更新类型', () => {
        const success = manager.updateType('item', {
            name: '道具物品',
            priority: 120
        });
        
        expect(success).toBe(true);
        const type = manager.getTypeById('item');
        expect(type?.name).toBe('道具物品');
        expect(type?.priority).toBe(120);
    });

    it('更新不存在的类型返回 false', () => {
        const success = manager.updateType('nonexistent', { name: 'test' });
        expect(success).toBe(false);
    });

    it('删除类型', () => {
        const initialCount = manager.getAllTypes().length;
        const success = manager.deleteType('bloodline');
        
        expect(success).toBe(true);
        expect(manager.getAllTypes().length).toBe(initialCount - 1);
        expect(manager.getTypeById('bloodline')).toBeUndefined();
    });

    it('删除不存在的类型返回 false', () => {
        const success = manager.deleteType('nonexistent');
        expect(success).toBe(false);
    });

    it('启用/禁用类型', () => {
        const success = manager.toggleType('item', false);
        expect(success).toBe(true);
        
        const enabledTypes = manager.getTypes();
        expect(enabledTypes.find(t => t.id === 'item')).toBeUndefined();
        
        const allTypes = manager.getAllTypes();
        expect(allTypes.find(t => t.id === 'item')?.enabled).toBe(false);
    });

    it('添加关键词', () => {
        const success = manager.addKeyword('item', '新关键词');
        expect(success).toBe(true);
        
        const type = manager.getTypeById('item');
        expect(type?.keywords).toContain('新关键词');
    });

    it('添加重复关键词不重复', () => {
        const type = manager.getTypeById('item');
        const initialCount = type?.keywords.length;
        
        manager.addKeyword('item', '剑');
        manager.addKeyword('item', '剑');
        
        const updatedType = manager.getTypeById('item');
        expect(updatedType?.keywords.length).toBe(initialCount);
    });

    it('删除关键词', () => {
        const success = manager.removeKeyword('item', '剑');
        expect(success).toBe(true);
        
        const type = manager.getTypeById('item');
        expect(type?.keywords).not.toContain('剑');
    });

    it('匹配类型', () => {
        const match = manager.matchType('玉佩');
        expect(match?.name).toBe('物品');
    });

    it('匹配类型按优先级', () => {
        manager.updateType('item', { priority: 50 });
        manager.updateType('skill', { priority: 100 });
        
        const match = manager.matchType('秘籍');
        expect(match?.name).toBe('功法/技能');
    });

    it('匹配多个类型', () => {
        const matches = manager.matchAllTypes('神秘戒指');
        expect(matches.length).toBeGreaterThanOrEqual(1);
    });

    it('验证有效配置', () => {
        const result = manager.validateConfig(DEFAULT_FORESHADOW_CONFIG);
        expect(result.valid).toBe(true);
        expect(result.errors.length).toBe(0);
    });

    it('验证无效配置', () => {
        const invalidConfig = { types: [], version: '1.0.0' };
        const result = manager.validateConfig(invalidConfig as any);
        expect(result.valid).toBe(true);
        
        const invalidWithErrors = { types: [{ name: '', keywords: [] }], version: '1.0.0' };
        const result2 = manager.validateConfig(invalidWithErrors as any);
        expect(result2.valid).toBe(false);
    });

    it('导出配置', () => {
        const json = manager.exportConfig();
        const parsed = JSON.parse(json);
        expect(parsed.version).toBe('1.0.0');
        expect(parsed.types.length).toBe(DEFAULT_FORESHADOW_TYPES.length);
    });

    it('导入有效配置', () => {
        const json = JSON.stringify({
            types: [{
                id: 'test',
                name: '测试类型',
                description: '测试',
                keywords: ['测试'],
                priority: 10,
                enabled: true
            }],
            version: '1.0.0'
        });
        
        const result = manager.importConfig(json);
        expect(result.success).toBe(true);
        expect(manager.getAllTypes().length).toBe(1);
    });

    it('导入无效配置失败', () => {
        const result = manager.importConfig('invalid json');
        expect(result.success).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
    });

    it('重置为默认配置', () => {
        manager.addType({
            name: '测试',
            description: '测试',
            keywords: [],
            priority: 10,
            enabled: true
        });
        
        manager.resetToDefault();
        
        const config = manager.getConfig();
        expect(config.types.length).toBe(DEFAULT_FORESHADOW_TYPES.length);
    });

    it('配置变更通知', () => {
        let notified = false;
        manager.setOnConfigChange(() => {
            notified = true;
        });
        
        manager.addType({
            name: '测试',
            description: '测试',
            keywords: [],
            priority: 10,
            enabled: true
        });
        
        expect(notified).toBe(true);
    });
});