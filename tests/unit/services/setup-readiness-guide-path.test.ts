/**
 * 自检「标签与属性约定」项必须与「生成使用说明」写入路径一致
 */

import { describe, expect, it } from 'vitest';
import { App, Vault } from 'obsidian';
import { SetupReadinessService } from '@/services/setup-readiness-service';
import { USAGE_GUIDE_PATH } from '@/shared/usage-guide-content';

const make = (seedGuide: boolean) => {
    const vault = new Vault() as Vault & { _seedFile(path: string, content: string): unknown };
    const app = new App();
    app.vault = vault;
    if (seedGuide) vault._seedFile(USAGE_GUIDE_PATH, '# 插件使用约定');
    return new SetupReadinessService(app, {
        hasApiKey: () => true,
        currentModel: () => 'm',
        activeProject: () => '',
        indexEntryCount: async () => 0,
        pendingSettlementCount: async () => 0,
        workerMode: async () => 'worker' as const,
    });
};

describe('SetupReadinessService — 使用说明路径一致', () => {
    it('生成过使用说明后该项为 ok（不再一直 warning）', async () => {
        const item = (await make(true).check()).items.find(i => i.id === 'workspace');
        expect(item?.status).toBe('ok');
        expect(item?.detail).toContain(USAGE_GUIDE_PATH);
    });

    it('未生成时给出 warn 与修复建议', async () => {
        const item = (await make(false).check()).items.find(i => i.id === 'workspace');
        expect(item?.status).toBe('warn');
        expect(item?.fix).toContain('生成');
    });
});
