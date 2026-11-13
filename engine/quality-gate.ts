/**
 * quality-gate.ts — 三层质量验收编排
 * 对应 spec: story-quality-closed-loop-optimization Task 9。
 *
 * 三层契约（spec AC-6）：
 * 1. 程序规则层（rule）—— ConflictDetector（Task 4）+ AntiAIDetector.detectAIWords：零 AI 调用
 * 2. 结构层（structure）—— BeatVerifier（Task 3）+ 结尾钩子检测 + 相邻场景重复检测：零 AI 调用
 * 3. 模型层（model）—— 注入式回调（真实链路接 QualityScoreEngine + emotionAuditor），
 *    仅承接程序无法判断的项；未提供回调或跳过时该层为 null，不阻塞前两层
 *
 * 未新建重复规则：全部复用 Task 3/4 与现有检测器；
 * 逐层可独立跳过（skipLayers）；passed = rule 无冲突 且 structure 必做剧情全覆盖。
 */

import { BeatVerifier } from './beat-verifier';
import type { BeatVerifyResult } from './beat-verifier';
import { ConflictDetector } from './conflict-detector';
import type { Conflict, ConflictDetectorOptions } from './conflict-detector';
import { AntiAIDetector } from './anti-ai-detector';
import type { AIDetectionResult } from './anti-ai-detector';
import type { ChapterStateSnapshot, StoryBeat } from './story-state-types';
import type { ConsistencyCheckResult } from './character-consistency-checker';

/**
 * QualityGateLayer 类型定义。
 */
export type QualityGateLayer = 'rule' | 'structure' | 'model';

/** 模型层评审结果（由调用方组装 QualityScoreEngine/emotionAuditor 产出） */
export interface QualityGateModelReview {
    overallScore?: number;
    issues?: string[];
    source?: string;
}

/**
 * 质量闸门报告结构定义。
 */
export interface QualityGateReport {
    passed: boolean;
    layers: {
        rule: { conflicts: Conflict[]; aiWords: string[]; aiDetection: AIDetectionResult };
        structure: {
            beatVerify: BeatVerifyResult;
            endingHookPresent: boolean;
            repeatedScenes: string[];
        };
        model: QualityGateModelReview | null;
        /** 人物一致性（注入式；未提供时 undefined） */
        character?: ConsistencyCheckResult;
    };
    skippedLayers: QualityGateLayer[];
    summary: string;
}

/**
 * 质量闸门选项列表结构定义。
 */
export interface QualityGateOptions {
    beats?: StoryBeat[];
    /**
     * P2 第二意见：由事实库回答「这个时间声称值是否与已记录事实一致」。
     * 提供后冲突检测会在报时间线冲突前先问一次（consistent 抑制 / unknown 不抑制）。
     */
    adviseTimeline?: ConflictDetectorOptions['adviseTimeline'];
    /** 跳过指定层（逐层独立跳过） */
    skipLayers?: QualityGateLayer[];
    /** 第三层模型评审注入；未提供时模型层为 null */
    modelReviewer?: (body: string, snapshot: ChapterStateSnapshot) => Promise<QualityGateModelReview>;
    /** 人物一致性报告（高严重度 OOC 会使 passed=false） */
    characterReport?: ConsistencyCheckResult;
    /** 相邻段落重复检测的取前缀长度（默认 16，与既有行为一致） */
    repeatPrefixLen?: number;
    /** 结尾钩子检测的尾段窗口长度（默认 200，与既有行为一致） */
    endingHookWindow?: number;
}

/** 相邻场景重复检测：相邻段落前 N 字完全相同视为重复（默认值，可由 options 覆盖） */
const REPEAT_PREFIX_LEN = 16;

/** 结尾钩子检测的尾段窗口长度（默认值，可由 options 覆盖） */
const ENDING_HOOK_WINDOW = 200;

/**
 * 质量闸门。
 */
export class QualityGate {
    private verifier = new BeatVerifier();
    private detector = new ConflictDetector();
    private antiAI = new AntiAIDetector();

    /**
     * 执行。
     * @param body - 正文
     * @param snapshot - 快照
     * @param options - 配置项
      * @returns QualityGateReport 实例
     */
    async run(body: string, snapshot: ChapterStateSnapshot, options: QualityGateOptions = {}): Promise<QualityGateReport> {
        const skip = new Set(options.skipLayers || []);
        const skippedLayers = options.skipLayers || [];

        // —— 第一层：程序规则（零 AI） ——
        let conflicts: Conflict[] = [];
        let aiWords: string[] = [];
        let aiDetection: AIDetectionResult = { score: 0, hits: [], features: [], suggestions: [] };
        if (!skip.has('rule')) {
            conflicts = this.detector.detect(snapshot, body, {
            adviseTimeline: options?.adviseTimeline,
        });
            aiWords = this.antiAI.detectAIWords(body);
            aiDetection = this.antiAI.detect(body);
        }

        // —— 第二层：结构（零 AI） ——
        let beatVerify: BeatVerifyResult = { passed: true, completionRate: 1, results: [], missingRequired: [] };
        let endingHookPresent = true;
        let repeatedScenes: string[] = [];
        if (!skip.has('structure')) {
            beatVerify = this.verifier.verify(body, options.beats || []);
            endingHookPresent = this.checkEndingHook(body, options.beats || [], options.endingHookWindow ?? ENDING_HOOK_WINDOW);
            repeatedScenes = this.detectRepeatedScenes(body, options.repeatPrefixLen ?? REPEAT_PREFIX_LEN);
        }

        // —— 第三层：模型评审（注入式；未提供即跳过） ——
        let model: QualityGateModelReview | null = null;
        if (!skip.has('model') && options.modelReviewer) {
            try {
                model = await options.modelReviewer(body, snapshot);
            } catch (e) {
                // 模型层失败不阻塞验收（前两层结论仍有效）
                model = { issues: [`模型评审失败: ${e instanceof Error ? e.message : String(e)}`], source: 'error' };
            }
        }

        // v4.26：规则层（冲突/AI词表）降级为报告项——引导型体系下不再一票否决；
        // passed 只看结构层（节拍完整性）+ 人物一致性高严重度。
        const character = options.characterReport;
        const passed = beatVerify.passed && (character ? character.passed : true);
        return {
            passed,
            layers: { rule: { conflicts, aiWords, aiDetection }, structure: { beatVerify, endingHookPresent, repeatedScenes }, model, character },
            skippedLayers,
            summary: this.buildSummary(passed, conflicts, beatVerify, endingHookPresent, model, character),
        };
    }

    /** 结尾钩子检测：存在必做 hook beat 时，正文尾段须覆盖其描述 */
    private checkEndingHook(body: string, beats: StoryBeat[], windowLen: number = ENDING_HOOK_WINDOW): boolean {
        const hookBeats = beats.filter((b) => b.type === 'hook' && b.required);
        if (hookBeats.length === 0) return true; // 无要求则不判失
        const tail = body.trim().slice(-windowLen);
        return hookBeats.every((b) => tail.includes(b.description) || body.includes(b.description));
    }

    /** 相邻段落开头高度重复检测（空行分段） */
    private detectRepeatedScenes(body: string, prefixLen: number = REPEAT_PREFIX_LEN): string[] {
        const paragraphs = body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
        const hits: string[] = [];
        for (let i = 1; i < paragraphs.length; i++) {
            const prev = paragraphs[i - 1].slice(0, prefixLen);
            const curr = paragraphs[i].slice(0, prefixLen);
            if (prev.length >= prefixLen && prev === curr) {
                hits.push(`第${i + 1}段与上一段开头重复：${curr}…`);
            }
        }
        return hits;
    }

    private buildSummary(
        passed: boolean,
        conflicts: Conflict[],
        beatVerify: BeatVerifyResult,
        endingHookPresent: boolean,
        model: QualityGateModelReview | null,
        character?: ConsistencyCheckResult,
    ): string {
        if (passed) {
            const hints: string[] = [];
            if (!endingHookPresent) hints.push('结尾钩子缺失');
            if (beatVerify.missingRequired.length === 0 && hints.length === 0) hints.length = 0;
            if (character && character.worstSeverity !== 'none') {
                hints.push(`人物一致性 ${character.worstSeverity} 级提示`);
            }
            return hints.length
                ? `通过（含 ${hints.length} 项提示：${hints.join('；')}）`
                : '通过：无冲突，必做剧情全覆盖';
        }
        const parts: string[] = [];
        if (conflicts.length) parts.push(`${conflicts.length} 项冲突`);
        if (beatVerify.missingRequired.length) {
            parts.push(`${beatVerify.missingRequired.length} 项必做剧情未覆盖（字数达标不代表剧情推进）`);
        }
        if (character && !character.passed) {
            parts.push(`${character.highSeverityCount} 处高严重度人物矛盾`);
        }
        return `未通过：${parts.join('；')}`;
    }
}
