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

export async function getLifeInsurancePolicies(_req: Request) {
  return loadPolicies();
}

export async function createLifeInsurancePolicy(req: Request) {
  const policies = loadPolicies();
  const body = req.body as Omit<LifeInsurancePolicyConfig, 'id'>;
  const newPolicy: LifeInsurancePolicyConfig = {
    ...body,
    id: uuidv4(),
  };
  policies.push(newPolicy);
  savePolicies(policies);
  return newPolicy;
}

export async function updateLifeInsurancePolicy(req: Request) {
  const policyId = req.params.policyId;
  if (!policyId) throw new Error('policyId is required');

  const policies = loadPolicies();
  const index = policies.findIndex((p) => p.id === policyId);
  if (index === -1) throw new Error(`Policy ${policyId} not found`);

  const body = req.body as LifeInsurancePolicyConfig;
  policies[index] = { ...body, id: policyId };
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
