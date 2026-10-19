import { describe, expect, it } from 'vitest';

import { es } from './es';
import { setCurrentLanguage, t, translate } from './translate';

const variables = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('translate', () => {
  it('returns English for en and for a phrase with no entry', () => {
    expect(translate('en', 'Orders')).toBe('Orders');
    expect(translate('es', 'A phrase nobody translated')).toBe('A phrase nobody translated');
  });

  it('fills the variables in either language', () => {
    expect(translate('en', 'Send to {name}', { name: 'Lingnan' })).toBe('Send to Lingnan');
    expect(translate('es', 'Send to {name}', { name: 'Lingnan' })).toBe('Enviar a Lingnan');
  });

  it('keeps a variable it was not given', () => {
    expect(translate('en', 'Send to {name}')).toBe('Send to {name}');
  });

  it('the module t follows the language in use', () => {
    setCurrentLanguage('es');
    expect(t('Orders')).toBe('Órdenes');
    setCurrentLanguage('en');
    expect(t('Orders')).toBe('Orders');
  });

  it('every Spanish phrase uses the same variables as its English key', () => {
    for (const [key, value] of Object.entries(es)) {
      expect(variables(value), key).toEqual(variables(key));
    }
  });
});
