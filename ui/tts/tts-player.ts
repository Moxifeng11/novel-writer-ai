/**
 * tts-player.ts — 听校（TTS）播放条
 *
 * 设计取舍：
 * - 播放条挂在 document.body 上（不进设置页、不进侧栏）：朗读时用户要看着正文，
 *   条子只是控制面板，关掉正文就停。
 * - 逐句朗读而不是整章丢给 speechSynthesis：中文整章朗读会触发 Chromium
 *   「长文本提前 onend」的问题，而且逐句才能高亮当前句。
 * - 高亮用编辑器原生选区（setSelection）+ scrollIntoView：不引 CodeMirror
 *   装饰器，跨 Obsidian 版本更稳；代价是朗读期间会占用用户选区。
 */
import { Notice } from 'obsidian';
import type { App, Editor, EditorPosition } from 'obsidian';
import type NovelWriterPlugin from '@/main';
import { t } from '@/i18n';
import {
    TTS_RATE_OPTIONS,
    clampRate,
    frontmatterEndOffset,
    splitSentences,
    type TtsSentence,
} from '@/shared/tts-text';
import { createTtsSpeechEngine, type TtsSpeechEngine } from './tts-speech';

/** 构造依赖（测试注入假引擎 / 假 document / 假插件） */
export interface TtsPlayerDeps {
    app: App;
    plugin: NovelWriterPlugin;
    engine?: TtsSpeechEngine;
    doc?: Document;
}

/** 朗读会话状态 */
type TtsState = 'idle' | 'playing' | 'paused';

/**
 * 播放条：管理断句、逐句调度、高亮与语速/音色持久化。
 */
export class TtsPlayer {
    private readonly app: App;
    private readonly plugin: NovelWriterPlugin;
    private readonly engine: TtsSpeechEngine;
    private readonly doc: Document;

    private root: HTMLElement | null = null;
    private titleEl: HTMLElement | null = null;
    private progressEl: HTMLElement | null = null;
    private playBtn: HTMLElement | null = null;
    private rateSelect: HTMLSelectElement | null = null;
    private voiceSelect: HTMLSelectElement | null = null;

    private editor: Editor | null = null;
    private sentences: TtsSentence[] = [];
    private cursor = 0;
    private state: TtsState = 'idle';
    /** 会话号：每次 start/stop 自增，丢弃旧 utterance 的迟到回调 */
    private session = 0;
    private baseOffset = 0;
    private text = '';
    private label = '';
    private offVoicesChanged: (() => void) | null = null;

    constructor(deps: TtsPlayerDeps) {
        this.app = deps.app;
        this.plugin = deps.plugin;
        this.engine = deps.engine ?? createTtsSpeechEngine();
        const workspace = deps.app.workspace as unknown as { activeDocument?: Document } | undefined;
        this.doc = deps.doc ?? workspace?.activeDocument ?? document;
    }

    /** 是否正在朗读 / 暂停中 */
    get isActive(): boolean {
        return this.state !== 'idle';
    }

    /** 当前朗读到第几句（0 基；未开始为 0） */
    get currentIndex(): number {
        return this.cursor;
    }

    /** 当前句子总数 */
    get sentenceCount(): number {
        return this.sentences.length;
    }

    /**
     * 朗读整章：从 frontmatter 之后开始。
     *
     * @param editor - 正文编辑器
     * @param label - 播放条标题（通常是文件名）
     * @returns 是否开始朗读
     */
    playChapter(editor: Editor, label: string): boolean {
        const text = editor.getValue();
        const from = frontmatterEndOffset(text);
        return this.start(editor, text, 0, label, from);
    }

    /**
     * 朗读选区：只读用户选中的那段，高亮按选区起点换算。
     *
     * @param editor - 正文编辑器
     * @returns 是否开始朗读
     */
    playSelection(editor: Editor): boolean {
        const selection = editor.getSelection();
        if (!selection.trim()) return this.startFailing(t('tts.noText'));
        const startPos = editor.getCursor?.('from');
        const base = startPos && typeof editor.posToOffset === 'function'
            ? editor.posToOffset(startPos)
            : 0;
        return this.start(editor, selection, base, t('tts.selection'), 0);
    }

    /** 播放 / 暂停 */
    togglePause(): void {
        if (this.state === 'playing') {
            this.engine.pause();
            this.state = 'paused';
            this.updatePlayButton();
            return;
        }
        if (this.state === 'paused') {
            this.engine.resume();
            this.state = 'playing';
            this.updatePlayButton();
        }
    }

    /** 下一句（跳过当前） */
    nextSentence(): void {
        if (!this.isActive) return;
        this.session += 1;
        this.engine.cancel();
        this.goTo(this.cursor + 1);
    }

    /** 上一句 */
    prevSentence(): void {
        if (!this.isActive) return;
        this.session += 1;
        this.engine.cancel();
        this.goTo(this.cursor - 1);
    }

    /** 停止并收起播放条 */
    stop(): void {
        this.session += 1;
        this.engine.cancel();
        this.state = 'idle';
        this.cursor = 0;
        this.sentences = [];
        this.editor = null;
        this.offVoicesChanged?.();
        this.offVoicesChanged = null;
        // 测试替身没有 remove()：可选调用，真 DOM 走原生移除
        this.root?.remove?.();
        this.root = null;
        this.titleEl = null;
        this.progressEl = null;
        this.playBtn = null;
        this.rateSelect = null;
        this.voiceSelect = null;
    }

    /** 组件卸载时的清理 */
    destroy(): void {
        this.stop();
    }

    // ───── 内部：会话 ─────

    private startFailing(message: string): false {
        this.notice(message);
        return false;
    }

    private start(editor: Editor, text: string, baseOffset: number, label: string, from: number): boolean {
        if (!this.engine.isSupported()) return this.startFailing(t('tts.unsupported'));
        const sentences = splitSentences(text, { from });
        if (sentences.length === 0) return this.startFailing(t('tts.noText'));

        this.session += 1;
        this.engine.cancel();
        this.editor = editor;
        this.text = text;
        this.baseOffset = baseOffset;
        this.label = label;
        this.sentences = sentences;
        this.cursor = 0;
        this.state = 'playing';

        this.buildBar();
        this.fillVoices();
        this.speakCurrent();
        return true;
    }

    private speakCurrent(): void {
        const sentence = this.sentences[this.cursor];
        if (!sentence || !this.editor) { this.finish(); return; }
        const session = this.session;
        this.highlight(sentence);
        this.updateProgress();
        const rate = clampRate(this.plugin.settings?.ttsRate);
        const voiceUri = typeof this.plugin.settings?.ttsVoice === 'string' ? this.plugin.settings.ttsVoice : '';
        const started = this.engine.speak(
            sentence.speech,
            { rate, voiceUri, lang: 'zh-CN' },
            {
                onEnd: () => {
                    if (session !== this.session) return;
                    this.goTo(this.cursor + 1);
                },
                onError: (reason) => {
                    if (session !== this.session) return;
                    // 单句失败不整章中断：跳到下一句，并提示一次
                    this.notice(t('tts.error', { message: reason }));
                    this.goTo(this.cursor + 1);
                },
            },
        );
        if (!started) this.finish();
    }

    /** 跳到指定句并朗读；越界即结束（上一句到头时停在第一句） */
    private goTo(index: number): void {
        const target = Math.max(0, Math.min(index, this.sentences.length));
        if (target >= this.sentences.length) { this.finish(); return; }
        this.cursor = target;
        if (this.state === 'paused') { this.state = 'playing'; this.updatePlayButton(); }
        this.speakCurrent();
    }

    private finish(): void {
        const hadContent = this.sentences.length > 0;
        this.state = 'idle';
        this.session += 1;
        this.engine.cancel();
        this.cursor = 0;
        this.updateProgress();
        this.updatePlayButton();
        if (hadContent) this.notice(t('tts.finished'));
        this.root?.remove?.();
        this.root = null;
    }

    // ───── 内部：高亮 ─────

    private highlight(sentence: TtsSentence): void {
        const editor = this.editor;
        if (!editor) return;
        const from = this.toEditorPosition(this.baseOffset + sentence.start);
        const to = this.toEditorPosition(this.baseOffset + sentence.end);
        try {
            editor.setSelection(from, to);
            editor.scrollIntoView({ from, to }, true);
        } catch {
            // 编辑器已随文件关闭：停止朗读，避免继续念看不见的文本
            this.stop();
        }
    }

    private toEditorPosition(absoluteOffset: number): EditorPosition {
        const editor = this.editor;
        if (editor && typeof editor.offsetToPos === 'function') return editor.offsetToPos(absoluteOffset);
        // 退化路径（替身 / 旧 API）：从选区起点逐字符换行
        const startPos = editor?.getCursor?.('from') ?? { line: 0, ch: 0 };
        const relative = Math.max(0, absoluteOffset - this.baseOffset);
        let line = startPos.line;
        let ch = startPos.ch;
        for (let i = 0; i < relative && i < this.text.length; i += 1) {
            if (this.text[i] === '\n') { line += 1; ch = 0; } else { ch += 1; }
        }
        return { line, ch };
    }

    // ───── 内部：DOM ─────

    private buildBar(): void {
        if (this.root) return;
        const root = this.doc.createElement('div');
        root.className = 'nw-tts-bar nw-scope';
        root.setAttribute('role', 'region');
        root.setAttribute('aria-label', t('tts.title'));
        this.doc.body.appendChild(root);
        this.root = root;

        const head = root.createDiv({ cls: 'nw-tts-bar-head' });
        this.titleEl = head.createSpan({ cls: 'nw-tts-bar-title', text: t('tts.title') });
        this.progressEl = head.createSpan({ cls: 'nw-tts-bar-progress' });

        const controls = root.createDiv({ cls: 'nw-tts-bar-controls' });
        this.button(controls, 'nw-tts-btn nw-tts-btn-prev', t('tts.prev'), () => this.prevSentence());
        this.playBtn = this.button(controls, 'nw-tts-btn nw-tts-btn-play', t('tts.play'), () => this.togglePause());
        this.button(controls, 'nw-tts-btn nw-tts-btn-next', t('tts.next'), () => this.nextSentence());
        this.button(controls, 'nw-tts-btn nw-tts-btn-stop', t('tts.stop'), () => this.stop());
        this.button(controls, 'nw-tts-btn nw-tts-btn-close', t('tts.close'), () => this.stop());

        const selects = root.createDiv({ cls: 'nw-tts-bar-selects' });
        this.rateSelect = this.buildRateSelect(selects);
        this.voiceSelect = this.buildVoiceSelect(selects);

        this.updateTitle();
        this.updateProgress();
        this.updatePlayButton();
    }

    private button(parent: HTMLElement, cls: string, label: string, onClick: () => void): HTMLElement {
        const btn = parent.createEl('button', { cls, attr: { type: 'button', 'aria-label': label, title: label } });
        btn.setText(this.iconFor(cls, label));
        btn.addEventListener('click', event => {
            event?.preventDefault?.();
            onClick();
        });
        return btn;
    }

    private iconFor(cls: string, label: string): string {
        if (cls.includes('btn-prev')) return '⏮';
        if (cls.includes('btn-play')) return '⏸';
        if (cls.includes('btn-next')) return '⏭';
        if (cls.includes('btn-stop')) return '⏹';
        if (cls.includes('btn-close')) return '✕';
        return label;
    }

    private buildRateSelect(parent: HTMLElement): HTMLSelectElement {
        const select = parent.createEl('select', {
            cls: 'nw-tts-select nw-tts-rate',
            attr: { 'aria-label': t('tts.rate'), title: t('tts.rate') },
        }) as unknown as HTMLSelectElement;
        for (const rate of TTS_RATE_OPTIONS) {
            select.createEl('option', { text: rate + '×', attr: { value: String(rate) } });
        }
        select.value = String(clampRate(this.plugin.settings?.ttsRate));
        select.addEventListener('change', () => {
            const next = clampRate(select.value);
            this.plugin.settings.ttsRate = next;
            void this.plugin.saveSettings?.();
        });
        return select;
    }

    private buildVoiceSelect(parent: HTMLElement): HTMLSelectElement {
        const select = parent.createEl('select', {
            cls: 'nw-tts-select nw-tts-voice',
            attr: { 'aria-label': t('tts.voice'), title: t('tts.voice') },
        }) as unknown as HTMLSelectElement;
        select.addEventListener('change', () => {
            this.plugin.settings.ttsVoice = select.value;
            void this.plugin.saveSettings?.();
        });
        return select;
    }

    /** 刷新音色下拉：空清单也要留一项「系统默认」，否则界面像坏了 */
    private fillVoices(): void {
        const select = this.voiceSelect;
        if (!select) return;
        select.empty();
        const saved = typeof this.plugin.settings?.ttsVoice === 'string' ? this.plugin.settings.ttsVoice : '';
        select.createEl('option', { text: t('tts.voiceDefault'), attr: { value: '' } });
        for (const voice of this.engine.listVoices()) {
            select.createEl('option', { text: voice.name + ' (' + voice.lang + ')', attr: { value: voice.uri } });
        }
        select.value = saved;
        if (!this.offVoicesChanged) {
            this.offVoicesChanged = this.engine.onVoicesChanged(() => this.fillVoices());
        }
    }

    private updateTitle(): void {
        if (this.titleEl) this.titleEl.setText(t('tts.title') + ' · ' + (this.label || t('tts.untitled')));
    }

    private updateProgress(): void {
        if (!this.progressEl) return;
        const total = this.sentences.length;
        const index = total === 0 ? 0 : Math.min(this.cursor + 1, total);
        this.progressEl.setText(t('tts.progress', { index, total }));
    }

    private updatePlayButton(): void {
        if (!this.playBtn) return;
        const playing = this.state === 'playing';
        this.playBtn.setText(playing ? '⏸' : '▶');
        this.playBtn.setAttribute('aria-label', t(playing ? 'tts.pause' : 'tts.play'));
        this.playBtn.setAttribute('title', t(playing ? 'tts.pause' : 'tts.play'));
    }

    private notice(message: string): void {
        try {
            new Notice(message, 4000);
        } catch {
            // 提示失败不影响朗读
        }
    }
}

/** 模块级单例：命令面板多次触发只保留一条播放条 */
let singleton: TtsPlayer | null = null;

/**
 * 取（或创建）全局播放条。
 *
 * @param app - Obsidian App
 * @param plugin - 插件实例（用于设置与注册卸载清理）
 * @returns 播放条单例
 */
export function getTtsPlayer(app: App, plugin: NovelWriterPlugin): TtsPlayer {
    if (!singleton) {
        const player = new TtsPlayer({ app, plugin });
        singleton = player;
        plugin.register?.(() => {
            player.destroy();
            if (singleton === player) singleton = null;
        });
    }
    return singleton;
}

/** 测试用：清掉单例（生产代码不要调用） */
export function resetTtsPlayerForTests(): void {
    singleton?.destroy();
    singleton = null;
}
