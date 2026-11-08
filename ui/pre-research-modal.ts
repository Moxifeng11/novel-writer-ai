/**
 * pre-research-modal.ts — 短篇 / 剧本独立前期调研
 *
 * 短篇、剧本不再从通用「新建项目」直接进入长篇模板：
 * 先完成本模块的定位、分类、故事核/商业钩子与目标规格，再创建项目。
 * 调研结果写入项目内独立的 `00-前期调研/`，与长篇 11 步完全分离。
 */
import { App, Modal, Notice } from 'obsidian';
import type NovelWriterPlugin from '@/main';
import {
    CREATION_MODE_SPECS,
    SCRIPT_GENRES,
    SHORT_STORY_CATEGORIES,
    type CreationMode,
} from '@/shared/creation-mode';
import {
    createDefaultPreResearch,
    readPreResearchData,
    writePreResearchFiles,
    type PreResearchData,
    type ScriptPreResearch,
    type ShortPreResearch,
} from '@/shared/pre-research';
import { DomainProjectFactory } from '@/domains/kernel/domain-project-factory';
import { getProjectMeta } from './project-utils';
import { showErrorNotice, showSuccessNotice } from './components/notice-helpers';
import { AiAssistedPremiseService, type AiPremiseResult } from '@/engine/harness/ai-assisted-premise-service';
import { creativeRandomizer } from '@/engine/harness/creative-randomizer';

import { createLogger } from '@/shared/logger';

const log = createLogger('PreResearchModal');

type ResearchMode = Extract<CreationMode, 'short' | 'script'>;
type FieldElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

/**
 * PreResearchModalOptions 类型定义。
 */
export interface PreResearchModalOptions {
    /** 已有项目：编辑当前项目的前期调研 */
    project?: string;
    /** 新建时预填项目名 */
    name?: string;
    onCreated?: (project: string) => void | Promise<void>;
}

/**
 * PreResearchModal 类。
 */
export class PreResearchModal extends Modal {
    private readonly mode: ResearchMode;
    private readonly options: PreResearchModalOptions;
    private readonly fields: Record<string, FieldElement> = {};
    private loaded = false;
    private aiStatusEl: HTMLElement | null = null;
    private aiOutputEl: HTMLElement | null = null;
    private aiResult: AiPremiseResult | null = null;
    private randomBrief: ReturnType<typeof creativeRandomizer.brief> | null = null;

    constructor(
        app: App,
        private readonly plugin: NovelWriterPlugin,
        mode: ResearchMode,
        options: PreResearchModalOptions = {}
    ) {
        super(app);
        this.mode = mode;
        this.options = options;
    }

    /**
     * onOpen 方法。
     */
    onOpen(): void {
        this.modalEl.addClass('nw-scope', 'nw-modal', 'nw-pre-research-modal');
        this.titleEl.setText(this.mode === 'short' ? '📚 短篇前期调研' : '🎬 剧本前期调研');
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('nw-pre-research-content');

        const intro = contentEl.createDiv({ cls: 'nw-pre-research-intro' });
        intro.createEl('p', {
            text: this.mode === 'short'
                ? '先完成番茄短篇定位与故事核，再创建项目。调研结果写入独立的 00-前期调研/，不复用长篇 11 步。'
                : '先完成红果短剧类型、商业钩子与集数规格，再创建项目。调研结果写入独立的 00-前期调研/，不复用长篇 11 步。',
        });

        const aiRow = intro.createDiv({ cls: 'nw-u-d-flex-2 nw-u-gap-8px-2 nw-u-fwr-wrap-2' });
        const researchBtn = aiRow.createEl('button', {
            text: '🤖 AI 前期调研',
            cls: 'nw-btn nw-btn-primary',
            attr: { type: 'button', title: '检索热点/行业素材，结合固化框架与真随机因子生成 3 个候选方向' },
        });
        const randomBtn = aiRow.createEl('button', {
            text: '🎲 随机灵感',
            cls: 'nw-btn nw-btn-secondary',
            attr: { type: 'button', title: '只生成多层真随机因子预览，不调用 AI' },
        });
        const aiStatus = aiRow.createDiv({ cls: 'nw-u-fs-12px-2 nw-u-c-text-muted-2', text: '尚未执行 AI 调研' });
        const aiOutput = intro.createDiv({ cls: 'nw-u-fs-12px-2' });
        aiOutput.hidden = true;
        this.aiStatusEl = aiStatus;
        this.aiOutputEl = aiOutput;
        researchBtn.onclick = () => { void this.runAiResearch(researchBtn, randomBtn); };
        randomBtn.onclick = () => this.showRandomPreview();

        const body = contentEl.createDiv({ cls: 'nw-modal-body' });
        if (this.mode === 'short') this.renderShortFields(body);
        else this.renderScriptFields(body);

        const footer = contentEl.createDiv({ cls: 'nw-modal-footer' });
        const cancel = footer.createEl('button', {
            text: '取消',
            cls: 'nw-btn nw-btn-secondary',
            attr: { type: 'button' },
        });
        cancel.onclick = () => this.close();

        const submit = footer.createEl('button', {
            text: this.options.project ? '保存调研' : '创建项目并进入',
            cls: 'nw-btn nw-btn-primary',
            attr: { type: 'button' },
        });
        submit.onclick = () => { void this.submit(); };

        if (this.options.project) void this.loadExisting();
        else this.loaded = true;
    }

    private section(parent: HTMLElement, title: string): HTMLElement {
        const section = parent.createDiv({ cls: 'nw-form-group nw-pre-research-section' });
        section.createEl('h3', { text: title, cls: 'nw-pre-research-section-title' });
        return section;
    }

    private textField(
        parent: HTMLElement,
        key: string,
        label: string,
        placeholder: string,
        value = ''
    ): HTMLInputElement {
        const group = parent.createDiv({ cls: 'nw-form-group' });
        group.createEl('label', { cls: 'nw-form-label', text: label });
        const input = group.createEl('input', {
            type: 'text',
            cls: 'nw-input nw-form-input',
            attr: { placeholder },
        });
        input.value = value;
        this.fields[key] = input;
        return input;
    }

    private textareaField(
        parent: HTMLElement,
        key: string,
        label: string,
        placeholder: string,
        rows = 3
    ): HTMLTextAreaElement {
        const group = parent.createDiv({ cls: 'nw-form-group' });
        group.createEl('label', { cls: 'nw-form-label', text: label });
        const input = group.createEl('textarea', {
            cls: 'nw-textarea nw-form-textarea',
            attr: { placeholder, rows: String(rows) },
        });
        this.fields[key] = input;
        return input;
    }

    private numberField(
        parent: HTMLElement,
        key: string,
        label: string,
        value: number,
        min: number,
        max: number,
        desc?: string
    ): HTMLInputElement {
        const group = parent.createDiv({ cls: 'nw-form-group' });
        group.createEl('label', { cls: 'nw-form-label', text: label });
        const input = group.createEl('input', {
            type: 'number',
            cls: 'nw-input',
            attr: { min: String(min), max: String(max), value: String(value) },
        });
        this.fields[key] = input;
        if (desc) group.createEl('p', { cls: 'nw-text-12-muted', text: desc });
        return input;
    }

    private selectField(
        parent: HTMLElement,
        key: string,
        label: string,
        options: Array<{ value: string; text: string }>,
        placeholder: string
    ): HTMLSelectElement {
        const group = parent.createDiv({ cls: 'nw-form-group' });
        group.createEl('label', { cls: 'nw-form-label nw-form-label-required', text: label });
        const select = group.createEl('select', { cls: 'nw-select' });
        select.createEl('option', { value: '', text: placeholder });
        for (const option of options) select.createEl('option', { value: option.value, text: option.text });
        this.fields[key] = select;
        return select;
    }

    private renderShortFields(body: HTMLElement): void {
        const spec = CREATION_MODE_SPECS.short;
        const section1 = this.section(body, '一、市场与定位');
        this.textField(section1, 'name', '项目名称', '请输入短篇名', this.options.name || '');
        this.selectField(
            section1,
            'primaryCategory',
            '番茄主分类（必选）',
            SHORT_STORY_CATEGORIES.map(c => ({ value: c.name, text: `${c.name}（${c.gender}）` })),
            '请选择主分类'
        );
        this.numberField(section1, 'targetWords', '目标字数', spec.targetWords.default, spec.targetWords.min, spec.targetWords.max, '5–10 万字；建议 8 万字。');
        this.numberField(section1, 'targetSections', '目标节数', spec.targetUnits.default, spec.targetUnits.min, spec.targetUnits.max, '8–40 节；建议 20 节。');
        this.textField(section1, 'audience', '目标读者', '例如：25–35 岁女性、婚姻家庭题材读者');
        this.textField(section1, 'references', '参考作品/资料', '可填写平台作品、榜单、公开资料');

        const section2 = this.section(body, '二、故事核心');
        this.textareaField(section2, 'premise', '一句话故事（必填）', '谁 + 要什么 + 被谁阻止 + 反转 + 情绪承诺', 3);
        this.textareaField(section2, 'coreConflict', '核心冲突', '主角与对手/规则的核心对撞', 2);
        this.textField(section2, 'emotionalPromise', '情绪承诺', '例如：先抑后扬的婚姻反击爽感');
        this.textareaField(section2, 'reversals', '3–5 个反转', '每个反转写：读者以为→实际→代价', 4);
        this.textareaField(section2, 'endingPayoff', '结尾兑现', '最后一节给读者的具体画面/结果', 2);

        const section3 = this.section(body, '三、五维标签');
        this.textField(section3, 'plotTags', '情节标签', '例如：家庭关系 / 婆媳矛盾 / 财产争夺');
        this.textField(section3, 'characterCore', '角色核心', '例如：隐忍儿媳 vs 恶婆婆');
        this.textField(section3, 'emotionCurve', '情绪曲线', '例如：先抑后扬 / 先虐后爽');
        this.textField(section3, 'background', '背景', '例如：现代 / 家庭住宅 / 现实');

        const section4 = this.section(body, '四、补充');
        this.textareaField(section4, 'notes', '调研备注', '待核实信息、平台规则、风险点', 3);
    }

    private renderScriptFields(body: HTMLElement): void {
        const spec = CREATION_MODE_SPECS.script;
        const section1 = this.section(body, '一、项目定位');
        this.textField(section1, 'name', '剧名', '请输入剧本名', this.options.name || '');
        this.selectField(
            section1,
            'genre',
            '红果短剧类型（必选）',
            SCRIPT_GENRES.map(g => ({ value: g.name, text: `${g.name} · ${g.coreHook}` })),
            '请选择剧本类型'
        );
        this.numberField(section1, 'targetWords', '目标字数', 60000, spec.targetWords.min, spec.targetWords.max, '5–10 万字。');
        this.numberField(section1, 'targetEpisodes', '目标集数', spec.targetUnits.default, spec.targetUnits.min, spec.targetUnits.max, '40–120 集；建议 80 集。');
        this.numberField(section1, 'episodeSeconds', '单集时长（秒）', 90, 60, 120, '60–120 秒。');
        this.textField(section1, 'audience', '目标受众', '例如：下沉市场、25–45 岁女性');
        this.textField(section1, 'references', '参考作品/资料', '可填写平台短剧、公开资料');

        const section2 = this.section(body, '二、商业钩子');
        this.textareaField(section2, 'logline', '一句话卖点（必填）', '谁被谁压迫 + 核心反转 + 观众为什么追', 3);
        this.textareaField(section2, 'hook3s', '前 3 秒钩子', '必须可见：冲突/羞辱/危机/身份错位', 2);
        this.textareaField(section2, 'coreConflict', '核心冲突', '主角与对手/规则的核心对撞', 2);
        this.textareaField(section2, 'payoff', '本剧爽点/兑现', '观众最想看到的具体画面', 2);
        this.numberField(section2, 'paywallEpisode', '付费卡点集数', 12, 1, spec.targetUnits.max, '默认第 10–15 集。');

        const section3 = this.section(body, '三、人物与场景');
        this.textareaField(section3, 'characters', '主要人物', '主角/对手/关键关系人，写清欲望与阻力', 3);
        this.textareaField(section3, 'scenes', '主要场景', '2–4 个主场景，控制置景成本', 3);

        const section4 = this.section(body, '四、补充');
        this.textareaField(section4, 'notes', '调研备注', '待核实信息、平台规则、拍摄限制', 3);
    }

    private categoryOrGenre(): string {
        return this.mode === 'short' ? this.value('primaryCategory') : this.value('genre');
    }

    private showRandomPreview(): void {
        this.randomBrief = creativeRandomizer.brief(this.mode);
        this.renderRandomCard();
        this.aiStatusEl?.setText('已生成真随机因子预览；点击「AI 前期调研」可结合热点生成候选');
    }

    private renderRandomCard(): void {
        const brief = this.randomBrief;
        if (!brief || !this.aiOutputEl) return;
        this.aiOutputEl.hidden = false;
        this.aiOutputEl.empty();

        const card = this.aiOutputEl.createDiv({ cls: 'nw-seed-card' });

        const head = card.createDiv({ cls: 'nw-seed-card-head' });
        head.createDiv({ text: '🎲 真随机种子', cls: 'nw-seed-card-title' });
        const actions = head.createDiv({ cls: 'nw-seed-card-actions' });
        const copyBtn = actions.createEl('button', {
            text: '复制',
            cls: 'nw-btn nw-btn-secondary nw-seed-card-btn',
            attr: { type: 'button', title: '复制随机种子' },
        });
        const resetBtn = actions.createEl('button', {
            text: '重置',
            cls: 'nw-btn nw-btn-secondary nw-seed-card-btn',
            attr: { type: 'button', title: '生成新的随机种子与因子' },
        });
        copyBtn.onclick = () => { void this.copySeed(brief.seed, copyBtn); };
        resetBtn.onclick = () => {
            this.randomBrief = creativeRandomizer.brief(this.mode);
            this.renderRandomCard();
            this.aiStatusEl?.setText('已重置随机种子与因子；点击「AI 前期调研」可基于新种子生成候选');
        };

        const seedRow = card.createDiv({ cls: 'nw-seed-card-seed' });
        seedRow.createSpan({ text: '种子', cls: 'nw-seed-card-label' });
        seedRow.createSpan({ text: brief.seed, cls: 'nw-seed-card-value' });

        const groups: Array<{ title: string; items: string[]; cls: string }> = [
            { title: '前提层', items: brief.factors.layers.premise, cls: 'nw-seed-group-premise' },
            { title: '结构层', items: brief.factors.layers.structure, cls: 'nw-seed-group-structure' },
            { title: '质感层', items: brief.factors.layers.texture, cls: 'nw-seed-group-texture' },
            { title: '差异化', items: brief.factors.layers.differentiation, cls: 'nw-seed-group-diff' },
            { title: '禁用套路', items: brief.factors.forbiddenPatterns, cls: 'nw-seed-group-forbidden' },
        ];
        const grid = card.createDiv({ cls: 'nw-seed-card-grid' });
        for (const group of groups) {
            const groupEl = grid.createDiv({ cls: `nw-seed-group ${group.cls}` });
            groupEl.createDiv({ text: group.title, cls: 'nw-seed-group-title' });
            const chips = groupEl.createDiv({ cls: 'nw-seed-chips' });
            for (const item of group.items) {
                chips.createSpan({ text: item, cls: 'nw-seed-chip' });
            }
        }
    }

    private async copySeed(seed: string, button: HTMLButtonElement): Promise<void> {
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(seed);
            } else {
                const textarea = document.createElement('textarea');
                textarea.value = seed;
                textarea.style.position = 'fixed';
                textarea.style.opacity = '0';
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                textarea.remove();
            }
            const original = button.textContent || '复制';
            button.setText('已复制');
            button.addClass('is-copied');
            window.setTimeout(() => {
                button.setText(original);
                button.removeClass('is-copied');
            }, 1600);
        } catch (e) {
            showErrorNotice(e instanceof Error ? e.message : String(e), { title: '复制失败', timeout: 5000 });
        }
    }

    private async runAiResearch(researchBtn: HTMLButtonElement, randomBtn: HTMLButtonElement): Promise<void> {
        if (researchBtn.disabled) return;
        const categoryOrGenre = this.categoryOrGenre();
        if (!categoryOrGenre) {
            new Notice('❌ 请先选择主分类/短剧类型，再执行 AI 调研', 5000);
            return;
        }
        researchBtn.disabled = true;
        randomBtn.disabled = true;
        researchBtn.setText('⏳ AI 调研中…');
        this.aiStatusEl?.setText('正在检索热点/行业素材，并结合固化框架与真随机因子生成候选…');
        try {
            const settings = this.plugin.settings;
            const service = new AiAssistedPremiseService(this.plugin.aiEngine, {
                provider: settings.canonResearch?.provider || 'manual',
                apiKey: settings.canonResearch?.apiKey || '',
                maxSources: settings.canonResearch?.maxSources || 6,
            });
            const audience = this.value('audience');
            const result = await service.generate({
                mode: this.mode,
                project: this.options.project,
                categoryOrGenre,
                audience: audience || undefined,
            });
            this.aiResult = result;
            this.applyAiResult(result);
            const sourceLabel = result.trend.verified ? '实时来源' : '模型调研草稿（未经实时核实）';
            this.aiStatusEl?.setText(`✅ AI 调研完成：${sourceLabel}，来源 ${result.trend.sources.length} 条，候选 ${result.suggestions.length} 个`);
            showSuccessNotice(`AI 前期调研完成（${sourceLabel}）`, { timeout: 5000 });
        } catch (e) {
            this.aiStatusEl?.setText(`❌ AI 调研失败：${e instanceof Error ? e.message : String(e)}`);
            showErrorNotice(e instanceof Error ? e.message : String(e), { title: 'AI 前期调研失败', timeout: 8000 });
        } finally {
            researchBtn.disabled = false;
            randomBtn.disabled = false;
            researchBtn.setText('🤖 AI 前期调研');
        }
    }

    private applyAiResult(result: AiPremiseResult): void {
        if (!this.aiOutputEl) return;
        this.aiOutputEl.hidden = false;
        this.aiOutputEl.empty();
        this.aiOutputEl.createEl('pre', {
            text: result.premiseBlock,
            cls: 'nw-u-fs-12px-2',
        });

        const suggestions = result.suggestions;
        if (suggestions.length === 0) return;
        const apply = (index: number): void => {
            const item = suggestions[index];
            if (!item) return;
            this.setValueIfPresent('name', item.name);
            if (this.mode === 'short') {
                this.setValueIfPresent('premise', item.logline);
                this.setValueIfPresent('coreConflict', item.coreConflict);
                this.setValueIfPresent('emotionalPromise', item.emotionalPromise);
                this.setValueIfPresent('endingPayoff', item.endingPayoff);
                this.setValueIfPresent('characterCore', item.characters);
                this.setValueIfPresent('background', item.scenes);
            } else {
                this.setValueIfPresent('logline', item.logline);
                this.setValueIfPresent('hook3s', item.hook);
                this.setValueIfPresent('coreConflict', item.coreConflict);
                this.setValueIfPresent('payoff', item.emotionalPromise);
                this.setValueIfPresent('characters', item.characters);
                this.setValueIfPresent('scenes', item.scenes);
            }
            this.aiStatusEl?.setText(`已应用候选 ${index + 1}：${item.name}`);
        };
        this.aiOutputEl.createEl('div', { cls: 'nw-u-d-flex-2 nw-u-gap-8px-2 nw-u-fwr-wrap-2 nw-u-margintop-8px-2' }, (row) => {
            suggestions.forEach((item, index) => {
                const button = row.createEl('button', {
                    text: `应用候选 ${index + 1}`,
                    cls: 'nw-btn nw-btn-secondary',
                    attr: { type: 'button', title: item.logline || item.name },
                });
                button.onclick = () => apply(index);
            });
        });
    }

    private setValueIfPresent(key: string, value: string): void {
        const field = this.fields[key];
        if (!field || !value) return;
        field.value = value;
        field.dispatchEvent(new Event('input', { bubbles: true }));
        field.dispatchEvent(new Event('change', { bubbles: true }));
    }

    private async loadExisting(): Promise<void> {
        const project = this.options.project;
        if (!project) return;
        try {
            const meta = await getProjectMeta(this.app, project);
            if (meta.creationMode !== this.mode) {
                new Notice(`该项目不是${this.mode === 'short' ? '短篇' : '剧本'}项目，无法使用对应前期调研`, 6000);
                this.close();
                return;
            }
            const stored = await readPreResearchData(this.app.vault.adapter, project);
            const data = stored || (this.mode === 'short'
                ? {
                    ...(createDefaultPreResearch('short', project) as ShortPreResearch),
                    primaryCategory: meta.shortCategory,
                    targetWords: meta.modeTargetWords,
                    targetSections: meta.modeTargetUnits,
                }
                : {
                    ...(createDefaultPreResearch('script', project) as ScriptPreResearch),
                    genre: meta.scriptGenre,
                    targetWords: meta.modeTargetWords,
                    targetEpisodes: meta.modeTargetUnits,
                });
            this.applyData(data);
            // 已创建项目的类型与目标规格不允许在调研里悄悄改掉，避免与 .project 脱节
            for (const key of ['name', 'primaryCategory', 'genre', 'targetWords', 'targetSections', 'targetEpisodes']) {
                const el = this.fields[key];
                if (el) el.disabled = true;
            }
            this.loaded = true;
        } catch (e) {
            showErrorNotice(e instanceof Error ? e.message : String(e), { title: '读取前期调研失败', timeout: 6000 });
            this.loaded = true;
        }
    }

    private applyData(data: PreResearchData): void {
        const set = (key: string, value: unknown): void => {
            const el = this.fields[key];
            if (el) el.value = String(value ?? '');
        };
        if (data.mode === 'short') {
            set('name', data.name);
            set('primaryCategory', data.primaryCategory);
            set('targetWords', data.targetWords);
            set('targetSections', data.targetSections);
            set('premise', data.premise);
            set('coreConflict', data.coreConflict);
            set('emotionalPromise', data.emotionalPromise);
            set('reversals', data.reversals);
            set('endingPayoff', data.endingPayoff);
            set('plotTags', data.plotTags);
            set('characterCore', data.characterCore);
            set('emotionCurve', data.emotionCurve);
            set('background', data.background);
            set('audience', data.audience);
            set('references', data.references);
            set('notes', data.notes);
        } else {
            set('name', data.name);
            set('genre', data.genre);
            set('targetWords', data.targetWords);
            set('targetEpisodes', data.targetEpisodes);
            set('episodeSeconds', data.episodeSeconds);
            set('logline', data.logline);
            set('hook3s', data.hook3s);
            set('coreConflict', data.coreConflict);
            set('payoff', data.payoff);
            set('paywallEpisode', data.paywallEpisode);
            set('characters', data.characters);
            set('scenes', data.scenes);
            set('audience', data.audience);
            set('references', data.references);
            set('notes', data.notes);
        }
    }

    private value(key: string): string {
        return String(this.fields[key]?.value ?? '').trim();
    }

    private number(key: string, fallback: number): number {
        const parsed = parseInt(this.value(key), 10);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    private buildInsight(): PreResearchData['insight'] {
        const result = this.aiResult;
        if (!result) return undefined;
        return {
            summary: result.trend.summary,
            verified: result.trend.verified,
            researchedAt: result.trend.researchedAt,
            sources: result.trend.sources,
            warnings: result.trend.warnings,
            framework: result.frameworkBlock,
            randomFactors: {
                seed: result.randomBrief.seed,
                premise: result.randomBrief.factors.layers.premise,
                structure: result.randomBrief.factors.layers.structure,
                texture: result.randomBrief.factors.layers.texture,
                differentiation: result.randomBrief.factors.layers.differentiation,
                forbiddenPatterns: result.randomBrief.factors.forbiddenPatterns,
            },
        };
    }

    private collect(): PreResearchData | null {
        if (!this.loaded) return null;
        const name = this.value('name');
        if (!name) {
            new Notice('❌ 请填写项目名称', 4000);
            return null;
        }
        if (this.mode === 'short') {
            const category = this.value('primaryCategory');
            if (!category) {
                new Notice('❌ 请选择番茄短篇主分类', 5000);
                return null;
            }
            const targetWords = this.number('targetWords', 80000);
            const targetSections = this.number('targetSections', 20);
            const spec = CREATION_MODE_SPECS.short;
            if (targetWords < spec.targetWords.min || targetWords > spec.targetWords.max) {
                new Notice(`❌ 目标字数必须在 ${spec.targetWords.min}–${spec.targetWords.max} 字之间`, 6000);
                return null;
            }
            if (targetSections < spec.targetUnits.min || targetSections > spec.targetUnits.max) {
                new Notice(`❌ 目标节数必须在 ${spec.targetUnits.min}–${spec.targetUnits.max} 节之间`, 6000);
                return null;
            }
            const data: ShortPreResearch = {
                mode: 'short',
                name,
                primaryCategory: category,
                targetWords,
                targetSections,
                premise: this.value('premise'),
                coreConflict: this.value('coreConflict'),
                emotionalPromise: this.value('emotionalPromise'),
                reversals: this.value('reversals'),
                endingPayoff: this.value('endingPayoff'),
                plotTags: this.value('plotTags'),
                characterCore: this.value('characterCore'),
                emotionCurve: this.value('emotionCurve'),
                background: this.value('background'),
                audience: this.value('audience'),
                references: this.value('references'),
                notes: this.value('notes'),
                insight: this.buildInsight(),
            };
            return data;
        }

        const genre = this.value('genre');
        if (!genre) {
            new Notice('❌ 请选择红果短剧类型', 5000);
            return null;
        }
        const spec = CREATION_MODE_SPECS.script;
        const targetWords = this.number('targetWords', 60000);
        const targetEpisodes = this.number('targetEpisodes', 80);
        const episodeSeconds = this.number('episodeSeconds', 90);
        const paywallEpisode = this.number('paywallEpisode', 12);
        if (targetWords < spec.targetWords.min || targetWords > spec.targetWords.max) {
            new Notice(`❌ 目标字数必须在 ${spec.targetWords.min}–${spec.targetWords.max} 字之间`, 6000);
            return null;
        }
        if (targetEpisodes < spec.targetUnits.min || targetEpisodes > spec.targetUnits.max) {
            new Notice(`❌ 目标集数必须在 ${spec.targetUnits.min}–${spec.targetUnits.max} 集之间`, 6000);
            return null;
        }
        if (episodeSeconds < 60 || episodeSeconds > 120) {
            new Notice('❌ 单集时长必须在 60–120 秒之间', 6000);
            return null;
        }
        if (paywallEpisode < 1 || paywallEpisode > targetEpisodes) {
            new Notice('❌ 付费卡点集数必须落在总集数范围内', 6000);
            return null;
        }
        const data: ScriptPreResearch = {
            mode: 'script',
            name,
            genre,
            targetWords,
            targetEpisodes,
            episodeSeconds,
            logline: this.value('logline'),
            hook3s: this.value('hook3s'),
            coreConflict: this.value('coreConflict'),
            payoff: this.value('payoff'),
            paywallEpisode,
            characters: this.value('characters'),
            scenes: this.value('scenes'),
            audience: this.value('audience'),
            references: this.value('references'),
            notes: this.value('notes'),
            insight: this.buildInsight(),
        };
        return data;
    }

    private async submit(): Promise<void> {
        const data = this.collect();
        if (!data) return;

        if (this.options.project) {
            try {
                await writePreResearchFiles(this.app.vault.adapter, this.options.project, data, this.app);
                showSuccessNotice('前期调研已保存到 00-前期调研/', { timeout: 5000 });
                this.close();
            } catch (e) {
                showErrorNotice(e instanceof Error ? e.message : String(e), { title: '保存调研失败', timeout: 8000 });
            }
            return;
        }

        new DomainProjectFactory(this.app, this.plugin, this.app.vault.adapter).create({
            name: data.name,
            mode: data.mode,
            genre: data.mode === 'short' ? data.primaryCategory : data.genre,
            description: data.mode === 'short' ? data.premise : data.logline,
            targetWords: data.targetWords,
            targetUnits: data.mode === 'short' ? data.targetSections : data.targetEpisodes,
            shortCategory: data.mode === 'short' ? data.primaryCategory : '',
            scriptGenre: data.mode === 'script' ? data.genre : '',
            onCreated: async (project) => {
                try {
                    await writePreResearchFiles(this.app.vault.adapter, project, data, this.app);
                    showSuccessNotice(`项目已创建：${project}。下一步在「创作流程」里写大纲与正文`, { timeout: 6000 });
                    await this.options.onCreated?.(project);
                    // 创建即断头是旧流程最大的问题：写完调研必须把用户送到下一步。
                    // 导航失败只降级为提示，不能反过来把「项目已创建」报成失败。
                    try {
                        await this.plugin.openCreationFlow(project);
                    } catch (navError) {
                        log.warn('打开创作流程失败:', navError);
                        showSuccessNotice('项目已创建，可手动打开「创作流程」继续', { timeout: 6000 });
                    }
                } catch (e) {
                    showErrorNotice(e instanceof Error ? e.message : String(e), { title: '调研写入失败', timeout: 8000 });
                } finally {
                    this.close();
                }
            },
        }).catch((e) => {
            showErrorNotice(e instanceof Error ? e.message : String(e), { title: '创建项目失败', timeout: 8000 });
        });
    }

    /**
     * onClose 方法。
     */
    onClose(): void {
        this.contentEl.empty();
    }
}
