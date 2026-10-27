import { describe, expect, it, vi } from 'vitest';

vi.mock('../../main', () => ({ default: class NovelWriterPlugin {} }));

import { AnalysisReportEngine } from '../../../engine/analysis-report-engine';

describe('AnalysisReportEngine — 复用步骤 9 报告', () => {
    it('已有分析报告时不发起任何 AI 调用', async () => {
        const callAI = vi.fn();
        const engine = new AnalysisReportEngine(
            {} as never,
            { callAI } as never,
            {} as never,
        );

        const report = await engine.executeFullAnalysis(
            '测试项目',
            '正文内容',
            '第1章',
            1,
            '第一卷',
            [
                'UPDATE_CHARACTER: [[林深]] | 状态 | 左臂重伤',
                'NEW_LOCATION: 废弃码头 | 城郊旧货运码头',
                'NEW_FORESHADOW: 生锈的钥匙 | 1 | 第5章 | 林深 | 主线',
                'NEW_TIMELINE: 深夜 | 林深抵达码头',
                'RELATION: 林深 | 苏晚 | 盟友 | 暂时合作',
            ].join('\n'),
        );

        expect(callAI).not.toHaveBeenCalled();
        expect(report.meta.aiModel).toBe('parsed-step-report');
        expect(report.entities.characters).toHaveLength(1);
        expect(report.entities.locations).toHaveLength(1);
        expect(report.foreshadows.planted).toHaveLength(1);
        expect(report.timeline.events).toHaveLength(1);
        expect(report.majorChanges.length).toBeGreaterThan(0);
    });

    it('没有已有报告时仍走 AI 路径', async () => {
        const callAI = vi.fn(async () => ({ content: '[]' }));
        const app = {
            vault: { getFiles: () => [], getAbstractFileByPath: () => null },
            metadataCache: { getFileCache: () => null },
        };
        const aiEngine = { callAI, getPlugin: () => ({ settings: {} }) };
        const engine = new AnalysisReportEngine(
            app as never,
            aiEngine as never,
            {} as never,
        );

        await engine.executeFullAnalysis('测试项目', '正文内容', '第1章', 1, '第一卷');

        expect(callAI).toHaveBeenCalled();
    });
});

describe('AnalysisReportEngine — 旧报告回退', () => {
    it('普通叙述型报告没有结构化指令时回退 AI', async () => {
        const callAI = vi.fn(async () => ({ content: '[]' }));
        const app = {
            vault: { getFiles: () => [], getAbstractFileByPath: () => null },
            metadataCache: { getFileCache: () => null },
        };
        const engine = new AnalysisReportEngine(
            app as never,
            { callAI, getPlugin: () => ({ settings: {} }) } as never,
            {} as never,
        );

        const report = await engine.executeFullAnalysis(
            '测试项目', '正文内容', '第1章', 1, '第一卷',
            '本章节奏紧凑，人物关系有推进，结尾留下悬念。',
        );

        expect(callAI).toHaveBeenCalled();
        expect(report.meta.aiModel).not.toBe('parsed-step-report');
    });

    it('只有 PROMISE 指令的报告仍走 0 次 AI 解析', async () => {
        const callAI = vi.fn();
        const engine = new AnalysisReportEngine(
            {} as never,
            { callAI } as never,
            {} as never,
        );

        const report = await engine.executeFullAnalysis(
            '测试项目', '正文内容', '第1章', 1, '第一卷',
            'PROMISE_OPEN: 三年之约 | 复仇 | 第10章 | 主角记下',
        );

        expect(callAI).not.toHaveBeenCalled();
        expect(report.meta.aiModel).toBe('parsed-step-report');
        expect(report.emotionCurve.summary).toContain('跳过重复 AI');
    });
});
