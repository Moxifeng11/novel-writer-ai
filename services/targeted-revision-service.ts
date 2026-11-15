/**
 * targeted-revision-service.ts — 定向修订闭环（B2）
 *
 * 流程：读正文 → B1 校验 → 有可修订项则生成定向修订提示 → 调 AI 只改问题处 →
 *      落盘 → 重新校验 → 通过则结束，未通过则再试（有上限），最终仍不通过标记「待人工」。
 *
 * 设计约束：
 *  - 每轮最多改 5 条问题，避免一次改太多导致风格漂移；
 *  - 修订结果必须通过长度/内容守卫，否则视为失败、保留原稿；
 *  - 默认上限 2 轮（可配），超限即停止，不无限重写。
 */

import { App, TFile, TFolder } from 'obsidian';
import { createLogger } from '@/shared/logger';
import {
    buildRevisionPrompt,
    buildRevisionTasks,
    type RevisionLoopResult,
    type RevisionTask,
} from '@/shared/targeted-revision-model';
import type { PostGenerationCheckReport } from '@/shared/post-generation-check-model';

const log = createLogger('TargetedRevision');

/** 修订系统提示（与正文步分离，强调只改清单） */
const REVISION_SYSTEM = '你是中文网文修订编辑。严格按照给定清单做最小幅度修订，只输出修订后的完整正文。';

/** 正文长度相对原稿的允许区间（防止模型大幅改写或截断） */
const MIN_RATIO = 0.6;
const MAX_RATIO = 1.6;

/** 修订依赖 */
export interface TargetedRevisionDeps {
    /** 调 AI（system, user）→ 正文 */
    callAI(system: string, user: string): Promise<string>;
    /** 跑一次 B1 校验 */
    check(project: string, chapterName: string): Promise<PostGenerationCheckReport>;
    /** 落盘修订后的正文（走 BodyWriter） */
    writeBody(project: string, chapterName: string, body: string): Promise<void>;
}

/** 修订执行结果 */
export interface TargetedRevisionOutcome extends RevisionLoopResult {
    /** 是否写过盘 */
    wrote: boolean;
    /** 每轮的问题数（可观测） */
    rounds: number[];
    /** 中止原因（守卫拦截/模型报错） */
    abortedReason?: string;
}

/**
 * 定向修订闭环服务。
 */
export class TargetedRevisionService {
    /**
     * @param app - Obsidian 应用
     * @param deps - 修订依赖
     */
    constructor(
        private readonly app: App,
        private readonly deps: TargetedRevisionDeps,
    ) {}

    /**
     * 执行修订闭环。
     *
     * @param project - 项目路径
     * @param chapterName - 章节名
     * @param options - 选项（最大轮次/每轮任务数）
     * @returns 修订结果
     */
    async revise(
        project: string,
        chapterName: string,
        options: { maxRounds?: number; maxTasks?: number } = {},
    ): Promise<TargetedRevisionOutcome> {
        const maxRounds = Math.max(1, options.maxRounds ?? 2);
        const maxTasks = Math.max(1, options.maxTasks ?? 5);
        let body = await this.readBody(project, chapterName);
        if (!body.trim()) {
            return {
                passed: false,
                attempts: 0,
                body,
                report: await this.deps.check(project, chapterName),
                pending: [],
                wrote: false,
                rounds: [],
                abortedReason: '正文为空，无法修订',
            };
        }

        let report = await this.deps.check(project, chapterName);
        const rounds: number[] = [report.items.length];
        // B2 口径：warn 也值得修订（与「通过」不同——通过只要求无 error）
        if (buildRevisionTasks(report, maxTasks).length === 0) {
            return { passed: report.passed, attempts: 0, body, report, pending: [], wrote: false, rounds };
        }

        let attempts = 0;
        let wrote = false;
        let abortedReason: string | undefined;
        while (attempts < maxRounds) {
            const tasks = buildRevisionTasks(report, maxTasks);
            if (tasks.length === 0) break;
            attempts += 1;
            let revised = '';
            try {
                revised = await this.deps.callAI(REVISION_SYSTEM, buildRevisionPrompt(body, tasks));
            } catch (error) {
                abortedReason = `模型调用失败：${String(error)}`;
                log.warn(abortedReason);
                break;
            }
            const accepted = this.acceptRevision(body, revised);
            if (!accepted.ok) {
                abortedReason = accepted.reason;
                log.warn(`修订结果被守卫拦截：${accepted.reason}`);
                break;
            }
            body = accepted.body;
            await this.deps.writeBody(project, chapterName, body);
            wrote = true;
            report = await this.deps.check(project, chapterName);
            rounds.push(report.items.length);
            if (buildRevisionTasks(report, maxTasks).length === 0) break;
        }

        const pending: RevisionTask[] = buildRevisionTasks(report, maxTasks);
        return { passed: pending.length === 0 && report.passed, attempts, body, report, pending, wrote, rounds, abortedReason };
    }

    /**
     * 修订结果守卫：非空、长度在区间内、不是把清单/提示词原样回显、带代码围栏时剥掉。
     *
     * @param original - 原正文
     * @param revised - 模型输出
     * @returns 验收结果
     */
    acceptRevision(original: string, revised: string): { ok: true; body: string } | { ok: false; reason: string } {
        let text = String(revised ?? '').trim();
        if (!text) return { ok: false, reason: '模型返回空内容' };
        if (text.includes('【修订清单】') || text.includes('【硬性要求】')) {
            return { ok: false, reason: '模型回显了提示词而非正文' };
        }
        const fence = text.match(/^```[a-zA-Z]*\n([\s\S]*?)\n```$/);
        if (fence) text = fence[1].trim();
        const ratio = text.length / Math.max(1, original.length);
        if (ratio < MIN_RATIO) return { ok: false, reason: `修订后过短（原稿 ${Math.round(ratio * 100)}%）` };
        if (ratio > MAX_RATIO) return { ok: false, reason: `修订后过长（原稿 ${Math.round(ratio * 100)}%）` };
        return { ok: true, body: text };
    }

    /** 找并读本章正文 */
    private async readBody(project: string, chapterName: string): Promise<string> {
        const path = await this.findBody(project, chapterName);
        if (!path) return '';
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) return '';
        try {
            return await this.app.vault.read(file);
        } catch { // silent-ok: 读失败按空处理
            return '';
        }
    }

    /** 找本章正文文件（`第N章_*_正文.md`） */
    private async findBody(project: string, chapterName: string): Promise<string | null> {
        const root = this.app.vault.getAbstractFileByPath(project);
        if (!(root instanceof TFolder)) return null;
        const stack: TFolder[] = [root];
        while (stack.length > 0) {
            const current = stack.pop();
            if (!current) continue;
            for (const child of current.children) {
                if (child instanceof TFolder) stack.push(child);
                else if (child instanceof TFile && child.extension === 'md'
                    && child.path.includes('/正文/')
                    && child.basename.startsWith(chapterName)
                    && child.basename.includes('正文')) {
                    return child.path;
                }
            }
        }
        return null;
    }
}
