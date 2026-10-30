import { describe, expect, it } from 'vitest';

import { formatRupees, priceValues } from '../src';

describe('price placeholders', () => {
  it('formats paise as rupees for {price} and {intro_price}', () => {
    expect(formatRupees(100)).toBe('₹1');
    expect(formatRupees(9900)).toBe('₹99');
    expect(formatRupees(129900)).toBe('₹1,299');
    expect(formatRupees(9950)).toBe('₹99.50');
    expect(formatRupees(-5)).toBe('₹0');
    expect(priceValues({ monthly_paise: 9900, intro_paise: 100 })).toEqual({ price: '₹99', intro_price: '₹1' });
    expect(priceValues({ monthly_paise: 9900, intro_paise: null })).toEqual({ price: '₹99', intro_price: '₹99' });
  });
});
