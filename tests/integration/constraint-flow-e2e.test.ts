/**
 * 阶段 A3：约束流端到端（官方考据 → 同人设定 → 审核闸门 → 绑定 → 注入）
 *
 * 长期目标（docs/LONG-TERM-GOAL.md）阶段 A 的第三条链路自证。
 *
 * **不 mock 中间层**：真实 Vault 读写、真实 `attachFanficPathToProject` 绑定、
 * 真实 `readFanficRules` 解析、真实 `formatFanficRulesForPrompt` 注入。
 *
 * 要守住的三件事：
 * 1. **审核闸门不可绕过**：pending / rejected 的设定**不能**绑定到项目
 * 2. **绑定后真的生效**：绑定 → 读取 → 注入，内容进入 prompt
 * 3. **断链可诊断**：未绑定 / 文件缺失 / 文件损坏都有明确的 loadError，不静默
 */

import { describe, expect, it } from 'vitest';
import { App, TFile, Vault } from 'obsidian';
import { attachFanficPathToProject, buildFanficSettingsContent, fanficSettingsFileName } from '../../ui/full-writer/fanfic-settings-utils';
import { applyFanficReviewMeta } from '../../shared/fanfic-audit';
import { formatFanficRulesForPrompt, parseFanficReviewStatus, readFanficRules } from '../../shared/fanfic-rules';
import { pjFanficDir, pjFanficPendingDir, pjProjectMeta } from '../../shared/paths';

const PROJECT = '长篇小说/同人测试';

/** 构造同人设定正文 */
function draftWith(reviewStatus: 'approved' | 'pending' | 'rejected'): string {
    const skeleton = buildFanficSettingsContent({
        workName: '测试原作',
        workType: '长篇',
        author: '原作者',
        worldviewType: '修真世界，宗门林立',
        powerSystem: '练气、筑基、金丹、元婴',
        coreRules: '修为不可越级挑战，越级必遭反噬',
        mustFollow: '主角的出身与师门关系不可改动',
        adaptScope: '可以增加配角与支线剧情',
        redlines: '不得改变原作结局与核心人物的生死',
    });
    return applyFanficReviewMeta(skeleton, {
        '审核状态': reviewStatus,
        '审核人': '测试审核员',
        '审核时间': new Date().toISOString(),
    });
}

/** 建 vault 并写入一个设定文件 */
async function makeVaultWithSettings(
    reviewStatus: 'approved' | 'pending' | 'rejected',
    inPendingDir = false,
): Promise<{ app: App; path: string; content: string }> {
    const vault = new Vault();
    const content = draftWith(reviewStatus);
    const dir = inPendingDir ? pjFanficPendingDir(PROJECT) : pjFanficDir(PROJECT);
    await vault.createFolder(dir);
    const path = `${dir}/${fanficSettingsFileName('测试原作')}`;
    await vault.create(path, content);
    // .project 先声明为同人项目（绑定前）
    await vault.create(pjProjectMeta(PROJECT), `# ${PROJECT}\n\n## 类型\nfanfic\n`);
    return { app: { vault } as unknown as App, path, content };
}

describe('阶段 A3：约束流端到端', () => {
    it('已审核设定绑定后，约束真正进入 prompt', async () => {
        const { app, path } = await makeVaultWithSettings('approved');

        // 1) 绑定（绑定函数自身校验审核状态）
        await attachFanficPathToProject(app, PROJECT, path);

        // 2) 读取
        const rules = await readFanficRules(app, PROJECT);
        expect(rules.isFanfic).toBe(true);
        expect(rules.path).toBe(path);
        expect(rules.reviewStatus).toBe('approved');
        expect(rules.worldviewType).toContain('修真');

        // 3) 注入
        const prompt = formatFanficRulesForPrompt(rules);
        expect(prompt).toContain('修真世界');
        expect(prompt).toContain('练气');
        expect(prompt).toContain('不得改变原作结局');
    });

    it('待审核设定不能绑定到项目（审核闸门）', async () => {
        const { app, path } = await makeVaultWithSettings('pending');
        await expect(attachFanficPathToProject(app, PROJECT, path))
            .rejects.toThrow(/尚未通过人工审核/);
    });

    it('已驳回设定同样不能绑定', async () => {
        const { app, path } = await makeVaultWithSettings('rejected');
        await expect(attachFanficPathToProject(app, PROJECT, path))
            .rejects.toThrow(/尚未通过人工审核/);
    });

    it('未绑定设定时读取返回空规则且标明是同人项目（不静默当成原创）', async () => {
        const vault = new Vault();
        await vault.create(pjProjectMeta(PROJECT), `# ${PROJECT}\n\n## 类型\nfanfic\n`);
        const app = { vault } as unknown as App;

        const rules = await readFanficRules(app, PROJECT);
        expect(rules.isFanfic).toBe(true);
        expect(rules.loadError).toBe('missing-path');
        // 空规则注入必须是空串，不能产出「必须遵守：（空）」这种假约束
        expect(formatFanficRulesForPrompt(rules)).toBe('');
    });

    it('绑定后文件被删除时读取给出 missing-file（断链可诊断）', async () => {
        const { app, path } = await makeVaultWithSettings('approved');
        await attachFanficPathToProject(app, PROJECT, path);

        // 模拟文件被删：新 vault 里只有 .project，没有设定文件
        const emptyVault = new Vault();
        const metaFile = (app.vault as Vault).getAbstractFileByPath(pjProjectMeta(PROJECT)) as TFile;
        const meta = await (app.vault as Vault).read(metaFile);
        await emptyVault.create(pjProjectMeta(PROJECT), meta);
        const appWithoutFile = { vault: emptyVault } as unknown as App;

        const rules = await readFanficRules(appWithoutFile, PROJECT);
        expect(rules.isFanfic).toBe(true);
        expect(rules.loadError).toBe('missing-file');
    });

    it('骨架占位不算内容：未填字段不产生假约束', async () => {
        const vault = new Vault();
        await vault.createFolder(pjFanficDir(PROJECT));
        const skeletonOnly = buildFanficSettingsContent({
            workName: '空壳',
            workType: '（待补充）',
            author: '（待补充）',
            worldviewType: '（待补充）',
            powerSystem: '（待补充）',
            coreRules: '（待补充）',
            mustFollow: '（待补充）',
            adaptScope: '（待补充）',
            redlines: '（待补充）',
        });
        const content = applyFanficReviewMeta(skeletonOnly, { '审核状态': 'approved' });
        const path = `${pjFanficDir(PROJECT)}/${fanficSettingsFileName('空壳')}`;
        await vault.create(path, content);
        await vault.create(pjProjectMeta(PROJECT), `# ${PROJECT}\n\n## 类型\nfanfic\n\n## 同人设定路径\n${path}\n`);
        const app = { vault } as unknown as App;

        const rules = await readFanficRules(app, PROJECT);
        expect(parseFanficReviewStatus(content)).toBe('approved');
        // 占位被解析阶段丢弃 → 注入为空
        expect(formatFanficRulesForPrompt(rules)).toBe('');
    });
});
