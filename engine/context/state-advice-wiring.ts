/**
 * state-advice-wiring.ts — 把事实库接到「第二意见」的真实链路
 *
 * 到此为止 `state-advice` 只是纯函数库，没有生产调用方。本模块负责：
 *   项目路径 → 读事实库 → 生成第二意见回调
 * 供时间线检测、伏笔核对、实体状态读取等正则功能使用。
 *
 * 三条约束（与既有设计一致）：
 *  - 事实库缺失/读失败 → 返回「不干预」的 advisor（全 unknown），**不影响功能**；
 *  - 不在 advisor 内部写盘、不做网络调用（纯本地读一次）；
 *  - 事实库是权威，正则只是候选（权威序：正文 > 事实库 > 摘要）。
 */

import type { App } from 'obsidian';
import { ObsidianFileSystem } from '@/shared/file-system-port';
import { pjFactStoreFile } from '@/shared/paths';
import { loadFactStore } from '@/engine/consistency/fact-store';
import type { FactMetadata } from './knowledge-fact-nodes';
import { adviseState, type StateAdvice } from './state-advice';

/** 伏笔第二意见结果 */
export interface ForeshadowAdvice {
    /** consistent = 与「未兑现」一致；conflict = 事实库显示已兑现；unknown = 无法判断 */
    status: 'consistent' | 'conflict' | 'unknown';
    /** 说明 */
    reason: string;
    /** 兑现证据（conflict 时给出） */
    evidence?: FactMetadata;
}

/** 一次审核/一次写作流程内复用的事实查询器 */
export interface StateAdvisor {
    /** 某主体某章的状态建议 */
    advise(claim: { subject: string; predicate?: string; chapter: number; value: string }): StateAdvice;
    /** 时间线专用的简化入口（供 ConflictDetector 使用） */
    adviseTimeline(claim: { value: string; chapterNum: number }): { status: StateAdvice['status']; reason: string };
    /**
     * 伏笔第二意见：查事实库里在 `fromChapter` 之后是否有该关键词的证据。
     * 供伏笔闭环核对使用（台账说「未兑现」时，事实库可能已有兑现痕迹）。
     */
    adviseForeshadow(keyword: string, fromChapter: number): ForeshadowAdvice;
    /** 事实总数（0 表示事实库为空/不可用） */
    readonly factCount: number;
    /** 加载告警（空表示一切正常） */
    readonly warnings: string[];
}

/**
 * 读事实库并构造 advisor。
 *
 * 无论事实库是否可用都返回可用的 advisor（不可用时全部回答 unknown = 不干预），
 * 这样调用方不需要到处判空。
 *
 * @param app - Obsidian 应用
 * @param project - 项目路径
 * @returns advisor
 */
export async function createStateAdvisor(app: App, project: string): Promise<StateAdvisor> {
    const fs = new ObsidianFileSystem(app);
    const warnings: string[] = [];
    let facts: FactMetadata[] = [];
    try {
        const loaded = await loadFactStore(fs, pjFactStoreFile(project));
        if (loaded.status === 'ok') {
            facts = loaded.store.facts;
        } else if (loaded.status === 'read-failed') {
            warnings.push(`事实库不可读，第二意见降级为「不干预」（${loaded.error ?? '未知错误'}）`);
        }
    } catch (error) {
        warnings.push(`事实库读取异常，第二意见降级为「不干预」（${error instanceof Error ? error.message : String(error)}）`);
    }

    return {
        factCount: facts.length,
        warnings,
        advise(claim) {
            if (facts.length === 0) {
                return { status: 'unknown', reason: '事实库为空，未做比对' };
            }
            return adviseState(facts, claim);
        },
        adviseTimeline(claim) {
            if (facts.length === 0) return { status: 'unknown', reason: '事实库为空，未做比对' };
            // 时间线断言在事实库里通常是「故事·时间」或「某事件·时间」，
            // 这里不绑定具体主体：任一谓词含「时间」或类型为 timeline 的事实即可作为参照。
            const timelineFacts = facts.filter(f => f.predicate.includes('时间') || f.type === 'timeline');
            if (timelineFacts.length === 0) return { status: 'unknown', reason: '事实库无时间线记录' };
            return {
                status: 'unknown',
                reason: `事实库有 ${timelineFacts.length} 条时间线记录，但缺少可比对的章号，暂不干预`,
            };
        },
        adviseForeshadow(keyword, fromChapter) {
            const key = (keyword ?? '').trim();
            if (!key || facts.length === 0) {
                return { status: 'unknown', reason: '事实库为空或关键词为空，未做比对' };
            }
            const hits = facts.filter(fact => fact.chapter > fromChapter
                && (fact.value.includes(key) || fact.quote.includes(key) || fact.subject.includes(key)));
            if (hits.length === 0) {
                return {
                    status: 'consistent',
                    reason: `第 ${fromChapter} 章之后事实库无「${key}」痕迹，与「未兑现」判断一致`,
                };
            }
            const evidence = hits[0];
            return {
                status: 'conflict',
                reason: `台账判「未兑现」，但事实库第 ${evidence.chapter} 章已出现「${key}」：`
                    + `${evidence.quote.slice(0, 30)}`,
                evidence,
            };
        },
    };
}
