/**
 * engine-runtime-labels.test.ts — 引擎层用户可见运行时文案双语（缺口⑦ 第二期第46片）
 *
 * 本片只覆盖「会渲染到界面」的运行时文案，三个文件：
 *   - engine/agent/harness/harness-engine.ts：空输入提示、降级兜底、中断提示、审批框标题、工具行、压缩提示
 *   - engine/agent/harness/agent-loop.ts：取消/超预算/模型失败/工具未执行/工具参数摘要
 *   - engine/rhythm-analyzer.ts：节奏问题与建议、段落类型标签
 *
 * 刻意保留中文的：AI 提示词（进模型上下文）、正则、`log.*` 日志、vault 目录名、会话默认标题「新会话」。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { hasMessage, setLocale, t, translate } from '../../../i18n';
import { AgentSessionLog } from '../../../engine/agent/harness/session-log';
import { HarnessToolRegistry } from '../../../engine/agent/harness/tool-registry';
import { runHarnessTurn } from '../../../engine/agent/harness/agent-loop';
import { AgentHarnessEngine } from '../../../engine/agent/harness/harness-engine';
import type {
    HarnessAdapter,
    HarnessMemoryState,
} from '../../../engine/agent/harness/harness-types';
import type { AgentContext, GuideAgentPort } from '../../../engine/agent/agent-types';

const CJK = /[\u4e00-\u9fff]/;

/** 全部 37 条键（agent 25 + rhythm 12） */
const AGENT_KEYS = [
    'emptyInput', 'unavailable', 'failFallback', 'chipOffline', 'chipRetry',
    'interrupted', 'unknownReason', 'approvalTitle', 'toolOk', 'toolFail',
    'compacted', 'cancelled', 'contextOverBudget', 'modelFailed',
    'toolCallPlaceholder', 'toolNotRun', 'memoryRecorded', 'writePath',
    'deletePath', 'deleteProject', 'noProjectTarget', 'openUi', 'done',
    'moreItems', 'listSep',
].map(key => 'engineMsg.agent.' + key);

const RHYTHM_KEYS = [
    'issue.longDescription', 'issue.slowDense', 'issue.longMonologue', 'issue.highDensity',
    'suggest.slowOverall', 'suggest.fastOverall', 'suggest.problems', 'suggest.sameTypeRun',
    'type.action', 'type.dialogue', 'type.description', 'type.introspection',
].map(key => 'engineMsg.rhythm.' + key);

const ALL_KEYS = [...AGENT_KEYS, ...RHYTHM_KEYS];

/** 插值样本：只为让 en 断言拿到真实产出 */
const SAMPLES: Record<string, Record<string, string | number>> = {
    'engineMsg.agent.unavailable': { reason: 'call failed' },
    'engineMsg.agent.interrupted': { reason: 'step limit' },
    'engineMsg.agent.approvalTitle': { tool: 'write_file' },
    'engineMsg.agent.toolOk': { tool: 'write_file', summary: 'chapters/01.md' },
    'engineMsg.agent.toolFail': { tool: 'write_file', summary: 'EACCES' },
    'engineMsg.agent.compacted': { count: 8 },
    'engineMsg.agent.contextOverBudget': { tokens: 42000, budget: 32000 },
    'engineMsg.agent.toolCallPlaceholder': { tool: 'list_projects' },
    'engineMsg.agent.memoryRecorded': { count: 3 },
    'engineMsg.agent.writePath': { path: 'chapters/01.md' },
    'engineMsg.agent.deletePath': { path: 'chapters/02.md' },
    'engineMsg.agent.deleteProject': { project: 'long/old-draft' },
    'engineMsg.agent.moreItems': { items: '' },
    'engineMsg.rhythm.suggest.sameTypeRun': { count: 4, type: 'Action scenes' },
};

const CONTEXT: AgentContext = { projects: [], activeProject: null };

function nullAdapter(): HarnessAdapter {
    return { async complete() { return null; } };
}

afterEach(() => {
    setLocale('zh-CN');
});

describe('第46片：资源覆盖（zh / en 同集）', () => {
    it('37 条键在两种语言下都能解析，且不回落到键名', () => {
        expect(ALL_KEYS).toHaveLength(37);
        expect(new Set(ALL_KEYS).size).toBe(37);
        for (const locale of ['zh-CN', 'en-US'] as const) {
            for (const key of ALL_KEYS) {
                expect(hasMessage(key), locale + ' 缺键 ' + key).toBe(true);
                const value = translate(locale, key, SAMPLES[key]);
                expect(value, locale + ' 回落到键名 ' + key).not.toBe(key);
                expect(value.trim().length, locale + ' 空值 ' + key).toBeGreaterThan(0);
            }
        }
    });

    it('en 下 37 条运行时文案零中文（插值样本走 ASCII）', () => {
        for (const key of ALL_KEYS) {
            expect(translate('en-US', key, SAMPLES[key]), key).not.toMatch(CJK);
        }
    });

    it('占位符集合 zh / en 一致', () => {
        const holders = (text: string): string[] =>
            Array.from(text.matchAll(/\{(\w+)\}/g)).map(match => match[1]).sort();
        for (const key of ALL_KEYS) {
            expect(holders(translate('en-US', key)), key).toEqual(holders(translate('zh-CN', key)));
        }
    });
});

describe('第46片：zh 逐字（零回归）', () => {
    it('空输入 / 降级兜底 / 中断提示保持原文', () => {
        expect(t('engineMsg.agent.emptyInput')).toBe('没有收到内容，请再输入一次，或点下面的选项。');
        expect(t('engineMsg.agent.unavailable', { reason: '调用失败' })).toBe(
            '⚠️ AI 助手暂时不可用（调用失败）。\n可以切换到离线逐步引导，或稍后重试。',
        );
        expect(t('engineMsg.agent.failFallback')).toBe('调用失败');
        expect(t('engineMsg.agent.chipOffline')).toBe('🔄 切换到离线引导');
        expect(t('engineMsg.agent.chipRetry')).toBe('🔄 重试');
        expect(t('engineMsg.agent.interrupted', { reason: '未知原因' })).toBe(
            '本轮对话中断：未知原因。可以重新描述你的需求。',
        );
        expect(t('engineMsg.agent.unknownReason')).toBe('未知原因');
    });

    it('审批与工具行保持原文', () => {
        expect(t('engineMsg.agent.approvalTitle', { tool: 'write_file' })).toBe('Agent 请求执行「write_file」');
        expect(t('engineMsg.agent.toolOk', { tool: 'write_file', summary: 'chapters/01.md' }))
            .toBe('write_file → 成功：chapters/01.md');
        expect(t('engineMsg.agent.toolFail', { tool: 'write_file', summary: 'EACCES' }))
            .toBe('write_file → 失败：EACCES');
        expect(t('engineMsg.agent.compacted', { count: 8 })).toBe('[compaction] 已把较早的 8 条历史压缩为摘要节点');
        expect(t('engineMsg.agent.cancelled')).toBe('用户取消');
        expect(t('engineMsg.agent.contextOverBudget', { tokens: 42000, budget: 32000 })).toBe(
            '上下文超预算（约 42000 token，预算 32000）。请缩短本章参考或清理会话后重试。',
        );
        expect(t('engineMsg.agent.modelFailed')).toBe('模型调用失败');
        expect(t('engineMsg.agent.toolCallPlaceholder', { tool: 'list_projects' })).toBe('（调用工具 list_projects）');
        expect(t('engineMsg.agent.toolNotRun')).toBe('工具未执行');
    });

    it('工具参数摘要保持原文（含分隔符与「等」的后置空格）', () => {
        expect(t('engineMsg.agent.memoryRecorded', { count: 3 })).toBe('记录 3 项信息');
        expect(t('engineMsg.agent.writePath', { path: 'chapters/01.md' })).toBe('写入 chapters/01.md');
        expect(t('engineMsg.agent.deletePath', { path: 'chapters/02.md' })).toBe('删除 chapters/02.md');
        expect(t('engineMsg.agent.deleteProject', { project: '长篇/旧稿' })).toBe('删除项目 长篇/旧稿');
        expect(t('engineMsg.agent.noProjectTarget')).toBe('未指定项目（将拒绝执行）');
        expect(t('engineMsg.agent.openUi')).toBe('打开界面');
        expect(t('engineMsg.agent.done')).toBe('执行完成');
        expect(t('engineMsg.agent.listSep')).toBe('、');
        expect('a' + t('engineMsg.agent.moreItems', { items: '' })).toBe('a 等');
    });

    it('节奏问题、建议与类型标签保持原文', () => {
        expect(t('engineMsg.rhythm.issue.longDescription')).toBe('描写过长，可能拖慢节奏');
        expect(t('engineMsg.rhythm.issue.slowDense')).toBe('节奏缓慢且信息密度低，建议压缩');
        expect(t('engineMsg.rhythm.issue.longMonologue')).toBe('内心独白过长，建议穿插动作');
        expect(t('engineMsg.rhythm.issue.highDensity')).toBe('信息密度过高，读者可能疲劳');
        expect(t('engineMsg.rhythm.suggest.slowOverall')).toBe('整体节奏偏慢，建议增加动作或对话场景');
        expect(t('engineMsg.rhythm.suggest.fastOverall')).toBe('整体节奏偏快，建议穿插描写或内心戏调节');
        expect(t('engineMsg.rhythm.suggest.problems')).toBe('部分段落存在问题，建议查看详情');
        expect(t('engineMsg.rhythm.suggest.sameTypeRun', { count: 4, type: '描写场景' }))
            .toBe('连续 4 个描写场景，建议变换节奏');
        expect(t('engineMsg.rhythm.type.action')).toBe('动作场景');
        expect(t('engineMsg.rhythm.type.dialogue')).toBe('对话场景');
        expect(t('engineMsg.rhythm.type.description')).toBe('描写场景');
        expect(t('engineMsg.rhythm.type.introspection')).toBe('内心戏');
    });
});

describe('第46片：en 下运行时文案随语言切换', () => {
    it('空输入提示走英文', async () => {
        setLocale('en-US');
        const engine = new AgentHarnessEngine({ ctx: CONTEXT, adapter: nullAdapter(), portDeps: { port: {} as GuideAgentPort, ctx: CONTEXT } });
        const outcome = await engine.handle('   ');
        expect(outcome.messages[0].text).toContain('No input received');
        expect(outcome.messages[0].text).not.toMatch(CJK);
    });

    it('适配器失败时兜底气泡与降级 chip 走英文', async () => {
        setLocale('en-US');
        const engine = new AgentHarnessEngine({ ctx: CONTEXT, adapter: nullAdapter(), portDeps: { port: {} as GuideAgentPort, ctx: CONTEXT } });
        const outcome = await engine.start();
        expect(outcome.degraded).toBe(true);
        expect(outcome.messages[0].text).toContain('The AI assistant is unavailable');
        expect(outcome.messages[0].text).not.toMatch(CJK);
        expect(outcome.chips.find(chip => chip.value === '__fallback_rule__')?.label)
            .toBe('🔄 Switch to offline guide');
    });

    it('回合被取消时 failReason 走英文', async () => {
        setLocale('en-US');
        const controller = new AbortController();
        controller.abort();
        const log = new AgentSessionLog();
        log.append({ type: 'user_message', text: 'write chapter 1' });
        const result = await runHarnessTurn({
            adapter: nullAdapter(),
            registry: new HarnessToolRegistry(),
            log,
            memory: {} as HarnessMemoryState,
            projects: [],
            activeProject: null,
            signal: controller.signal,
        });
        expect(result.failed).toBe(true);
        expect(result.failReason).toBe('Cancelled by user');
    });
});

describe('第46片：默认中文不受影响', () => {
    it('未切语言时空输入仍为中文（存量断言零回归）', async () => {
        const engine = new AgentHarnessEngine({ ctx: CONTEXT, adapter: nullAdapter(), portDeps: { port: {} as GuideAgentPort, ctx: CONTEXT } });
        const outcome = await engine.handle('   ');
        expect(outcome.messages[0].text).toContain('没有收到内容');
    });
});
