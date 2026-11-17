import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Editor } from 'obsidian';
import { TtsPlayer, resetTtsPlayerForTests } from '@/ui/tts/tts-player';
import type { TtsSpeechEngine, TtsSpeakOptions, TtsSpeechHandlers, TtsVoiceInfo } from '@/ui/tts/tts-speech';
import { offsetToPosition } from '@/shared/tts-text';
import { FakeEl } from './support/fake-dom';

/** 假引擎：记录每句调用，测试手动触发 onEnd / onError */
class FakeEngine implements TtsSpeechEngine {
    supported = true;
    voices: TtsVoiceInfo[] = [];
    calls: Array<{ text: string; options: TtsSpeakOptions; handlers: TtsSpeechHandlers }> = [];
    paused = 0;
    resumed = 0;
    cancelled = 0;
    unsubscribed = false;

    isSupported(): boolean { return this.supported; }
    listVoices(): TtsVoiceInfo[] { return this.voices; }
    speak(text: string, options: TtsSpeakOptions, handlers: TtsSpeechHandlers): boolean {
        this.calls.push({ text, options, handlers });
        return true;
    }
    pause(): void { this.paused += 1; }
    resume(): void { this.resumed += 1; }
    cancel(): void { this.cancelled += 1; }
    onVoicesChanged(): () => void {
        return () => { this.unsubscribed = true; };
    }
    /** 触发最后一句的自然结束 */
    endLast(): void { this.calls[this.calls.length - 1].handlers.onEnd(); }
    /** 触发最后一句的朗读错误 */
    failLast(reason = 'audio-busy'): void { this.calls[this.calls.length - 1].handlers.onError(reason); }
}

/** 假编辑器：只有播放条用到的方法 */
function fakeEditor(text: string, selection = ''): Editor & { setSelection: ReturnType<typeof vi.fn>; scrollIntoView: ReturnType<typeof vi.fn> } {
    return {
        getValue: () => text,
        getSelection: () => selection,
        getCursor: () => ({ line: 0, ch: 0 }),
        posToOffset: () => 0,
        offsetToPos: (offset: number) => offsetToPosition(text, offset),
        setSelection: vi.fn(),
        scrollIntoView: vi.fn(),
    } as unknown as Editor & { setSelection: ReturnType<typeof vi.fn>; scrollIntoView: ReturnType<typeof vi.fn> };
}

/** 假 document：只需要 body + createElement */
function fakeDoc(): { body: FakeEl; createElement: (tag: string) => FakeEl } {
    return { body: new FakeEl('body'), createElement: (tag: string) => new FakeEl(tag) };
}

interface Harness {
    player: TtsPlayer;
    engine: FakeEngine;
    doc: ReturnType<typeof fakeDoc>;
    plugin: { settings: { ttsRate?: number; ttsVoice?: string }; saveSettings: ReturnType<typeof vi.fn> };
}

function makeHarness(engine = new FakeEngine(), text = '第一句。第二句！第三句？'): Harness {
    const doc = fakeDoc();
    const plugin = { settings: { ttsRate: 1.25, ttsVoice: '' }, saveSettings: vi.fn(async () => undefined) };
    const app = { workspace: { activeDocument: doc, getActiveFile: () => ({ basename: '第一章' }) } };
    const player = new TtsPlayer({
        app: app as never,
        plugin: plugin as never,
        engine,
        doc: doc as unknown as Document,
    });
    (player as unknown as { text?: string }).text = text;
    return { player, engine, doc, plugin };
}

const findSelect = (doc: ReturnType<typeof fakeDoc>, cls: string): FakeEl | null => doc.body.querySelector<FakeEl>('.' + cls);

beforeEach(() => {
    resetTtsPlayerForTests();
});

afterEach(() => {
    resetTtsPlayerForTests();
});

describe('tts-player：整章朗读', () => {
    it('从 frontmatter 之后断句，首句立即朗读并高亮', () => {
        const text = '---\ntags: [a]\n---\n第一句。第二句！第三句？';
        const { player, engine, doc } = makeHarness(new FakeEngine(), text);
        const editor = fakeEditor(text);
        expect(player.playChapter(editor, '第一章')).toBe(true);

        expect(player.isActive).toBe(true);
        expect(player.sentenceCount).toBe(3);
        expect(engine.calls).toHaveLength(1);
        expect(engine.calls[0].text).toBe('第一句。');
        expect(engine.calls[0].options.rate).toBe(1.25);
        // 高亮落在正文位置（跳过 frontmatter）
        const start = text.indexOf('第一句。');
        expect(editor.setSelection).toHaveBeenCalledWith(offsetToPosition(text, start), offsetToPosition(text, start + 4));
        expect(editor.scrollIntoView).toHaveBeenCalledTimes(1);
        // 播放条挂在 body 上
        expect(doc.body.children).toHaveLength(1);
        expect(doc.body.children[0].className).toContain('nw-tts-bar');
    });

    it('进度指示与标题反映当前句', () => {
        const { player, doc } = makeHarness();
        player.playChapter(fakeEditor('第一句。第二句！第三句？'), '第一章');
        const root = doc.body.children[0];
        expect(root.allText()).toContain('第一章');
        expect(root.querySelector<FakeEl>('.nw-tts-bar-progress')?.textContent).toBe('1/3');
    });

    it('句子结束自动续读，读完收起播放条', () => {
        const { player, engine, doc } = makeHarness();
        const editor = fakeEditor('第一句。第二句！第三句？');
        player.playChapter(editor, '第一章');

        engine.endLast();
        expect(player.currentIndex).toBe(1);
        expect(engine.calls[1].text).toBe('第二句！');
        expect(doc.body.children[0].querySelector<FakeEl>('.nw-tts-bar-progress')?.textContent).toBe('2/3');

        engine.endLast();
        engine.endLast();
        expect(player.isActive).toBe(false);
        expect(doc.body.children).toHaveLength(0);
    });

    it('单句出错不中断整章，跳到下一句', () => {
        const { player, engine } = makeHarness();
        player.playChapter(fakeEditor('第一句。第二句！'), '第一章');
        engine.failLast('audio-busy');
        expect(player.currentIndex).toBe(1);
        expect(engine.calls[1].text).toBe('第二句！');
    });
});

describe('tts-player：暂停 / 跳句 / 停止', () => {
    it('暂停与恢复真正打到引擎上', () => {
        const { player, engine, doc } = makeHarness();
        player.playChapter(fakeEditor('第一句。第二句！'), '第一章');
        const playBtn = doc.body.children[0].querySelector<FakeEl>('.nw-tts-btn-play');

        player.togglePause();
        expect(engine.paused).toBe(1);
        expect(playBtn?.textContent).toBe('▶');

        player.togglePause();
        expect(engine.resumed).toBe(1);
        expect(playBtn?.textContent).toBe('⏸');
    });

    it('下一句先取消当前朗读再前进', () => {
        const { player, engine } = makeHarness();
        player.playChapter(fakeEditor('第一句。第二句！第三句？'), '第一章');
        player.nextSentence();
        expect(engine.cancelled).toBeGreaterThan(0);
        expect(player.currentIndex).toBe(1);
        expect(engine.calls[engine.calls.length - 1].text).toBe('第二句！');
    });

    it('已是最后一句时点下一句收起播放条', () => {
        const { player, engine } = makeHarness();
        player.playChapter(fakeEditor('第一句。'), '第一章');
        player.nextSentence();
        expect(player.isActive).toBe(false);
        expect(engine.calls).toHaveLength(1);
    });

    it('停止会取消引擎、清空状态并退订音色变更', () => {
        const { player, engine, doc } = makeHarness();
        player.playChapter(fakeEditor('第一句。第二句！'), '第一章');
        player.stop();
        expect(engine.cancelled).toBeGreaterThan(0);
        expect(engine.unsubscribed).toBe(true);
        expect(player.isActive).toBe(false);
        expect(doc.body.children).toHaveLength(0);
    });
});

describe('tts-player：选区与降级', () => {
    it('只朗读选中文字，标题显示「选段」', () => {
        const { player, engine, doc } = makeHarness();
        const editor = fakeEditor('整章文本。', '只读这句。');
        expect(player.playSelection(editor)).toBe(true);
        expect(engine.calls[0].text).toBe('只读这句。');
        expect(doc.body.children[0].allText()).toContain('选段');
    });

    it('空选区 / 无文本 / 不支持语音都不建播放条', () => {
        const emptySelection = makeHarness();
        expect(emptySelection.player.playSelection(fakeEditor('正文。', '   '))).toBe(false);
        expect(emptySelection.doc.body.children).toHaveLength(0);

        const noText = makeHarness();
        expect(noText.player.playChapter(fakeEditor('---\ntags: a\n---\n'), '空章')).toBe(false);
        expect(noText.doc.body.children).toHaveLength(0);

        const unsupportedEngine = new FakeEngine();
        unsupportedEngine.supported = false;
        const unsupported = makeHarness(unsupportedEngine);
        expect(unsupported.player.playChapter(fakeEditor('正文。'), '第一章')).toBe(false);
        expect(unsupported.engine.calls).toHaveLength(0);
    });
});

describe('tts-player：语速与音色', () => {
    it('语速下拉改动写回设置并持久化', () => {
        const { player, engine, doc, plugin } = makeHarness();
        player.playChapter(fakeEditor('第一句。第二句！'), '第一章');
        const rateSelect = findSelect(doc, 'nw-tts-rate');
        expect(rateSelect).not.toBeNull();
        expect(rateSelect?.children.map(option => option.textContent)).toEqual(['0.75×', '1×', '1.25×', '1.5×', '2×']);
        expect(rateSelect?.value).toBe('1.25');

        rateSelect!.value = '1.5';
        rateSelect!.dispatch('change');
        expect(plugin.settings.ttsRate).toBe(1.5);
        expect(plugin.saveSettings).toHaveBeenCalledTimes(1);

        engine.endLast();
        expect(engine.calls[1].options.rate).toBe(1.5);
    });

    it('音色清单为空时只有「系统默认」一项', () => {
        const { player, doc } = makeHarness();
        player.playChapter(fakeEditor('第一句。'), '第一章');
        const voiceSelect = findSelect(doc, 'nw-tts-voice');
        expect(voiceSelect?.children).toHaveLength(1);
        expect(voiceSelect?.children[0].textContent).toBe('系统默认');
        expect(voiceSelect?.children[0].getAttribute('value')).toBe('');
    });

    it('有音色时列出全部并保存所选 voiceURI', () => {
        const engine = new FakeEngine();
        engine.voices = [
            { uri: 'v1', name: '晓晓', lang: 'zh-CN', isDefault: true },
            { uri: 'v2', name: 'Yunxi', lang: 'zh-CN', isDefault: false },
        ];
        const { player, doc, plugin } = makeHarness(engine);
        player.playChapter(fakeEditor('第一句。'), '第一章');
        const voiceSelect = findSelect(doc, 'nw-tts-voice');
        expect(voiceSelect?.children.map(option => option.textContent)).toEqual(['系统默认', '晓晓 (zh-CN)', 'Yunxi (zh-CN)']);

        voiceSelect!.value = 'v2';
        voiceSelect!.dispatch('change');
        expect(plugin.settings.ttsVoice).toBe('v2');
        expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
    });
});
