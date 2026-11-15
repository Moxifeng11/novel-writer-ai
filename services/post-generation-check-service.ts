/**
 * post-generation-check-service.ts — 生成后校验（B1）
 *
 * 只做**规则/base 校验**（不调 AI，成本低、可重复）：
 *  1. 场景实体可解析（覆盖缺口）；
 *  2. 伏笔计划回收逾期；
 *  3. 节奏偏离（情绪规划 vs 相邻步预期）；
 *  4. 本章已记录的一致性矛盾。
 *
 * LLM 复核（人物口吻/行为）留给 B2 的可选增强。
 */

import { App, TFile, TFolder } from 'obsidian';
import { createLogger } from '@/shared/logger';
import {
    buildCheckReport,
    type CheckItem,
    type PostGenerationCheckReport,
} from '@/shared/post-generation-check-model';
import { parseEmotionIntensities } from '@/shared/emotion-plan-parse';
import { detectRhythmDeviations } from '@/shared/rhythm-baseline-model';

const log = createLogger('PostGenCheck');

/** 名称解析器（插件侧注入项目索引 resolve） */
export type NameResolver = (name: string) => Promise<string | null>;

/**
 * 生成后校验服务。
 */
export class PostGenerationCheckService {
    /**
     * @param app - Obsidian 应用
     * @param resolveName - 名称 → 实体 ID 解析（找不到返回 null）
     */
    constructor(
        private readonly app: App,
        private readonly resolveName: NameResolver,
    ) {}

    /**
     * 跑一次生成后校验。
     *
     * @param project - 项目路径
     * @param chapterName - 章节名（如「第3章」）
     * @returns 报告
     */
    async check(project: string, chapterName: string): Promise<PostGenerationCheckReport> {
        const items: CheckItem[] = [];
        const chapterNum = this.chapterNumOf(chapterName);

        items.push(...await this.checkSceneCoverage(project, chapterName));
        items.push(...await this.checkForeshadowOverdue(project, chapterNum));
        items.push(...await this.checkRhythm(project, chapterName));
        items.push(...await this.checkRecordedContradictions(project, chapterName));

        const report = buildCheckReport(project, chapterName, items);
        log.info(`生成后校验：${chapterName} ${report.passed ? '通过' : '未通过'}（${items.length} 项）`);
        return report;
    }

    /** 场景在场实体是否可解析 */
    private async checkSceneCoverage(project: string, chapterName: string): Promise<CheckItem[]> {
        const path = await this.findBySuffix(project, `${chapterName}_Scene展开`);
        if (!path) return [];
        const text = await this.readText(path);
        const names = new Set<string>();
        for (const line of text.split('\n')) {
            const match = line.match(/在场人物[：:]\s*(.+)/);
            if (!match) continue;
            for (const name of match[1].split(/[、,，\s]+/)) {
                if (name.trim()) names.add(name.trim());
            }
        }
        const items: CheckItem[] = [];
        for (const name of names) {
            const id = await this.resolveName(name).catch(() => null);
            if (!id) {
                items.push({
                    kind: 'coverage',
                    severity: 'error',
                    message: `场景在场人物「${name}」在设定库中找不到对应实体`,
                    suggestion: '先补建人物卡或修正名字，否则生成会拿不到该角色设定',
                    refs: [name],
                });
            }
        }
        return items;
    }

    /** 伏笔计划回收逾期 */
    private async checkForeshadowOverdue(project: string, chapterNum: number): Promise<CheckItem[]> {
        if (chapterNum <= 0) return [];
        const text = await this.readText(`${project}/02-时间线与伏笔/伏笔库.md`);
        if (!text.trim()) return [];
        const items: CheckItem[] = [];
        for (const line of text.split('\n')) {
            if (!line.includes('|')) continue;
            const cells = line.split('|').map(cell => cell.trim());
            if (cells.length < 4) continue;
            const name = cells[1];
            const plannedMatch = cells[3]?.match(/第\s*(\d+)\s*章/);
            if (!name || !plannedMatch) continue;
            const planned = Number(plannedMatch[1]);
            if (planned > 0 && planned < chapterNum) {
                items.push({
                    kind: 'foreshadow',
                    severity: 'warn',
                    message: `伏笔「${name}」计划在第${planned}章回收，当前已到第${chapterNum}章仍未回收`,
                    suggestion: '本章或近章安排回收，或更新计划回收章节',
                    refs: [name],
                });
            }
        }
        return items;
    }

    /** 节奏偏离 */
    private async checkRhythm(project: string, chapterName: string): Promise<CheckItem[]> {
        const path = await this.findBySuffix(project, `${chapterName}_情绪规划`);
        if (!path) return [];
        const scenes = parseEmotionIntensities(await this.readText(path));
        if (scenes.length < 2) return [];
        const deviations = detectRhythmDeviations(scenes);
        return deviations.map(deviation => ({
            kind: 'rhythm' as const,
            severity: 'warn' as const,
            message: `第${deviation.index}场节奏偏离（${deviation.kind}）：预期${deviation.expected}，实际${deviation.actual}——${deviation.message}`,
            suggestion: '检查该场事件密度或情绪落点，必要时补充铺垫/压缩',
        }));
    }

    /** 本章已记录的一致性矛盾 */
    private async checkRecordedContradictions(project: string, chapterName: string): Promise<CheckItem[]> {
        const text = await this.readText(`${project}/04-项目总控/一致性审核/矛盾.json`);
        if (!text.trim()) return [];
        const num = this.chapterNumOf(chapterName);
        let parsed: unknown;
        try {
            parsed = JSON.parse(text);
        } catch { // silent-ok: 矛盾.json 损坏时跳过该项校验，不影响其它检查
            return [];
        }
        const items = Array.isArray(parsed) ? parsed : (parsed as { items?: unknown[] }).items ?? [];
        return items
            .filter(item => {
                const raw = JSON.stringify(item);
                return num > 0 && raw.includes(`第${num}章`);
            })
            .slice(0, 10)
            .map(item => ({
                kind: 'consistency' as const,
                severity: 'warn' as const,
                message: `一致性审核记录了本章问题：${String((item as { summary?: string; reason?: string }).summary ?? (item as { reason?: string }).reason ?? '见矛盾.json')}`,
                suggestion: '核对左右证据后修正，或标记为有意为之',
            }));
    }

    /** 章节名 → 数字 */
    private chapterNumOf(chapterName: string): number {
        const match = String(chapterName ?? '').match(/第\s*(\d+)\s*章/);
        return match ? Number(match[1]) : 0;
    }

    /** 读文本 */
    private async readText(path: string): Promise<string> {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) return '';
        try {
            return await this.app.vault.read(file);
        } catch { // silent-ok: 单文件读失败按空处理
            return '';
        }
    }

    /** 深度优先按文件名后缀找文件 */
    private async findBySuffix(project: string, suffix: string): Promise<string | null> {
        const root = this.app.vault.getAbstractFileByPath(project);
        if (!(root instanceof TFolder)) return null;
        const stack: TFolder[] = [root];
        while (stack.length > 0) {
            const current = stack.pop();
            if (!current) continue;
            for (const child of current.children) {
                if (child instanceof TFolder) stack.push(child);
                else if (child instanceof TFile && child.extension === 'md' && child.basename.endsWith(suffix)) return child.path;
            }
        }
        return null;
    }
}
