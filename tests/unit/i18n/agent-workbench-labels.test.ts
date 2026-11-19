/**
 * agent-workbench-labels.test.ts — Agent 创作工作台双语（缺口⑦ 第二期第45片）
 *
 * 本片覆盖 `ui/agent-workbench-view.ts`（1,837 行）+ `ui/agent-workbench/stage-panel.ts`：
 * 头部导航、左栏四组、阶段面板、输入条、右栏文件树/预览、审批与守卫、
 * 会话提示、意图回执、chip 元信息、遥测与记忆/工具日志，共 106 条界面文案。
 *
 * 刻意保留中文的只有三类：vault 目录名（长篇小说/短篇小说/剧本/元文件）、
 * `log.*` 日志与注释——它们不是界面文案。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { hasMessage, setLocale, translate } from '../../../i18n';
import { resolveCreationFlow } from '../../../shared/creation-flow';
import { buildStagePanelModel, buildStagePrompt } from '../../../ui/agent-workbench/stage-panel';

const CJK = /[\u4e00-\u9fff]/;

/** 全部 106 条界面键（按资源子组列出） */
const GROUPS: Record<string, string[]> = {
    '': ['title'],
    mode: ['starting', 'ai', 'rule'],
    header: ['newSession', 'newSessionTip', 'collapseLeftTip', 'collapseRightTip'],
    nav: ['workbench', 'workbenchTip', 'cowrite', 'cowriteTip', 'knowledge', 'knowledgeTip', 'fingerprint', 'fingerprintTip'],
    resize: ['leftAria', 'rightAria'],
    panel: ['projects', 'plan', 'stages', 'quick'],
    quick: ['settings', 'story', 'quality', 'export'],
    stage: ['next', 'completed', 'emptyNoProject', 'emptyFailed', 'prompt', 'promptBlocked', 'progressBlocked', 'tooltip', 'tooltipReason'],
    project: ['groupEmpty', 'otherGroup', 'emptyAll', 'none', 'cardTip', 'chipTip', 'askAgent'],
    model: ['chipTip'],
    composer: ['attachTip', 'placeholder', 'send', 'removeImageTip', 'quoteTip', 'quoteClearTip'],
    file: ['title', 'reloadTip', 'preview', 'pick', 'noProject', 'projectMissing', 'noProjects', 'emptyDir', 'fromTree'],
    preview: ['unsupported', 'readFailed'],
    notice: ['approvalTimeout', 'approvalLabel', 'mcpFailed', 'imageUnsupported', 'imageSaveFailed', 'noProjectForStory', 'harnessFallback', 'busyNewSession', 'busySend', 'noRetry', 'turnFailedTitle'],
    guard: ['readOnly'],
    approval: ['title'],
    notes: ['restored', 'steered', 'retried'],
    intent: ['createdFiles', 'wizardManual', 'preResearchWritten'],
    chip: ['bestFor', 'preview', 'risk'],
    plan: ['empty'],
    telemetry: ['summary', 'turns', 'modelCalls', 'modelSteps', 'toolCalls', 'fail', 'toolMs', 'trimmed', 'prunedChars', 'compaction', 'context', 'window', 'spilled', 'trimmedTurns', 'compactionValue', 'spilledValue'],
    memory: ['empty', 'title', 'more'],
    toollog: ['empty', 'title', 'repairs', 'repairSummary'],
};

const ALL_KEYS = Object.entries(GROUPS).flatMap(([group, keys]) =>
    keys.map(key => (group ? 'agentWorkbench.' + group + '.' + key : 'agentWorkbench.' + key)));

/** 插值样本：只为让 en 断言能拿到真实产出 */
const SAMPLES: Record<string, Record<string, string | number>> = {
    'agentWorkbench.stage.next': { label: 'Chapter writing' },
    'agentWorkbench.stage.prompt': { stage: 'Chapter writing', cta: 'Write chapter 6', blocked: '' },
    'agentWorkbench.stage.promptBlocked': { reason: 'finish the outline first' },
    'agentWorkbench.stage.progressBlocked': { progress: '5/10', reason: 'finish the outline first' },
    'agentWorkbench.stage.tooltip': { progress: '5/10', reason: '; finish the outline first' },
    'agentWorkbench.stage.tooltipReason': { reason: 'finish the outline first' },
    'agentWorkbench.project.cardTip': { project: 'long/example' },
    'agentWorkbench.project.askAgent': { project: 'long/example' },
    'agentWorkbench.file.projectMissing': { root: 'long/example' },
    'agentWorkbench.preview.unsupported': { ext: 'pdf', path: 'long/example/a.pdf' },
    'agentWorkbench.preview.readFailed': { error: 'EACCES' },
    'agentWorkbench.notice.approvalTimeout': { label: 'Agent approval "write_file"' },
    'agentWorkbench.notice.approvalLabel': { tool: 'write_file' },
    'agentWorkbench.notice.mcpFailed': { count: 2, ids: 'a, b' },
    'agentWorkbench.guard.readOnly': { tool: 'write_file', kind: 'write' },
    'agentWorkbench.approval.title': { tool: 'write_file' },
    'agentWorkbench.notes.restored': { count: 12 },
    'agentWorkbench.intent.createdFiles': { count: 3 },
    'agentWorkbench.chip.bestFor': { text: 'fast drafting' },
    'agentWorkbench.chip.preview': { text: 'outline first' },
    'agentWorkbench.chip.risk': { text: 'rewrites prose' },
    'agentWorkbench.telemetry.trimmedTurns': { count: 3 },
    'agentWorkbench.telemetry.compactionValue': { compactions: 2, calls: 4 },
    'agentWorkbench.telemetry.spilledValue': { count: 7, chars: 12 },
    'agentWorkbench.memory.more': { count: 21 },
    'agentWorkbench.toollog.repairSummary': { ok: 2, attempts: 3 },
};

const WORKBENCH_SNAPSHOT_FACTS = {
    preResearchDone: false,
    docs: {},
    unitTotal: 0,
    unitTarget: 0,
    unitWritten: 0,
    nextUnitNumber: null,
    exportExists: false,
};

afterEach(() => {
    setLocale('zh-CN');
});

describe('第45片：资源覆盖（zh / en 同集）', () => {
    it('106 条键在两种语言下都能解析，且不回落到键名', () => {
        expect(ALL_KEYS).toHaveLength(106);
        expect(new Set(ALL_KEYS).size).toBe(106);
        for (const locale of ['zh-CN', 'en-US'] as const) {
            for (const key of ALL_KEYS) {
                expect(hasMessage(key), locale + ' 缺键 ' + key).toBe(true);
                const value = translate(locale, key, SAMPLES[key]);
                expect(value, locale + ' 回落到键名 ' + key).not.toBe(key);
                expect(value.trim().length, locale + ' 空值 ' + key).toBeGreaterThan(0);
            }
        }
    });

    it('en 下 106 条界面文案零中文（插值样本走 ASCII）', () => {
        for (const key of ALL_KEYS) {
            expect(translate('en-US', key, SAMPLES[key]), key).not.toMatch(CJK);
        }
    });
});

describe('第45片：zh 逐字（零回归）', () => {
    it('头部与左栏保持原文', () => {
        expect(translate('zh-CN', 'agentWorkbench.title')).toBe('🤖 Agent 创作工作台');
        expect(translate('zh-CN', 'agentWorkbench.header.newSession')).toBe('🆕 新会话');
        expect(translate('zh-CN', 'agentWorkbench.header.newSessionTip'))
            .toBe('清空当前项目的会话存档，重新开始（spill 存档保留 7 天）');
        expect(translate('zh-CN', 'agentWorkbench.panel.quick')).toBe('界面直达');
        expect(translate('zh-CN', 'agentWorkbench.quick.story')).toBe('🧬 故事结构');
    });

    it('阶段与项目文案逐字', () => {
        expect(translate('zh-CN', 'agentWorkbench.stage.next', { label: '章节写作' })).toBe('下一步：章节写作');
        expect(translate('zh-CN', 'agentWorkbench.stage.prompt', { stage: '章节写作', cta: '继续写第 6 章', blocked: '' }))
            .toBe('继续「章节写作」：继续写第 6 章');
        expect(translate('zh-CN', 'agentWorkbench.stage.promptBlocked', { reason: '先完成大纲' })).toBe('（先完成大纲）');
        expect(translate('zh-CN', 'agentWorkbench.stage.progressBlocked', { progress: '5/10', reason: '先完成大纲' }))
            .toBe('5/10（先完成大纲）');
        expect(translate('zh-CN', 'agentWorkbench.stage.tooltip', { progress: '5/10', reason: '；先完成大纲' }))
            .toBe('5/10；先完成大纲；点击预填下一步指令');
        expect(translate('zh-CN', 'agentWorkbench.stage.completed')).toBe('全部阶段已完成');
        expect(translate('zh-CN', 'agentWorkbench.project.askAgent', { project: '长篇小说/示例' }))
            .toBe('我要操作项目「长篇小说/示例」');
        expect(translate('zh-CN', 'agentWorkbench.project.cardTip', { project: '长篇小说/示例' }))
            .toBe('长篇小说/示例（点击告知 Agent 切换到该项目）');
        expect(translate('zh-CN', 'agentWorkbench.project.otherGroup')).toBe('其他位置');
    });

    it('输入条、右栏、Notice 与遥测逐字', () => {
        expect(translate('zh-CN', 'agentWorkbench.composer.placeholder'))
            .toBe('对 Agent 说点什么…（@ 引用文件，Enter 发送，Shift+Enter 换行）');
        expect(translate('zh-CN', 'agentWorkbench.file.noProject')).toBe('（未选择项目）');
        expect(translate('zh-CN', 'agentWorkbench.preview.unsupported', { ext: 'pdf', path: 'a.pdf' }))
            .toBe('暂不支持预览 .pdf 文件（a.pdf）');
        expect(translate('zh-CN', 'agentWorkbench.notice.approvalTimeout', { label: 'Agent 审批「write_file」' }))
            .toBe('⏱️ Agent 审批「write_file」超过 10 分钟未响应，已默认拒绝');
        expect(translate('zh-CN', 'agentWorkbench.guard.readOnly', { tool: 'write_file', kind: 'write' }))
            .toBe('🔒 只读模式已开启：Agent 工具「write_file」会修改作品（write），已阻止。可在设置中关闭只读模式。');
        expect(translate('zh-CN', 'agentWorkbench.notes.restored', { count: 3 }))
            .toBe('已恢复上次会话（3 条消息）。点「🆕 新会话」可清空重来。');
        expect(translate('zh-CN', 'agentWorkbench.telemetry.compactionValue', { compactions: 2, calls: 4 }))
            .toBe('2（4 次）');
        expect(translate('zh-CN', 'agentWorkbench.telemetry.spilledValue', { count: 7, chars: 12 }))
            .toBe('7 条 / 省 12k');
        expect(translate('zh-CN', 'agentWorkbench.memory.more', { count: 21 })).toBe('…共 21 项');
        expect(translate('zh-CN', 'agentWorkbench.toollog.repairSummary', { ok: 2, attempts: 3 })).toBe('2/3 成功');
    });
});

describe('第45片：阶段面板随语言切换', () => {
    it('en 下阶段面板文案全英文（含模式名与话术）', () => {
        setLocale('en-US');
        const flow = resolveCreationFlow('long', 'long/example', {
            ...WORKBENCH_SNAPSHOT_FACTS,
            wizardDone: true,
            unitTotal: 10,
            unitWritten: 5,
            unitSettled: 4,
            nextUnitNumber: 6,
        });
        const model = buildStagePanelModel(flow, 'long/example');

        expect(model.modeLabel).not.toMatch(CJK);
        expect(model.modeLabel).toBe(translate('en-US', 'creationMode.label.long', {}));
        expect(model.nextLabel).not.toMatch(CJK);
        for (const item of model.items) {
            expect(item.label, item.id).not.toMatch(CJK);
            expect(item.prompt, item.id).not.toMatch(CJK);
            expect(item.tooltip, item.id).not.toMatch(CJK);
        }
        expect(model.items.some(item => item.progressText.includes('('))).toBe(true);
    });

    it('en 下占位与完成态走资源键', () => {
        setLocale('en-US');
        expect(buildStagePanelModel(null, 'long/example').emptyText)
            .toBe(translate('en-US', 'agentWorkbench.stage.emptyFailed'));
        expect(buildStagePanelModel(null, '').emptyText)
            .toBe(translate('en-US', 'agentWorkbench.stage.emptyNoProject'));

        const flow = resolveCreationFlow('long', 'long/example', {
            ...WORKBENCH_SNAPSHOT_FACTS,
            wizardDone: true,
            preResearchDone: true,
            docs: { storyCore: true, outline: true, bible: true, storyboard: true },
            unitTotal: 2,
            unitTarget: 2,
            unitWritten: 2,
            unitSettled: 2,
            exportExists: true,
        });
        const done = buildStagePanelModel(flow, 'long/example');
        expect(done.nextLabel).toBe(translate('en-US', 'agentWorkbench.stage.completed'));
        expect(buildStagePrompt(flow.stages[0])).not.toMatch(CJK);
    });
});
