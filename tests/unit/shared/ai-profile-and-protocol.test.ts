/**
 * 温度分档 + 协议行 的回归测试（2026-11-26）
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    AI_TASK_PROFILES, resolveSampling, taskKindOfStep, type AiTaskKind,
} from '../../../shared/ai-task-profile';
import {
    splitProtocolLines, validateProtocolLines, renderProtocolChecklist,
    PROTOCOL_LINES_INSTRUCTION, ITEM_CHANGE_TYPES,
} from '../../../shared/protocol-lines';
import { BODY_GENERATION_SYSTEM_PROMPT_V2 } from '../../../engine/prompts/body-v2-prompts';
import { BODY_GENERATION_SYSTEM_PROMPT_V4 } from '../../../engine/prompts/body-v4-prompts';
import { TEMPLATE_VAR_FALLBACK_KEYS } from '../../../ui/full-writer/template-vars-builder';

describe('T1 温度分档', () => {
    it('结构化任务温度必须 ≤0.3（防 JSON 格式漂移）', () => {
        expect(AI_TASK_PROFILES['quality-check'].temperature).toBeLessThanOrEqual(0.3);
        expect(AI_TASK_PROFILES['extraction'].temperature).toBeLessThanOrEqual(0.3);
        expect(AI_TASK_PROFILES['distillation'].temperature).toBeLessThanOrEqual(0.3);
    });

    it('创意任务温度必须 ≥0.7（防句子均匀/保守重复）', () => {
        expect(AI_TASK_PROFILES['body-generation'].temperature).toBeGreaterThanOrEqual(0.7);
    });

    it('所有档位温度都在 [0, 1.2] 内（1.4 已超多数模型建议上限）', () => {
        for (const [kind, p] of Object.entries(AI_TASK_PROFILES)) {
            expect(p.temperature, kind).toBeGreaterThanOrEqual(0);
            expect(p.temperature, kind).toBeLessThanOrEqual(1.2);
        }
    });

    it('正文生成温度高于质量自检（核心分工）', () => {
        expect(AI_TASK_PROFILES['body-generation'].temperature)
            .toBeGreaterThan(AI_TASK_PROFILES['quality-check'].temperature);
    });

    it('resolveSampling 支持覆写', () => {
        const r = resolveSampling('body-generation', { temperature: 0.5 });
        expect(r.temperature).toBe(0.5);
        expect(r.maxTokens).toBe(AI_TASK_PROFILES['body-generation'].maxTokens);
    });

    it('resolveSampling 无覆写时返回档位默认值', () => {
        expect(resolveSampling('extraction').temperature).toBe(0.2);
    });

    it('stepKey → 任务类型映射正确', () => {
        expect(taskKindOfStep('bodyGeneration')).toBe('body-generation');
        expect(taskKindOfStep('qualityControl')).toBe('quality-check');
        expect(taskKindOfStep('analysisReport')).toBe('analysis');
        expect(taskKindOfStep('plotDistill')).toBe('distillation');
        expect(taskKindOfStep('outline')).toBe('planning');
    });

    it('未知 stepKey 退回 planning（不崩）', () => {
        expect(taskKindOfStep('nonexistent-step')).toBe('planning');
    });

    it('每个档位都有非空说明（便于设置页/账本展示）', () => {
        for (const [kind, p] of Object.entries(AI_TASK_PROFILES)) {
            expect(p.note.length, kind).toBeGreaterThan(0);
        }
    });
});

describe('T3 协议行', () => {
    it('能分离四种协议行', () => {
        const raw = [
            '他把剑收起来。',
            'CR|林昭|苏晚|师徒反目|苏晚隐瞒身世',
            'CI|霜寒剑|损坏|1',
            'BT|林昭|练气三层|练气四层|生死一线',
            'NE|黑风寨|势力|必须交代伏击者来历',
        ].join('\n');
        const { body, lines } = splitProtocolLines(raw);
        expect(body).toBe('他把剑收起来。');
        expect(lines).toHaveLength(4);
        expect(lines.map(l => l.kind)).toEqual(['CR', 'CI', 'BT', 'NE']);
    });

    it('容忍竖线两侧空格', () => {
        const { lines } = splitProtocolLines('CR | 张三 | 李四 | 结盟 | 共渡难关');
        expect(lines).toHaveLength(1);
        expect(lines[0].fields).toEqual(['张三', '李四', '结盟', '共渡难关']);
    });

    it('不匹配的行原样留在正文', () => {
        const { body, lines } = splitProtocolLines('普通正文。\n这行不是协议行。');
        expect(lines).toHaveLength(0);
        expect(body).toContain('普通正文');
        expect(body).toContain('这行不是协议行');
    });

    it('字段不足的协议行被拒绝', () => {
        const { valid, warnings } = validateProtocolLines([
            { kind: 'CR', fields: ['只有两个', '字段'] },
        ]);
        expect(valid).toHaveLength(0);
        expect(warnings[0]).toContain('字段不足');
    });

    it('CI 变动类型必须在白名单', () => {
        const bad = validateProtocolLines([{ kind: 'CI', fields: ['剑', '乱写类型', '1'] }]);
        expect(bad.valid).toHaveLength(0);
        expect(bad.warnings[0]).toContain('白名单');

        const good = validateProtocolLines([{ kind: 'CI', fields: ['剑', ITEM_CHANGE_TYPES[0], '1'] }]);
        expect(good.valid).toHaveLength(1);
    });

    it('NE 允许 2 个字段（理由可选）', () => {
        const { valid } = validateProtocolLines([{ kind: 'NE', fields: ['新门派', '势力'] }]);
        expect(valid).toHaveLength(1);
    });

    it('清单渲染含四类分组与勾选项', () => {
        const md = renderProtocolChecklist([
            { kind: 'CR', fields: ['A', 'B', '关系变化', '事件'] },
            { kind: 'CI', fields: ['剑', '获得', '1'] },
        ], '第12章');
        expect(md).toContain('第12章 协议行待确认');
        expect(md).toContain('角色关系变化');
        expect(md).toContain('物品变动');
        expect(md).toContain('全部采纳');
    });

    it('空列表不渲染清单', () => {
        expect(renderProtocolChecklist([], '第1章')).toBe('');
    });

    it('指令块含四类格式与「不要编造」约束', () => {
        expect(PROTOCOL_LINES_INSTRUCTION).toContain('CR|');
        expect(PROTOCOL_LINES_INSTRUCTION).toContain('CI|');
        expect(PROTOCOL_LINES_INSTRUCTION).toContain('BT|');
        expect(PROTOCOL_LINES_INSTRUCTION).toContain('NE|');
        expect(PROTOCOL_LINES_INSTRUCTION).toContain('不要编造');
    });

    it('正文 system 提示词注入 protocolLines 占位（V2/V4）', () => {
        // 协议行指令属于系统级约束，放在 system prompt 里（与 humanVoice 同级）
        // 模板写的是转义形式 \${protocolLines}，fillTemplate 运行时会替换成真实内容
        expect(BODY_GENERATION_SYSTEM_PROMPT_V2).toContain('protocolLines');
        expect(BODY_GENERATION_SYSTEM_PROMPT_V4).toContain('protocolLines');
    });

    it('protocolLines 登记在 fallback 键表（否则占位符原样发给模型）', () => {
        expect(TEMPLATE_VAR_FALLBACK_KEYS).toContain('protocolLines');
    });

    it('协议行指令默认关闭（350 字指令不该每章都付 token）', () => {
        // 2026-11-28 实测缺陷：此前 `vars["protocolLines"]` 无条件注入，
        // 没有开关能关掉，正文尾部恒带程序用行。现由 structuredChangeLines 控制。
        const here = path.dirname(fileURLToPath(import.meta.url));
        const src = readFileSync(
            path.resolve(here, '../../../ui/full-writer/template-vars-builder.ts'),
            'utf8',
        );
        expect(src).toContain('structuredChangeLines');
        // 不允许再出现裸赋值（无条件注入）
        expect(src).not.toMatch(/vars\["protocolLines"\]\s*=\s*PROTOCOL_LINES_INSTRUCTION\s*;/);
    });
});
