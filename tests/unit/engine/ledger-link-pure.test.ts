/**
 * D3-10（维度② r3）：buildLedgerLinks 必须是纯函数。
 *
 * 旧实现就地写 ref.id/kind/path/resolved 并 push 进 ledger.issues：
 *  - 同一台账第二次渲染时问题数翻倍；
 *  - 已删除实体的 ref 仍保持 resolved=true，继续连边。
 */

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { buildLedgerLinks } from '../../../engine/ledger/ledger-link';

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function makeLedger() {
    return {
        events: [{
            id: 'EVT-1', name: '外门考核', chapterNum: 1, chapterKey: '第1章',
            sourcePath: '书A/时间线看板.md', lineNo: 4,
            entityRefs: [{ id: 'ref-1', name: '林玄', kind: 'character', resolved: false }],
            foreshadowRefs: [],
        }],
        foreshadows: [],
        links: [],
        issues: [] as Array<Record<string, unknown>>,
    };
}

describe('buildLedgerLinks — 纯函数', () => {
    it('不修改 refs、不向 ledger.issues 追加，问题数不随调用次数增长', () => {
        const ledger = makeLedger();
        const ref = ledger.events[0].entityRefs[0];
        const resolver = () => null;

        const first = buildLedgerLinks(ledger as never, resolver);
        const second = buildLedgerLinks(ledger as never, resolver);

        expect(first.issues).toHaveLength(1);
        expect(second.issues).toHaveLength(1);
        expect(ledger.issues).toHaveLength(0);
        expect(ref).toEqual({ id: 'ref-1', name: '林玄', kind: 'character', resolved: false });
    });

    it('实体被删除后不再按旧 resolved 连边', () => {
        const ledger = makeLedger();
        let found = true;
        const resolver = () => (found ? { id: 'CHAR-1', name: '林玄', kind: 'character', path: '书A/人物/林玄.md' } : null);

        const first = buildLedgerLinks(ledger as never, resolver);
        expect(first.links).toHaveLength(1);
        expect(first.links[0].to).toBe('CHAR-1');

        found = false;
        const second = buildLedgerLinks(ledger as never, resolver);
        expect(second.links).toHaveLength(0);
        expect(second.issues[0].type).toBe('unresolved-entity');
    });
});

describe('D3-10 接线契约', () => {
    it('context-manager 用渲染副本，不把 links/issues 写回缓存台账', () => {
        const src = read('engine/context-manager.ts');
        expect(src).not.toContain('ledger.links = links');
        expect(src).toContain('issues: [...ledger.issues, ...issues]');
    });

    it('ledger-link 不再 push 进 ledger.issues', () => {
        const src = read('engine/ledger/ledger-link.ts');
        expect(src).not.toContain('ledger.issues.push');
    });
});
