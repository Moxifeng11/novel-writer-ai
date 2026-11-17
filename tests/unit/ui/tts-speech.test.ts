import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTtsSpeechEngine } from '@/ui/tts/tts-speech';

/** 假 SpeechSynthesisVoice */
function voice(uri: string, name: string, lang: string, isDefault = false) {
    return { voiceURI: uri, name, lang, default: isDefault, localService: true };
}

/** 假 utterance：记录被赋的属性与回调 */
class FakeUtterance {
    text: string;
    lang = '';
    rate = 1;
    pitch = 1;
    volume = 1;
    voice: unknown = null;
    onstart: (() => void) | null = null;
    onend: (() => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;
    constructor(text: string) { this.text = text; }
}

/** 假 synth */
function fakeSynth(options: { voices?: unknown[]; throwOnSpeak?: boolean; throwOnPause?: boolean } = {}) {
    const spoken: FakeUtterance[] = [];
    const listeners = new Map<string, Array<() => void>>();
    const synth = {
        getVoices: () => options.voices ?? [],
        speak: (utterance: FakeUtterance) => {
            if (options.throwOnSpeak) throw new Error('speak blocked');
            spoken.push(utterance);
        },
        pause: () => { if (options.throwOnPause) throw new Error('no pause'); },
        resume: () => { if (options.throwOnPause) throw new Error('no resume'); },
        cancel: () => { if (options.throwOnPause) throw new Error('no cancel'); },
        addEventListener: (type: string, handler: () => void) => {
            listeners.set(type, [...(listeners.get(type) ?? []), handler]);
        },
        removeEventListener: (type: string, handler: () => void) => {
            listeners.set(type, (listeners.get(type) ?? []).filter(item => item !== handler));
        },
        emit: (type: string) => (listeners.get(type) ?? []).forEach(handler => handler()),
        listenerCount: (type: string) => (listeners.get(type) ?? []).length,
    };
    return { synth, spoken };
}

const g = globalThis as unknown as { speechSynthesis?: unknown; SpeechSynthesisUtterance?: unknown };

beforeEach(() => {
    g.SpeechSynthesisUtterance = FakeUtterance;
});

afterEach(() => {
    delete g.speechSynthesis;
    delete g.SpeechSynthesisUtterance;
});

describe('tts-speech：能力探测', () => {
    it('没有 synth 也没有构造器时 isSupported 为 false', () => {
        delete g.SpeechSynthesisUtterance;
        expect(createTtsSpeechEngine().isSupported()).toBe(false);
    });

    it('注入 synth 即视为支持（音色为空不算不支持）', () => {
        const { synth } = fakeSynth({ voices: [] });
        const engine = createTtsSpeechEngine(synth as unknown as SpeechSynthesis);
        expect(engine.isSupported()).toBe(true);
        expect(engine.listVoices()).toEqual([]);
    });

    it('映射音色字段；getVoices 抛错时返回空数组', () => {
        const { synth } = fakeSynth({ voices: [voice('a', 'A', 'zh-CN', true)] });
        expect(createTtsSpeechEngine(synth as unknown as SpeechSynthesis).listVoices()).toEqual([
            { uri: 'a', name: 'A', lang: 'zh-CN', isDefault: true },
        ]);
        const broken = { getVoices: () => { throw new Error('boom'); } };
        expect(createTtsSpeechEngine(broken as unknown as SpeechSynthesis).listVoices()).toEqual([]);
    });
});

describe('tts-speech：朗读', () => {
    it('把语速 / 语言 / 音量写进 utterance，并接线回调', () => {
        const { synth, spoken } = fakeSynth({ voices: [voice('v1', 'Voice 1', 'zh-CN')] });
        const engine = createTtsSpeechEngine(synth as unknown as SpeechSynthesis);
        const onEnd = vi.fn();
        const onStart = vi.fn();
        const ok = engine.speak('你好。', { rate: 1.5, volume: 0.8, lang: 'zh-CN', voiceUri: 'v1' }, { onStart, onEnd, onError: vi.fn() });
        expect(ok).toBe(true);
        expect(spoken).toHaveLength(1);
        expect(spoken[0].text).toBe('你好。');
        expect(spoken[0].rate).toBe(1.5);
        expect(spoken[0].volume).toBe(0.8);
        expect(spoken[0].lang).toBe('zh-CN');
        expect(spoken[0].voice).toEqual(voice('v1', 'Voice 1', 'zh-CN'));
        spoken[0].onstart?.();
        expect(onStart).toHaveBeenCalledTimes(1);
        spoken[0].onend?.();
        expect(onEnd).toHaveBeenCalledTimes(1);
    });

    it('voiceUri 找不到时退回系统默认音色', () => {
        const { synth, spoken } = fakeSynth({ voices: [voice('v1', 'Voice 1', 'zh-CN')] });
        createTtsSpeechEngine(synth as unknown as SpeechSynthesis).speak('hi', { rate: 1, voiceUri: 'missing' }, { onEnd: vi.fn(), onError: vi.fn() });
        expect(spoken[0].voice).toBeNull();
    });

    it('缺构造器 / speak 抛错都走 onError，不向外抛', () => {
        const onError = vi.fn();
        delete g.SpeechSynthesisUtterance;
        const { synth } = fakeSynth();
        expect(createTtsSpeechEngine(synth as unknown as SpeechSynthesis).speak('x', { rate: 1 }, { onEnd: vi.fn(), onError })).toBe(false);
        expect(onError).toHaveBeenCalledWith('unsupported');

        g.SpeechSynthesisUtterance = FakeUtterance;
        const throwing = fakeSynth({ throwOnSpeak: true });
        const onError2 = vi.fn();
        expect(createTtsSpeechEngine(throwing.synth as unknown as SpeechSynthesis).speak('x', { rate: 1 }, { onEnd: vi.fn(), onError: onError2 })).toBe(false);
        expect(onError2).toHaveBeenCalledWith('speak blocked');
    });

    it('utterance 的 onerror 把 error 名透传给回调', () => {
        const { synth, spoken } = fakeSynth();
        const onError = vi.fn();
        createTtsSpeechEngine(synth as unknown as SpeechSynthesis).speak('x', { rate: 1 }, { onEnd: vi.fn(), onError });
        spoken[0].onerror?.({ error: 'not-allowed' });
        expect(onError).toHaveBeenCalledWith('not-allowed');
    });
});

describe('tts-speech：控制与音色变更', () => {
    it('pause / resume / cancel 抛错也被吞掉', () => {
        const { synth } = fakeSynth({ throwOnPause: true });
        const engine = createTtsSpeechEngine(synth as unknown as SpeechSynthesis);
        expect(() => { engine.pause(); engine.resume(); engine.cancel(); }).not.toThrow();
    });

    it('voiceschanged 可订阅也可退订', () => {
        const { synth } = fakeSynth();
        const engine = createTtsSpeechEngine(synth as unknown as SpeechSynthesis);
        const callback = vi.fn();
        const off = engine.onVoicesChanged(callback);
        expect(synth.listenerCount('voiceschanged')).toBe(1);
        synth.emit('voiceschanged');
        expect(callback).toHaveBeenCalledTimes(1);
        off();
        expect(synth.listenerCount('voiceschanged')).toBe(0);
    });

    it('没有 addEventListener 的环境返回空退订函数', () => {
        const off = createTtsSpeechEngine({ getVoices: () => [] } as unknown as SpeechSynthesis).onVoicesChanged(() => undefined);
        expect(() => off()).not.toThrow();
    });
});
