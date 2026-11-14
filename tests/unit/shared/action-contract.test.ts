/**
 * action-contract 单测：动作语义契约（读/写正文/写设定/管理）
 *
 * 用真实命令 id 做金标准断言，避免规则改动悄悄改变语义。
 */

import { describe, expect, it } from 'vitest';
import {
    actionKind,
    ACTION_KIND_OVERRIDES,
    changesProse,
    changesSetting,
    isReadAction,
    isWriteAction,
    kindForGroup,
    normalizeAction,
} from '@/shared/action-contract';

describe('normalizeAction 归一化', () => {
    it('去掉 novel-writer- 前缀', () => {
        expect(normalizeAction('novel-writer-write-chapter')).toBe('write-chapter');
    });

    it('去掉 novel-writer-ai: 前缀（Obsidian 完整 id）', () => {
        expect(normalizeAction('novel-writer-ai:novel-writer-usage-ledger')).toBe('usage-ledger');
    });

    it('大小写与空白归一', () => {
        expect(normalizeAction('  NOVEL-WRITER-Export-Manuscript ')).toBe('export-manuscript');
    });
});

describe('真实命令分类（金标准）', () => {
    const cases: Array<[string, string]> = [
        ['novel-writer-write-chapter', 'write-prose'],
        ['novel-writer-write-chapter-auto', 'write-prose'],
        ['novel-writer-batch-chapters', 'write-prose'],
        ['novel-writer-continue-chapters', 'write-prose'],
        ['novel-writer-auto-writer', 'write-prose'],
        ['novel-writer-review-chapter', 'write-prose'],
        ['novel-writer-targeted-revision', 'write-prose'],
        ['novel-writer-save-version', 'write-prose'],
        ['novel-writer-chapter-settlement', 'write-prose'],
        ['novel-writer-full-writer', 'write-prose'],
        ['novel-writer-worldview', 'write-setting'],
        ['novel-writer-character', 'write-setting'],
        ['novel-writer-timeline', 'write-setting'],
        ['novel-writer-foreshadow', 'write-setting'],
        ['novel-writer-outline-expand', 'write-setting'],
        ['novel-writer-batch-deconstruct', 'write-setting'],
        ['novel-writer-extract-elements', 'write-setting'],
        ['novel-writer-create-project', 'admin'],
        ['novel-writer-rename-project', 'admin'],
        ['novel-writer-backup', 'admin'],
        ['novel-writer-open-settings', 'admin'],
        ['novel-writer-usage-ledger', 'read'],
        ['novel-writer-writing-stats', 'read'],
        ['novel-writer-export-manuscript', 'read'],
        ['novel-writer-consistency-audit', 'read'],
        ['novel-writer-fact-store', 'read'],
        ['novel-writer-project-health', 'read'],
        ['novel-writer-quality-dashboard', 'read'],
        ['novel-writer-version-history', 'read'],
        ['novel-writer-open-knowledge-base', 'read'],
        ['novel-writer-job-center', 'read'],
    ];

    for (const [id, expected] of cases) {
        it(`${id} → ${expected}`, () => {
            expect(actionKind(id)).toBe(expected);
        });
    }
});

describe('判定函数', () => {
    it('isReadAction / isWriteAction 互斥', () => {
        expect(isReadAction('novel-writer-writing-stats')).toBe(true);
        expect(isWriteAction('novel-writer-writing-stats')).toBe(false);
        expect(isReadAction('novel-writer-write-chapter')).toBe(false);
        expect(isWriteAction('novel-writer-write-chapter')).toBe(true);
    });

    it('changesProse 只认写正文', () => {
        expect(changesProse('novel-writer-write-chapter')).toBe(true);
        expect(changesProse('novel-writer-worldview')).toBe(false);
        expect(changesProse('novel-writer-usage-ledger')).toBe(false);
    });

    it('changesSetting 只认写设定', () => {
        expect(changesSetting('novel-writer-character')).toBe(true);
        expect(changesSetting('novel-writer-write-chapter')).toBe(false);
    });

    it('未知命令默认按只读（安全侧）', () => {
        expect(actionKind('novel-writer-some-unknown-thing')).toBe('read');
    });
});

describe('分组兜底', () => {
    it('命名判不出时按分组归类', () => {
        // 完全无法从名字判断的假想命令
        expect(actionKind('novel-writer-zzz', 'writing-assistant')).toBe('write-prose');
        expect(actionKind('novel-writer-zzz', 'knowledge-base')).toBe('write-setting');
        expect(actionKind('novel-writer-zzz', 'views')).toBe('read');
        expect(actionKind('novel-writer-zzz', 'project-management')).toBe('admin');
    });

    it('分组映射表覆盖全部枚举值', () => {
        for (const group of ['project-management', 'writing-assistant', 'knowledge-base', 'views', 'version', 'tools']) {
            expect(kindForGroup(group), group).not.toBeNull();
        }
        expect(kindForGroup('unknown-group')).toBeNull();
    });
});

describe('例外表', () => {
    it('所有例外值都是合法类别', () => {
        const kinds = new Set(['read', 'write-prose', 'write-setting', 'admin']);
        for (const [key, kind] of Object.entries(ACTION_KIND_OVERRIDES)) {
            expect(kinds.has(kind), key).toBe(true);
        }
    });

    it('例外表优先于命名规则（export 类不被误判为写）', () => {
        expect(actionKind('novel-writer-export-manuscript')).toBe('read');
    });
});
