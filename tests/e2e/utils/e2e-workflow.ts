/**
 * e2e-workflow.ts — 新 E2E 用例共享的真实 Obsidian 操作
 *
 * 覆盖「创建长篇项目（UI）→ 准备章节骨架 → 打开工作台/协同视图 → 导出」。
 * 所有页面内调用都通过 Obsidian 公共实例（window.app）完成，不依赖产品代码内部导出。
 */
import { expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
    executeCommand,
    toObsidianCommandId,
    waitForModalPage,
    type TestVault,
} from './obsidian-app';

export const PLUGIN_ID = 'novel-writer-ai';
export const FULL_WRITER_VIEW_TYPE = 'novel-writer-full-writer';
export const CO_WRITING_VIEW_TYPE = 'novel-writer-co-writing';
export const AGENT_WORKBENCH_VIEW_TYPE = 'novel-writer-agent-workbench';
export const MONITOR_A_VIEW_TYPE = 'nw-float-monitor-a';
export const MONITOR_B_VIEW_TYPE = 'nw-float-monitor-b';

export interface SeededChapter {
    /** vault 相对路径（正斜杠，可直接传给插件 API） */
    bodyRel: string;
    /** 磁盘绝对路径（Node 侧断言用） */
    bodyAbs: string;
    stepRel: string;
    stepAbs: string;
    projectRootAbs: string;
}

function toPosix(value: string): string {
    return value.split(path.sep).join('/');
}

/**
 * 通过 UI 创建一个长篇项目（覆盖创建弹窗入口）。
 * @param page - 工作区页面
 * @param projectName - 项目名
 * @param genre - 题材
 * @returns 项目 ID（例如 长篇小说/xxx）
 */
export async function createLongProjectViaUi(
    page: Page,
    projectName: string,
    genre = '玄幻',
): Promise<string> {
    // 首启欢迎弹窗由 setTimeout(1000) 打开，且可能晚于插件就绪；
    // 连续 6 次轮询关闭，覆盖「关闭后才弹出」的竞态。
    for (let attempt = 0; attempt < 6; attempt++) {
        for (const candidate of page.context().pages()) {
            await candidate.evaluate(() => {
                document.querySelectorAll<HTMLElement>('.modal-container .modal-close-button')
                    .forEach(el => el.click());
            }).catch(() => undefined);
        }
        await page.waitForTimeout(500);
    }
    expect(await executeCommand(page, toObsidianCommandId('novel-writer-create-project'))).toBe(true);

    const modalPage = await waitForModalPage(page, 20_000);
    const modal = modalPage.locator('.modal-container').last();
    await expect(modal).toBeVisible();
    await expect(modal.locator('.nw-story-structure-card')).toHaveCount(5);

    await modal.getByRole('button', { name: /智能随机/ }).click();
    await expect(modal.locator('.nw-story-warning-ok')).toBeVisible();
    await modal.locator('input[placeholder*="项目名称"]').fill(projectName);
    await modal.locator('input[placeholder*="题材"]').fill(genre);
    await modal.getByRole('button', { name: '创建项目', exact: true }).click();

    const view = page.locator(`.workspace-leaf-content[data-type="${FULL_WRITER_VIEW_TYPE}"]`);
    await expect(view).toBeVisible({ timeout: 90_000 });

    const projectId = `长篇小说/${projectName}`;
    const projectCard = page.locator(`.novel-writer-fw-project-card[data-project="${projectId}"]`);
    await expect(projectCard).toBeVisible({ timeout: 30_000 });
    return projectId;
}

/**
 * 通过 vault API 写入一个主角卡（让上下文必做输入「人物状态」通过）。
 *
 * @param page - 工作区页面
 * @param projectId - 项目 ID
 * @param name - 主角名
 */
export async function seedCharacterViaVault(page: Page, projectId: string, name = '林玄'): Promise<void> {
    await page.evaluate(async ({ project, characterName }) => {
        const app = (window as unknown as {
            app?: { vault?: { create?: (path: string, content: string) => Promise<unknown>; createFolder?: (path: string) => Promise<unknown>; getAbstractFileByPath?: (path: string) => unknown } };
        }).app;
        const folder = `${project}/01-世界架构/人物`;
        const path = `${folder}/${characterName}.md`;
        if (app?.vault?.getAbstractFileByPath?.(path)) return;
        if (!app?.vault?.getAbstractFileByPath?.(folder)) {
            await app?.vault?.createFolder?.(folder);
        }
        const content = [
            '---',
            `姓名: ${characterName}`,
            '身份: 主角',
            '年龄: 18',
            '性别: 男',
            '核心动机: 查明身世并守住外门',
            '核心驱动力_软肋: 害怕再次失去同伴',
            '习惯性小动作: 紧张时摩挲掌心旧疤',
            '当前状态: 外门弟子',
            '当前情绪: 压抑',
            '当前位置: 青云宗外门',
            '性格标签: 隐忍,果决',
            '---',
            '',
            `# ${characterName}`,
            '',
            '## 确定性设定',
            '- 外貌：清瘦，掌心有一道旧疤。',
            '',
        ].join(String.fromCharCode(10));
        await app?.vault?.create?.(path, content);
    }, { project: projectId, characterName: name });
    await page.waitForTimeout(300);
}

/**
 * 在临时 vault 中写入章节正文和可选的步骤结果文件。
 *
 * 必须走 Obsidian 的 vault API（而不是 Node fs）：直接写盘要等文件监听器索引，
 * 工作台用 getAbstractFileByPath 找正文时可能还看不到文件。
 * @param page - 工作区页面
 * @param vault - 临时 vault
 * @param projectId - 项目 ID
 * @param chapterNum - 章号
 * @param title - 章名
 * @param body - 正文（不含标题）
 * @param options - status / 分析报告
 * @returns SeededChapter 实例
 */
export async function seedChapter(
    page: Page,
    vault: TestVault,
    projectId: string,
    chapterNum: number,
    title: string,
    body: string,
    options: { status?: string; analysisReport?: string } = {},
): Promise<SeededChapter> {
    const projectRootRel = `${projectId}/03-大纲与章节`;
    const bodyRel = `${projectRootRel}/正文/第1卷/第${chapterNum}章_正文.md`;
    const stepRel = `${projectRootRel}/步骤结果/第1卷/第${chapterNum}章`;
    const bodyAbs = path.join(vault.path, bodyRel);
    const stepAbs = path.join(vault.path, stepRel);
    const projectRootAbs = path.join(vault.path, projectId);
    const reportRel = options.analysisReport
        ? `${stepRel}/第${chapterNum}章_分析报告.md`
        : '';

    const bodyContent = [
        '---',
        'tags: [正文]',
        `status: ${options.status || 'drafting'}`,
        `标题: ${title}`,
        '---',
        '',
        `# 第${chapterNum}章 ${title}`,
        '',
        body,
        '',
    ].join('\n');

    await page.evaluate(async ({ bodyPath, bodyText, reportPath, reportText }) => {
        const app = (window as unknown as {
            app?: {
                vault?: {
                    adapter?: { mkdir?: (path: string) => Promise<void> };
                    getAbstractFileByPath?: (path: string) => unknown;
                    create?: (path: string, content: string) => Promise<unknown>;
                    modify?: (file: unknown, content: string) => Promise<void>;
                };
            };
        }).app;
        const vault = app?.vault;
        if (!vault?.adapter?.mkdir || !vault.create) throw new Error('vault API 不可用');

        const dirs = [bodyPath.split('/').slice(0, -1).join('/')];
        if (reportPath) dirs.push(reportPath.split('/').slice(0, -1).join('/'));
        const ensureDir = async (dir: string): Promise<void> => {
            const parts = dir.split('/').filter(Boolean);
            let current = '';
            for (const part of parts) {
                current = current ? `${current}/${part}` : part;
                await vault.adapter?.mkdir?.(current).catch(() => undefined);
            }
        };
        for (const dir of dirs) {
            if (dir) await ensureDir(dir);
        }

        const write = async (path: string, content: string): Promise<void> => {
            const existing = vault.getAbstractFileByPath?.(path);
            if (existing && vault.modify) {
                await vault.modify(existing, content);
            } else {
                await vault.create?.(path, content);
            }
        };
        await write(bodyPath, bodyText);
        if (reportPath && reportText) await write(reportPath, reportText);
    }, {
        bodyPath: toPosix(bodyRel),
        bodyText: bodyContent,
        reportPath: reportRel ? toPosix(reportRel) : '',
        reportText: options.analysisReport || '',
    });

    return {
        bodyRel: toPosix(bodyRel),
        bodyAbs,
        stepRel: toPosix(stepRel),
        stepAbs,
        projectRootAbs,
    };
}

/**
 * 打开完整写作工作台并绑定指定章节。
 * @param page - 工作区页面
 * @param projectId - 项目 ID
 * @param bodyRel - 正文 vault 相对路径
 * @param chapterName - 章名（如 第1章）
 */
export async function openChapterInFullWriter(
    page: Page,
    projectId: string,
    bodyRel: string,
    chapterName: string,
): Promise<void> {
    // 外部 fs 写入的章节要等 Obsidian 文件监听把它纳入 vault 索引，
    // 否则 openChapterByPath 会 getAbstractFileByPath 失败并停在项目页。
    await page.waitForFunction(
        path => Boolean((window as unknown as { app?: { vault?: { getAbstractFileByPath?: (p: string) => unknown } } }).app?.vault?.getAbstractFileByPath?.(path)),
        bodyRel,
        { timeout: 15_000 },
    ).catch(() => undefined);
    await page.evaluate(({ project, chapter }) => {
        const app = (window as unknown as {
            app?: {
                plugins?: { plugins?: Record<string, { openChapterInFullWriter?: (p: string, c: string) => void }> };
            };
        }).app;
        app?.plugins?.plugins?.['novel-writer-ai']?.openChapterInFullWriter?.(project, chapter);
    }, { project: projectId, chapter: bodyRel });

    await expect(page.locator('.novel-writer-fw-prompt-area')).toBeVisible({ timeout: 30_000 });
    await page.waitForFunction(({ project, chapter }) => {
        const app = (window as unknown as {
            app?: {
                workspace?: { getLeavesOfType?: (type: string) => Array<{ view?: unknown }> };
            };
        }).app;
        const leaf = app?.workspace?.getLeavesOfType?.('novel-writer-full-writer')?.[0];
        const view = leaf?.view as { project?: string; chapterName?: string; chapDir?: string } | undefined;
        return Boolean(view && view.project === project && view.chapterName === chapter && view.chapDir);
    }, { project: projectId, chapter: chapterName }, { timeout: 30_000 });
    await expect(page.locator('.nw-step-actionbar')).toBeVisible({ timeout: 20_000 });
}

const STEP_INDEXES: Record<string, number> = {
    context: 0,
    infoPlan: 1,
    plotDistill: 2,
    characterSoul: 3,
    outline: 4,
    emotionPlan: 5,
    sceneExpand: 6,
    bodyGeneration: 7,
    qualityControl: 8,
    analysisReport: 9,
    settlement: 10,
};

/**
 * 把工作台切到指定步骤。直接操作视图运行时状态，避免步骤导航折叠造成的脆弱选择器。
 * @param page - 工作区页面
 * @param stepKey - 步骤 key
 */
export async function selectWriterStep(page: Page, stepKey: string): Promise<void> {
    const index = STEP_INDEXES[stepKey];
    expect(index, `未知步骤 key: ${stepKey}`).not.toBeUndefined();

    const switched = await page.evaluate(async ({ stepIndex }) => {
        const app = (window as unknown as {
            app?: { workspace?: { getLeavesOfType?: (type: string) => Array<{ view?: unknown }> } };
        }).app;
        const leaf = app?.workspace?.getLeavesOfType?.('novel-writer-full-writer')?.[0];
        const view = leaf?.view as {
            chapterStateManager?: { currentStepIndex?: number };
            renderInContainer?: (container: HTMLElement) => Promise<void>;
            tabContent?: HTMLElement;
        } | undefined;
        if (!view?.chapterStateManager || !view.renderInContainer || !view.tabContent) return false;
        view.chapterStateManager.currentStepIndex = stepIndex as number;
        await view.renderInContainer(view.tabContent);
        return true;
    }, { stepIndex: index });

    expect(switched).toBe(true);
    await expect(page.locator('.nw-step-actionbar')).toBeVisible({ timeout: 20_000 });
}

/**
 * 调用工作台「一键完成本章」/「逐步完成本章」并等待整条链路结束。
 * @param page - 工作区页面
 * @param mode - recommended=合并规划；step=逐步规划
 * @returns 链路结束后已完成步骤 key 列表
 */
export async function runChapterFromWorkbench(
    page: Page,
    mode: 'recommended' | 'step' = 'step',
): Promise<string[]> {
    const result = await page.evaluate(async ({ runMode }) => {
        const app = (window as unknown as {
            app?: { workspace?: { getLeavesOfType?: (type: string) => Array<{ view?: unknown }> } };
        }).app;
        const leaf = app?.workspace?.getLeavesOfType?.('novel-writer-full-writer')?.[0];
        const view = leaf?.view as {
            runChapterOneClick?: (m: string) => Promise<void>;
            stepCompleted?: Set<string>;
            executionStore?: { getFailures?: () => Array<{ message?: string }>; getEvents?: () => Array<{ message?: string }> };
        } | undefined;
        if (!view?.runChapterOneClick) throw new Error('未找到完整写作工作台视图');
        await view.runChapterOneClick(runMode);
        return {
            completed: Array.from(view.stepCompleted || []),
            failures: (view.executionStore?.getFailures?.() || []).map(item => item.message || ''),
            events: (view.executionStore?.getEvents?.() || []).slice(-8).map(item => item.message || ''),
            debug: {
                hasRun: typeof view.runChapterOneClick,
                hasStore: Boolean(view.executionStore),
                project: (view as { project?: string }).project,
                chapterName: (view as { chapterName?: string }).chapterName,
                chapDir: (view as { chapDir?: string }).chapDir,
            },
        };
    }, { runMode: mode });
    if (result.failures.length > 0) {
        throw new Error(`工作台步骤失败：${result.failures.join('; ')} | 已完成：${result.completed.join(',')}`);
    }
    if (result.completed.length === 0) {
        throw new Error(`工作台未完成任何步骤：${JSON.stringify(result)}`);
    }
    return result.completed;
}

/** 读取文件；不存在返回空串 */
export function readTextIfExists(filePath: string): string {
    try {
        return fs.readFileSync(filePath, 'utf8');
    } catch {
        return '';
    }
}

/** 等待磁盘文件出现 */
export async function waitForFile(filePath: string, timeout = 30_000): Promise<void> {
    await expect.poll(() => fs.existsSync(filePath), { timeout }).toBe(true);
}

/** 列出目录下指定扩展名的文件（不存在返回空数组） */
export function listFilesWithExtension(dir: string, extension: string): string[] {
    try {
        return fs.readdirSync(dir)
            .filter((name) => name.toLowerCase().endsWith(extension.toLowerCase()))
            .map((name) => path.join(dir, name));
    } catch {
        return [];
    }
}

/**
 * 通过「成稿导出」UI 导出 TXT 并断言落盘非空。
 *
 * 桌面端默认走 `<a download>`；测试环境把 app.isMobile 临时置为 true，
 * 走同一导出逻辑的 vault 回退路径（导出文件/），避免依赖 Electron 下载事件。
 * @param page - 工作区页面
 * @param vaultPath - 临时 vault 根目录
 * @returns 导出的 TXT 绝对路径
 */
export async function exportTxtViaUi(page: Page, vaultPath: string): Promise<string> {
    const mobileForced = await page.evaluate(() => {
        const app = (window as unknown as { app?: Record<string, unknown> }).app;
        if (!app) return false;
        try {
            Object.defineProperty(app, 'isMobile', { value: true, configurable: true, writable: true });
        } catch {
            try {
                (app as { isMobile?: boolean }).isMobile = true;
            } catch {
                return false;
            }
        }
        return (app as { isMobile?: boolean }).isMobile === true;
    });

    expect(await executeCommand(page, toObsidianCommandId('novel-writer-export-manuscript'))).toBe(true);
    const modalPage = await waitForModalPage(page, 20_000);
    const modal = modalPage.locator('.modal-container').last();
    await expect(modal).toBeVisible();

    const selects = modal.locator('select:visible');
    await expect.poll(() => selects.count(), { timeout: 10_000 }).toBe(2);
    await selects.nth(1).selectOption('text');

    const exportButton = modal.getByRole('button', { name: /^导出$/ });
    await expect(exportButton).toBeEnabled();

    if (mobileForced) {
        await exportButton.click();
    } else {
        // 兜底：无法改写 isMobile 时，抓 Electron 下载事件
        const downloadPromise = modalPage.waitForEvent('download', { timeout: 30_000 }).catch(() => null);
        await exportButton.click();
        const download = await downloadPromise;
        if (download) {
            const dir = path.join(vaultPath, '导出文件');
            fs.mkdirSync(dir, { recursive: true });
            const target = path.join(dir, 'e2e-export.txt');
            await download.saveAs(target);
        }
    }

    const exportDir = path.join(vaultPath, '导出文件');
    await expect.poll(() => listFilesWithExtension(exportDir, '.txt').length, { timeout: 30_000 })
        .toBeGreaterThan(0);

    // 恢复桌面语义，避免后续步骤走移动端分支
    await page.evaluate(() => {
        const app = (window as unknown as { app?: Record<string, unknown> }).app;
        if (!app) return;
        try {
            Object.defineProperty(app, 'isMobile', { value: false, configurable: true, writable: true });
        } catch {
            try {
                (app as { isMobile?: boolean }).isMobile = false;
            } catch {
                // ignore
            }
        }
    });

    const exported = listFilesWithExtension(exportDir, '.txt')[0];
    expect(exported, '未找到导出的 TXT 文件').toBeTruthy();
    expect(fs.statSync(exported).size).toBeGreaterThan(0);
    return exported;
}
