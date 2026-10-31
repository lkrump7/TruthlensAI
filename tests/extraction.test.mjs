import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractClaimsFromText, splitAtomicClaims } from '../lib/claims.mjs';

test('extraction splits compound statements into atomic claims', async () => {
  const revenue = await extractClaimsFromText('Revenue rose 20% in 2020 and costs fell 5% in 2021.');
  assert.ok(revenue.some((c) => /Revenue rose/.test(c.text) && !/costs fell/.test(c.text)), JSON.stringify(revenue));
  assert.ok(revenue.some((c) => /costs fell/.test(c.text)), JSON.stringify(revenue));

  const contrast = await extractClaimsFromText('The reservoir reduced flooding deaths whereas the levee protected only two towns.');
  assert.equal(contrast.length, 2, JSON.stringify(contrast));

  const reported = await extractClaimsFromText('The study found that sleep improves memory and that exercise improves mood in adults.');
  assert.equal(reported.length, 2, JSON.stringify(reported));
  assert.match(reported[1].text, /exercise improves mood/i);
});

test('splitting does not tear noun lists or single statements apart', () => {
  assert.equal(splitAtomicClaims('The committee discussed salt and pepper exports in 2020.').length, 1);
  assert.equal(splitAtomicClaims('Bread and butter is served at breakfast daily.').length, 1);
  assert.equal(splitAtomicClaims('Water boils at 100 degrees Celsius at sea level.').length, 1);
});

test('labelled recall fixture: every expected proposition is extracted', async () => {
  const cases = [
    ['Revenue rose 20% in 2020 and costs fell 5% in 2021.', ['Revenue rose', 'costs fell']],
    ['The treatment improved survival; it also reduced hospital stays by two days.', ['improved survival', 'reduced hospital stays']],
    ['Smoking causes lung cancer, and it greatly increases the risk of heart disease.', ['Smoking causes lung cancer', 'increases the risk']],
    ['The reservoir reduced flooding deaths whereas the levee protected only two towns.', ['reservoir reduced', 'levee protected']],
    ['The study found that sleep improves memory and that exercise improves mood in adults.', ['sleep improves memory', 'exercise improves mood']],
    ['The drug lowered blood pressure in patients with hypertension during the twelve week trial.', ['lowered blood pressure']],
  ];
  let found = 0, total = 0;
  for (const [text, expected] of cases) {
    const joined = (await extractClaimsFromText(text)).map((c) => c.text).join(' | ').toLowerCase();
    for (const e of expected) { total++; if (joined.includes(e.toLowerCase())) found++; }
  }
  assert.equal(found, total, `recall ${found}/${total}`);
});
