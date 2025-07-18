import { Pension } from '../../data/retirement/pension/pension';
import { PensionData } from '../../data/retirement/pension/types';
import { SocialSecurity } from '../../data/retirement/socialSecurity/socialSecurity';
import { SocialSecurityData } from '../../data/retirement/socialSecurity/types';
import { load } from './io';

export type PensionsAndSocialSecurity = {
  pensions: Pension[];
  socialSecurities: SocialSecurity[];
};

export type PensionsAndSocialSecurityData = {
  pensions: PensionData[];
  socialSecurities: SocialSecurityData[];
};

/**
 * Loads pension and social security configurations for a specific simulation.
 * 
 * Reads retirement data from pension_and_social_security.json and creates
 * Pension and SocialSecurity instances with the specified simulation context.
 * 
 * @param simulation - Name of the simulation to load (defaults to 'Default')
 * @returns Object containing arrays of pension and social security instances
 * 
 * @example
 * ```typescript
 * const retirement = loadPensionsAndSocialSecurity('Conservative');
 * // Returns: {
 * //   pensions: [Pension, Pension, ...],
 * //   socialSecurities: [SocialSecurity, SocialSecurity, ...]
 * // }
 * 
 * // Access pension details
 * console.log(retirement.pensions[0].monthlyBenefit);
 * console.log(retirement.socialSecurities[0].startAge);
 * ```
 */
export function loadPensionsAndSocialSecurity(simulation = 'Default'): PensionsAndSocialSecurity {
  const data = load<PensionsAndSocialSecurityData>('pension_and_social_security.json');
  return {
    pensions: data.pensions.map((p) => new Pension(p, simulation)),
    socialSecurities: data.socialSecurities.map((ss) => new SocialSecurity(ss, simulation)),
  };
}
