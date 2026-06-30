 /**
  * co-writer-types.ts — CoWriter 引擎扩展类型定义
  * 
  * 包含 A1 (角色灵魂/OOC检测) 和 D1 (实体状态追踪) 相关类型
  */
 
 // ============================================================
 // A1: OOC 检测结果
 // ============================================================
 
 /** OOC 检测结果 */
 export interface OOCCheckResult {
     hasOOC: boolean;
     warnings: string[];
     score: number;
     violatedFields: string[];
     checkedAt: number;
 }
 
 // ============================================================
 // D1: 实体状态追踪扩展
 // ============================================================
 
 /** 待确认的实体状态变更 */
 export interface PendingEntityChange {
     change: import('../engine/entity-state-manager').EntityStateChange;
     confirmed: boolean;
     reviewedAt?: number;
 }
 
 /** CoWriting 会话扩展（含灵魂数据和状态变更） */
 export interface CoWritingSessionExtended {
     soulData: import('../engine/character-soul').CharacterSoulSummary | null;
     pendingStateChanges: PendingEntityChange[];
 }
 
 // ============================================================
 // F3: 情绪曲线
 // ============================================================
 
 export interface EmotionPoint {
     position: number;
     emotion: string;
     intensity: number;
     text: string;
 }
 
 export interface EmotionCurve {
     points: EmotionPoint[];
     dominantEmotion: string;
     volatility: number;
     arcType: 'rise' | 'fall' | 'wave' | 'flat';
 }
 
 // ============================================================
 // C2: 节奏检测
 // ============================================================
 
 export interface RhythmSegment {
     start: number;
     end: number;
     type: 'action' | 'dialogue' | 'description' | 'introspection';
     pace: 'fast' | 'medium' | 'slow';
     density: number;
     tensionLevel: number;
     issues: string[];
 }
 
 export interface RhythmAnalysis {
     segments: RhythmSegment[];
     overallPace: string;
     slowSegments: RhythmSegment[];
     fastSegments: RhythmSegment[];
     suggestions: string[];
 }
 
 // ============================================================
 // B1: 联想输入
 // ============================================================
 
 export interface AssociationHint {
     type: 'entity-action' | 'escalate' | 'foreshadow' | 'emotion' | 'dialogue';
     entity?: string;
     emotion?: string;
     item?: string;
     confidence: number;
 }
 
 export interface AssociationSuggestion {
     text: string;
     type: string;
     confidence: number;
     preview: string;
 }
