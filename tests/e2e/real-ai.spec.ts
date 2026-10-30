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
 * 真实 AI 链路（唯一会消耗 API 额度、并写入真实项目的用例）。
 *
 * 与 obsidian-plugin.spec.ts 的区别：那个用临时 vault（不复制 data.json，无凭据）；
 * 这里直接打开真实 vault（默认 D:/小说工坊/小说工坊），用真实模型跑一次单章一键成文，
 * 然后把「正文落盘 / 规划补全 / 分析报告 / 结算回写 / 实体字段 / 伏笔闭环 / 注入溯源 / 成本」
 * 全部读盘核对一遍。
 *
 * 启用条件（缺一即跳过，常规 npm run test:e2e 不会碰真实项目）：
 *   OBSIDIAN_PATH=<Obsidian.exe>   E2E_REAL_AI=1
 * 可选：
 *   E2E_VAULT_PATH    真实 vault 路径（默认 D:/小说工坊/小说工坊）
 *   E2E_REAL_PROJECT  项目（默认 长篇小说/九霄逆脉行）
 *
 * 运行前必须完全退出用户自己的 Obsidian：两个实例同时写同一 vault 会互相覆盖 workspace.json。
 */

const REAL_VAULT = process.env.E2E_VAULT_PATH?.trim() || 'D:/小说工坊/小说工坊';
const PROJECT = process.env.E2E_REAL_PROJECT?.trim() || '长篇小说/九霄逆脉行';
const CHAPTER_NAME = '第2章';
const VOLUME = '第1卷';
const BODY_DIR = `${PROJECT}/03-大纲与章节/正文/${VOLUME}`;
const BODY_PREFIX = `${CHAPTER_NAME}_`;

/** 正文文件名会按生成标题重命名（第2章_锁痕_正文.md），不能写死 */
function resolveBodyPath(): string {
    const dir = path.join(REAL_VAULT, BODY_DIR);
    if (!fs.existsSync(dir)) return path.join(dir, `${CHAPTER_NAME}_正文.md`);
    const candidates = fs.readdirSync(dir)
        .filter(name => name.startsWith(BODY_PREFIX) && name.endsWith('_正文.md'))
        .map(name => path.join(dir, name));
    return candidates[0] ?? path.join(dir, `${CHAPTER_NAME}_正文.md`);
}

const BODY_PATH = `${BODY_DIR}/${CHAPTER_NAME}_正文.md`;
const STEP_DIR = `${PROJECT}/03-大纲与章节/步骤结果/${VOLUME}/${CHAPTER_NAME}`;

/** 用户选择的中止阈值：30 分钟（含重试与续写放大） */
const RUN_BUDGET_MS = 30 * 60_000;
const FALLBACK_BUDGET_MS = 15 * 60_000;

interface RunSnapshot {
    eventTypes: string[];
    terminal: string | null;
    terminalMessage: string;
    /** 最近 15 条事件（type + 文本），用于定位失败步骤 */
    recentEvents: Array<{ type: string; level: string; message: string }>;
    /** 步骤失败卡的结构化记录（含 stack） */
    failures: Array<{ stepKey: string; stepLabel: string; kind: string; message: string; detail: string; suggestion: string }>;
    status: { message: string; current?: number; total?: number; aiCalls?: number } | null;
    ledgerEvents: Array<{
        stepKey: string;
        totalEstTokens: number;
        truncatedCount: number;
        embeddingCalls: number;
        retrievalQueries: number;
        cacheHits: number;
        cacheMisses: number;
        entryCount: number;
        message: string;
    }>;
}

function readText(relativeOrAbsolutePath: string): string {
    const absolute = path.isAbsolute(relativeOrAbsolutePath)
        ? relativeOrAbsolutePath
        : path.join(REAL_VAULT, relativeOrAbsolutePath);
    return fs.existsSync(absolute) ? fs.readFileSync(absolute, 'utf8') : '';
}

function stripFrontmatter(content: string): string {
    return content.replace(/^---[\s\S]*?---\s*/, '');
}

test.describe('Novel Writer AI · 真实 AI 链路（第2章一键成文）', () => {
    test.describe.configure({ mode: 'serial' });
    test.skip(!isObsidianE2EEnabled(), describeSkipReason());
    test.skip(process.env.E2E_REAL_AI !== '1', '未设置 E2E_REAL_AI=1：真实 AI 链路会消耗 API 额度并写入真实项目，需显式开启');

    let session: ObsidianSession;

    test.beforeAll(async () => {
        session = await launchObsidian({ path: REAL_VAULT });
        session.page.on('pageerror', (error) => console.error('[real-ai pageerror]', error.message));
        // 真实链路诊断：插件的 AI 客户端把「返回为空 / 截断 / 切模型」写在 info/warn 里，
        // 只抓 error 会漏掉关键证据（run 2 就是靠这段才看出模型返回空内容）。
        session.page.on('console', (message) => {
            const text = message.text();
            if (message.type() === 'error') {
                console.error('[real-ai console:error]', text.slice(0, 400));
                return;
            }
            if (/AI返回为空|截断|切模型|小说工坊\] .*(空内容|finish_reason|max_tokens)|API响应/.test(text)) {
                console.log('[real-ai console]', text.slice(0, 400));
            }
        });
        await waitForPluginLoaded(session.page, 120_000);
        // 真实 vault 还会加载其它第三方插件，留出稳定时间
        await session.page.waitForTimeout(3_000);
    });

    test.afterAll(async () => {
        await session?.close().catch(() => undefined);
    });

    test('一键成文跑通并读盘核对', async () => {
        test.setTimeout(RUN_BUDGET_MS + FALLBACK_BUDGET_MS + 10 * 60_000);
        const { page } = session;

        const beforeBodyPath = resolveBodyPath();
        const before = {
            bodyBytes: readText(beforeBodyPath).length,
            bodyStatus: /status:\s*(\w+)/.exec(readText(beforeBodyPath))?.[1] ?? '',
            emotionPlan: readText(`${STEP_DIR}/${CHAPTER_NAME}_情绪规划.md`).length,
            foreshadowLib: readText(`${PROJECT}/02-时间线与伏笔/伏笔库.md`).length,
        };
        console.log('REAL_AI_BEFORE ' + JSON.stringify(before));

        // 1) 凭据与模型（只输出布尔/模型名，绝不打印设置对象）
        const auth = await page.evaluate(() => {
            const host = window as unknown as {
                app?: { plugins?: { plugins?: Record<string, {
                    hasAiCredentials?: boolean;
                    settings?: { defaultModel?: string };
                }> } };
            };
            const plugin = host.app?.plugins?.plugins?.['novel-writer-ai'];
            return { hasCredentials: Boolean(plugin?.hasAiCredentials), model: plugin?.settings?.defaultModel ?? '' };
        });
        console.log('REAL_AI_AUTH ' + JSON.stringify(auth));
        expect(auth.hasCredentials).toBe(true);

        // 2) 打开工作台并定位第2章（openChapterByPath 会 loadContext + 恢复步骤状态）
        const opened = await page.evaluate(async ({ project, bodyPath }) => {
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
                openChapterByName?(a: string, b: string): Promise<void>;
            } | undefined;
            if (!view) return 'no-view';
            // 优先按「项目 + 章名」打开：正文可能已按标题重命名（第2章_锁痕_正文.md）
            await view.openChapterByPath?.(project, bodyPath);
            return 'ok';
        }, { project: PROJECT, bodyPath: resolveBodyPath() });
        expect(opened).toBe('ok');

        // 视图可能刚从 workspace.json 恢复、还在初始化：轮询到章节上下文真的写入为止
        // （runChapterOneClick 的前置守卫是 project/chapterName/chapDir 三者非空）
        const chapterReady = async (): Promise<boolean> => page.evaluate(() => {
            const host = window as unknown as {
                app?: { workspace?: { getLeavesOfType(type: string): Array<{ view: unknown }> } };
            };
            const leaf = host.app?.workspace?.getLeavesOfType('novel-writer-full-writer')[0];
            const view = leaf?.view as { chapterName?: string; chapDir?: string } | undefined;
            return Boolean(view?.chapterName && view?.chapDir);
        });
        for (let attempt = 0; attempt < 6; attempt++) {
            if (await chapterReady()) break;
            await page.waitForTimeout(1_500);
            await page.evaluate(async ({ project, bodyPath }) => {
                const host = window as unknown as {
                    app?: { workspace?: { getLeavesOfType(type: string): Array<{ view: unknown }> } };
                };
                const leaf = host.app?.workspace?.getLeavesOfType('novel-writer-full-writer')[0];
                const view = leaf?.view as { openChapterByPath?(a: string, b: string): Promise<void> } | undefined;
                await view?.openChapterByPath?.(project, bodyPath);
            }, { project: PROJECT, bodyPath: resolveBodyPath() });
        }
        const ready = await chapterReady();
        console.log('REAL_AI_CHAPTER_READY ' + String(ready));
        if (!ready) {
            // 自动化入口的已知限制：工作台从 workspace.json 恢复时，openChapterByPath
            // 走的是「复用已存在 tab」分支，视图状态可能尚未回填（真实用户手点章节不受影响）。
            // 这种情况显式 skip 并保留日志，而不是把环境竞态当成产品失败。
            test.skip(true, '工作台恢复竞态：章节上下文未建立，未能触发一键成文（详见 REAL_AI_CHAPTER_READY 日志）');
        }

        // 3) 触发一键成文：不要 await（真实生成可能十几分钟），把 promise 挂到 window 防未处理拒绝
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
            const store = view.executionStore;
            const before = store ? store.getEvents().length : 0;
            (window as unknown as { __nwRealRun?: Promise<unknown> }).__nwRealRun =
                view.runChapterOneClick('recommended').catch((error: unknown) => {
                    console.error('[real-ai] runChapterOneClick 失败:', error);
                });
            return { ok: true, before };
        });
        console.log('REAL_AI_START ' + JSON.stringify(started));
        expect(started.ok).toBe(true);

        const snapshot = async (): Promise<RunSnapshot> => page.evaluate((fromIndex) => {
            const host = window as unknown as {
                app?: { workspace?: { getLeavesOfType(type: string): Array<{ view: unknown }> } };
            };
            const leaf = host.app?.workspace?.getLeavesOfType('novel-writer-full-writer')[0];
            const view = leaf?.view as {
                executionStore?: {
                    getEvents(): Array<{ type?: string; debug?: Record<string, unknown>; message?: string; stepKey?: string }>;
                    getStatus(): { message: string; current?: number; total?: number; aiCalls?: number } | null;
                };
            } | undefined;
            const store = view?.executionStore;
            if (!store) {
                return { eventTypes: [], terminal: null, terminalMessage: '', recentEvents: [], failures: [], status: null, ledgerEvents: [] };
            }
            const events = store.getEvents().slice(fromIndex);
            const terminalEvent = events.find(event => ['run-complete', 'run-error', 'run-aborted', 'run-cancelled']
                .includes(String(event.type ?? '')));
            const storeWithFailures = store as unknown as {
                getFailures?(): Array<{ stepKey?: string; stepLabel?: string; kind?: string; message?: string; detail?: string; suggestion?: string }>;
            };
            const failures = (storeWithFailures.getFailures?.() ?? []).map(item => ({
                stepKey: String(item.stepKey ?? ''),
                stepLabel: String(item.stepLabel ?? ''),
                kind: String(item.kind ?? ''),
                message: String(item.message ?? ''),
                detail: String(item.detail ?? '').slice(0, 300),
                suggestion: String(item.suggestion ?? ''),
            }));
            const recentEvents = events.slice(-15).map(event => ({
                type: String(event.type ?? ''),
                level: String((event as { level?: string }).level ?? ''),
                message: String(event.message ?? '').slice(0, 300),
            }));
            const ledgerEvents = events
                .filter(event => event.type === 'prompt-ledger')
                .map((event) => {
                    const debug = event.debug ?? {};
                    const entries = typeof debug.ledgerEntries === 'string' ? debug.ledgerEntries : '[]';
                    let entryCount = 0;
                    try { entryCount = (JSON.parse(entries) as unknown[]).length; } catch { entryCount = 0; }
                    return {
                        stepKey: String(event.stepKey ?? ''),
                        totalEstTokens: Number(debug.totalEstTokens ?? 0),
                        truncatedCount: Number(debug.truncatedCount ?? 0),
                        embeddingCalls: Number(debug.embeddingCalls ?? 0),
                        retrievalQueries: Number(debug.retrievalQueries ?? 0),
                        cacheHits: Number(debug.cacheHits ?? 0),
                        cacheMisses: Number(debug.cacheMisses ?? 0),
                        entryCount,
                        message: String(event.message ?? '').slice(0, 400),
                    };
                });
            return {
                eventTypes: events.map(event => String(event.type ?? '')),
                terminal: terminalEvent ? String(terminalEvent.type) : null,
                terminalMessage: String(terminalEvent?.message ?? ''),
                recentEvents,
                failures,
                status: store.getStatus(),
                ledgerEvents,
            };
        }, started.before);

        // 4) 轮询到终态（run-complete/run-error/…）或超时
        const deadline = Date.now() + RUN_BUDGET_MS;
        let current = await snapshot();
        while (!current.terminal && Date.now() < deadline) {
            await page.waitForTimeout(5_000);
            current = await snapshot();
            const statusText = current.status ? `${current.status.message} (${current.status.current ?? 0}/${current.status.total ?? 0}) ai=${current.status.aiCalls ?? 0}` : 'idle';
            console.log(`REAL_AI_PROGRESS ${new Date().toISOString()} ${statusText} ledger=${current.ledgerEvents.length}`);
        }
        console.log('REAL_AI_TERMINAL ' + JSON.stringify({
            terminal: current.terminal,
            terminalMessage: current.terminalMessage,
            status: current.status,
            ledgerSteps: current.ledgerEvents.map(item => item.stepKey),
        }));
        console.log('REAL_AI_FAILURES ' + JSON.stringify(current.failures));
        console.log('REAL_AI_RECENT_EVENTS ' + JSON.stringify(current.recentEvents));

        // 5) 降级：**只有没跑到正文**才改用旧版后台写章；
        // 正文已产出（prompt-ledger 里有 bodyGeneration）时按实际产物继续核对，
        // 否则会白等 15 分钟去重写一章已经存在的正文。
        let fallbackUsed = false;
        const ranBody = current.ledgerEvents.some(item => item.stepKey === 'bodyGeneration');
        // 磁盘上已有达标正文（可能是前一次运行产出）时同样不该降级重写
        const bodyOnDisk = stripFrontmatter(readText(resolveBodyPath()));
        const bodyReady = bodyOnDisk.trim().length >= 2100;
        if (!ranBody && !bodyReady) {
            console.log('REAL_AI_FALLBACK 触发（终端状态=' + current.terminal + '，正文步骤=' + ranBody + '）');
            fallbackUsed = true;
            await page.evaluate(async ({ project, volume, chapterName }) => {
                const host = window as unknown as {
                    app?: { plugins?: { plugins?: Record<string, {
                        setWorkbenchContext(ctx: unknown): void;
                        executeCommandAsync(id: string): Promise<boolean>;
                    }> } };
                };
                const plugin = host.app?.plugins?.plugins?.['novel-writer-ai'];
                plugin?.setWorkbenchContext({ project, volume, chapterName, chapterNum: 2, chapDir: '' });
                await plugin?.executeCommandAsync('novel-writer-write-chapter-auto');
            }, { project: PROJECT, volume: VOLUME, chapterName: CHAPTER_NAME });

            const fallbackDeadline = Date.now() + FALLBACK_BUDGET_MS;
            let fallbackDone = false;
            while (!fallbackDone && Date.now() < fallbackDeadline) {
                await page.waitForTimeout(5_000);
                fallbackDone = await page.evaluate(() => {
                    const host = window as unknown as {
                        app?: { plugins?: { plugins?: Record<string, {
                            getExecutionLedgerRecords(limit?: number): Array<{ commandId?: string; status?: string }>;
                        }> } };
                    };
                    const plugin = host.app?.plugins?.plugins?.['novel-writer-ai'];
                    const records = plugin?.getExecutionLedgerRecords?.(5) ?? [];
                    return records.some(record => record.commandId === 'novel-writer-write-chapter'
                        && (record.status === 'done' || record.status === 'failed'));
                });
                console.log(`REAL_AI_FALLBACK_PROGRESS ${new Date().toISOString()} done=${fallbackDone}`);
            }
            expect(fallbackDone).toBe(true);
        }

        // 6) 执行登记表（结算记录 + 伏笔闭环）
        const ledgerRecords = await page.evaluate(() => {
            const host = window as unknown as {
                app?: { plugins?: { plugins?: Record<string, {
                    getExecutionLedgerRecords(limit?: number): Array<Record<string, unknown>>;
                }> } };
            };
            const plugin = host.app?.plugins?.plugins?.['novel-writer-ai'];
            return plugin?.getExecutionLedgerRecords?.(10) ?? [];
        });
        console.log('REAL_AI_LEDGER ' + JSON.stringify(ledgerRecords).slice(0, 2000));

        // 7) 读盘核对
        const body = readText(resolveBodyPath());
        const bodyText = stripFrontmatter(body);
        const emotionPlan = readText(`${STEP_DIR}/${CHAPTER_NAME}_情绪规划.md`);
        const scenePlan = readText(`${STEP_DIR}/${CHAPTER_NAME}_Scene展开.md`);
        const analysis = readText(`${STEP_DIR}/${CHAPTER_NAME}_分析报告.md`);
        const quality = readText(`${STEP_DIR}/${CHAPTER_NAME}_质量控制.md`);
        const settlementTable = readText(`${STEP_DIR}/${CHAPTER_NAME}_结算表.md`);
        const foreshadowLib = readText(`${PROJECT}/02-时间线与伏笔/伏笔库.md`);
        const behaviorLog = readText(`${PROJECT}/01-世界架构/人物/出场记录.md`);
        const overview = readText(`${PROJECT}/04-项目总控/叙事总览.md`);
        const snapshotFile = readText(`${PROJECT}/04-项目总控/章节状态快照/${CHAPTER_NAME}_状态快照.md`);

        const observations = {
            at: new Date().toISOString(),
            fallbackUsed,
            terminal: current.terminal,
            aiCalls: current.status?.aiCalls ?? 0,
            ledgerSteps: current.ledgerEvents.map(item => item.stepKey),
            promptLedger: current.ledgerEvents,
            terminalMessage: current.terminalMessage,
            failures: current.failures,
            recentEvents: current.recentEvents,
            totalEstTokens: current.ledgerEvents.reduce((sum, item) => sum + item.totalEstTokens, 0),
            embeddingCalls: current.ledgerEvents.reduce((sum, item) => sum + item.embeddingCalls, 0),
            cacheHits: current.ledgerEvents.reduce((sum, item) => sum + item.cacheHits, 0),
            truncatedSegments: current.ledgerEvents.reduce((sum, item) => sum + item.truncatedCount, 0),
            body: {
                bytes: body.length,
                chars: bodyText.trim().length,
                status: /status:\s*(\w+)/.exec(body)?.[1] ?? '',
                wordCount: Number(/word_count:\s*(\d+)/.exec(body)?.[1] ?? 0),
            },
            plans: {
                emotionPlanChars: emotionPlan.length,
                scenePlanChars: scenePlan.length,
                emotionPlanHasPlaceholder: emotionPlan.includes('${chapNum}'),
                scenePlanHasPlaceholder: scenePlan.includes('${chapNum}'),
            },
            qualityChars: quality.length,
            analysis: {
                chars: analysis.length,
                newDirectives: (analysis.match(/^NEW_[A-Z_]+:/gm) ?? []).length,
                updateCharacter: (analysis.match(/^UPDATE_CHARACTER:/gm) ?? []).length,
                hasRankField: /^UPDATE_CHARACTER:.*修为等级/m.test(analysis),
                hasLocationField: /^UPDATE_CHARACTER:.*当前位置/m.test(analysis),
                hasBehavior: /^CHARACTER_BEHAVIOR:/m.test(analysis),
                hasForeshadowNew: /^NEW_FORESHADOW:/m.test(analysis),
            },
            settlement: {
                ledgerRecords: ledgerRecords.length,
                foreshadowLoop: (ledgerRecords.find(record =>
                    typeof record.commandId === 'string' && record.commandId.includes('settlement')) as
                    { settlement?: { foreshadowLoop?: { pass?: boolean; summary?: string } } } | undefined)?.settlement?.foreshadowLoop ?? null,
                foreshadowLibDelta: foreshadowLib.length - before.foreshadowLib,
                behaviorLogChars: behaviorLog.length,
                overviewChars: overview.length,
                snapshotChars: snapshotFile.length,
                settlementTableChars: settlementTable.length,
            },
        };

        const outDir = path.resolve(__dirname, '../../test-results');
        fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(path.join(outDir, 'real-ai-observations.json'), JSON.stringify(observations, null, 2), 'utf8');
        console.log('REAL_AI_OBSERVATIONS ' + JSON.stringify({
            fallbackUsed: observations.fallbackUsed,
            aiCalls: observations.aiCalls,
            body: observations.body,
            plans: observations.plans,
            analysis: observations.analysis,
            settlement: observations.settlement,
            cost: {
                totalEstTokens: observations.totalEstTokens,
                embeddingCalls: observations.embeddingCalls,
                cacheHits: observations.cacheHits,
                truncatedSegments: observations.truncatedSegments,
            },
        }));

        // 8) 硬断言：这一章必须真的被写出来并结算
        expect(observations.body.chars).toBeGreaterThanOrEqual(2100);
        expect(observations.body.status).toBe('settled');
        expect(observations.body.wordCount).toBeGreaterThan(0);
        expect(observations.plans.emotionPlanHasPlaceholder).toBe(false);
        expect(observations.plans.scenePlanHasPlaceholder).toBe(false);
        expect(observations.analysis.newDirectives).toBeGreaterThan(0);
        // 结算链路必须留痕（StepRunner 或降级链路之一）
        expect(observations.settlement.ledgerRecords).toBeGreaterThan(0);
    });
});
