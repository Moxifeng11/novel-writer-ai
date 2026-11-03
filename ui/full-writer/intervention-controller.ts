/**
 * intervention-controller.ts — 干预面板控制器
 *
 * 职责：渲染「干预」侧栏组件，包括文本输入、AI 理解、执行干预、语音输入等功能。
 *
 * 从 full-writer-view.ts 拆分而来，原代码约 300 行。
 */

import { App, Notice } from 'obsidian';
import NovelWriterPlugin from '@/main';
import { AIEngine } from '@/engine/ai-engine';
import { StepRunner, ALL_FULL_STEPS } from '@/engine/step-runner';
import { showProgress, hideProgress, showError } from '@/utils/helpers';
import { createLogger } from '@/shared/logger';


const log = createLogger('InterventionController');
/**
 * InterventionReport 类型定义。
 */
export interface InterventionReport {
    summary: string;
    actions: Array<{
        type: string;
        target: string;
        content: string;
        confidence?: number;
    }>;
    affectsBody?: boolean;
    warnings?: string[];
}

/**
 * InterventionDeps 类型定义。
 */
export interface InterventionDeps {
    getVars: () => Record<string, any>;
    setVar: (key: string, value: any) => void;
    deleteVar: (key: string) => void;
    getStepResults: () => Record<string, string>;
    setStepResult: (key: string, value: string) => void;
    getAIEngine: () => AIEngine;
    getStepRunner: () => StepRunner;
    getCurrentStepIndex: () => number;
    makeStepRunCtx: () => any;
    onRenderNeeded: () => Promise<void>;
    getFlashModel: () => string;
}

/**
 * InterventionController 类。
 */
export class InterventionController {
    private app: App;
    private plugin: NovelWriterPlugin;
    private deps: InterventionDeps;

    private container!: HTMLElement;
    private inputEl!: HTMLTextAreaElement;
    private reportEl!: HTMLElement;
    private currentReport: InterventionReport | null = null;
    /** 理解报告对应的步骤（确认执行前校验步骤没变） */
    private reportStepKey = '';
    /** 干预执行中：确认按钮不禁用会并发执行两次同一步 */
    private executing = false;

    constructor(app: App, plugin: NovelWriterPlugin, deps: InterventionDeps) {
        this.app = app;
        this.plugin = plugin;
        this.deps = deps;
    }

    /**
     * 渲染干预面板到指定容器
     * @param container - 容器元素
     */
    render(container: HTMLElement): void {
        const box = container.createDiv({
            cls: 'novel-writer-fw-intervention',
            attr: { style: 'margin-top: 12px; padding: 8px; border-top: 1px solid var(--background-modifier-border);' }
        });
        this.container = box;

        box.createEl('div', {
            text: '🖊 干预',
            attr: { style: 'margin: 0 0 6px 0; font-size: 0.8em; font-weight: 600; color: var(--text-muted);' }
        });

        this.inputEl = box.createEl('textarea', {
            attr: {
                placeholder: '输入介入意见...',
                style: 'width: 100%; box-sizing: border-box; min-height: 60px; max-height: 160px; resize: vertical; padding: 6px; border: 1px solid var(--background-modifier-border); border-radius: 6px; font-size: 0.8em; line-height: 1.4; background: var(--background-primary); color: var(--text-normal);'
            }
        });

        const btnRow = box.createDiv({
            attr: { style: 'display: flex; flex-direction: column; gap: 4px; margin-top: 6px;' }
        });

        const understandBtn = btnRow.createEl('button', {
            text: '🤖 AI 理解',
            attr: { style: 'padding: 6px 16px; cursor: pointer; background: var(--interactive-accent); color: var(--text-on-accent); border: none; border-radius: 6px; font-size: 0.85em;' }
        });
        understandBtn.addEventListener('click', () => this.onUnderstand());

        const clearBtn = btnRow.createEl('button', {
            text: '🗑️ 清空',
            attr: { style: 'padding: 6px 16px; cursor: pointer; background: transparent; color: var(--text-muted); border: 1px solid var(--background-modifier-border); border-radius: 6px; font-size: 0.85em;' }
        });
        clearBtn.addEventListener('click', () => {
            this.inputEl.value = '';
            this.reportEl.style.display = 'none';
            this.currentReport = null;
        });

        if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
            const voiceBtn = btnRow.createEl('button', {
                text: '🎤 语音',
                attr: { style: 'padding: 6px 16px; cursor: pointer; background: transparent; color: var(--text-muted); border: 1px solid var(--background-modifier-border); border-radius: 6px; font-size: 0.85em;' }
            });
            voiceBtn.addEventListener('click', () => this.startVoiceInput());
        }

        this.reportEl = box.createDiv({
            attr: {
                style: 'display: none; margin-top: 8px; padding: 12px; border: 1px solid var(--text-accent); border-radius: 6px; background: var(--background-primary);'
            }
        });
    }

    /**
     * AI 理解干预意见
     */
    private async onUnderstand(): Promise<void> {
        const input = this.inputEl.value.trim();
        if (!input) {
            new Notice('⚠️ 请输入干预意见');
            return;
        }

        showProgress('🤖 AI 正在理解您的意见...');
        try {
            const report = await this.callUnderstandingAPI(input);
            this.currentReport = report;
            this.reportStepKey = this.getCurrentStepKey();
            this.renderReport(report);
            new Notice('✅ AI 理解完成，请确认报告');
        } catch (e: any) {
            showError(`AI 理解失败: ${e.message}`);
        } finally {
            hideProgress();
        }
    }

    /**
     * 调用 AI 理解 API
     */
    private async callUnderstandingAPI(userInput: string): Promise<InterventionReport> {
        const currentStepKey = this.getCurrentStepKey();
        const stepLabels: Record<string, string> = {
            'infoPlan': '信息规划',
            'plotDistill': '情节蒸馏',
            'outline': '大纲摘要',
            'bodyGeneration': '正文生成',
            'selfCheck': 'AI自检',
            'continuityCheck': '连贯性检查',
        };
        const stepName = stepLabels[currentStepKey] || currentStepKey;
        const stepOutput = this.deps.getStepResults()[currentStepKey] || '';

        const prompt = `你是一个写作干预理解引擎。
用户的介入意见可能是口语化的、模糊的，你需要将其理解为精确的修改指令。

【当前步骤】：${stepName}
【当前步骤输出内容】：
${stepOutput.slice(0, 4000)}

【用户介入意见】：
${userInput}

请分析用户意见，输出 JSON（不要加 \`\`\` 包裹）：
{
  "summary": "对用户意见的1句话总结",
  "actions": [
    {
      "type": "modify" | "add" | "delete" | "replace",
      "target": "描述修改目标位置（如第3段、情节节点2）",
      "content": "具体修改内容",
      "confidence": 0.9
    }
  ],
  "affectsBody": true/false,
  "warnings": ["可能的副作用或冲突"]
}

规则：
1. 如果用户的意见不明确，在 warnings 中说明
2. confidence < 0.5 的项，在 warnings 中标记为"不确定"
3. 如果涉及正文修改（Step 4），必须标注 affectedParagraphs（受影响的段落号）`;

        const response = await this.deps.getAIEngine().callAI(
            '你是一个写作干预理解引擎，只输出 JSON。',
            prompt,
            this.deps.getFlashModel(),
            0.3,
            2000,
        );
        if (response.error) throw new Error(response.error);

        const text = (response.content || '').trim();
        const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || text.match(/(\{[\s\S]*\})/);
        const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : text;

        try {
            return JSON.parse(jsonStr);
        } catch (e) {
            log.warn('[InterventionController] 干预理解 JSON 解析失败:', e);
            return {
                summary: userInput,
                actions: [{ type: 'modify', target: '全文', content: userInput, confidence: 0.5 }],
                affectsBody: true,
                warnings: ['AI 返回格式异常，已按字面意思处理']
            } as InterventionReport;
        }
    }

    /**
     * 渲染理解报告
     */
    private renderReport(report: InterventionReport): void {
        this.reportEl.empty();
        this.reportEl.style.display = 'block';

        this.reportEl.createEl('h4', {
            text: '🤖 AI 理解报告',
            attr: { style: 'margin: 0 0 8px 0; font-size: 0.85em; color: var(--text-accent);' }
        });

        const summary = this.reportEl.createEl('p', {
            text: report.summary || '已理解您的意见',
            attr: { style: 'color: var(--text-accent); font-weight: 600; font-size: 0.85em; margin: 0 0 8px 0;' }
        });

        if (report.actions && report.actions.length > 0) {
            const list = this.reportEl.createEl('ul', {
                attr: { style: 'margin: 4px 0; padding-left: 16px; font-size: 0.8em;' }
            });
            for (const action of report.actions) {
                const li = list.createEl('li');
                li.createSpan({
                    text: `[${action.type}] ${action.target}: ${action.content.slice(0, 100)}...`,
                    attr: { style: 'font-size: 0.8em;' }
                });
            }
        }

        if (report.warnings && report.warnings.length > 0) {
            const warnBox = this.reportEl.createDiv({
                attr: { style: 'margin-top: 8px; padding: 8px; background: var(--background-modifier-error-rgb); border-radius: 4px; font-size: 0.8em;' }
            });
            warnBox.createEl('strong', { text: '⚠️ 警告：' });
            for (const w of report.warnings) {
                warnBox.createEl('div', { text: `• ${w}` });
            }
        }

        const btnRow = this.reportEl.createDiv({
            attr: { style: 'margin-top: 8px; display: flex; gap: 8px;' }
        });

        const confirmBtn = btnRow.createEl('button', {
            text: '✅ 确认执行',
            attr: { style: 'padding: 6px 16px; cursor: pointer; background: var(--interactive-accent); color: var(--text-on-accent); border: none; border-radius: 6px; font-size: 0.85em;' }
        });
        confirmBtn.addEventListener('click', () => this.executeIntervention());

        const modifyBtn = btnRow.createEl('button', {
            text: '✏️ 修改意见',
            attr: { style: 'padding: 6px 16px; cursor: pointer; background: transparent; color: var(--text-muted); border: 1px solid var(--background-modifier-border); border-radius: 6px; font-size: 0.85em;' }
        });
        modifyBtn.addEventListener('click', () => {
            this.reportEl.style.display = 'none';
            this.inputEl.focus();
        });
    }

    /**
     * 执行干预
     */
    private async executeIntervention(): Promise<void> {
        if (!this.currentReport) return;
        if (this.executing) return;
        // 报告是针对「理解时那一步」的输出生成的：确认前用户可能已切到别的步骤，
        // 直接跑当前步骤会把 A 步的修改意见注入 B 步。
        const currentKey = this.getCurrentStepKey();
        if (this.reportStepKey && currentKey !== this.reportStepKey) {
            new Notice(`⚠️ 当前步骤已从「${this.reportStepKey}」切换到「${currentKey}」，请重新点击「AI 理解」后再执行`, 6000);
            return;
        }
        this.executing = true;

        const interventionText = this.currentReport.actions.map((a: any) =>
            `[${a.type}] ${a.target}: ${a.content}`
        ).join('\n');

        try {
            this.deps.setVar('userIntervention', `【用户介入意见】\n${interventionText}`);
            this.deps.setStepResult('_intervention', JSON.stringify(this.currentReport));

            await this.deps.getStepRunner().executeCurrentStep(this.deps.makeStepRunCtx());

            this.deps.deleteVar('userIntervention');

            await this.deps.onRenderNeeded();

            new Notice('✅ 干预已执行');
        } catch (e) {
            this.deps.deleteVar('userIntervention');
            new Notice(`❌ 干预执行失败：${e instanceof Error ? e.message : String(e)}`, 6000);
        } finally {
            this.executing = false;
        }
    }

    /**
     * 获取当前步骤的 key
     */
    private getCurrentStepKey(): string {
        const step = ALL_FULL_STEPS[this.deps.getCurrentStepIndex()];
        return step?.key || '';
    }

    /**
     * 语音输入
     */
    private startVoiceInput(): void {
        type SpeechRecognitionCtor = new () => {
            lang: string;
            continuous: boolean;
            interimResults: boolean;
            start(): void;
            stop(): void;
            onresult: ((event: any) => void) | null;
            onerror: ((event: any) => void) | null;
        };
        const w = window as unknown as { webkitSpeechRecognition?: SpeechRecognitionCtor; SpeechRecognition?: SpeechRecognitionCtor };
        const SpeechRecognition = w.webkitSpeechRecognition ?? w.SpeechRecognition;
        if (!SpeechRecognition) {
            new Notice('⚠️ 当前浏览器不支持语音输入');
            return;
        }

        const recognition = new SpeechRecognition();
        recognition.lang = 'zh-CN';
        recognition.continuous = true;
        recognition.interimResults = true;

        let isRecording = false;

        const toggleBtn = () => {
            if (!isRecording) {
                recognition.start();
                this.inputEl.placeholder = '🎤 正在录音...';
                isRecording = true;
            } else {
                recognition.stop();
                this.inputEl.placeholder = '输入您的介入意见...';
                isRecording = false;
            }
        };

        const btns = this.container.querySelectorAll('button');
        btns.forEach(b => {
            if (b.textContent?.includes('语音')) {
                b.onclick = toggleBtn;
            }
        });

        recognition.onresult = (event: any) => {
            let transcript = '';
            for (let i = 0; i < event.results.length; i++) {
                transcript += event.results[i][0].transcript;
            }
            this.inputEl.value = transcript;
        };

        recognition.onerror = (event: any) => {
            log.error('Speech recognition error:', event.error);
            this.inputEl.placeholder = '输入您的介入意见...';
            isRecording = false;
        };
    }

    /**
     * 清理资源
     */
    destroy(): void {
        this.currentReport = null;
    }
}
