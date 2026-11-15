/**
 * 高级维护结果摘要 + 面板可导入（视图门禁）
 */

import { describe, expect, it } from 'vitest';
import { describeMissingChapter, summarizeMaintenanceResult } from '@/shared/maintenance-model';
import { AdvancedMaintenanceModal } from '@/ui/advanced-maintenance-modal';

describe('summarizeMaintenanceResult', () => {
    it('优先使用服务自带 report（基线探测）', () => {
        const lines = summarizeMaintenanceResult({ report: '第一行\n第二行' });
        expect(lines).toEqual(['第一行', '第二行']);
    });

    it('场景循环：summary + 字数 + 失败场景', () => {
        const lines = summarizeMaintenanceResult({
            summary: '生成 3 场，合并 2 场',
            chars: 2076,
            failedScenes: [3],
            dryRun: true,
        });
        expect(lines[0]).toContain('生成 3 场');
        expect(lines).toContain('字数：2076');
        expect(lines.some(line => line.includes('失败场景'))).toBe(true);
    });

    it('关系图同步：派生出边/保留手工边/移除', () => {
        const lines = summarizeMaintenanceResult({
            dryRun: false, derived: 5, keptManual: 2, skipped: 1, removed: 0, warnings: ['未解析：甲 ↔ 乙'],
        });
        expect(lines).toContain('模式：已写入');
        expect(lines).toContain('派生出边：5');
        expect(lines).toContain('保留手工边：2');
        expect(lines.some(line => line.startsWith('告警：'))).toBe(true);
    });

    it('断言索引重建：条目数/文件/备份', () => {
        const lines = summarizeMaintenanceResult({
            dryRun: true, count: 12, path: '项目/04-项目总控/断言.json', backup: '项目/04-项目总控/断言.json.bak',
        });
        expect(lines).toContain('模式：预览（未写入）');
        expect(lines).toContain('条目数：12');
        expect(lines.some(line => line.startsWith('文件：'))).toBe(true);
        expect(lines.some(line => line.startsWith('备份：'))).toBe(true);
    });

    it('空值/原始值兜底', () => {
        expect(summarizeMaintenanceResult(null)).toEqual(['（无返回结果）']);
        expect(summarizeMaintenanceResult({ foo: 1 })).toEqual(['结果字段：foo']);
        expect(summarizeMaintenanceResult({})).toEqual(['（空结果）']);
    });
});

describe('describeMissingChapter', () => {
    it('缺章节时给出提示，有章节返回空串', () => {
        expect(describeMissingChapter('基线探测', '')).toBe('「基线探测」需要先选择章节');
        expect(describeMissingChapter('基线探测', '第1章')).toBe('');
    });
});

describe('界面模块可导入（视图门禁）', () => {
    it('高级维护面板是构造函数', () => {
        expect(typeof AdvancedMaintenanceModal).toBe('function');
    });
});
