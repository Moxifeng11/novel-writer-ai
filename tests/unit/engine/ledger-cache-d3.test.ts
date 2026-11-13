/**
 * D3-9（维度② r3）回归：
 * 1. 台账缓存签名含内容指纹——mtime/size 不变的同长度改写也能失效；
 * 2. 读失败返回的空账本不得写进缓存；
 * 3. 结算追加遇到「表格缺失（no-table）」必须可见（partialFailure），
 *    而不是当成「已存在，跳过」。
 */

import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { TFile } from 'obsidian';

vi.mock('../../../main', () => ({
    default: class NovelWriterPlugin {},
}));

import { invalidateStoryLedger, loadStoryLedger } from '../../../engine/ledger/ledger-io';

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const PROJECT = '长篇小说/测试书';
const TIMELINE_PATH = `${PROJECT}/02-时间线与伏笔/时间线看板.md`;

function timeline(event: string): string {
    return [
        '### 主线纪元',
        '',
        '| 时间 | 对应章节 | 事件 | 影响 |',
        '|---|---|---|---|',
        `| 清晨 | 第1章 | ${event} | 林玄暴露体质 |`,
        '',
    ].join('\n');
}

describe('loadStoryLedger — 内容指纹参与签名', () => {
    it('同长度改写（mtime/size 不变）也能读到新内容', async () => {
        const file = new TFile();
        file.path = TIMELINE_PATH;
        file.stat = { ctime: 0, mtime: 0, size: timeline('外门考核').length };
        let content = timeline('外门考核');

        const app = {
            vault: {
                getAbstractFileByPath: (p: string) => (p === TIMELINE_PATH ? file : null),
                cachedRead: () => content,
            },
        } as never;

        invalidateStoryLedger(PROJECT);
        const first = await loadStoryLedger(app, PROJECT);
        expect(first.events.map(e => e.name)).toContain('外门考核');

        // 同长度替换：旧实现 mtime+size 签名不变 → 永远读到缓存里的旧事件
        content = timeline('内门考核');
        const second = await loadStoryLedger(app, PROJECT);
        expect(second.events.map(e => e.name)).toContain('内门考核');
    });

    it('读失败的空账本不写缓存，恢复后立即读到真实内容', async () => {
        const file = new TFile();
        file.path = TIMELINE_PATH;
        // 故意给 0:0 的 stat：旧实现失败签名 '0:0' 与成功签名相同，会把空账本永久缓存
        file.stat = { ctime: 0, mtime: 0, size: 0 };
        let fail = true;

        const app = {
            vault: {
                getAbstractFileByPath: (p: string) => (p === TIMELINE_PATH ? file : null),
                cachedRead: () => {
                    if (fail) throw new Error('transient io');
                    return timeline('外门考核');
                },
            },
        } as never;

        invalidateStoryLedger(PROJECT);
        const first = await loadStoryLedger(app, PROJECT);
        expect(first.events).toHaveLength(0);

        fail = false;
        const second = await loadStoryLedger(app, PROJECT);
        expect(second.events.map(e => e.name)).toContain('外门考核');
    });
});

describe('D3-9 接线契约', () => {
    it('ledger-io 使用内容指纹并在读失败时不写缓存', () => {
        const src = read('engine/ledger/ledger-io.ts');
        expect(src).toContain('function hashContent');
        expect(src).toContain('${mtime}:${size}:${hashContent(content)}');
        // DSH-20261114-04：关系状态.md 纳入读取与签名，读失败同样不写缓存
        expect(src).toContain('if (timeline.ok && foreshadow.ok && promise.ok && relation.ok)');
    });

    it('结算 no-table 走 partialFailure，揭示后失效台账缓存', () => {
        const src = read('engine/settlement-engine.ts');
        expect(src).toContain("written.reason === 'no-table'");
        expect(src).toContain("this.markPostStepFailure(ctx, '伏笔库结构')");
        expect(src).toContain("this.markPostStepFailure(ctx, '时间线看板结构')");
        const revealIdx = src.indexOf('invalidateStoryLedger(ctx.project);', src.indexOf('更新伏笔库失败'));
        expect(revealIdx).toBeGreaterThan(-1);
    });
});
