import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * D-1（2026-11-10 数据一致性审计）：一键成文在 settle 成功后还会无锁整篇改写正文，
 * 并把 status: settled 改回 written。settleStep_updateBodyFrontmatter 已在正文锁内写好
 * status 与涉及*，这段二次改写必须删除，否则「settled 不降级」不变量永久失效。
 */
const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('一键成文 — 结算后不再二次改写正文', () => {
    const src = read('ui/write-chapter-modal.ts');

    it('不再写入 status: written，也不再整篇 vault.modify 正文', () => {
        expect(src).not.toContain("'status: written'");
        expect(src).not.toContain('await app.vault.modify(bodyFile, updatedBody)');
    });

    it('结算仍是唯一 frontmatter 写入者，且注释标明原因', () => {
        expect(src).toContain('executeSettlement');
        expect(src).toContain('settleStep_updateBodyFrontmatter');
        expect(src).toContain('D-1');
        // 结算失败/回滚分支仍然提前返回，不登记完成
        expect(src).toContain('settleResult.rollback || settleResult.settlementPartial');
    });

    it('AI 标题进入 rename 前先净化（安全审计 S-4）', () => {
        expect(src).toContain('sanitizeFileSegment(writeResult.title)');
        expect(src).not.toContain('writeResult.title.slice(0, 15)');
    });
});
