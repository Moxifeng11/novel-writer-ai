/**
 * C2：章节状态单一口径——三个判定入口必须一致
 */

import { describe, expect, it } from 'vitest';
import {
    isChapterSettledText, isChapterWrittenRecord, isWrittenOrSettledStatus, normalizeChapterStatus,
} from '@/shared/chapter-status';
import { isChapterWritten } from '@/shared/chapter-progress';
import { ChapterStatus } from '@/engine/repository/domain/value-objects/chapter-status';

const RAWS = ['settled', 'written', 'pending', 'draft', '草稿', '已完稿', '已结算', '已写', '需修改', '', '自定义'];
const SIZES = [300, 3000];

describe('C2 章节状态单一口径', () => {
    it('三个入口对同一输入结论一致', () => {
        for (const raw of RAWS) {
            for (const size of SIZES) {
                const canonical = isChapterWrittenRecord(raw, true, size);
                expect(isChapterWritten(raw, true, size)).toBe(canonical);
                const vo = ChapterStatus.fromRecord(raw, true, size);
                expect(vo.isWritten() || vo.isSettled()).toBe(canonical);
            }
        }
    });

    it('无正文文件一律不算已写', () => {
        for (const raw of RAWS) {
            expect(isChapterWrittenRecord(raw, false, 5000)).toBe(false);
            expect(isChapterWritten(raw, false, 5000)).toBe(false);
        }
    });

    it('中文/旧值归一', () => {
        expect(normalizeChapterStatus('已完稿')).toBe('settled');
        expect(normalizeChapterStatus('已结算')).toBe('settled');
        expect(normalizeChapterStatus('草稿')).toBe('pending');
        expect(normalizeChapterStatus('已写')).toBe('written');
        expect(normalizeChapterStatus(null)).toBe('pending');
        expect(normalizeChapterStatus('未知值')).toBe('pending');
    });

    it('显式占位状态即便文件很大也不算完成', () => {
        expect(isChapterWrittenRecord('pending', true, 9000)).toBe(false);
        expect(isChapterWrittenRecord('草稿', true, 9000)).toBe(false);
    });

    it('旧文件无状态时按体量兜底', () => {
        expect(isChapterWrittenRecord('', true, 3000)).toBe(true);
        expect(isChapterWrittenRecord('', true, 300)).toBe(false);
    });

    it('frontmatter 结算判定与规范状态一致', () => {
        for (const raw of ['settled', '已结算', '已完稿', 'written', 'pending']) {
            const text = `---\nstatus: ${raw}\n---\n\n正文`;
            expect(isChapterSettledText(text)).toBe(normalizeChapterStatus(raw) === 'settled');
        }
        expect(isWrittenOrSettledStatus('written')).toBe(true);
        expect(isWrittenOrSettledStatus('pending')).toBe(false);
    });
});
