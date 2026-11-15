/**
 * 自检：Worker 运行模式（目录版无 workers 时明确告警而不是静默降级）
 */

import { describe, expect, it } from 'vitest';
import { App, Vault } from 'obsidian';
import { SetupReadinessService } from '@/services/setup-readiness-service';

const make = (mode: 'worker' | 'worker-inline' | 'main-thread') => {
    const app = new App();
    app.vault = new Vault();
    return new SetupReadinessService(app, {
        hasApiKey: () => true,
        currentModel: () => 'deepseek-flash',
        activeProject: () => '',
        indexEntryCount: async () => 0,
        pendingSettlementCount: async () => 0,
        workerMode: async () => mode,
    });
};

describe('SetupReadinessService — Worker 模式', () => {
    it('后台线程模式：ok', async () => {
        const item = (await make('worker').check()).items.find(i => i.id === 'worker');
        expect(item?.status).toBe('ok');
    });

    it('主线程降级：warn 且说明原因与影响', async () => {
        const item = (await make('main-thread').check()).items.find(i => i.id === 'worker');
        expect(item?.status).toBe('warn');
        expect(item?.detail).toContain('目录版');
        expect(item?.fix).toContain('仓库');
    });
});
