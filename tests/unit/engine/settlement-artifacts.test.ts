/**
 * 结算表唯一生成器（Wave B 第一步）
 *
 * 完整结算表此前两份模板（章节结算弹窗 / 一键成文内联），同章不同入口字段漂移。
 * 这里锁住 frontmatter、字段顺序、partial 标记与统计口径。
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
    buildSettlementTable,
    countSettlementChanges,
    type SettlementTableResult,
} from '../../../engine/settlement/settlement-artifacts';

const RESULT: SettlementTableResult = {
    updatedChars: 2,
    updatedForeshadows: 1,
    createdChars: 1,
    createdLocs: 2,
    createdFactions: 0,
    createdItems: 1,
    createdForeshadows: 3,
    createdTimelines: 1,
};

describe('buildSettlementTable', () => {
    it('frontmatter 字段完整，卷/章带引号', () => {
        const text = buildSettlementTable({
            chapterName: '第7章',
            volume: '第2卷',
            result: RESULT,
            timestamp: '2026-11-02T00:00:00.000Z',
            model: 'flash',
        });
        expect(text).toContain('tags: [结算表]');
        expect(text).toContain('卷: "第2卷"');
        expect(text).toContain('章: "第7章"');
        expect(text).toContain('settlement_mode: full');
        expect(text).toContain('step_model: "flash"');
        expect(text).toContain('step_timestamp: 2026-11-02T00:00:00.000Z');
        expect(text).not.toContain('settlement_partial');
    });

    it('正文统计与字段顺序固定', () => {
        const text = buildSettlementTable({ chapterName: '第7章', volume: '', result: RESULT });
        expect(text).toContain('# 第7章 结算表');
        expect(text).toContain('- 人物状态更新：2 人');
        expect(text).toContain('- 伏笔状态更新：1 个');
        expect(text).toContain('- 新建人物：1 个');
        expect(text).toContain('- 新建地点：2 个');
        expect(text).toContain('- 新建势力：0 个');
        expect(text).toContain('- 新建物品功法：1 个');
        expect(text).toContain('- 新建伏笔：3 个');
        expect(text).toContain('- 新建时间线事件：1 个');
    });

    it('回滚不完整时写 settlement_partial', () => {
        const text = buildSettlementTable({
            chapterName: '第7章', volume: '', result: { ...RESULT, settlementPartial: true },
        });
        expect(text).toContain('settlement_partial: true');
    });
});

describe('countSettlementChanges', () => {
    it('更新 = 人物+伏笔，新建 = 六类之和', () => {
        expect(countSettlementChanges(RESULT)).toEqual({ updated: 3, created: 8 });
    });
});

describe('源码约束：两个入口共用同一生成器', () => {
    const root = path.resolve(__dirname, '../../..');
    const read = (rel: string): string => fs.readFileSync(path.join(root, rel), 'utf8');

    it('章节结算弹窗与一键成文都引用 buildSettlementTable', () => {
        expect(read('ui/chapter-settlement-modal.ts')).toContain('buildSettlementTable({');
        expect(read('ui/write-chapter-modal.ts')).toContain('buildSettlementTable({');
    });

    it('一键成文不再保留自己的结算表模板', () => {
        const source = read('ui/write-chapter-modal.ts');
        expect(source).not.toContain('const settleFm = buildStepFrontmatter');
        expect(source).not.toContain('# 第${chapName}章 结算表');
    });
});
