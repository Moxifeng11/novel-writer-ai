/**
 * 桌宠本机图片选择器：必须挂 DOM 再触发、取消/异常清理、失败可见（对抗审查修复回归）
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { pickLocalImage } from '@/ui/pet-image-settings';

/** 记录调用顺序 */
const order: string[] = [];

class FakeInput {
    type = '';
    accept = '';
    className = '';
    files: File[] | null = null;
    parentNode: FakeParent | null = null;
    private listeners = new Map<string, Array<() => void>>();

    addEventListener(type: string, listener: () => void): void {
        const list = this.listeners.get(type) ?? [];
        list.push(listener);
        this.listeners.set(type, list);
    }

    dispatch(type: string): void {
        for (const listener of this.listeners.get(type) ?? []) listener();
    }

    click = vi.fn(() => order.push('click'));

    showPicker = vi.fn(() => order.push('showPicker'));
}

class FakeParent {
    children: FakeInput[] = [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    appendChild(node: any): void {
        node.parentNode = this;
        this.children.push(node);
        order.push('append');
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    removeChild(node: any): void {
        this.children = this.children.filter(child => child !== node);
        node.parentNode = null;
        order.push('remove');
    }
}

const makeElement = (input: FakeInput) => (tag: string) => {
        if (tag === 'input') return input;
        if (tag === 'canvas') {
            return {
                width: 0,
                height: 0,
                getContext: () => ({ drawImage: vi.fn() }),
                toDataURL: () => 'data:image/png;base64,AAAA',
            };
        }
        return { tagName: tag };
};

const makeDoc = (input: FakeInput, parent: FakeParent) => {
    const createElement = makeElement(input);
    return {
        createElement,
        createEl: createElement,
        body: parent,
        documentElement: parent,
    };
};

const makeFile = (): File => ({ name: 'pet.png', type: 'image/png', size: 10 } as unknown as File);

afterEach(() => {
    order.length = 0;
    vi.unstubAllGlobals();
});

describe('pickLocalImage — 文件选择器', () => {
    it('先挂到 DOM 再触发 showPicker（iOS/WebView 下 detached input 会被忽略）', () => {
        const input = new FakeInput();
        const parent = new FakeParent();
        const doc = makeDoc(input, parent);
        vi.stubGlobal('document', doc);

        pickLocalImage({ doc: doc as unknown as Document }, () => undefined);

        expect(order).toEqual(['append', 'showPicker']);
        expect(parent.children).toHaveLength(1);
        expect(input.accept).toContain('image/png');
        expect(input.className).toBe('nw-file-input-probe');
    });

    it('选择图片后回调收到压缩 data URL，并清理临时 input', async () => {
        const input = new FakeInput();
        const parent = new FakeParent();
        const doc = makeDoc(input, parent);
        vi.stubGlobal('document', doc);
        const picked: string[] = [];

        pickLocalImage({
            doc: doc as unknown as Document,
            readAsDataUrl: async () => 'data:image/png;base64,AAAA',
            loadImage: async () => ({ width: 100, height: 100 } as unknown as HTMLImageElement),
        }, dataUrl => { picked.push(dataUrl); });
        input.files = [makeFile()];
        input.dispatch('change');
        await new Promise(resolve => setTimeout(resolve, 0));
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(picked).toEqual(['data:image/png;base64,AAAA']);
        expect(parent.children).toHaveLength(0);
    });

    it('读取失败：提示可见且清理 input（不再静默无反应）', async () => {
        const input = new FakeInput();
        const parent = new FakeParent();
        const doc = makeDoc(input, parent);
        vi.stubGlobal('document', doc);
        const errors: string[] = [];

        pickLocalImage({
            doc: doc as unknown as Document,
            readAsDataUrl: async () => { throw new Error('读不动'); },
            loadImage: async () => ({ width: 10, height: 10 } as unknown as HTMLImageElement),
            onError: (message: string) => errors.push(message),
        }, () => undefined);
        input.files = [makeFile()];
        input.dispatch('change');
        await new Promise(resolve => setTimeout(resolve, 0));
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain('读取或保存图片失败');
        expect(parent.children).toHaveLength(0);
    });

    it('取消选择：清理 input', () => {
        const input = new FakeInput();
        const parent = new FakeParent();
        const doc = makeDoc(input, parent);
        vi.stubGlobal('document', doc);

        pickLocalImage({ doc: doc as unknown as Document }, () => undefined);
        expect(parent.children).toHaveLength(1);
        input.dispatch('cancel');
        expect(parent.children).toHaveLength(0);
    });

    it('showPicker 抛错时退回 click', () => {
        const input = new FakeInput();
        input.showPicker = vi.fn(() => { throw new Error('not allowed'); });
        const parent = new FakeParent();
        const doc = makeDoc(input, parent);
        vi.stubGlobal('document', doc);

        pickLocalImage({ doc: doc as unknown as Document }, () => undefined);
        expect(input.click).toHaveBeenCalled();
    });
});

describe('pickLocalImage — 独立设置窗口（Obsidian 1.15）', () => {
    it('未显式传 doc 时使用 activeDocument（当前设置窗口），而不是主窗口 document', () => {
        const mainInput = new FakeInput();
        const mainParent = new FakeParent();
        const mainDoc = makeDoc(mainInput, mainParent);
        const settingsInput = new FakeInput();
        const settingsParent = new FakeParent();
        const settingsDoc = makeDoc(settingsInput, settingsParent);
        vi.stubGlobal('document', mainDoc);
        vi.stubGlobal('activeDocument', settingsDoc);

        pickLocalImage({}, () => undefined);

        // 必须落在设置窗口（activeDocument）里，否则 showPicker 会因窗口未聚焦被拦截
        expect(settingsParent.children).toHaveLength(1);
        expect(mainParent.children).toHaveLength(0);
        expect(settingsInput.showPicker).toHaveBeenCalled();
        expect(mainInput.showPicker).not.toHaveBeenCalled();
    });
});
