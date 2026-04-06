import { Request } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { load, save } from '../../utils/io/io';
import type { LifeInsurancePolicyConfig } from '../../utils/calculate-v3/life-insurance-manager';

const FILE_NAME = 'lifeInsuranceConfig.json';

function loadPolicies(): LifeInsurancePolicyConfig[] {
  try {
    return load<LifeInsurancePolicyConfig[]>(FILE_NAME);
  } catch {
    return [];
  }
}

function savePolicies(policies: LifeInsurancePolicyConfig[]): void {
  save(policies, FILE_NAME);
}

function validatePolicyBody(body: Record<string, unknown>): void {
  const validTypes = ['employer', 'term', 'whole'];
  if (!body.type || !validTypes.includes(body.type as string)) {
    throw new Error(`Invalid policy type: ${body.type}. Must be one of: ${validTypes.join(', ')}`);
  }
  if (body.type === 'employer' && !body.coverage) {
    throw new Error('coverage is required for employer policies');
  }
  if (body.type === 'term') {
    if (!body.faceAmount) throw new Error('faceAmount is required for term policies');
    if (!body.termYears) throw new Error('termYears is required for term policies');
    if (body.premiumAmount === undefined) throw new Error('premiumAmount is required for term policies');
  }
  if (body.type === 'whole') {
    if (!body.deathBenefit) throw new Error('deathBenefit is required for whole policies');
    if (body.premiumAmount === undefined) throw new Error('premiumAmount is required for whole policies');
    if (body.guaranteedRate === undefined) throw new Error('guaranteedRate is required for whole policies');
  }
}

export async function getLifeInsurancePolicies(_req: Request) {
  return loadPolicies();
}

export async function createLifeInsurancePolicy(req: Request) {
  validatePolicyBody(req.body);
  const policies = loadPolicies();
  const newPolicy = {
    ...req.body,
    id: uuidv4(),
  } as LifeInsurancePolicyConfig;
  policies.push(newPolicy);
  savePolicies(policies);
  return newPolicy;
}

export async function updateLifeInsurancePolicy(req: Request) {
  const policyId = req.params.policyId;
  if (!policyId) throw new Error('policyId is required');

  validatePolicyBody(req.body);

  const policies = loadPolicies();
  const index = policies.findIndex((p) => p.id === policyId);
  if (index === -1) throw new Error(`Policy ${policyId} not found`);

  policies[index] = { ...req.body, id: policyId } as LifeInsurancePolicyConfig;
  savePolicies(policies);
  return policies[index];
}

export async function deleteLifeInsurancePolicy(req: Request) {
  const policyId = req.params.policyId;
  if (!policyId) throw new Error('policyId is required');

  const policies = loadPolicies();
  const index = policies.findIndex((p) => p.id === policyId);
  if (index === -1) throw new Error(`Policy ${policyId} not found`);

  policies.splice(index, 1);
  savePolicies(policies);
  return { id: policyId };
}
