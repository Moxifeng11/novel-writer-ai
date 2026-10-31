import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
    describeSkipReason,
    isObsidianE2EEnabled,
    launchObsidian,
    waitForPluginLoaded,
    type ObsidianSession,
} from './utils/obsidian-app';

/**
 * 真实链路：重置并重写指定章节（消耗 API 额度，默认跳过）
 *
 * 用途：改了正文提示词/对话骨架后，用同一套真实管线把章节重写一遍，再拿去外部检测对比。
 *
 * 启用：OBSIDIAN_PATH=... E2E_REWRITE=1 [E2E_REWRITE_CHAPTERS=1,2]
 */

const REAL_VAULT = process.env.E2E_VAULT_PATH?.trim() || 'D:/小说工坊/小说工坊';
const PROJECT = process.env.E2E_REAL_PROJECT?.trim() || '长篇小说/九霄逆脉行';
const VOLUME = '第1卷';
const CHAPTERS = (process.env.E2E_REWRITE_CHAPTERS || '1,2')
    .split(',')
    .map((n) => parseInt(n.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
const BACKUP_DIR = '重写备份';
const BUDGET_MS = 30 * 60_000;

function bodyPath(chapterNum: number): string {
    const dir = path.join(REAL_VAULT, PROJECT, '03-大纲与章节', '正文', VOLUME);
    if (!fs.existsSync(dir)) return path.join(dir, `第${chapterNum}章_正文.md`);
    const hit = fs.readdirSync(dir).find((name) => name.startsWith(`第${chapterNum}章`) && name.endsWith('_正文.md'));
    return hit ? path.join(dir, hit) : path.join(dir, `第${chapterNum}章_正文.md`);
}

test.describe('Novel Writer AI · 重写章节（真实管线）', () => {
    test.describe.configure({ mode: 'serial' });
    test.skip(!isObsidianE2EEnabled(), describeSkipReason());
    test.skip(process.env.E2E_REWRITE !== '1', '未设置 E2E_REWRITE=1：会重置并重写真实章节，需显式开启');

    let session: ObsidianSession;

    test.beforeAll(async () => {
        session = await launchObsidian({ path: REAL_VAULT });
        // 把渲染进程异常带回终端：run-error 时执行事件里只有摘要，缺少堆栈
        session.page.on('pageerror', (error) => console.error('[rewrite pageerror]', error.message));
        session.page.on('console', (message) => {
            if (message.type() === 'error') console.error('[rewrite console]', message.text());
        });
        await waitForPluginLoaded(session.page, 120_000);
        await session.page.waitForTimeout(3_000);
    });

    test.afterAll(async () => {
        await session?.close().catch(() => undefined);
    });

    test('仅结算探针（不烧 AI）：打开已写完的章并触发 settle', async () => {
        test.skip(process.env.E2E_SETTLE_ONLY !== '1', '仅排查结算链路时启用');
        test.setTimeout(5 * 60_000);
        const { page } = session;
        const body = bodyPath(1);
        const opened = await page.evaluate(async ({ project, bodyRel }) => {
            const host = window as unknown as {
                app?: {
                    workspace?: { getLeavesOfType(type: string): Array<{ view: Record<string, any> }> };
                    plugins?: { plugins?: Record<string, { openFullWriterView(): Promise<void> }> };
                };
            };
            const plugin = host.app?.plugins?.plugins?.['novel-writer-ai'];
            if (!plugin) return 'no-plugin';
            await plugin.openFullWriterView();
            const leaf = host.app?.workspace?.getLeavesOfType('novel-writer-full-writer')[0];
            const view = leaf?.view as Record<string, any>;
            if (!view?.openChapterByPath) return 'no-view';
            await view.openChapterByPath(project, bodyRel);
            await new Promise(r => setTimeout(r, 1500));
            const stepResults = view.stepResults || {};
            const result = await view.stepRunner.executeSettlement(
                view.project, view.chapDir, view.chapterName,
                stepResults, view.stepCompleted, view.vars, view.plugin,
                async () => undefined, view.tabContent,
            );
            const recent = (view.plugin.getExecutionLedgerRecords?.(3) ?? [])[0] ?? null;
            return JSON.stringify({
                ledgerRecord: recent ? { status: recent.status, failure: recent.failure, detail: recent.detail, settlement: recent.settlement } : null,
                project: view.project, chapDir: view.chapDir,
                analysisChars: (stepResults['analysisReport'] || '').length,
                bodyChars: (stepResults['bodyGeneration'] || '').length,
                settled: view.stepCompleted.has('settlement'),
                resultType: typeof result,
            });
        }, { project: PROJECT, bodyRel: path.relative(REAL_VAULT, body).split('\\').join('/') });
        console.log('SETTLE_PROBE', opened);
    });

    test('重置指定章节并逐章一键成文', async () => {
        test.skip(process.env.E2E_SETTLE_ONLY === '1', 'SETTLE_ONLY 模式只跑结算探针，不烧 AI');
        test.setTimeout(CHAPTERS.length * BUDGET_MS + 10 * 60_000);
        const { page } = session;

        for (const chapterNum of CHAPTERS) {
            const chapterName = `第${chapterNum}章`;
            const body = bodyPath(chapterNum);
            const relativeBody = path.relative(REAL_VAULT, body).replace(/\\/g, '/');
            const stepDir = `${PROJECT}/03-大纲与章节/步骤结果/${VOLUME}/${chapterName}`;
            const backupDir = `${BACKUP_DIR}/${chapterName}-${Date.now()}`;

            // 1) 备份旧产物（步骤结果 + 正文），再把正文重置为骨架
            const reset = await page.evaluate(async ({ relativeBody: rel, stepDir: dir, backupDir: backup, chapterName: name, project, volume }) => {
                const host = window as unknown as {
                    app?: {
                        vault?: {
                            adapter?: {
                                read(p: string): Promise<string>;
                                write(p: string, c: string): Promise<void>;
                                exists(p: string): Promise<boolean>;
                                mkdir(p: string): Promise<void>;
                                remove(p: string): Promise<void>;
                                list(p: string): Promise<{ files: string[]; folders: string[] }>;
                            };
                        };
                    };
                };
                const adapter = host.app?.vault?.adapter;
                if (!adapter) return { ok: false, reason: 'no-adapter' };
                const ensure = async (folder: string) => {
                    const parts = folder.split('/').filter(Boolean);
                    let cur = '';
                    for (const part of parts) {
                        cur = cur ? `${cur}/${part}` : part;
                        if (!(await adapter.exists(cur))) await adapter.mkdir(cur);
                    }
                };
                // 备份步骤结果目录
                let backedUp = 0;
                if (await adapter.exists(dir)) {
                    await ensure(backup);
                    const listing = await adapter.list(dir);
                    for (const file of listing.files) {
                        const target = `${backup}/${file.split('/').pop()}`;
                        await adapter.write(target, await adapter.read(file));
                        backedUp++;
                    }
                    // 步骤结果不删：正文已重置为骨架，编排器会按骨架重新生成；
                    // 备份只是保险（确认新稿更好后可手动清理）。
                }
                // 正文重置为骨架（保留 title 之外的 frontmatter 最小集）
                const skeleton = [
                    '---',
                    `卷: "${volume}"`,
                    `章: "${name}"`,
                    '标题: ""',
                    'status: pending',
                    'word_count: 0',
                    'writing_mode: pipeline',
                    '涉及人物: []',
                    '涉及地点: []',
                    '涉及势力: []',
                    '涉及物品功法: []',
                    '---',
                    '',
                    `# ${name}`,
                    '',
                ].join('\n');
                await adapter.write(rel, skeleton);
                // v4.25：所有「第N章_类型.md」步骤结果都重置为 pending 骨架。
                // 只重置正文/Scene 不够——旧 infoPlan（可能来自全书规划期、引用后续章）
                // 会被幂等跳过直接复用，上下文体检会以「串章」告警（本次实测即如此）。
                let stepReset = 0;
                const listing2 = await adapter.list(dir);
                // 历史遗留：旧版落盘缺陷产生的无章名「第N章_正文.md」与带章名文件并存，
                // 会继续吸引新稿写到错误文件；重置时直接清掉（内容已备份在 重写备份/）。
                for (const legacy of listing2.files) {
                    const legacyName = legacy.split('/').pop() || '';
                    if (legacyName === `${name}_正文.md`) {
                        await adapter.remove(legacy);
                    }
                }
                for (const file of listing2.files) {
                    const fileName = file.split('/').pop() || '';
                    if (!new RegExp(`^${name}_.+\\.md$`).test(fileName)) continue;
                    const type = fileName.slice(name.length + 1).replace(/\.md$/, '');
                    await adapter.write(file, [
                        '---',
                        'step_status: pending',
                        '---',
                        '',
                        `# ${type}`,
                        '',
                    ].join('\n'));
                    stepReset++;
                }
                return { ok: true, backedUp, stepReset, sceneReset: await adapter.exists(`${dir}/${name}_Scene展开.md`) };
            }, { relativeBody, stepDir, backupDir, chapterName, project: PROJECT, volume: VOLUME });
            console.log(`REWRITE_RESET ${chapterName}`, JSON.stringify(reset));
            expect(reset.ok).toBe(true);

            // 2) 打开工作台并定位章节
            const opened = await page.evaluate(async ({ project, bodyPath: p, bodyRel }) => {
                const host = window as unknown as {
                    app?: {
                        workspace?: { getLeavesOfType(type: string): Array<{ view: unknown }> };
                        plugins?: { plugins?: Record<string, { openFullWriterView(): Promise<void> }> };
                    };
                };
                const plugin = host.app?.plugins?.plugins?.['novel-writer-ai'];
                if (!plugin) return 'no-plugin';
                await plugin.openFullWriterView();
                const leaf = host.app?.workspace?.getLeavesOfType('novel-writer-full-writer')[0];
                const view = leaf?.view as {
                    openChapterByPath?(a: string, b: string): Promise<void>;
                    project?: string; chapterName?: string; chapDir?: string;
                } | undefined;
                if (!view?.openChapterByPath) return 'no-view';
                const readState = () => JSON.stringify({
                    project: view.project ?? '',
                    chapterName: view.chapterName ?? '',
                    chapDir: view.chapDir ?? '',
                });
                try {
                    // 必须用 vault 相对路径：openChapterByPath 走 getAbstractFileByPath，
                    // 绝对路径（含盘符）在 vault 索引里不存在 → 静默 Notice
                    await view.openChapterByPath(project, bodyRel);
                    const first = readState();
                    if (JSON.parse(first).chapDir) return first;
                    await new Promise(resolve => setTimeout(resolve, 800));
                    await view.openChapterByPath(project, bodyRel);
                    await new Promise(resolve => setTimeout(resolve, 800));
                    return readState();
                } catch (error) {
                    return `open-threw: ${(error as Error).message}`;
                }
            }, { project: PROJECT, bodyPath: body, bodyRel: relativeBody });
            console.log('REWRITE_OPEN', opened);
            expect(['ok', 'no-view'].includes(opened)).toBe(false);
            expect(opened && !opened.startsWith('open-threw')).toBe(true);
            const openedState = JSON.parse(opened as string) as { chapDir?: string };
            expect(openedState.chapDir).not.toBe('');
            await page.waitForTimeout(2_000);

            // 3) 一键成文（不 await，轮询终态）
            const started = await page.evaluate(() => {
                const host = window as unknown as {
                    app?: { workspace?: { getLeavesOfType(type: string): Array<{ view: unknown }> } };
                };
                const leaf = host.app?.workspace?.getLeavesOfType('novel-writer-full-writer')[0];
                const view = leaf?.view as {
                    runChapterOneClick?(mode: string): Promise<unknown>;
                    executionStore?: { getEvents(): Array<{ type?: string }> };
                } | undefined;
                if (!view?.runChapterOneClick) return { ok: false, before: 0 };
                const before = view.executionStore ? view.executionStore.getEvents().length : 0;
                (window as unknown as { __nwRewrite?: Promise<unknown> }).__nwRewrite =
                    view.runChapterOneClick('recommended').catch((error: unknown) => console.error('[rewrite] 失败:', error));
                return { ok: true, before };
            });
            expect(started.ok).toBe(true);

            const deadline = Date.now() + BUDGET_MS;
            let terminal: string | null = null;
            while (!terminal && Date.now() < deadline) {
                await page.waitForTimeout(5_000);
                terminal = await page.evaluate((from: number) => {
                    const host = window as unknown as {
                        app?: { workspace?: { getLeavesOfType(type: string): Array<{ view: unknown }> } };
                    };
                    const leaf = host.app?.workspace?.getLeavesOfType('novel-writer-full-writer')[0];
                    const view = leaf?.view as {
                        executionStore?: { getEvents(): Array<{ type?: string; stepKey?: string }> };
                    } | undefined;
                    const events = view?.executionStore?.getEvents().slice(from) ?? [];
                    const done = events.find((e) => ['run-complete', 'run-error', 'run-aborted', 'run-cancelled']
                        .includes(String(e.type ?? '')));
                    // 失败时把最近事件带回 Node（page 里的 console.log 不会进 Playwright 终端）
                    return done ? JSON.stringify({ type: done.type, last: events.slice(-6) }) : null;
                }, started.before);
                if (terminal) {
                    const parsed = JSON.parse(terminal) as { type: string; last: Array<Record<string, unknown>> };
                    terminal = parsed.type;
                    if (parsed.type === 'run-error') {
                        console.log('REWRITE_ERROR_EVENTS', JSON.stringify(parsed.last));
                    }
                }
                const status = await page.evaluate(() => {
                    const host = window as unknown as {
                        app?: { workspace?: { getLeavesOfType(type: string): Array<{ view: unknown }> } };
                    };
                    const leaf = host.app?.workspace?.getLeavesOfType('novel-writer-full-writer')[0];
                    const view = leaf?.view as { executionStore?: { getStatus(): { message: string } | null } } | undefined;
                    return view?.executionStore?.getStatus()?.message ?? '';
                });
                console.log(`REWRITE_PROGRESS ${chapterName} ${new Date().toISOString()} ${status}`);
            }
            console.log(`REWRITE_TERMINAL ${chapterName} ${terminal}`);

            // 4) 读盘核对
            const finalBody = fs.readFileSync(bodyPath(chapterNum), 'utf8');
            const bodyChars = finalBody.replace(/^---[\s\S]*?---\s*/, '').replace(/\s+/g, '').length;
            const status = /status:\s*(\w+)/.exec(finalBody)?.[1] ?? '';
            const human = {
                dialogue: /对话占比:\s*([\d.]+)/.exec(finalBody)?.[1] ?? '',
                colloquial: /口语密度:\s*([\d.]+)/.exec(finalBody)?.[1] ?? '',
                anchors: /时间锚点:\s*(\d+)/.exec(finalBody)?.[1] ?? '',
                score: /人味分:\s*(\d+)/.exec(finalBody)?.[1] ?? '',
            };
            console.log(`REWRITE_RESULT ${chapterName}`, JSON.stringify({ terminal, bodyChars, status, human }));
            expect(bodyChars).toBeGreaterThan(1500);
            expect(['written', 'settled']).toContain(status);
        }
    });
});
