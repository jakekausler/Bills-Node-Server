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

export function loadPensionsAndSocialSecurity(simulation = 'Default'): PensionsAndSocialSecurity {
	const data = load<PensionsAndSocialSecurityData>('pension_and_social_security.json');
	return {
		pensions: data.pensions.map((p) => new Pension(p, simulation)),
		socialSecurities: data.socialSecurities.map((ss) => new SocialSecurity(ss, simulation)),
	};
}
