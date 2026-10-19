import { describe, it, expect } from 'vitest';
import { SemanticAnalyzer } from '../engine/semantic-analyzer';

describe('Debug', () => {
    it('debug all failing words', () => {
        const characters = ['克莱恩', '卡丹', '紫川秀', '帝林', '李云龙', '王小云'];
        const skills = ['九阳神功', '九阴真经', '乾坤大挪移', '紫霞神功', '北冥神功', '小无相功'];
        const settings = ['太古秘境', '昆仑禁地', '长安城', '幽冥鬼界', '东海龙宫', '西天大雷音寺'];
        const events = ['三界大战', '末日预言', '万年浩劫', '封神之战', '千年大劫', '末世灾变'];
        const orgs = ['武当派', '少林派', '青龙帮', '明教', '妖族联盟', '暗夜组织'];

        console.log('\n=== Characters ===');
        for (const w of characters) {
            const r = SemanticAnalyzer.analyzeWord(w);
            console.log(`${w}: type=${r.type}, subType=${r.subType}, conf=${r.confidence}`);
        }

        console.log('\n=== Skills ===');
        for (const w of skills) {
            const r = SemanticAnalyzer.analyzeWord(w);
            console.log(`${w}: type=${r.type}, subType=${r.subType}, conf=${r.confidence}`);
        }

        console.log('\n=== Settings ===');
        for (const w of settings) {
            const r = SemanticAnalyzer.analyzeWord(w);
            console.log(`${w}: type=${r.type}, subType=${r.subType}, conf=${r.confidence}`);
        }

        console.log('\n=== Events ===');
        for (const w of events) {
            const r = SemanticAnalyzer.analyzeWord(w);
            console.log(`${w}: type=${r.type}, subType=${r.subType}, conf=${r.confidence}`);
        }

        console.log('\n=== Orgs ===');
        for (const w of orgs) {
            const r = SemanticAnalyzer.analyzeWord(w);
            console.log(`${w}: type=${r.type}, subType=${r.subType}, conf=${r.confidence}`);
        }

        console.log('\n=== extractEntities ===');
        const text = '克莱恩手持传国玉佩，来到了太古秘境。九阳神功在他体内流转。';
        const entities = SemanticAnalyzer.extractEntities(text);
        console.log('Entities:', entities);

        console.log('\n=== Debug problematic words ===');
        const debugWords = ['手持传国玉佩', '到了太古秘境', '在他体内', '手持', '到了', '在他', '传国玉佩', '太古秘境', '来到了', '他体内'];
        for (const w of debugWords) {
            const a = SemanticAnalyzer.analyzeWord(w);
            const looks = SemanticAnalyzer.looksLikePersonName(w);
            console.log(`${w}: type=${a.type}, subType=${a.subType}, conf=${a.confidence}, looksLikeName=${looks}`);
        }

        console.log('\n=== isVerbStart debug ===');
        const testWords = ['手持传国玉佩', '到了太古秘境', '传国玉佩', '太古秘境'];
        for (const w of testWords) {
            const first2 = w.substring(0, Math.min(2, w.length));
            const first = w.charAt(0);
            const a2 = SemanticAnalyzer.analyzeWord(first2);
            const a1 = SemanticAnalyzer.analyzeWord(first);
            console.log(`${w}: first2=${first2}(${a2.type}), first=${first}(${a1.type})`);
        }

        console.log('\n=== Candidate scores ===');
        const text2 = '克莱恩手持传国玉佩，来到了太古秘境。九阳神功在他体内流转。';
        const candidates: { word: string; score: number; subType: string; pos: number }[] = [];
        for (let len = 6; len >= 2; len--) {
            for (let i = 0; i <= text2.length - len; i++) {
                const word = text2.substring(i, i + len);
                if (!/^[\u4e00-\u9fa5]+$/.test(word)) continue;
                const a = SemanticAnalyzer.analyzeWord(word);
                if (a.type !== 'noun' || !a.subType || a.subType === 'unknown') continue;
                if (a.confidence < 0.65) continue;
                
                let score = a.confidence;
                if (word.length >= 3 && word.length <= 4) score += 0.1;
                if (word.length >= 5) score -= 0.1 * (word.length - 4);
                
                const first2 = word.substring(0, Math.min(2, word.length));
                const a2 = SemanticAnalyzer.analyzeWord(first2);
                if (a2.type === 'verb') score -= 0.3;
                if (a2.type === 'function') score -= 0.2;
                
                const first1 = word.charAt(0);
                const a1 = SemanticAnalyzer.analyzeWord(first1);
                if (a1.type === 'verb') score -= 0.15;
                if (a1.type === 'function') score -= 0.1;
                
                if (score >= 0.6) {
                    candidates.push({ word, score, subType: a.subType, pos: i });
                }
            }
        }
        candidates.sort((a, b) => b.score - a.score);
        console.log('Top candidates:');
        for (const c of candidates.slice(0, 15)) {
            console.log(`  ${c.word} (pos=${c.pos}, subType=${c.subType}): score=${c.score.toFixed(3)}`);
        }

        expect(true).toBe(true);
    });
});
