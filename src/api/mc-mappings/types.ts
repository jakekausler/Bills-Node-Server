export interface MCMapping {
  sampleType: string;       // MonteCarloSampleType enum value (e.g., 'Inflation')
  variable: string | null;  // Rate variable name (e.g., 'INFLATION') or null if unmapped
  description: string;      // Human-readable description of this sample type
}
