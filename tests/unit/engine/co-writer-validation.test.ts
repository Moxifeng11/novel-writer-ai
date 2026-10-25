import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../main', () => ({
    default: class NovelWriterPlugin {},
}));

import { CoWriterEngine } from '../../../engine/co-writer-engine';
import type { EditValidation } from '../../../shared/types';

function makeEngine(): CoWriterEngine {
    return new CoWriterEngine(
        {} as any,
        {} as any,
        {} as any,
    );
}

function parse(engine: CoWriterEngine, raw: string): EditValidation {
    return (engine as any).parseValidationResponse(raw);
}

describe('CoWriterEngine — 编辑验证解析（思考模型）', () => {
    it('剥离 <think> 后仍能提取围栏 JSON', () => {
        const engine = makeEngine();
        const raw = `<think>先看一致性，再给分。</think>
\`\`\`json
{"consistencyScore": 88, "styleScore": 76, "plotAlignmentScore": 91, "warnings": [], "suggestions": ["保持"]}
\`\`\``;
        const result = parse(engine, raw);
        expect(result.degraded).toBeFalsy();
        expect(result.consistencyScore).toBe(88);
        expect(result.styleScore).toBe(76);
        expect(result.plotAlignmentScore).toBe(91);
        expect(result.isValid).toBe(true);
    });

    it('JSON 前后带解释文字也能提取', () => {
        const engine = makeEngine();
        const raw = `结果如下：{"consistencyScore": 70, "styleScore": 65, "plotAlignmentScore": 62} 以上。`;
        const result = parse(engine, raw);
        expect(result.degraded).toBeFalsy();
        expect(result.overallScore).toBe(66);
        expect(result.isValid).toBe(true);
    });

    it('任一项低于通过线则判为存在风险', () => {
        const engine = makeEngine();
        const result = parse(engine, '{"consistencyScore": 90, "styleScore": 59, "plotAlignmentScore": 90}');
        expect(result.isValid).toBe(false);
    });
});

describe('CoWriterEngine — 编辑验证降级（不静默放行）', () => {
    it('找不到 JSON 时标记 degraded，而不是给 70 分假装通过', () => {
        const engine = makeEngine();
        const result = parse(engine, '我觉得这段写得不错，没有 JSON。');
        expect(result.degraded).toBe(true);
        expect(result.degradedReason).toContain('找不到');
        expect(result.overallScore).toBe(0);
        expect(result.warnings.length).toBeGreaterThan(0);
        // 不阻塞用户继续使用，但 UI 会显示「校验未完成」
        expect(result.isValid).toBe(true);
    });

    it('JSON 语法错误时标记 degraded', () => {
        const engine = makeEngine();
        // 花括号成对但内容不是合法 JSON → 进入 catch 分支
        const result = parse(engine, '{"consistencyScore": 80,}');
        expect(result.degraded).toBe(true);
        expect(result.degradedReason).toContain('解析失败');
    });
});
