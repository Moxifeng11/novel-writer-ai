/**
 * four-check-refresh.ts — 正文「四项校验」的按需重算
 *
 * 背景：步骤 7 的正文保存后由 engine/step-runner.ts 自动记录四项校验，
 * 但正文还有别的写入路径（协同写作保存、场景循环生成、续写下一章、定向修订），
 * 它们不经过步骤 7，质量面板里就永远没有这几章的结论。
 *
 * 本服务只从磁盘事实重算一次：正文文件 + 写作规则格式契约 + 本章信息规划
 * 的「章末钩子」。判定规则全部复用既有实现（shared/body-format.ts、
 * engine/consistency/extended-rules.ts、engine/quality-gate.ts），
 * 不新增判定口径，也不阻断任何流程。
 */

import { App, TFile } from 'obsidian';
import { BodyWriter } from '@/engine/body-writer';
import { detectPerspectiveMix } from '@/engine/consistency/extended-rules';
import { detectHookCoverage } from '@/engine/quality-gate';
import { FourCheckStore } from '@/services/four-check-store';
import { analyzeBodyFormat } from '@/shared/body-format';
import type { BodyFormatContract } from '@/shared/body-format';
import { buildFourCheckReport } from '@/shared/chapter-four-checks-model';
import type { FourCheckHookInput, FourCheckReport } from '@/shared/chapter-four-checks-model';
import { parseInfoPlanFields } from '@/shared/info-plan-fields';
import { createLogger } from '@/shared/logger';
import { pjStepFile } from '@/shared/paths';
import { isProjectDirectory } from '@/shared/project-catalog';
import { getBusinessThreshold } from '@/shared/thresholds';

const log = createLogger('FourCheckService');

/** 未传目标字数时的兜底（与 step-runner 的 ctx.defaultWordCount 兜底一致） */
const DEFAULT_TARGET_WORDS = 3000;

/** 标准正文路径：<项目>/03-大纲与章节/正文/第N卷/第M章[_标题]_正文.md */
const BODY_PATH_PATTERN = /\/03-大纲与章节\/正文\/第(\d+)卷\/第(\d+)章[^/]*_正文\.md$/;

/**
 * 一次按需校验的输入。
 */
export interface FourCheckRequest {
    /** 项目路径 */
    project: string;
    /** 章节名（展示与结果归档键） */
    chapterName: string;
    /** 正文文件路径（vault 相对）；用于读正文与定位本章信息规划 */
    bodyPath?: string;
    /** 正文内容；提供时不再从磁盘读 */
    body?: string;
    /** 本章目标字数（settings.defaultWordCount），缺省 3000 */
    targetWords?: number;
    /** 检查时间戳（测试注入） */
    now?: number;
}

/**
 * 可替换依赖（测试注入用；生产环境走真实实现）。
 */
export interface FourCheckServiceDeps {
    /** 覆盖格式契约解析（默认 BodyWriter.resolveContract） */
    resolveContract?(project: string): Promise<BodyFormatContract>;
    /** 覆盖文本读取（默认 vault/adapter 读取，不存在返回 null） */
    readText?(path: string): Promise<string | null>;
}

/**
 * 四项校验按需重算服务。
 */
export class FourCheckService {
    private readonly writer: BodyWriter;

    /**
     * @param app - Obsidian 应用实例
     * @param deps - 可替换依赖（测试用）
     */
    constructor(private readonly app: App, private readonly deps: FourCheckServiceDeps = {}) {
        this.writer = new BodyWriter({ app });
    }

    /**
     * 按磁盘事实重算一章的四项校验并归档。
     *
     * @param req - 校验输入
     * @returns 聚合报告
     * @throws 项目不存在或正文为空时抛出（由调用方提示）
     */
    async refresh(req: FourCheckRequest): Promise<FourCheckReport> {
        const project = String(req.project || '').trim();
        if (!project || !isProjectDirectory(this.app, project)) {
            throw new Error(`项目不存在或不是作品目录：${project || '(空)'}`);
        }
        const body = String(req.body ?? (req.bodyPath ? await this.readText(req.bodyPath) ?? '' : ''));
        if (!body.trim()) {
            throw new Error(`正文为空，无法校验：${req.chapterName || '(未命名)'}`);
        }
        const contract = this.deps.resolveContract
            ? await this.deps.resolveContract(project)
            : await this.writer.resolveContract(project);
        const report = buildFourCheckReport({
            chapterName: req.chapterName,
            wordCount: body.length,
            targetWords: req.targetWords && req.targetWords > 0 ? req.targetWords : DEFAULT_TARGET_WORDS,
            wordMinRatio: getBusinessThreshold('wordMinRatio'),
            format: analyzeBodyFormat(body, contract),
            perspective: detectPerspectiveMix(body),
            hook: await this.resolveHook(project, req.bodyPath, body),
            now: req.now,
        });
        try {
            await new FourCheckStore(this.app).record(project, report);
        } catch (e) {
            // 归档失败只影响质量面板历史，不影响本次结论
            log.warn('四项校验结果写入失败（不影响本次校验）:', e);
        }
        return report;
    }

    /**
     * 从本章信息规划取章末钩子，并判断正文结尾是否落笔。
     *
     * @param project - 项目路径
     * @param bodyPath - 正文路径（用于推导步骤结果目录）
     * @param body - 正文
     * @returns 钩子输入；未声明钩子时 required=0
     */
    private async resolveHook(project: string, bodyPath: string | undefined, body: string): Promise<FourCheckHookInput> {
        const stepPath = this.resolveInfoPlanPath(project, bodyPath);
        if (!stepPath) return { required: 0, present: null };
        const content = await this.readText(stepPath);
        const fields = parseInfoPlanFields(content || '');
        const hookContent = fields.hookContent.trim();
        if (!hookContent) return { required: 0, present: null };
        return {
            required: 1,
            hookType: fields.hookType.trim() || undefined,
            present: detectHookCoverage(body, hookContent),
        };
    }

    /**
     * 由正文路径推导本章「信息规划」步骤文件路径。
     *
     * @param project - 项目路径
     * @param bodyPath - 正文路径
     * @returns 步骤文件路径；路径不符合标准结构时返回 null
     */
    private resolveInfoPlanPath(project: string, bodyPath?: string): string | null {
        if (!bodyPath) return null;
        const matched = BODY_PATH_PATTERN.exec(bodyPath);
        if (!matched) return null;
        const volN = Number(matched[1]);
        const chapN = Number(matched[2]);
        if (!Number.isFinite(volN) || !Number.isFinite(chapN)) return null;
        return pjStepFile(project, volN, chapN, '信息规划');
    }

    /**
     * 读取 vault 内文本；不存在或读取失败返回 null。
     *
     * @param path - vault 相对路径
     * @returns 文本或 null
     */
    private async readText(path: string): Promise<string | null> {
        if (this.deps.readText) return this.deps.readText(path);
        try {
            const file = this.app.vault.getAbstractFileByPath(path);
            if (file instanceof TFile) return await this.app.vault.read(file);
            if (await this.app.vault.adapter.exists(path)) return await this.app.vault.adapter.read(path);
        } catch (e) {
            log.warn(`读取失败，按缺失处理：${path}`, e);
        }
        return null;
    }
}