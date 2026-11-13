import { describe, expect, it } from 'vitest';
import { buildLedgerLinks, renderLinkageIndex, type EntityResolver } from '../../../engine/ledger/ledger-link';
import type { EventRecord, ForeshadowRecord, LedgerIssue, LinkRecord } from '../../../engine/ledger/ledger-model';

/**
 * CV-1（2026-11-10 审计）：ledger-link 之前 0/81 stmts、0/53 branches——
 * 关联索引落盘的数据质量完全无护栏。本文件锁住核心分支：
 * resolver 三态（未解析/歧义/命中）、伏笔引用显式边、派生边与去重优先级、
 * 章节排序（数字序优先于字典序）与 issues 区块渲染。
 */

function mkEvent(overrides: Partial<EventRecord> & { id: string; name: string }): EventRecord {
    return {
        time: '清晨', chapterNum: 1, chapterKey: '第1章', era: 'main', eraName: '主线纪元',
        location: '', entityRefs: [], foreshadowRefs: [], impact: '', type: '', importance: 'unknown',
        status: 'occurred', source: 'manual', sourcePath: '时间线看板.md', lineNo: 1, raw: '',
        ...overrides,
    };
}

function mkForeshadow(overrides: Partial<ForeshadowRecord> & { id: string; name: string }): ForeshadowRecord {
    return {
        importance: '中', buryChapter: '', plannedReveal: '', revealChapter: '', status: 'unrevealed',
        relatedRefs: [], mainline: '', eventRefs: [], method: '', reason: '',
        sourcePath: '伏笔库.md', lineNo: 1, raw: '',
        ...overrides,
    };
}

const ENTITY_RESOLVER: EntityResolver = (name) => {
    if (name === '幽灵甲') return null;
    if (name === '同名') return [{ id: 'ENT-a', name, kind: 'character', path: '甲.md' }, { id: 'ENT-b', name, kind: 'character', path: '乙.md' }];
    return { id: `ENT-${name}`, name, kind: 'character', path: `${name}.md` };
};

function mkLedger(events: EventRecord[], foreshadows: ForeshadowRecord[]) {
    return { events, foreshadows, links: [] as LinkRecord[], issues: [] as LedgerIssue[] };
}

describe('buildLedgerLinks — resolver 三态', () => {
    it('未解析引用：记 unresolved-entity issue，不产边', () => {
        const ledger = mkLedger(
            [mkEvent({ id: 'EV-1', name: '遇袭', entityRefs: [{ id: '', name: '幽灵甲', kind: 'unknown', resolved: false }] })],
            [],
        );
        const { links, issues } = buildLedgerLinks(ledger, ENTITY_RESOLVER);
        expect(links).toHaveLength(0);
        expect(issues).toHaveLength(1);
        expect(issues[0]).toMatchObject({ type: 'unresolved-entity', severity: 'medium', recordId: 'EV-1' });
        // D3-10：纯函数不把 issues 写回缓存台账
        expect(ledger.issues).toHaveLength(0);
    });

    it('同名多实体：记 ambiguous-entity issue，不静默选第一个', () => {
        const ledger = mkLedger(
            [mkEvent({ id: 'EV-1', name: '对峙', entityRefs: [{ id: '', name: '同名', kind: 'unknown', resolved: false }] })],
            [],
        );
        const { links, issues } = buildLedgerLinks(ledger, ENTITY_RESOLVER);
        expect(links).toHaveLength(0);
        expect(issues[0].type).toBe('ambiguous-entity');
        expect(issues[0].message).toContain('甲.md、乙.md');
    });

    it('命中实体：产 mention 边（weight 3），不改写缓存 ref', () => {
        const ledger = mkLedger(
            [mkEvent({ id: 'EV-1', name: '入门', chapterNum: 2, chapterKey: '第2章', entityRefs: [{ id: '', name: '林玄', kind: 'unknown', resolved: false }] })],
            [],
        );
        const { links } = buildLedgerLinks(ledger, ENTITY_RESOLVER);
        expect(links).toHaveLength(1);
        expect(links[0]).toMatchObject({ from: 'EV-1', to: 'ENT-林玄', kind: 'mention', weight: 3, chapterNum: 2, source: 'explicit' });
        // D3-10：refs 保持原样（缓存台账不被就地改写）
        expect(ledger.events[0].entityRefs[0]).toMatchObject({ id: '', resolved: false });
    });
});

describe('buildLedgerLinks — 伏笔显式边与派生边', () => {
    const fsId = 'FS-玉佩';
    const event = mkEvent({ id: 'EV-1', name: '得玉佩', foreshadowRefs: [fsId] });
    const foreshadow = mkForeshadow({ id: fsId, name: '玉佩', buryChapter: '第1章' });

    it('按 ID 引用：同章 → sets-up（weight 4, explicit）', () => {
        const { links } = buildLedgerLinks(mkLedger([event], [foreshadow]), ENTITY_RESOLVER);
        expect(links).toContainEqual(expect.objectContaining({
            from: fsId, to: 'EV-1', kind: 'sets-up', weight: 4, source: 'explicit',
        }));
    });

    it('按归一化名称引用（跨章 → related）', () => {
        const later = mkEvent({ id: 'EV-2', name: '解玉佩', chapterNum: 9, chapterKey: '第9章', foreshadowRefs: ['玉佩 '] });
        const { links } = buildLedgerLinks(mkLedger([event, later], [foreshadow]), ENTITY_RESOLVER);
        expect(links).toContainEqual(expect.objectContaining({ from: fsId, to: 'EV-2', kind: 'related', weight: 4 }));
    });

    it('引用不存在的伏笔：记 issue，不产边', () => {
        const ghost = mkEvent({ id: 'EV-3', name: '幻影', foreshadowRefs: ['不存在的伏笔'] });
        const { links, issues } = buildLedgerLinks(mkLedger([ghost], []), ENTITY_RESOLVER);
        expect(links).toHaveLength(0);
        expect(issues[0].message).toContain('不存在的伏笔');
    });

    it('同章派生 sets-up（weight 2, derived）与显式边去重：显式优先', () => {
        const { links } = buildLedgerLinks(mkLedger([event], [foreshadow]), ENTITY_RESOLVER);
        const setUpLinks = links.filter((link) => link.kind === 'sets-up' && link.from === fsId && link.to === 'EV-1');
        // 显式（weight 4）与派生（weight 2）同 from/to/kind，去重后只留显式
        expect(setUpLinks).toHaveLength(1);
        expect(setUpLinks[0]).toMatchObject({ weight: 4, source: 'explicit' });
    });

    it('伏笔 relatedRefs 命中 → related 边（chapterNum null）', () => {
        const withRelated = mkForeshadow({
            id: 'FS-信', name: '神秘来信', buryChapter: '第2章',
            relatedRefs: [{ id: '', name: '苏晚', kind: 'unknown', resolved: false }],
        });
        const { links } = buildLedgerLinks(mkLedger([], [withRelated]), ENTITY_RESOLVER);
        expect(links).toContainEqual(expect.objectContaining({
            from: 'FS-信', to: 'ENT-苏晚', kind: 'related', weight: 3, chapterNum: null,
        }));
    });

    it('不同章不产派生边', () => {
        const far = mkEvent({ id: 'EV-9', name: '别章', chapterNum: 9, chapterKey: '第9章' });
        const { links } = buildLedgerLinks(mkLedger([far], [foreshadow]), ENTITY_RESOLVER);
        expect(links.filter((link) => link.source === 'derived')).toHaveLength(0);
    });
});

describe('renderLinkageIndex — 渲染契约', () => {
    it('数字章号排序优先于字典序；issues 带 path:lineNo', () => {
        const ledger = mkLedger(
            [
                mkEvent({ id: 'EV-10', name: '十章', chapterNum: 10, chapterKey: '第10章' }),
                mkEvent({ id: 'EV-2', name: '二章', chapterNum: 2, chapterKey: '第2章' }),
                mkEvent({ id: 'EV-0', name: '背景', chapterNum: null, chapterKey: '背景纪元' }),
            ],
            [mkForeshadow({ id: 'FS-1', name: '玉佩', buryChapter: '第2章' })],
        );
        ledger.issues.push({
            type: 'unresolved-entity', message: '无法解析实体「幽灵甲」',
            sourcePath: '时间线看板.md', lineNo: 7, recordId: 'EV-1', severity: 'medium',
        });

        const text = renderLinkageIndex(ledger, '2026-11-10T00:00:00.000Z');
        // 总览计数
        expect(text).toContain('- 事件：3');
        expect(text).toContain('- 伏笔：1');
        expect(text).toContain('- 待处理问题：1');
        // 数字序：第2章在 第10章 之前（字典序会把 10 排在 2 前）
        expect(text.indexOf('## 第2章')).toBeGreaterThan(0);
        expect(text.indexOf('## 第2章')).toBeLessThan(text.indexOf('## 第10章'));
        // 无章号事件进「未定章」/原文键
        expect(text).toContain('## 背景纪元');
        expect(text).toContain('| EV-10 | 十章 |');
        expect(text).toContain('| FS-1 | 玉佩（unrevealed） |');
        // issues 区块带来源定位
        expect(text).toContain('- [medium] 无法解析实体「幽灵甲」（时间线看板.md:7）');
    });
});

describe('buildLedgerLinks — 无 resolver 档（DSH-20261114-04）', () => {
    it('跳过实体边且不记 unresolved/ambiguous issue；事件↔伏笔与派生边照常产出', () => {
        const ledger = mkLedger(
            [mkEvent({
                id: 'EV-1', name: '遇袭',
                entityRefs: [{ id: '', name: '幽灵甲', kind: 'unknown', resolved: false }], // 有 resolver 时会记 issue
                foreshadowRefs: ['FS-9'], // 显式伏笔引用（无 resolver 也要解析）
                chapterNum: 2, chapterKey: '第2章',
            })],
            [
                mkForeshadow({ id: 'FS-9', name: '令牌的来历', buryChapter: '第2章' }),
                // 同章派生边来源（与事件同 buryChapter）
                mkForeshadow({ id: 'FS-8', name: '玉佩缺口', buryChapter: '第2章' }),
            ],
        );
        const { links, issues } = buildLedgerLinks(ledger, undefined);

        // 实体边跳过：无 mention 边
        expect(links.some(l => l.kind === 'mention')).toBe(false);
        // 「没提供解析器」≠「实体不存在」：不记 unresolved issue（否则污染看板问题数）
        expect(issues).toHaveLength(0);
        // 显式伏笔引用边照常（按 FS 稳定 ID / 名称在台账内解析）
        expect(links.some(l => l.from === 'FS-9' && l.to === 'EV-1' && l.source === 'explicit')).toBe(true);
        // 同章派生边照常
        expect(links.some(l => l.from === 'FS-8' && l.to === 'EV-1' && l.kind === 'sets-up' && l.source === 'derived')).toBe(true);
    });
});
