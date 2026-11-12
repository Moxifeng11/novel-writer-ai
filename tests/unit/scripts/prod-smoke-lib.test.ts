/**
 * 生产冒烟判定逻辑回归（npm run check:prod）
 *
 * 这个脚本的价值在于「自动拦住 AI 全线不可用」——2026-11-13 真实发生过：
 * 密钥在 providerKeys 里、apiKey 为空 → 界面说能用，实际请求发不出去，
 * 而 8130 条单元测试全绿。所以脚本本身的判定逻辑必须被锁住，
 * 否则规则被改松，冒烟就成了摆设（与测试标准 1/3 同理）。
 */

import { describe, expect, it } from 'vitest';
import {
    SMOKE_STATUS,
    countCapturedErrors,
    evaluateAiCall,
    evaluateVersionMatch,
    parsePluginInfo,
    summarizeSmoke,
} from '../../../scripts/lib/prod-smoke-lib.mjs';

describe('生产冒烟-1：插件信息解析', () => {
    it('解析 TSV 字段', () => {
        const out = 'type\tcommunity\nname\tNovel Writer AI\nversion\t4.85.0\nenabled\ttrue\n';
        const parsed = parsePluginInfo(out);
        expect(parsed?.version).toBe('4.85.0');
        expect(parsed?.enabled).toBe('true');
    });

    it('空输出返回 null（不静默当成功）', () => {
        expect(parsePluginInfo('')).toBeNull();
        expect(parsePluginInfo('not a tsv')).toBeNull();
    });
});

describe('生产冒烟-2：版本一致性（发版后必须 reload）', () => {
    it('一致 → 通过', () => {
        expect(evaluateVersionMatch({ runningVersion: '4.85.0', expectedVersion: '4.85.0' }).ok).toBe(true);
    });

    it('运行中版本落后 → 失败并提示 reload', () => {
        const r = evaluateVersionMatch({ runningVersion: '4.81.1', expectedVersion: '4.85.0' });
        expect(r.ok).toBe(false);
        expect(r.reason).toContain('4.81.1');
        expect(r.reason).toContain('plugin:reload');
    });

    it('读不到运行版本 → 失败（不当作通过）', () => {
        expect(evaluateVersionMatch({ runningVersion: '', expectedVersion: '4.85.0' }).ok).toBe(false);
    });

    it('读不到期望版本 → 失败', () => {
        expect(evaluateVersionMatch({ runningVersion: '4.85.0', expectedVersion: '' }).ok).toBe(false);
    });
});

describe('生产冒烟-3：AI 调用判定', () => {
    it('有内容且无 error → 通过', () => {
        const r = evaluateAiCall({ label: '非流式', result: { content: 'OK', finishReason: 'stop' } });
        expect(r.ok).toBe(true);
        expect(r.contentLength).toBe(2);
    });

    it('返回 error → 失败（这是「密钥未配置」那类缺陷的硬信号）', () => {
        const r = evaluateAiCall({ result: { content: '', error: 'API密钥未配置' } });
        expect(r.ok).toBe(false);
        expect(r.reason).toContain('API密钥未配置');
    });

    it('空内容 → 失败（不能把「没报错但也没输出」当成功）', () => {
        const r = evaluateAiCall({ result: { content: '   ' } });
        expect(r.ok).toBe(false);
        expect(r.reason).toContain('空内容');
    });

    it('结果对象缺失 → 失败', () => {
        expect(evaluateAiCall({ result: null }).ok).toBe(false);
        expect(evaluateAiCall({ result: undefined }).ok).toBe(false);
    });

    it('可要求最小内容长度', () => {
        expect(evaluateAiCall({ result: { content: 'OK' }, minContentLength: 5 }).ok).toBe(false);
        expect(evaluateAiCall({ result: { content: 'OKOKOK' }, minContentLength: 5 }).ok).toBe(true);
    });
});

describe('生产冒烟-4：错误捕获判定', () => {
    it('No errors captured → 0', () => {
        expect(countCapturedErrors('No errors captured.')).toBe(0);
    });

    it('有错误内容 → 非 0', () => {
        expect(countCapturedErrors('TypeError: x\nTypeError: y')).toBe(2);
    });

    it('空输出 → null（无法判断，不当作 0）', () => {
        expect(countCapturedErrors('')).toBeNull();
    });
});

describe('生产冒烟-5：结果汇总（skip 不等于通过）', () => {
    it('全通过 → ok', () => {
        const s = summarizeSmoke([
            { name: 'a', status: SMOKE_STATUS.PASS },
            { name: 'b', status: SMOKE_STATUS.PASS },
        ]);
        expect(s.ok).toBe(true);
        expect(s.hasFailure).toBe(false);
        expect(s.hasSkip).toBe(false);
    });

    it('有 skip 但无失败 → ok=false 且 hasSkip=true（必须显式区分）', () => {
        const s = summarizeSmoke([
            { name: 'a', status: SMOKE_STATUS.PASS },
            { name: 'b', status: SMOKE_STATUS.SKIP },
        ]);
        expect(s.ok).toBe(false);
        expect(s.hasSkip).toBe(true);
        expect(s.hasFailure).toBe(false);
    });

    it('有失败 → hasFailure=true', () => {
        const s = summarizeSmoke([{ name: 'a', status: SMOKE_STATUS.FAIL }]);
        expect(s.hasFailure).toBe(true);
        expect(s.ok).toBe(false);
    });

    it('空列表 → ok（无步骤可失败）', () => {
        expect(summarizeSmoke([]).ok).toBe(true);
    });
});
