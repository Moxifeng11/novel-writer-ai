/**
 * prompt-manager-import.test.ts — 提示词配置导入的 dry-run 差异与合并（功能缺口 ④）
 *
 * 锁三件事：①「同 id 或同名」是唯一匹配规则（预览与落盘必须一致）
 * ② replace 模式才算「将移除」，merge 模式不许动没提到的模板
 * ③ merge 保留现有 A/B 总开关与使用记录，且不修改入参。
 */
import { describe, expect, it } from 'vitest';
import {
    buildPromptImportDiff,
    isSameTemplate,
    mergePromptConfigs,
} from '../../../shared/prompt-manager-import';
import type {
    PromptManagerConfig,
    PromptTemplate,
    PromptUsageRecord,
} from '../../../shared/prompt-manager-types';

function template(id: string, name: string, versions: string[] = ['v1']): PromptTemplate {
    return {
        id,
        name,
        category: 'chapter',
        description: '',
        versions: versions.map((version, index) => ({
            version,
            createdAt: index + 1,
            systemPrompt: `sys-${version}`,
            userPrompt: `user-${version}`,
            isActive: index === versions.length - 1,
        })),
        variables: [],
        createdAt: 1,
        updatedAt: 1,
    };
}

function usage(id: string, templateId: string): PromptUsageRecord {
    return { id, templateId, version: 'v1', timestamp: 1 };
}

function config(overrides: Partial<PromptManagerConfig> = {}): PromptManagerConfig {
    return {
        customTemplates: [],
        abTests: [],
        usageHistory: [],
        abTestingEnabled: false,
        ...overrides,
    };
}

describe('isSameTemplate', () => {
    it('同 id 或同名都算同一模板，其余不算', () => {
        expect(isSameTemplate(template('a', '雨夜'), template('a', '别的名字'))).toBe(true);
        expect(isSameTemplate(template('a', '雨夜'), template('b', '雨夜'))).toBe(true);
        expect(isSameTemplate(template('a', '雨夜'), template('b', '伏笔'))).toBe(false);
    });
});

describe('buildPromptImportDiff', () => {
    const current = {
        templates: [template('custom-1', '雨夜氛围扩写'), template('custom-9', '只在本地')],
        tests: [],
    };
    const imported = config({
        customTemplates: [template('custom-1', '雨夜氛围扩写'), template('custom-2', '伏笔密度体检')],
        usageHistory: [usage('u1', 'custom-2')],
    });

    it('merge 模式：同 id 记覆盖、新 id 记新增、不列「将移除」', () => {
        const diff = buildPromptImportDiff(current, imported, 'merge');
        expect(diff.overwrittenTemplates).toEqual(['雨夜氛围扩写']);
        expect(diff.addedTemplates).toEqual(['伏笔密度体检']);
        expect(diff.removedTemplates).toEqual([]);
        expect(diff.usageInFile).toBe(1);
    });

    it('replace 模式：文件里没有的本地模板记为「将移除」', () => {
        const diff = buildPromptImportDiff(current, imported, 'replace');
        expect(diff.removedTemplates).toEqual(['只在本地']);
    });
});

describe('mergePromptConfigs', () => {
    it('新模板追加、同名模板合并版本并保留现有 id', () => {
        const current = config({
            customTemplates: [template('custom-1', '雨夜氛围扩写', ['v1'])],
            usageHistory: [usage('u1', 'custom-1')],
            abTestingEnabled: false,
        });
        const imported = config({
            customTemplates: [
                { ...template('other-id', '雨夜氛围扩写', ['v1', 'v2']), id: 'other-id' },
                template('custom-2', '伏笔密度体检', ['v1']),
            ],
            usageHistory: [usage('u1', 'custom-1'), usage('u2', 'custom-2')],
            abTestingEnabled: true,
        });

        const merged = mergePromptConfigs(current, imported);

        expect(merged.customTemplates.map(t => t.id)).toEqual(['custom-1', 'custom-2']);
        const mergedTemplate = merged.customTemplates[0];
        expect(mergedTemplate.versions.map(v => v.version)).toEqual(['v1', 'v2']);
        expect(mergedTemplate.versions.find(v => v.isActive)?.version).toBe('v2');
        // 使用记录按 id 去重：u1 不重复，u2 追加
        expect(merged.usageHistory.map(r => r.id)).toEqual(['u1', 'u2']);
        // A/B 总开关保留当前（导入不该悄悄打开分流）
        expect(merged.abTestingEnabled).toBe(false);
    });

    it('不修改入参（版本数组是拷贝）', () => {
        const current = config({ customTemplates: [template('custom-1', '雨夜', ['v1'])] });
        const imported = config({ customTemplates: [template('custom-1', '雨夜', ['v1', 'v2'])] });
        const before = current.customTemplates[0].versions.length;
        mergePromptConfigs(current, imported);
        expect(current.customTemplates[0].versions).toHaveLength(before);
        expect(imported.customTemplates[0].versions).toHaveLength(2);
    });
});