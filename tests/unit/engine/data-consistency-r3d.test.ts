/**
 * D3-17 / D3-18（维度② r3 收尾）回归：
 * 1. 信息债看板三个写点统一走共享写入器（路径锁内覆盖写，不再 delete+write）；
 * 2. 写作规则覆写前先留 `.bak` 副本。
 */

import { describe, expect, it, vi } from 'vitest';
import { TFile } from 'obsidian';
import fs from 'node:fs';
import path from 'node:path';
import { writeInfoDebtBoard } from '../../../shared/info-debt-board';
import { RulesService } from '../../../services/rules-service';
import { WRITING_RULES } from '../../../shared/writing-rules';
import { VAULT_RULES_PATH } from '../../../services/rules-registry';

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('writeInfoDebtBoard — 路径锁内覆盖写', () => {
    it('并发写入串行执行，不出现交错', async () => {
        let active = 0;
        let maxActive = 0;
        const written: string[] = [];

        const write = async (_path: string, content: string): Promise<void> => {
            active++;
            maxActive = Math.max(maxActive, active);
            await new Promise(resolve => setTimeout(resolve, 5));
            written.push(content);
            active--;
        };

        await Promise.all([
            writeInfoDebtBoard('看板.md', 'A', write),
            writeInfoDebtBoard('看板.md', 'B', write),
        ]);

        expect(maxActive).toBe(1);
        expect(written.sort()).toEqual(['A', 'B']);
    });
});

describe('D3-17 三写点接线', () => {
    it('结算/批量/伏笔管理器都走共享写入器，且不再 delete 看板', () => {
        for (const rel of [
            'engine/settlement-engine.ts',
            'ui/batch-chapters-modal.ts',
            'engine/foreshadow-manager.ts',
        ]) {
            expect(read(rel)).toContain('writeInfoDebtBoard');
        }
        const foreshadow = read('engine/foreshadow-manager.ts');
        expect(foreshadow).not.toContain('this.getFS().delete(debtPath)');
    });
});

describe('D3-18 写作规则覆写前备份', () => {
    it('版本不一致时先写 .bak 再覆写', async () => {
        RulesService.resetInstance();
        const oldRules = '---\nversion: 3.0.0\n---\n\n# 用户自己的写作规则\n';
        const file = new TFile();
        file.path = VAULT_RULES_PATH;
        const writes: Array<{ path: string; content: string }> = [];
        let modified: string | null = null;

        const app = {
            vault: {
                getAbstractFileByPath: (p: string) => (p === VAULT_RULES_PATH ? file : null),
                read: async () => oldRules,
                modify: async (_f: unknown, content: string) => { modified = content; },
                getFiles: () => [],
                adapter: {
                    mkdir: async () => undefined,
                    write: async (p: string, content: string) => { writes.push({ path: p, content }); },
                },
            },
        };

        const service = RulesService.getInstance(app as never);
        const result = await service.migrateToVaultSingleSource();

        expect(result.overwrote).toBe(true);
        expect(writes).toHaveLength(1);
        expect(writes[0].path).toBe(`${VAULT_RULES_PATH}.bak`);
        expect(writes[0].content).toBe(oldRules);
        expect(modified).toBe(WRITING_RULES);
        RulesService.resetInstance();
    });

    it('契约：备份在 modify 之前且持路径锁', () => {
        const src = read('services/rules-service.ts');
        const lockIdx = src.indexOf('await withWriteLock(VAULT_RULES_PATH, async () => {');
        const backupIdx = src.indexOf('`${VAULT_RULES_PATH}.bak`', lockIdx);
        const modifyIdx = src.indexOf('await this.app.vault.modify(existing, WRITING_RULES);', lockIdx);
        expect(lockIdx).toBeGreaterThan(-1);
        expect(backupIdx).toBeGreaterThan(lockIdx);
        expect(modifyIdx).toBeGreaterThan(backupIdx);
    });
});
