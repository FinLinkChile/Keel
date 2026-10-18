import type { Onboarding } from './onboarding';
import { cleanRut } from './rut';
import type { KeelData, Party } from './types';

// The importer's company as the person signed it up, instead of the example company of the mock:
// its name, place and RUT. The exporter and the third parties stay as they are. The company is
// bound during render by the session, like the test wallets.
let company: Onboarding['company'] | undefined;

export function bindCompany(next: Onboarding['company'] | undefined) {
  company = next;
}

const shortName = (legalName: string) => legalName.trim().split(/\s+/)[0] ?? legalName;

export function withCompany(base: KeelData): KeelData {
  const apply = async (party: Party | undefined): Promise<Party | undefined> => {
    if (!party || !company || party.id !== (await base.account('importer')).party) return party;
    return { ...party, name: company.legalName, short: shortName(company.legalName), place: 'Chile', taxId: cleanRut(company.rut) };
  };
  return {
    ...base,
    party: async (id) => apply(await base.party(id)),
    partyByAddress: async (address) => apply(await base.partyByAddress(address)),
  };
}
