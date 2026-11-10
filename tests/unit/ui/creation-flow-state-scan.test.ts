/**
 * creation-flow-state-scan.test.ts — 阶段采集的整库遍历预算与导出语义回归
 *
 * 背景：v4.63 审计（docs/audits/v4.63-collect-creation-flow-perf.md）定位
 * collectCreationFlowState 单次采集含 3 次整库遍历：
 * hasExportArtifact 的 getFiles() + getChaptersForProject 的 getFiles()/getAllLoadedFiles()；
 * 短篇/剧本的 listModeUnits 还会 own + legacy 各扫一次。
 * 本轮收敛为「导出目录局部遍历 + own/legacy 共用一次扫描」，用 fake vault 计数锁定
 * 「长篇 2、短篇/剧本 1」的上限，同时锁定导出判定四种语义不变。
 */
import { describe, expect, it } from 'vitest';
import { App } from '../../__mocks__/obsidian';
import { collectCreationFlowState } from '../../../ui/full-writer/creation-flow-state';

const LONG_META_PATH = '长篇小说/示例/.project';
const LONG_META = ['## 创作模式', '长篇小说', ''].join('\n');
const SHORT_META = ['## 创作模式', '短篇小说', '', '## 目标字数', '30000', '', '## 目标节数', '10', ''].join('\n');

/**
 * 统计整库遍历次数：getFiles + getAllLoadedFiles 都算一次全库扫描。
 * fake vault 的 getAllLoadedFiles 内部会复用 getFiles，这里用标记避免重复计数
 * （真实 Vault 中二者是各自独立的整库遍历）。
 */
function trackVaultScans(app: App): () => number {
    const originGetFiles = app.vault.getFiles;
    const originGetAllLoadedFiles = app.vault.getAllLoadedFiles;
    let filesCalls = 0;
    let loadedCalls = 0;
    let insideLoaded = false;
    app.vault.getFiles = () => {
        if (!insideLoaded) filesCalls += 1;
        return originGetFiles.call(app.vault);
    };
    app.vault.getAllLoadedFiles = () => {
        insideLoaded = true;
        loadedCalls += 1;
        try {
            return originGetAllLoadedFiles.call(app.vault);
        } finally {
            insideLoaded = false;
        }
    };
    return () => filesCalls + loadedCalls;
}

async function makeApp(): Promise<App> {
    const app = new App();
    await app.vault.createFolder('导出文件');
    return app;
}

describe('collectCreationFlowState — 整库遍历预算', () => {
    it('长篇单次采集只做 2 次整库遍历（章节统计），导出检查走目录局部遍历', async () => {
        const app = await makeApp();
        app.vault._seedFile(LONG_META_PATH, LONG_META);
        app.vault._seedFile('长篇小说/示例/03-大纲与章节/正文/第1卷/第1章_正文.md', '# 第1章\n正文');
        await app.vault.createFolder('长篇小说/示例/05-导出');

        const scans = trackVaultScans(app);
        await collectCreationFlowState(app as never, '长篇小说/示例', { mode: 'long' });

        expect(scans()).toBe(2);
    });

    it('短篇新结构单次采集只做 1 次整库遍历（own 与 legacy 共用扫描）', async () => {
        const app = await makeApp();
        app.vault._seedFile('短篇示例/.project', SHORT_META);
        app.vault._seedFile('短篇示例/短篇创作/03-正文/第01节.md', '# 第1节\n正文');

        const scans = trackVaultScans(app);
        const state = await collectCreationFlowState(app as never, '短篇示例', { mode: 'short' });

        expect(scans()).toBe(1);
        expect(state.facts.unitTotal).toBe(1);
    });

    it('短篇旧结构回退仍只做 1 次整库遍历', async () => {
        const app = await makeApp();
        app.vault._seedFile('旧短篇/.project', SHORT_META);
        app.vault._seedFile('旧短篇/03-大纲与章节/正文/第1卷/第1章_正文.md', '旧正文');

        const scans = trackVaultScans(app);
        const state = await collectCreationFlowState(app as never, '旧短篇', { mode: 'short' });

        expect(scans()).toBe(1);
        expect(state.facts.unitTotal).toBe(1);
    });

    it('选择页传入 longChapters 时零整库遍历（P-3 卡片点击复用快照）', async () => {
        const app = await makeApp();
        app.vault._seedFile(LONG_META_PATH, LONG_META);

        const scans = trackVaultScans(app);
        const state = await collectCreationFlowState(app as never, '长篇小说/示例', {
            mode: 'long',
            longChapters: [{ chapter: '第1章', status: 'written', written: true }],
        });

        expect(scans()).toBe(0);
        expect(state.facts.unitTotal).toBe(1);
        expect(state.facts.unitWritten).toBe(1);
    });
});

describe('collectCreationFlowState — 导出判定语义', () => {
    async function flowWithExport(app: App, project: string, mode: 'long' | 'short' | 'script' = 'short') {
        const state = await collectCreationFlowState(app as never, project, { mode });
        return state.facts.exportExists;
    }

    it('无导出目录时不算已导出', async () => {
        const app = await makeApp();
        app.vault._seedFile('无导出示例/.project', SHORT_META);

        expect(await flowWithExport(app, '无导出示例')).toBe(false);
    });

    it('项目导出目录存在但为空时不算已导出', async () => {
        const app = await makeApp();
        app.vault._seedFile('空导出示例/.project', SHORT_META);
        await app.vault.createFolder('空导出示例/05-导出');

        expect(await flowWithExport(app, '空导出示例')).toBe(false);
    });

    it('项目导出目录内有产物时算已导出', async () => {
        const app = await makeApp();
        app.vault._seedFile('有导出示例/.project', SHORT_META);
        app.vault._seedFile('有导出示例/05-导出/有导出示例.epub', 'epub');

        expect(await flowWithExport(app, '有导出示例')).toBe(true);
    });

    it('fallback 导出目录命中项目名时算已导出', async () => {
        const app = await makeApp();
        app.vault._seedFile('回退示例/.project', SHORT_META);
        app.vault._seedFile('导出文件/回退示例_稿.epub', 'epub');

        expect(await flowWithExport(app, '回退示例')).toBe(true);
    });

    it('短篇产物在 短篇创作/05-导出 时算已导出', async () => {
        const app = await makeApp();
        app.vault._seedFile('短篇新目录/.project', SHORT_META);
        app.vault._seedFile('短篇新目录/短篇创作/05-导出/短篇新目录.epub', 'epub');

        expect(await flowWithExport(app, '短篇新目录', 'short')).toBe(true);
    });

    it('剧本产物在 剧本创作/06-导出 时算已导出', async () => {
        const app = await makeApp();
        app.vault._seedFile('剧本新目录/.project', SHORT_META);
        app.vault._seedFile('剧本新目录/剧本创作/06-导出/剧本新目录.docx', 'docx');

        expect(await flowWithExport(app, '剧本新目录', 'script')).toBe(true);
    });

    it('剧本旧版根目录 06-导出 仍算已导出（兼容）', async () => {
        const app = await makeApp();
        app.vault._seedFile('旧剧本/.project', SHORT_META);
        app.vault._seedFile('旧剧本/06-导出/旧剧本.epub', 'epub');

        expect(await flowWithExport(app, '旧剧本', 'script')).toBe(true);
    });

    it('短篇新目录与旧根目录都为空时不算已导出', async () => {
        const app = await makeApp();
        app.vault._seedFile('双空示例/.project', SHORT_META);
        await app.vault.createFolder('双空示例/短篇创作/05-导出');
        await app.vault.createFolder('双空示例/05-导出');

        expect(await flowWithExport(app, '双空示例', 'short')).toBe(false);
    });
});
