/**
 * true-random.ts - CSPRNG-backed random helpers.
 *
 * Requirement: "真随机" means cryptographic randomness, not Math.random().
 * All creative randomization must go through this module so results are
 * non-reproducible even with identical prompts.
 */

export interface RandomSource {
    nextFloat(): number;
    randomInt(maxExclusive: number): number;
    pick<T>(items: T[]): T;
    pickMany<T>(items: T[], count: number): T[];
    shuffle<T>(items: T[]): T[];
    weightedPick<T>(items: Array<{ value: T; weight: number }>): T;
    uuid(): string;
}

function cryptoRandomInt(maxExclusive: number): number {
    if (!Number.isFinite(maxExclusive) || maxExclusive <= 1) return 0;
    if (typeof globalThis.crypto?.getRandomValues !== 'function') {
        // Only tests / ancient environments hit this; production Obsidian has WebCrypto.
        return Math.floor(Math.random() * maxExclusive);
    }
    // Rejection sampling avoids modulo bias.
    const range = 4294967296; // 2 ** 32
    const limit = range - (range % maxExclusive);
    const buffer = new Uint32Array(1);
    for (let attempt = 0; attempt < 32; attempt++) {
        globalThis.crypto.getRandomValues(buffer);
        if (buffer[0] < limit) return buffer[0] % maxExclusive;
    }
    return buffer[0] % maxExclusive;
}

/**
 * trueRandom 常量。
 */
export const trueRandom: RandomSource = {
    nextFloat(): number {
        return cryptoRandomInt(4294967296) / 4294967296;
    },
    randomInt(maxExclusive: number): number {
        return cryptoRandomInt(maxExclusive);
    },
    pick<T>(items: T[]): T {
        if (!items || items.length === 0) throw new Error('trueRandom.pick: empty array');
        return items[cryptoRandomInt(items.length)];
    },
    pickMany<T>(items: T[], count: number): T[] {
        return this.shuffle(items).slice(0, Math.max(0, Math.min(count, items.length)));
    },
    shuffle<T>(items: T[]): T[] {
        const result = [...items];
        for (let i = result.length - 1; i > 0; i--) {
            const j = cryptoRandomInt(i + 1);
            [result[i], result[j]] = [result[j], result[i]];
        }
        return result;
    },
    weightedPick<T>(items: Array<{ value: T; weight: number }>): T {
        const usable = items.filter(item => item.weight > 0);
        if (usable.length === 0) throw new Error('trueRandom.weightedPick: no positive weights');
        const total = usable.reduce((sum, item) => sum + item.weight, 0);
        let threshold = this.nextFloat() * total;
        for (const item of usable) {
            threshold -= item.weight;
            if (threshold <= 0) return item.value;
        }
        return usable[usable.length - 1].value;
    },
    uuid(): string {
        if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
        const bytes = new Uint8Array(16);
        globalThis.crypto.getRandomValues(bytes);
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    },
};

/**
 * Deterministic helper for tests only; production code must use trueRandom.
 *
 * @param seed - 随机种子
  * @returns RandomSource 实例
 */
export function createSeededRandom(seed: string): RandomSource {
    let state = 2166136261;
    for (const char of seed) {
        state ^= char.charCodeAt(0);
        state = Math.imul(state, 16777619) >>> 0;
    }
    const next = (): number => {
        state ^= state << 13; state >>>= 0;
        state ^= state >> 17;
        state ^= state << 5; state >>>= 0;
        return state / 4294967296;
    };
    return {
        nextFloat: next,
        randomInt(maxExclusive: number) { return Math.floor(next() * maxExclusive); },
        pick(items) { return items[Math.floor(next() * items.length)]; },
        pickMany<T>(items: T[], count: number): T[] {
            const copy = [...items];
            const result: T[] = [];
            while (copy.length > 0 && result.length < count) {
                result.push(copy.splice(Math.floor(next() * copy.length), 1)[0]);
            }
            return result;
        },
        shuffle(items) {
            const result = [...items];
            for (let i = result.length - 1; i > 0; i--) {
                const j = Math.floor(next() * (i + 1));
                [result[i], result[j]] = [result[j], result[i]];
            }
            return result;
        },
        weightedPick(items) {
            const usable = items.filter(item => item.weight > 0);
            const total = usable.reduce((sum, item) => sum + item.weight, 0);
            let threshold = next() * total;
            for (const item of usable) {
                threshold -= item.weight;
                if (threshold <= 0) return item.value;
            }
            return usable[usable.length - 1].value;
        },
        uuid() { return `seed-${seed}-${Math.floor(next() * 1e12)}`; },
    };
}
