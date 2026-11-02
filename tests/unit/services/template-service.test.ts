import { describe, it, expect, beforeEach } from 'vitest';
import { TemplateService } from '../../../engine/template-service';
import { CHAPTER_FILE_TYPES } from '../../../engine/chapter-utils';
import { TFile } from '../../__mocks__/obsidian';

class MockApp {
    vault = {
        getAbstractFileByPath: (_path: string) => null,
        read: async (_file: any) => '',
    };
}

describe('TemplateService', () => {
    let service: TemplateService;

    beforeEach(() => {
        const mockApp = new MockApp() as any;
        service = new TemplateService(mockApp);
    });

    describe('默认模板', () => {
        it('正文模板包含 frontmatter 和标题', async () => {
            const result = await service.getBodyTemplate({ chapterName: '第1章', volume: '第1卷' });
            expect(result).toContain('tags: [正文, nw/正文]');
            expect(result).toContain('卷: "第1卷"');
            expect(result).toContain('章: "第1章"');
            expect(result).toContain('status: pending');
        });

        it('信息规划模板包含 step_status 等 v4.0 字段', async () => {
            const result = await service.getInfoPlanTemplate({ chapterName: '第1章', volume: '第1卷' });
            expect(result).toContain('tags: [信息规划, nw/步骤/信息规划]');
            expect(result).toContain('step_status: pending');
            expect(result).toContain('step_model:');
            expect(result).toContain('step_timestamp:');
            expect(result).toContain('情感温度');
            expect(result).toContain('冲突强度');
        });

        it('情节蒸馏模板结构完整', async () => {
            const result = await service.getPlotDistillTemplate({ chapterName: '第1章' });
            expect(result).toContain('tags: [情节蒸馏, nw/步骤/情节蒸馏]');
            expect(result).toContain('场景节奏设计');
            expect(result).toContain('情节节点规划');
            expect(result).toContain('爽点设计');
        });

        it('大纲摘要模板包含关键场景表格', async () => {
            const result = await service.getOutlineTemplate({ chapterName: '第1章' });
            expect(result).toContain('tags: [大纲摘要, nw/步骤/大纲摘要]');
            expect(result).toContain('关键场景');
            expect(result).toContain('结尾钩子');
        });

        it('V2 步骤模板全部可用', async () => {
            const steps = ['emotionPlan', 'sceneExpand', 'characterSoul', 'qualityControl', 'selfCheck', 'fix', 'finalFix', 'continuityReview'];
            for (const step of steps) {
                const result = await service.getStepTemplate(step, { chapterName: '第1章', volume: '第1卷' });
                expect(result.length).toBeGreaterThan(0);
                expect(result).toContain('step_status: pending');
                expect(result).toContain('---');
            }
        });

        it('默认模板数量与 CHAPTER_FILE_TYPES 对齐', async () => {
            const types = Object.keys(CHAPTER_FILE_TYPES);
            let count = 0;
            for (const type of types) {
                try {
                    const result = await service.getTemplate(type, { chapterName: '第1章' });
                    if (result && result.length > 0) count++;
                } catch {
                }
            }
            expect(count).toBeGreaterThanOrEqual(12);
        });
    });

    describe('变量替换', () => {
        it('正确替换章节名', async () => {
            const result = await service.getBodyTemplate({ chapterName: '第5章' });
            expect(result).toContain('章: "第5章"');
        });

        it('正确替换卷名', async () => {
            const result = await service.getInfoPlanTemplate({ chapterName: '第1章', volume: '第3卷' });
            expect(result).toContain('卷: "第3卷"');
        });

        it('正确替换标题', async () => {
            const result = await service.getBodyTemplate({ chapterName: '第1章', title: '测试标题' });
            expect(result).toContain('标题: "测试标题"');
        });

        it('第X章占位符被替换为实际章节名', async () => {
            const result = await service.getInfoPlanTemplate({ chapterName: '第10章' });
            expect(result).not.toContain('第X章');
            expect(result).toContain('第10章');
        });
    });

    describe('模板文件回退机制', () => {
        it('模板文件不存在时使用默认模板', async () => {
            const result = await service.getBodyTemplate({ chapterName: '第1章' });
            expect(result.length).toBeGreaterThan(0);
            expect(result).toContain('tags: [正文, nw/正文]');
        });
    });

    describe('AI Prompt 模板（P7 新增）', () => {
        it('getStepPrompt 无自定义模板时回退到默认硬编码模板', async () => {
            const result = await service.getStepPrompt('infoPlan');
            expect(result).not.toBeNull();
            expect(result?.systemPrompt.length).toBeGreaterThan(0);
            expect(result?.userPrompt.length).toBeGreaterThan(0);
            expect(result?.description).toContain('信息规划');
        });

        it('getStepPrompt 支持所有核心步骤', async () => {
            const steps = ['infoPlan', 'plotDistill', 'outline', 'bodyGeneration',
                           'selfCheck', 'fix', 'continuityCheck', 'analysisReport', 'qualityControl'];
            for (const step of steps) {
                const result = await service.getStepPrompt(step);
                expect(result).not.toBeNull();
                expect(result?.systemPrompt).toBeTruthy();
                expect(result?.userPrompt).toBeTruthy();
            }
        });

        it('getStepPrompt 未知步骤返回 null', async () => {
            const result = await service.getStepPrompt('nonexistentStep');
            expect(result).toBeNull();
        });

        it('getWritingRules 返回写作规则', async () => {
            const result = await service.getWritingRules();
            expect(result.length).toBeGreaterThan(0);
            // v4.26：回退文本为单一镜头引导版（结构锚点齐全）
            expect(result).toContain('## 单一镜头（核心锚点）');
            expect(result).toContain('## 格式参考（最低要求）');
            expect(result).toContain('主角');
        });

        it('hasCustomPrompt 无自定义模板时返回 false', async () => {
            const result = await service.hasCustomPrompt('infoPlan');
            expect(result).toBe(false);
        });

        it('自定义模板存在时优先使用自定义模板', async () => {
            const mockFile = new TFile();
            mockFile.path = '元文件/00-系统模板/prompts/infoPlan-system.md';
            mockFile.basename = 'infoPlan-system.md';

            class MockAppWithCustomTemplate {
                vault = {
                    getAbstractFileByPath: (path: string) => {
                        if (path.includes('infoPlan-system')) {
                            return mockFile;
                        }
                        return null;
                    },
                    read: async (_file: any) => 'CUSTOM_SYSTEM_PROMPT',
                };
            }
            const customService = new TemplateService(new MockAppWithCustomTemplate() as any);
            const result = await customService.getStepPrompt('infoPlan');
            expect(result).not.toBeNull();
            expect(result?.systemPrompt).toBe('CUSTOM_SYSTEM_PROMPT');
            expect(result?.userPrompt.length).toBeGreaterThan(0);
        });
    });
});
