import { describe, it, expect } from 'vitest';
import { getStepTemplateAuto } from '../../../engine/prompts/template-utils';

describe('getStepTemplateAuto — 整章草稿的新流程选择', () => {
    it('主角真实 soul 就绪时，Step7 自动使用 V2 小说家模板', () => {
        const tpl = getStepTemplateAuto('bodyGeneration', {
            characterSoulReady: '1',
            protagonistSoulDetail: '他/她最渴望的是：复仇',
            characterCores: '灵魂层数据'.repeat(40),
        });
        expect(tpl).not.toBeNull();
        expect(tpl!.systemPrompt).toContain('他不是角色卡');
    });

    it('只有「（灵魂层未配置）」文本时不得误开 V2', () => {
        const tpl = getStepTemplateAuto('bodyGeneration', {
            characterSoulReady: '',
            characterCores: '【甲】（灵魂层未配置）\n【乙】（灵魂层未配置）\n【丙】（灵魂层未配置）',
        });
        expect(tpl).not.toBeNull();
        expect(tpl!.systemPrompt).not.toContain('他不是角色卡');
    });

    it('无灵魂数据时回退 V1，但仍属于同一条步骤流水线', () => {
        const tpl = getStepTemplateAuto('bodyGeneration', { characterCores: '' });
        expect(tpl).not.toBeNull();
        expect(tpl!.systemPrompt).toContain('这是你和外界的通信协议');
        expect(tpl!.systemPrompt).not.toContain('他不是角色卡');
    });

    it('V1 / V2 正文模板必须消费全部已生成规划产物', () => {
        const v1 = getStepTemplateAuto('bodyGeneration', {})!;
        const v2 = getStepTemplateAuto('bodyGeneration', {
            characterSoulReady: '1',
            protagonistSoulDetail: '他/她最恐惧的是：被抛弃',
        })!;

        // 两套模板共享的规划/设定消费面：任何一条被移除都会让对应步骤白做
        const shared = [
            'infoPlan', 'outlineContent', 'distilledContent', 'settingLib',
            'timelineEvents', 'prevChapEnding', 'emotionPlan', 'sceneExpansion',
        ];
        for (const key of shared) {
            expect(v1.userPrompt).toContain(`\${${key}}`);
            expect(v2.userPrompt).toContain(`\${${key}}`);
        }
        // 记忆碎片：V1 放 user，V2 放 system（贴身镜头视角）
        expect(v1.userPrompt).toContain('${triggeredMemories}');
        expect(v2.systemPrompt).toContain('${triggeredMemories}');
        // 角色灵魂层：V1 放 user，V2 用主角 soul 详情
        expect(v1.userPrompt).toContain('${characterCores}');
        expect(v2.systemPrompt).toContain('${protagonistSoulDetail}');
    });

    it('V1 / V2 都必须使用 ${bodyFormat} 契约变量，不得再硬编码缩进', () => {
        const v1 = getStepTemplateAuto('bodyGeneration', {});
        const v2 = getStepTemplateAuto('bodyGeneration', {
            characterSoulReady: '1',
            protagonistSoulDetail: '他/她最恐惧的是：被抛弃',
        });
        for (const tpl of [v1, v2]) {
            expect(tpl!.systemPrompt).toContain('${bodyFormat}');
            expect(tpl!.systemPrompt).not.toContain('段落：每段开头空两格');
        }
        // V1 的 user 模板同样携带契约；V2 由 system 模板承载
        expect(v1!.userPrompt).toContain('${bodyFormat}');
    });
});
