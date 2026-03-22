/* eslint-disable import/prefer-default-export */
/**
 * BuildingInsightsService stub — fase 3 placeholder.
 * Full implementation in fase 4 (Adaptive Control).
 */

export interface InsightCategory {
  category: string;
}

// Minimal interface matching the methods called by FlowCardManagerService
export interface BuildingInsightsService {
  forceInsightAnalysis(): Promise<unknown>;
  isInsightActive(category: unknown): boolean;
  isConfidenceAbove(threshold: number): Promise<boolean>;
  areSavingsAbove(category: unknown, threshold: number): boolean;
  evaluateInsights(): Promise<void>;
  onSettingsChanged(newSettings: Record<string, unknown>): Promise<void>;
  initialize(): Promise<void>;
  destroy(): Promise<void>;
}
