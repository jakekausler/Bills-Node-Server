import { v4 as uuidv4 } from 'uuid';
import { Pension } from '../../data/retirement/pension/pension';
import { PensionData } from '../../data/retirement/pension/types';
import { SocialSecurity } from '../../data/retirement/socialSecurity/socialSecurity';
import { SocialSecurityData } from '../../data/retirement/socialSecurity/types';
import { load, save } from './io';

const PENSION_SS_FILE = 'pension_and_social_security.json';

// Raw data types WITH id field (what we store/serve via API)
export type PensionApiData = PensionData & { id: string };
export type SocialSecurityApiData = SocialSecurityData & { id: string };

export type PensionsAndSocialSecurityRaw = {
  pensions: PensionApiData[];
  socialSecurities: SocialSecurityApiData[];
};

export type PensionsAndSocialSecurity = {
  pensions: Pension[];
  socialSecurities: SocialSecurity[];
};

export type PensionsAndSocialSecurityData = {
  pensions: PensionData[];
  socialSecurities: SocialSecurityData[];
};

/**
 * Loads raw pension and SS data with IDs.
 * Migrates existing data by adding UUIDs if missing.
 */
export function loadRawPensionAndSS(): PensionsAndSocialSecurityRaw {
  const data = load<PensionsAndSocialSecurityRaw>(PENSION_SS_FILE);
  let migrated = false;

  const pensions = (data.pensions || []).map((p) => {
    if (!p.id) {
      p.id = uuidv4();
      migrated = true;
    }
    return p;
  });

  const socialSecurities = (data.socialSecurities || []).map((ss) => {
    if (!ss.id) {
      ss.id = uuidv4();
      migrated = true;
    }
    // Fix typo migration
    if ((ss as any).payToAcccount && !ss.payToAccount) {
      ss.payToAccount = (ss as any).payToAcccount;
      delete (ss as any).payToAcccount;
      migrated = true;
    }
    return ss;
  });

  if (migrated) {
    save({ pensions, socialSecurities }, PENSION_SS_FILE);
  }

  return { pensions, socialSecurities };
}

/**
 * Saves raw pension and SS data.
 */
export function savePensionAndSS(data: PensionsAndSocialSecurityRaw): void {
  save(data, PENSION_SS_FILE);
}

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
  const data = load<PensionsAndSocialSecurityData>(PENSION_SS_FILE);
  return {
    pensions: data.pensions.map((p) => new Pension(p, simulation)),
    socialSecurities: data.socialSecurities.map((ss) => new SocialSecurity(ss, simulation)),
  };
}
