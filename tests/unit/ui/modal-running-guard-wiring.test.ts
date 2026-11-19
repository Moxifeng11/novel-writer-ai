/**
 * ModalRunningGuard 接线不变量（审计 A-14 / P2 #19 回归）。
 *
 * 组件行为由 modal-running-guard.test.ts 覆盖；这里锁「接线」——
 * 四个长任务弹窗必须：挂守卫、任务开始置 running=true、结束/finally 置 false、
 * onClose 兜底重置（任务中途关窗后再打开不能仍被判为运行中）。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function source(file: string): string {
    return readFileSync(resolve(process.cwd(), file), 'utf8');
}

function stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

const TARGETS = [
    'ui/rebuild-chapters-modal.ts',
    'ui/continue-chapters-modal.ts',
    'ui/batch-create-modal.ts',
    'ui/backup-yuan-modal.ts',
];

describe.each(TARGETS)('%s 长任务运行态接线', (file) => {
    const src = stripComments(source(file));

    it('导入守卫并挂上 onOpen', () => {
        expect(src).toContain("import { ModalRunningGuard } from './components/modal-running-guard';");
        expect(src).toMatch(/runningGuard = new ModalRunningGuard\(\(\) => this\.running\)/);
        expect(src).toContain('this.runningGuard.attach(this, this.app);');
    });

    it('任务开始置 true、至少一处结束置 false', () => {
        expect(src).toMatch(/this\.running = true;/);
        expect(src).toMatch(/this\.running = false;/);
    });

    it('onClose 兜底重置运行态', () => {
        const m = src.match(/onClose\(\): void \{[\s\S]{0,200}?\}/);
        expect(m, '未找到 onClose').not.toBeNull();
        expect(m![0]).toContain('this.running = false;');
    });
});

describe('运行态边界（代码级）', () => {
    it('rebuild 在 finally 之外显式复位（章节级 catch 不吞整体运行态）', () => {
        const src = stripComments(source('ui/rebuild-chapters-modal.ts'));
        expect(src).toMatch(/this\.running = false;\s*\n\s*mainNotice\.hide\(\);/);
    });

    it('backup 在 finally 里复位（异常也要解除拦截）', () => {
        const src = stripComments(source('ui/backup-yuan-modal.ts'));
        expect(src).toMatch(/finally \{[\s\S]{0,120}this\.running = false;[\s\S]{0,80}progressNotice\.hide\(\);/);
    });

    it('continue 两条任务路径都在收尾复位', () => {
        const src = stripComments(source('ui/continue-chapters-modal.ts'));
        const resets = src.match(/this\.running = false;/g) ?? [];
        expect(resets.length).toBeGreaterThanOrEqual(3);
    });
});
