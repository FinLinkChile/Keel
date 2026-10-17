import { describe, expect, it } from 'vitest';

import { DEMO_DRAFT, toOnboarding } from './onboarding';
import { mockData } from './mock';
import { bindCompany, withCompany } from './withCompany';

describe('withCompany', () => {
  const data = withCompany(mockData);
  const importer = async () => (await mockData.party((await mockData.account('importer')).party))!;

  it('shows the example importer until someone signs up', async () => {
    bindCompany(undefined);
    expect((await data.party((await importer()).id))?.name).toBe('Pacífico Foods SpA');
  });

  it('shows the company that was signed up, and only for the importer', async () => {
    bindCompany(toOnboarding({ ...DEMO_DRAFT, legalName: 'Importadora Andina Ltda', companyRut: '77.123.987-0', identityChecked: true }, 1).company);
    const me = await importer();
    const shown = await data.party(me.id);
    expect(shown).toMatchObject({ name: 'Importadora Andina Ltda', short: 'Importadora', place: 'Chile', taxId: '771239870', address: me.address });
    expect(await data.partyByAddress(me.address)).toMatchObject({ name: 'Importadora Andina Ltda' });
    const exporter = (await mockData.party((await mockData.account('exporter')).party))!;
    expect(await data.party(exporter.id)).toEqual(exporter);
    bindCompany(undefined);
  });
});
