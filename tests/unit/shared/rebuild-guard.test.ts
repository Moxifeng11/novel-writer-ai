import { describe, expect, it } from 'vitest';
import { isRebuildableSkeleton, shouldPreserveExisting } from '@/shared/rebuild-guard';

describe('重建章节覆盖判定', () => {
    it('空内容算骨架', () => {
        expect(isRebuildableSkeleton('')).toBe(true);
        expect(isRebuildableSkeleton('   \n\n')).toBe(true);
    });

    it('明确占位符算骨架', () => {
        expect(isRebuildableSkeleton('（待定）')).toBe(true);
        expect(isRebuildableSkeleton('核心冲突：（待 auto_writer 填充）')).toBe(true);
        expect(isRebuildableSkeleton('TODO: 补充')).toBe(true);
    });

    it('手写短稿必须保留（旧逻辑会覆盖的典型场景）', () => {
        expect(shouldPreserveExisting('林玄走进山门，守门弟子拦下他。')).toBe(true);
        expect(shouldPreserveExisting('核心冲突：测灵被嘲笑')).toBe(true);
    });

    it('长正文保留', () => {
        expect(shouldPreserveExisting('正文'.repeat(200))).toBe(true);
    });
});
