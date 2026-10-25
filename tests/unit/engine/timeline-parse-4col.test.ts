/**
 * Rev 186：时间线看板同时兼容 4 列简表与 7 列富表。
 *
 * 真实项目「九霄逆脉行」的表头是 | 时间 | 对应章节 | 事件 | 影响 |，
 * 旧解析器只认 7 列（parts >= 8），导致整块时间线被读成 0 条，
 * 关联索引与时间线设定库之间因此永远无法关联。
 */
import { describe, it, expect, vi } from 'vitest';
import { App } from 'obsidian';

vi.mock('../../../main', () => ({
    default: class NovelWriterPlugin {},
}));

import { ContextManager } from '../../../engine/context-manager';
import { LINKAGE_BEGIN, LINKAGE_END } from '../../../engine/story-linkage-writer';

function seed(app: App, path: string, content: string): void {
    (app.vault as any)._seedFile(path, content);
}

function makeManager(app: App): ContextManager {
    return new ContextManager({ capabilities: { app } as never });
}

describe('parseTimelineContent — 表头兼容', () => {
    it('4 列简表：时间 / 对应章节 / 事件 / 影响', async () => {
        const app = new App();
        seed(app, '测试书/02-时间线与伏笔/时间线看板.md', [
            '## 纪元',
            '',
            '### 主线纪元',
            '',
            '| 时间 | 对应章节 | 事件 | 影响 |',
            '| --- | --- | --- | --- |',
            '| 纪元（测脉大典当日） | 第1章 | 沈砚被验出九脉逆行 | |',
            '| 第三年春 | 第6章 | 山门试炼开启 | 沈砚首次暴露体质 |',
            '',
        ].join('\n'));

        const result = await makeManager(app).gatherTimeline('测试书');

        expect(result.timeline).toHaveLength(2);
        expect(result.timeline?.[0]).toMatchObject({
            time: '纪元（测脉大典当日）',
            chapter: '第1章',
            event: '沈砚被验出九脉逆行',
            eventName: '沈砚被验出九脉逆行',
        });
        expect(result.timeline?.[1]).toMatchObject({
            time: '第三年春',
            chapter: '第6章',
            event: '山门试炼开启',
            impact: '沈砚首次暴露体质',
        });
    });

    it('7 列富表仍按旧字段解析，不受影响', async () => {
        const app = new App();
        seed(app, '测试书/02-时间线与伏笔/时间线看板.md', [
            '### 主线纪元',
            '',
            '| # | 事件名称 | 时间 | 地点 | 涉及人物 | 章节 | 类型 |',
            '| --- | --- | --- | --- | --- | --- | --- |',
            '| 1 | 山门试炼 | 第三年春 | 青云山 | 沈砚、姜晚 | 第6章 | 主线 |',
            '',
        ].join('\n'));

        const result = await makeManager(app).gatherTimeline('测试书');

        expect(result.timeline).toHaveLength(1);
        expect(result.timeline?.[0]).toMatchObject({
            eventName: '山门试炼',
            time: '第三年春',
            location: '青云山',
            chapter: '第6章',
            type: '主线',
        });
        expect(result.timeline?.[0].involvedEntities).toEqual(['沈砚', '姜晚']);
    });

    it('分隔行与空行不会生成伪事件', async () => {
        const app = new App();
        seed(app, '测试书/02-时间线与伏笔/时间线看板.md', [
            '### 主线纪元',
            '',
            '| 时间 | 对应章节 | 事件 | 影响 |',
            '| --- | --- | --- | --- |',
            '|     |      |     |     |',
            '',
        ].join('\n'));

        const result = await makeManager(app).gatherTimeline('测试书');

        expect(result.timeline).toHaveLength(0);
    });

    it('回写生成的 NW-LINKAGE 自动块不会被再次解析成事件', async () => {
        const app = new App();
        seed(app, '测试书/02-时间线与伏笔/时间线看板.md', [
            '### 主线纪元',
            '',
            '| 时间 | 对应章节 | 事件 | 影响 |',
            '| --- | --- | --- | --- |',
            '| 纪元（测脉大典当日） | 第1章 | 沈砚被验出九脉逆行 | |',
            '',
            '---',
            '',
            LINKAGE_BEGIN,
            '## 关联索引（自动生成）',
            '',
            '| 时间 | 章节 | 事件 | 状态 | 关联设定 |',
            '| --- | --- | --- | --- | --- |',
            '| 第三年春 | 第6章 | 山门试炼 | 本章 | 沈砚 |',
            LINKAGE_END,
            '',
        ].join('\n'));

        const result = await makeManager(app).gatherTimeline('测试书');

        expect(result.timeline).toHaveLength(1);
        expect(result.timeline?.[0].event).toBe('沈砚被验出九脉逆行');
    });
});
