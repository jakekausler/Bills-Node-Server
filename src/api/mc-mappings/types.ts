export interface MCMapping {
  variable: string;          // Rate variable name (e.g., 'INFLATION')
  sampleType: string | null; // MonteCarloSampleType value or null if unmapped
  description: string;       // Description of the rate variable
}
