/**
 * tts-speech.ts — Web Speech API 的薄封装（可注入，便于单测）
 *
 * 实测（Obsidian 1.15.1 / Windows）：speechSynthesis 存在、speak() 能正常
 * onstart/onend，但 getVoices() 返回空数组——Chromium 在 Electron 里没有
 * 暴露系统音色清单。因此：
 *   - 不可以「音色为空」判定不支持（会导致功能在桌面端整体瘫痪）；
 *   - 音色清单为空时只能朗读「系统默认音色」，界面要说清楚。
 */

/** 音色（对 SpeechSynthesisVoice 的最小投影） */
export interface TtsVoiceInfo {
    /** voiceURI，用于持久化选择 */
    uri: string;
    name: string;
    lang: string;
    isDefault: boolean;
}

/** 一次朗读的参数 */
export interface TtsSpeakOptions {
    rate: number;
    pitch?: number;
    volume?: number;
    /** 空 / undefined = 系统默认音色 */
    voiceUri?: string;
    /** 缺省 zh-CN */
    lang?: string;
}

/** 朗读回调（单句粒度） */
export interface TtsSpeechHandlers {
    onStart?: () => void;
    onEnd: () => void;
    onError: (reason: string) => void;
}

/** 引擎接口（播放器只依赖这个，测试可注入假实现） */
export interface TtsSpeechEngine {
    /** 当前环境有没有 speechSynthesis（有 = 可以尝试朗读） */
    isSupported(): boolean;
    /** 可用音色；桌面 Electron 常见为空数组 */
    listVoices(): TtsVoiceInfo[];
    /** 朗读一句；返回 false 表示连 utterance 都建不出来 */
    speak(text: string, options: TtsSpeakOptions, handlers: TtsSpeechHandlers): boolean;
    pause(): void;
    resume(): void;
    cancel(): void;
    /** 音色清单异步到位时通知界面刷新下拉 */
    onVoicesChanged(callback: () => void): () => void;
}

/** 取 speechSynthesis（浏览器 / Electron 注入到 window 上） */
function getSynth(): SpeechSynthesis | null {
    try {
        const synth = (globalThis as unknown as { speechSynthesis?: SpeechSynthesis }).speechSynthesis;
        return synth ?? null;
    } catch {
        return null;
    }
}

/** 取 SpeechSynthesisUtterance 构造器 */
function getUtteranceCtor(): (new (text: string) => SpeechSynthesisUtterance) | null {
    try {
        const ctor = (globalThis as unknown as { SpeechSynthesisUtterance?: new (text: string) => SpeechSynthesisUtterance }).SpeechSynthesisUtterance;
        return ctor ?? null;
    } catch { // silent-ok: 取不到构造器等于平台不支持朗读，由 isSupported() 统一给出降级提示
        return null;
    }
}

/**
 * 创建 Web Speech 引擎。
 *
 * @param synth - 可选注入（测试用）；缺省取 globalThis.speechSynthesis
 * @returns 引擎实例
 */
export function createTtsSpeechEngine(synth?: SpeechSynthesis | null): TtsSpeechEngine {
    return {
        isSupported(): boolean {
            return !!getSynth() || !!synth;
        },

        listVoices(): TtsVoiceInfo[] {
            const target = synth ?? getSynth();
            if (!target || typeof target.getVoices !== 'function') return [];
            try {
                return target.getVoices().map(voice => ({
                    uri: voice.voiceURI,
                    name: voice.name,
                    lang: voice.lang,
                    isDefault: !!voice.default,
                }));
            } catch {
                return [];
            }
        },

        speak(text: string, options: TtsSpeakOptions, handlers: TtsSpeechHandlers): boolean {
            const target = synth ?? getSynth();
            const Utterance = getUtteranceCtor();
            if (!target || !Utterance) {
                handlers.onError('unsupported');
                return false;
            }
            let utterance: SpeechSynthesisUtterance;
            try {
                utterance = new Utterance(text);
            } catch {
                handlers.onError('utterance-failed');
                return false;
            }
            utterance.lang = options.lang ?? 'zh-CN';
            utterance.rate = options.rate;
            if (typeof options.pitch === 'number') utterance.pitch = options.pitch;
            if (typeof options.volume === 'number') utterance.volume = options.volume;
            if (options.voiceUri) {
                const match = this.listVoices().find(voice => voice.uri === options.voiceUri);
                if (match) {
                    const voices = typeof target.getVoices === 'function' ? target.getVoices() : [];
                    const real = voices.find(voice => voice.voiceURI === match.uri);
                    if (real) utterance.voice = real;
                }
            }
            utterance.onstart = () => handlers.onStart?.();
            utterance.onend = () => handlers.onEnd();
            utterance.onerror = event => handlers.onError(String((event as { error?: string })?.error ?? 'speech-error'));
            try {
                target.speak(utterance);
                return true;
            } catch (error) {
                handlers.onError(error instanceof Error ? error.message : String(error));
                return false;
            }
        },

        pause(): void {
            const target = synth ?? getSynth();
            try { target?.pause(); } catch { /* 移动端可能不支持暂停 */ }
        },

        resume(): void {
            const target = synth ?? getSynth();
            try { target?.resume(); } catch { /* 同上 */ }
        },

        cancel(): void {
            const target = synth ?? getSynth();
            try { target?.cancel(); } catch { /* 取消失败不影响状态复位 */ }
        },

        onVoicesChanged(callback: () => void): () => void {
            const target = synth ?? getSynth();
            if (!target || typeof target.addEventListener !== 'function') return () => undefined;
            const handler = (): void => callback();
            target.addEventListener('voiceschanged', handler);
            return () => {
                try { target.removeEventListener('voiceschanged', handler); } catch { /* noop */ }
            };
        },
    };
}
