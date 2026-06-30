import { describe, it, expect } from 'vitest';
import {
    pjBodyDir,
    pjBodyFile,
    pjStepDir,
    pjCharFile,
    pjWorldview,
    pjForeshadowDB,
    isInCharsDir,
    isInBodyDir,
    isInStepDir,
    SUBDIR_WORLD_ARCH,
    PJ_TEMPLATE_DIR,
    pjBodyTemplate,
    pjInfoPlanTemplate,
    pjPlotDistillTemplate,
    pjOutlineTemplate,
    pjAnalysisTemplate,
    pjSettlementTemplate,
    pjContinuityReviewTemplate,
    pjSelfCheckTemplate,
    pjFixTemplate,
    pjFinalFixTemplate,
    pjQualityControlTemplate,
    pjEmotionPlanTemplate,
    pjSceneExpandTemplate,
    pjCharacterSoulTemplate,
} from '../../../shared/paths';

describe('路径函数', () => {
    const project = '我的小说';

    it('pjBodyDir 生成正文章节目录', () => {
        expect(pjBodyDir(project, 1)).toBe(`${project}/03-大纲与章节/正文/第1卷`);
        expect(pjBodyDir(project, 3)).toBe(`${project}/03-大纲与章节/正文/第3卷`);
    });

    it('pjBodyFile 生成正文文件路径', () => {
        expect(pjBodyFile(project, 1, 5)).toBe(`${project}/03-大纲与章节/正文/第1卷/第5章_正文.md`);
    });

    it('pjStepDir 生成步骤结果目录', () => {
        expect(pjStepDir(project, 2, 10)).toBe(`${project}/03-大纲与章节/步骤结果/第2卷/第10章`);
    });

    it('pjCharFile 生成人物文件路径', () => {
        expect(pjCharFile(project, '林砚')).toBe(`${project}/${SUBDIR_WORLD_ARCH}/人物/林砚.md`);
    });

    it('pjWorldview 生成世界观路径', () => {
        expect(pjWorldview(project)).toContain(project);
        expect(pjWorldview(project)).toContain('世界观总览.md');
    });

    it('pjForeshadowDB 生成伏笔库路径', () => {
        expect(pjForeshadowDB(project)).toContain(project);
        expect(pjForeshadowDB(project)).toContain('伏笔库.md');
    });
});

describe('路径判断函数', () => {
    const project = '我的小说';

    it('isInCharsDir 判断人物目录', () => {
        expect(isInCharsDir(project, `${project}/01-世界架构/人物/张三.md`)).toBe(true);
        expect(isInCharsDir(project, `${project}/01-世界架构/地点/北京.md`)).toBe(false);
    });

    it('isInBodyDir 判断正文目录', () => {
        expect(isInBodyDir(project, `${project}/03-大纲与章节/正文/第1卷/第1章_正文.md`)).toBe(true);
        expect(isInBodyDir(project, `${project}/03-大纲与章节/步骤结果/第1卷/第1章/信息规划.md`)).toBe(false);
    });

    it('isInStepDir 判断步骤结果目录', () => {
        expect(isInStepDir(project, `${project}/03-大纲与章节/步骤结果/第1卷/第1章/大纲摘要.md`)).toBe(true);
        expect(isInStepDir(project, `${project}/03-大纲与章节/正文/第1卷/第1章_正文.md`)).toBe(false);
    });
});

describe('模板路径函数（v4.0）', () => {
    it('所有模板路径都基于 PJ_TEMPLATE_DIR', () => {
        expect(pjBodyTemplate()).toBe(`${PJ_TEMPLATE_DIR}/正文模板.md`);
        expect(pjInfoPlanTemplate()).toBe(`${PJ_TEMPLATE_DIR}/信息规划模板.md`);
        expect(pjPlotDistillTemplate()).toBe(`${PJ_TEMPLATE_DIR}/情节蒸馏模板.md`);
        expect(pjOutlineTemplate()).toBe(`${PJ_TEMPLATE_DIR}/大纲摘要模板.md`);
        expect(pjAnalysisTemplate()).toBe(`${PJ_TEMPLATE_DIR}/分析报告模板.md`);
        expect(pjSettlementTemplate()).toBe(`${PJ_TEMPLATE_DIR}/结算表模板.md`);
    });

    it('V2 步骤模板路径完整', () => {
        expect(pjContinuityReviewTemplate()).toBe(`${PJ_TEMPLATE_DIR}/连贯性审查模板.md`);
        expect(pjSelfCheckTemplate()).toBe(`${PJ_TEMPLATE_DIR}/自检报告模板.md`);
        expect(pjFixTemplate()).toBe(`${PJ_TEMPLATE_DIR}/修正记录模板.md`);
        expect(pjFinalFixTemplate()).toBe(`${PJ_TEMPLATE_DIR}/最终修正模板.md`);
        expect(pjQualityControlTemplate()).toBe(`${PJ_TEMPLATE_DIR}/质量控制模板.md`);
        expect(pjEmotionPlanTemplate()).toBe(`${PJ_TEMPLATE_DIR}/情绪规划模板.md`);
        expect(pjSceneExpandTemplate()).toBe(`${PJ_TEMPLATE_DIR}/Scene展开模板.md`);
        expect(pjCharacterSoulTemplate()).toBe(`${PJ_TEMPLATE_DIR}/角色灵魂模板.md`);
    });

    it('模板路径数量与 CHAPTER_FILE_TYPES 对齐（正文 + 12种步骤）', () => {
        const templatePaths = [
            pjBodyTemplate(),
            pjInfoPlanTemplate(),
            pjPlotDistillTemplate(),
            pjOutlineTemplate(),
            pjAnalysisTemplate(),
            pjSettlementTemplate(),
            pjContinuityReviewTemplate(),
            pjSelfCheckTemplate(),
            pjFixTemplate(),
            pjFinalFixTemplate(),
            pjQualityControlTemplate(),
            pjEmotionPlanTemplate(),
            pjSceneExpandTemplate(),
            pjCharacterSoulTemplate(),
        ];
        expect(templatePaths.length).toBe(14);
        templatePaths.forEach(p => {
            expect(p.startsWith(PJ_TEMPLATE_DIR)).toBe(true);
            expect(p.endsWith('.md')).toBe(true);
        });
    });
});
