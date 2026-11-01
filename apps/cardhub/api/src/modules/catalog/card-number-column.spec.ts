import { cardNumberColumns } from './card-number-column';

describe('cardNumberColumns', () => {
  it('stores the normalized c: key beside the printed number', () => {
    expect(cardNumberColumns(' #A05 ')).toEqual({
      cardNumber: ' #A05 ',
      cardNumberNormalized: 'a5',
    });
    expect(cardNumberColumns('007')).toEqual({
      cardNumber: '007',
      cardNumberNormalized: '7',
    });
    expect(cardNumberColumns(null)).toEqual({
      cardNumber: null,
      cardNumberNormalized: null,
    });
  });
});
