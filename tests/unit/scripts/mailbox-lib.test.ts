/**
 * 阶段 D3/协作：信箱任务配对与根目录解析的回归测试
 *
 * 这两块逻辑都出过**真实 bug**，都属于「静默失效」——脚本不报错，只是永远返回空：
 *
 * 1. **根目录解析**：曾写死上溯三层，从
 *    `<vault>/.obsidian/plugins/novel-writer-ai/scripts` 只到 `.obsidian`，
 *    指向不存在的 `<vault>/.obsidian/.trae/mailbox`。
 *    于是 `mailbox-watch.mjs` 永远报「没有未读」，ZCode/Trae 的轮询形同虚设。
 * 2. **任务配对**：派发方可能把 TASK-ID 写在正文而不是 subject 前缀
 *    （dsh 第一次派发就犯了），只认 subject 会让任务静默消失。
 *
 * 本文件锁这两条，防止再退化。
 */

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    pairTasks,
    parseReceiptTaskId,
    parseTaskId,
    parseVoidTaskId,
    resolveMailboxRoot,
} from '../../../scripts/lib/mailbox-lib.mjs';
import type { MailboxMessage } from '../../../scripts/lib/mailbox-lib.mjs';

/** 造消息 */
function msg(partial: Partial<MailboxMessage> & { id: string }): MailboxMessage {
    return {
        ts: '2026-11-11T14:00:00.000Z',
        from: 'dsh',
        to: 'zcode',
        subject: '',
        body: '',
        ...partial,
    };
}

/** 建临时目录树并写一个空 messages.jsonl */
function makeTempMailbox(): { root: string; cleanup: () => void } {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-mailbox-'));
    const root = path.join(base, '.trae', 'mailbox');
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'messages.jsonl'), '');
    return {
        root,
        cleanup: () => fs.rmSync(base, { recursive: true, force: true }),
    };
}

describe('协作-1：信箱根目录解析（曾静默指向不存在路径）', () => {
    it('MAILBOX_ROOT 优先', () => {
        expect(resolveMailboxRoot('/somewhere', '/env/mailbox')).toBe('/env/mailbox');
    });

    it('从深层目录向上搜索到含 messages.jsonl 的信箱根', () => {
        const { root, cleanup } = makeTempMailbox();
        try {
            // 模拟 <vault>/.obsidian/plugins/novel-writer-ai/scripts
            const scriptsDir = path.join(root, '..', '..', '.obsidian', 'plugins', 'novel-writer-ai', 'scripts');
            fs.mkdirSync(scriptsDir, { recursive: true });
            expect(resolveMailboxRoot(scriptsDir, undefined)).toBe(path.resolve(root));
        } finally {
            cleanup();
        }
    });

    it('找不到时回退到「上溯四层」的 vault 约定（不是三层）', () => {
        const fakeScripts = path.join(os.tmpdir(), 'nw-fake', '.obsidian', 'plugins', 'novel-writer-ai', 'scripts');
        const resolved = resolveMailboxRoot(fakeScripts, undefined);
        // 关键断言：必须落在 <vault>/.trae/mailbox，其中 vault = 上溯四层
        const expectedVault = path.resolve(fakeScripts, '..', '..', '..', '..');
        expect(resolved).toBe(path.join(expectedVault, '.trae', 'mailbox'));
        // 反例守卫：不能是三层（那就是 .obsidian/.trae/mailbox，历史 bug）
        const wrong = path.join(path.resolve(fakeScripts, '..', '..', '..'), '.trae', 'mailbox');
        expect(resolved).not.toBe(wrong);
    });
});

describe('协作-2：任务 ID 解析（subject 优先，正文兜底）', () => {
    it('subject 前缀优先', () => {
        expect(parseTaskId(msg({ id: 'm1', subject: '[TASK-DSH-20261111-01] 做某事' })))
            .toBe('DSH-20261111-01');
    });

    it('subject 没写时退化到正文 TASK-ID 行（真实发生过的派发失误）', () => {
        expect(parseTaskId(msg({
            id: 'm1',
            subject: '进度同步（含首个任务）',
            body: '【首个任务】\nTASK-ID: DSH-20261111-09\n目标: x',
        }))).toBe('DSH-20261111-09');
    });

    it('两者都没有 → null（不是空串）', () => {
        expect(parseTaskId(msg({ id: 'm1', subject: '随便', body: '随便' }))).toBeNull();
    });

    it('回执解析取 [RECEIPT] 后的 ID', () => {
        expect(parseReceiptTaskId(msg({ id: 'm1', subject: '[RECEIPT] DSH-20261111-01' })))
            .toBe('DSH-20261111-01');
        expect(parseReceiptTaskId(msg({ id: 'm2', subject: '普通消息' }))).toBeNull();
    });
});

describe('协作-3：任务/回执配对', () => {
    it('派给我且未回执 → 待办', () => {
        const pending = pairTasks([
            msg({ id: 'm1', subject: '[TASK-T-1] 任务一' }),
        ], 'zcode');
        expect(pending.map(t => t.taskId)).toEqual(['T-1']);
    });

    it('已回执 → 不再待办（避免 30 分钟轮询重复做）', () => {
        const pending = pairTasks([
            msg({ id: 'm1', subject: '[TASK-T-1] 任务一' }),
            msg({ id: 'm2', from: 'zcode', to: 'dsh', subject: '[RECEIPT] T-1' }),
        ], 'zcode');
        expect(pending).toEqual([]);
    });

    it('别人回执不算我回执', () => {
        const pending = pairTasks([
            msg({ id: 'm1', to: 'all', subject: '[TASK-T-1] 任务一' }),
            msg({ id: 'm2', from: 'trae', to: 'dsh', subject: '[RECEIPT] T-1' }),
        ], 'zcode');
        expect(pending.map(t => t.taskId)).toEqual(['T-1']);
    });

    it('广播任务（to:all）算作派给我', () => {
        const pending = pairTasks([msg({ id: 'm1', to: 'all', subject: '[TASK-T-2] 广播任务' })], 'trae');
        expect(pending.map(t => t.taskId)).toEqual(['T-2']);
    });

    it('派给别人的任务不算我的待办', () => {
        const pending = pairTasks([msg({ id: 'm1', to: 'trae', subject: '[TASK-T-3] 给 trae' })], 'zcode');
        expect(pending).toEqual([]);
    });

    it('正文声明的任务也能被配对（与解析逻辑一致）', () => {
        const pending = pairTasks([
            msg({ id: 'm1', subject: '进度同步', body: 'TASK-ID: T-4\n目标: y' }),
        ], 'zcode');
        expect(pending.map(t => t.taskId)).toEqual(['T-4']);
    });

    it('空输入不抛错', () => {
        expect(pairTasks([], 'zcode')).toEqual([]);
        expect(pairTasks(null, 'zcode')).toEqual([]);
    });
});

describe('协作-4：任务作废（派发后规格被替代时不能永远挂待办）', () => {
    it('[VOID] 后任务不再出现在待办', () => {
        const pending = pairTasks([
            msg({ id: 'm1', subject: '[TASK-T-9] 旧任务' }),
            msg({ id: 'm2', subject: '[VOID] T-9' }),
        ], 'zcode');
        expect(pending).toEqual([]);
    });

    it('作废只影响目标任务，不影响其他', () => {
        const pending = pairTasks([
            msg({ id: 'm1', subject: '[TASK-T-9] 旧任务' }),
            msg({ id: 'm2', subject: '[TASK-T-10] 新任务' }),
            msg({ id: 'm3', subject: '[VOID] T-9' }),
        ], 'zcode');
        expect(pending.map(t => t.taskId)).toEqual(['T-10']);
    });

    it('parseVoidTaskId 解析与空值', () => {
        expect(parseVoidTaskId(msg({ id: 'm1', subject: '[VOID] T-9' }))).toBe('T-9');
        expect(parseVoidTaskId(msg({ id: 'm2', subject: '普通消息' }))).toBeNull();
    });
});
