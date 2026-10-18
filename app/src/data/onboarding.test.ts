import { describe, expect, it } from 'vitest';

import { checkStep, DEMO_DRAFT, isComplete, jsonOnboardingStore, normalizePhone, STEPS, toOnboarding, type Draft } from './onboarding';
import { memoryProposalStore } from './proposals';

const done: Draft = { ...DEMO_DRAFT, identityChecked: true };

describe('sign-up', () => {
  it('comes filled with the demo company, with valid RUTs, and only the identity box is left', () => {
    expect(DEMO_DRAFT.legalName).toBe('Pacífico Foods SpA');
    expect(STEPS.filter((s) => Object.keys(checkStep(s, DEMO_DRAFT)).length > 0)).toEqual(['identity']);
    expect(isComplete(done)).toBe(true);
  });

  it('asks for the RUT of a company in the company step and for a person one in the representative step', () => {
    expect(checkStep('company', { ...done, companyRut: '12.345.678-5' }).companyRut).toBeDefined();
    expect(checkStep('company', { ...done, companyRut: '76.543.210-4' }).companyRut).toBeDefined();
    expect(checkStep('representative', { ...done, repRut: '76.543.210-3' }).repRut).toBeDefined();
    expect(checkStep('representative', { ...done, repName: 'Camila' }).repName).toBeDefined();
  });

  it('checks the email and a Chilean mobile', () => {
    expect(checkStep('company', { ...done, email: 'not an email' }).email).toBeDefined();
    expect(checkStep('company', { ...done, phone: '22 123 4567' }).phone).toBeDefined();
    expect(checkStep('company', { ...done, legalName: ' ' }).legalName).toBeDefined();
    expect(checkStep('company', done)).toEqual({});
  });

  it('does not let the person in until the identity box is ticked', () => {
    expect(checkStep('identity', DEMO_DRAFT).identityChecked).toBeDefined();
    expect(checkStep('identity', done)).toEqual({});
    expect(() => toOnboarding(DEMO_DRAFT, 1000)).toThrow();
  });

  it('normalizes a Chilean mobile', () => {
    expect(normalizePhone('+56 9 1234 5678')).toBe('+56912345678');
    expect(normalizePhone('9 1234 5678')).toBe('+56912345678');
    expect(normalizePhone('56912345678')).toBe('+56912345678');
    expect(normalizePhone('12345678')).toBeNull();
  });

  it('stores the RUTs without dots and marks the identity as validated', () => {
    expect(toOnboarding({ ...done, pep: 'yes' }, 1000.9)).toEqual({
      country: 'CL',
      company: { rut: '765432103', legalName: 'Pacífico Foods SpA', email: 'compras@pacificofoods.example', phone: '+56912345678' },
      representative: { name: 'Camila Rojas Soto', rut: '123456785', pep: true },
      identityValidated: true,
      completedAt: 1000,
    });
  });

  it('keeps the sign-up in a text file and forgets it on clear', async () => {
    const { file } = memoryProposalStore();
    const store = jsonOnboardingStore(file);
    expect(await store.get()).toBeNull();
    const saved = toOnboarding(done, 5);
    await store.save(saved);
    expect(await store.get()).toEqual(saved);
    await store.clear();
    expect(await store.get()).toBeNull();
  });
});
