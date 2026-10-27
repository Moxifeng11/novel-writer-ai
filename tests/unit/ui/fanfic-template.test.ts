import { describe, expect, it } from 'vitest';
import { App } from 'obsidian';
import {
    createFanficDraftFromTemplate,
    ensureFanficTemplate,
    projectFanficTemplatePath,
} from '../../../ui/full-writer/fanfic-settings-utils';
import { listFanficSettingCandidates } from '../../../shared/fanfic-binding';

describe('同人设定模板 — 持久化与草稿复制', () => {
    it('项目模板存在时，从模板创建待审核草稿', async () => {
        const app = new App();
        await app.vault.createFolder('书甲');
        await app.vault.createFolder('书甲/05-同人设定库');
        await app.vault.create(projectFanficTemplatePath('书甲'), '# 模板\n\n## 原作核心设定\n');

        const path = await createFanficDraftFromTemplate(app, '书甲', '新作');

        expect(path).toContain('/_待审核/');
        const content = await (app.vault as any).readByPath(path);
        expect(content).toContain('审核状态: pending');
        expect(content).toContain('## 原作核心设定');
    });

    it('模板缺失时 ensureFanficTemplate 会重建项目模板', async () => {
        const app = new App();
        await app.vault.createFolder('书甲');
        await app.vault.createFolder('书甲/05-同人设定库');

        const path = await ensureFanficTemplate(app, '书甲');
        expect(path).toContain('同人设定模板.md');
        expect(await (app.vault as any).readByPath(path)).toContain('同人设定');
    });

    it('模板与自带示例不会出现在可绑定候选里', () => {
        const candidates = listFanficSettingCandidates(
            [
                '书甲/05-同人设定库/同人设定模板.md',
                '书甲/05-同人设定库/斗罗大陆设定.md',
                '书甲/05-同人设定库/我的设定.md',
            ],
            ['书甲/05-同人设定库'],
        );
        expect(candidates.map(c => c.name)).toEqual(['我的设定']);
    });
});
