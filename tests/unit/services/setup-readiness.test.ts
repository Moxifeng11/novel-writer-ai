/**
 * 首启环境自检
 */

import { describe, expect, it } from 'vitest';
import { App, Vault } from 'obsidian';
import { SetupReadinessService } from '@/services/setup-readiness-service';
import { TEMPLATE_SCAFFOLD_FILES } from '@/shared/template-scaffold-assets.generated';
import { TEMPLATE_ROOT } from '@/shared/template-scaffold';

const make = (opts: { seedAllTemplates?: boolean; projects?: string[]; indexCount?: number; active?: string } = {}) => {
    const vault = new Vault() as Vault & { _seedFile(path: string, content: string): unknown };
    const app = new App();
    app.vault = vault;
    if (opts.seedAllTemplates) {
        for (const rel of Object.keys(TEMPLATE_SCAFFOLD_FILES)) vault._seedFile(`${TEMPLATE_ROOT}/${rel}`, 'x');
    }
    for (const project of opts.projects ?? []) {
        vault._seedFile(`${project}/作品信息.md`, '# 作品');
    }
    const service = new SetupReadinessService(app, {
        hasApiKey: () => Boolean(opts.indexCount !== undefined),
        currentModel: () => (opts.indexCount !== undefined ? 'deepseek-flash' : ''),
        activeProject: () => opts.active ?? '',
        indexEntryCount: async () => opts.indexCount ?? 0,
    });
    return { service };
};

describe('SetupReadinessService', () => {
    it('空 vault：缺 Key/模板/项目 → 不可用', async () => {
        const { service } = make();
        const report = await service.check();
        expect(report.usable).toBe(false);
        expect(report.items.find(i => i.id === 'provider')?.status).toBe('missing');
        expect(report.items.find(i => i.id === 'templates')?.status).toBe('missing');
        expect(report.items.find(i => i.id === 'projects')?.status).toBe('missing');
    });

    it('配置齐全：可用', async () => {
        const { service } = make({ seedAllTemplates: true, projects: ['长篇小说/测试书'], indexCount: 12, active: '长篇小说/测试书' });
        const report = await service.check();
        expect(report.usable).toBe(true);
        expect(report.items.find(i => i.id === 'templates')?.detail).toContain('齐全');
        expect(report.items.find(i => i.id === 'index')?.status).toBe('ok');
    });

    it('有项目但索引为空 → warn 不阻塞', async () => {
        const { service } = make({ seedAllTemplates: true, projects: ['长篇小说/测试书'], indexCount: 0, active: '长篇小说/测试书' });
        const report = await service.check();
        expect(report.items.find(i => i.id === 'index')?.status).toBe('warn');
        expect(report.usable).toBe(true);
    });

    it('未选作品时索引项提示后续建立', async () => {
        const { service } = make({ seedAllTemplates: true, projects: ['长篇小说/测试书'], indexCount: 5 });
        const report = await service.check();
        expect(report.items.find(i => i.id === 'index')?.detail).toContain('打开作品');
    });

    it('模板缺失数可定位', async () => {
        const { service } = make();
        const templates = (await service.check()).items.find(i => i.id === 'templates');
        expect(templates?.detail).toMatch(/缺少 \d+\/\d+ 个模板文件/);
    });
});
