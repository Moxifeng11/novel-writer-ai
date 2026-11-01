/**
 * 实体访问统一 — 已迁移模块的回归契约
 *
 * 逐批迁移期间防止回潮：已迁移模块不得再直接拼 pj*Dir 前缀，
 * entity-reader 自身也不得退回全库 getFiles。
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const root = path.resolve(__dirname, '../../..');
const read = (rel: string): string => fs.readFileSync(path.join(root, rel), 'utf8')
    .split(/\r?\n/)
    .filter(line => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join('\n');
const RAW = ['pjCharsDir(', 'pjLocsDir(', 'pjFactionsDir(', 'pjItemsDir('];

describe('已迁移模块', () => {
    for (const rel of [
        'engine/analysis-report-engine.ts',
        'engine/cross-volume-integration.ts',
        'services/worldview-cache-service.ts',
        'ui/generate-character-modal.ts',
        'ui/wizard-checker.ts',
        'ui/context-injector-modal.ts',
        'engine/step-result-saver.ts',
        'engine/context-manager.ts',
    ]) {
        it(`${rel} 不再直接拼实体目录`, () => {
            const source = read(rel);
            for (const pattern of RAW) {
                expect(source, `${rel} 仍包含 ${pattern}`).not.toContain(pattern);
            }
        });
    }
});

describe('entity-reader', () => {
    it('唯一入口不退化为全库扫描', () => {
        const source = read('shared/entity-reader.ts');
        expect(source).not.toContain('getFiles()');
        expect(source).toContain('listFolderFiles<TFile>');
    });
});
