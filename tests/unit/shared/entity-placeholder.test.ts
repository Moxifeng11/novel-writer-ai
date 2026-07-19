/**
 * entity-placeholder.test.ts — 实体缺失字段占位工具单元测试
 */
import { describe, it, expect } from 'vitest';
import { appendMissingFieldPlaceholders } from '../../../shared/entity-placeholder';

describe('appendMissingFieldPlaceholders', () => {
    it('missingFields 为空时原样返回', () => {
        expect(appendMissingFieldPlaceholders('内容', [])).toBe('内容');
    });

    it('缺失字段追加占位行', () => {
        const result = appendMissingFieldPlaceholders('姓名：张三', ['性格', '背景']);
        expect(result).toContain('姓名：张三');
        expect(result).toContain('性格：（待补充）');
        expect(result).toContain('背景：（待补充）');
    });

    it('已存在的字段不重复追加', () => {
        const content = '姓名：张三\n性格：开朗';
        const result = appendMissingFieldPlaceholders(content, ['性格', '背景']);
        expect(result).not.toContain('性格：（待补充）');
        expect(result).toContain('背景：（待补充）');
    });

    it('保留原始内容不丢失', () => {
        const content = '第一段\n第二段';
        const result = appendMissingFieldPlaceholders(content, ['结局']);
        expect(result.startsWith(content)).toBe(true);
    });

    it('传入 null/undefined 安全返回原内容', () => {
        expect(appendMissingFieldPlaceholders('x', undefined as unknown as string[])).toBe('x');
    });
});
