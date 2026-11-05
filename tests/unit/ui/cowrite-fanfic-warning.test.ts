import { describe, it, expect, vi } from 'vitest';

/**
 * 同人设定警告此前只在 initEngine 之后提示一次：
 * 会话中删除/移动设定文件后，引擎每次生成前都会重读并记录 loadError，
 * 但界面永不复查 → 用户持续写作却已失去全部原作约束，且没有任何提示。
 * 这里锁定「生成收口与两条联想路径都要复查」「同项目同文案去重」「恢复后再失效要再提示」。
 */
const noticeLog = vi.hoisted(() => [] as Array<{ message: string; timeout?: number }>);

vi.mock('obsidian', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    class Notice {
        message: string;
        timeout?: number;
        constructor(message: string, timeout?: number) {
            this.message = message;
            this.timeout = timeout;
            noticeLog.push({ message, timeout });
        }
        setMessage(): this {
            return this;
        }
        hide(): void {}
    }
    return { ...actual, Notice };
});

vi.mock('../../../main', () => ({
    default: class NovelWriterPlugin {},
}));

import { CoWritingView } from '../../../ui/co-writing-view';

const MISSING_FILE_WARNING =
    '⚠️ 同人设定文件不存在：「书甲/同人设定/某作品设定.md」。协同写作不会带原作约束，请检查 .project 中的路径或重新保存设定。';
const MISSING_PATH_WARNING =
    '⚠️ 同人项目尚未绑定设定文件：协同写作不会带原作约束。请在向导「同人设定」步骤填写，或运行命令「添加同人设定」。';

/** notice-helpers 在无 DOM 垫片时退回纯文本：加粗标题行 + message 行 */
const WARNING_HEADLINE = '⚠️ 注意';

function renderedWarning(text: string): string {
    return `${WARNING_HEADLINE}\n${text.replace(/^⚠️\s*/u, '')}`;
}

type WarningHost = {
    project: string;
    engine: { getFanficRulesWarning: () => string | null } | null;
    lastFanficWarningKey: string;
};

function warningHost(warning: string | null, lastFanficWarningKey = ''): WarningHost {
    return {
        project: '书甲',
        engine: { getFanficRulesWarning: () => warning },
        lastFanficWarningKey,
    };
}

function warnOnce(host: WarningHost): void {
    (CoWritingView.prototype as unknown as {
        warnFanficRulesOnce: (this: WarningHost) => void;
    }).warnFanficRulesOnce.call(host);
}

describe('协同视图：同人设定警告在会话中复查', () => {
    it('首次出现加载失败时提示一次并记录去重键', () => {
        noticeLog.length = 0;
        const host = warningHost(MISSING_FILE_WARNING);
        warnOnce(host);
        expect(noticeLog).toHaveLength(1);
        expect(noticeLog[0]).toEqual({ message: renderedWarning(MISSING_FILE_WARNING), timeout: 8000 });
        expect(host.lastFanficWarningKey).toBe(`书甲|${MISSING_FILE_WARNING}`);
    });

    it('同项目同文案重复复查不重复提示', () => {
        noticeLog.length = 0;
        const host = warningHost(MISSING_FILE_WARNING);
        warnOnce(host);
        warnOnce(host);
        warnOnce(host);
        expect(noticeLog).toHaveLength(1);
    });

    it('同项目文案变化（未绑定路径 → 文件不存在）要重新提示', () => {
        noticeLog.length = 0;
        const host = warningHost(MISSING_PATH_WARNING);
        warnOnce(host);
        host.engine = { getFanficRulesWarning: () => MISSING_FILE_WARNING };
        warnOnce(host);
        expect(noticeLog.map(item => item.message)).toEqual([renderedWarning(MISSING_PATH_WARNING), renderedWarning(MISSING_FILE_WARNING)]);
        expect(host.lastFanficWarningKey).toBe(`书甲|${MISSING_FILE_WARNING}`);
    });

    it('设定恢复后再次失效（同文案）必须重新提示', () => {
        noticeLog.length = 0;
        const host = warningHost(MISSING_FILE_WARNING);
        warnOnce(host);
        // 用户修好路径：引擎重读成功，警告变为 null
        host.engine = { getFanficRulesWarning: () => null };
        warnOnce(host);
        // 再次删掉文件：同项目同文案，但这是一次新的失效
        host.engine = { getFanficRulesWarning: () => MISSING_FILE_WARNING };
        warnOnce(host);
        expect(noticeLog).toHaveLength(2);
    });

    it('无警告时不写去重键（原创项目不产生任何提示）', () => {
        noticeLog.length = 0;
        const host = warningHost(null);
        warnOnce(host);
        expect(noticeLog).toHaveLength(0);
        expect(host.lastFanficWarningKey).toBe('');
    });

    it('生成完成的统一收口（知识注入提示）会先复查同人警告', () => {
        const warnFanficRulesOnce = vi.fn();
        const host = {
            facade: { lastKnowledgeCount: 0 },
            warnFanficRulesOnce,
        };
        (CoWritingView.prototype as unknown as {
            showKnowledgeInjectionNotice: (this: typeof host) => void;
        }).showKnowledgeInjectionNotice.call(host);
        expect(warnFanficRulesOnce).toHaveBeenCalledTimes(1);
    });

    it('自动联想完成后复查同人警告', async () => {
        noticeLog.length = 0;
        const text = '这是一段足够长的正文，用于触发自动联想的最小长度检查，确保请求会真正发出。'.repeat(2);
        const warnFanficRulesOnce = vi.fn();
        const host = {
            plugin: { settings: { autoGhostAssociation: true } },
            isGhostAssociationEnabled: () => true,
            rightEditor: { value: text, selectionStart: text.length },
            isAssociating: false,
            isSuggesting: false,
            currentSuggestions: [],
            suggestionEpoch: 1,
            lastGhostSeed: '',
            lastGhostRequestAt: 0,
            suggestAbortController: null,
            isCurrentSuggestionEpoch: () => true,
            facade: { suggestAssociation: vi.fn(async () => []) },
            setGhostSuggestion: () => {},
            renderAssociationCards: () => {},
            warnFanficRulesOnce,
        };
        await (CoWritingView.prototype as unknown as {
            refreshGhostAssociation: (this: typeof host) => Promise<void>;
        }).refreshGhostAssociation.call(host);
        expect(host.facade.suggestAssociation).toHaveBeenCalledTimes(1);
        expect(warnFanficRulesOnce).toHaveBeenCalledTimes(1);
    });

    it('手动联想完成后复查同人警告', async () => {
        noticeLog.length = 0;
        const warnFanficRulesOnce = vi.fn();
        const host = {
            isAssociating: false,
            isSuggesting: false,
            project: '书甲',
            volume: '第1卷',
            chapterNum: 1,
            rightEditor: { value: '正文开头', selectionStart: 4 },
            canColdStart: () => true,
            suggestAbortController: null,
            beginSuggestionEpoch: () => 7,
            isCurrentSuggestionEpoch: (epoch: number) => epoch === 7,
            clearStaleSuggestions: () => {},
            renderAssociationLoading: () => {},
            renderEmptySuggestions: () => {},
            currentSuggestions: [],
            currentRecord: null,
            setGhostSuggestion: () => {},
            renderAssociationCards: () => {},
            facade: { suggestAssociation: vi.fn(async () => []) },
            warnFanficRulesOnce,
        };
        await (CoWritingView.prototype as unknown as {
            handleAssociationSuggest: (this: typeof host) => Promise<void>;
        }).handleAssociationSuggest.call(host);
        expect(host.facade.suggestAssociation).toHaveBeenCalledTimes(1);
        expect(warnFanficRulesOnce).toHaveBeenCalledTimes(1);
    });
});
