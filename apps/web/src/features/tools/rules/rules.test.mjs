import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CryptoDiceProvider } from '../dice/provider.mjs';
import { NumericRulesProvider } from './provider.mjs';
import { compactCheckResult, validateCheckResult } from './result.mjs';

test('checks use the selected face for criticals and only roll the damage allowed by the profile', () => {
  const faces = [1, 20, 3, 4, 20, 1];
  const draws = [];
  const rules = new NumericRulesProvider(new CryptoDiceProvider({}, (sides) => {
    draws.push(sides);
    return faces.shift();
  }));
  const input = { profile: 'd20-critical', target: 40, modifier: 5, damage: { normal: 'd6+3', critical: '2d6+3' } };
  const hit = { ...rules.resolve({ ...input, mode: 'advantage' }), rollId: 'critical' };
  const miss = rules.resolve({ ...input, mode: 'disadvantage' });
  assert.equal(hit.check.natural, 20);
  assert.equal(hit.check.outcome, 'critical_success');
  assert.equal(hit.damage.value, 10);
  assert.equal(miss.check.natural, 1);
  assert.equal(miss.check.outcome, 'critical_failure');
  assert.equal(miss.damage, null);
  assert.deepEqual(draws, [20, 20, 6, 6, 20, 20]);
  const summary = compactCheckResult(hit);
  assert.equal(summary.rollId, 'critical');
  assert.equal(summary.damage, 10);
  assert.equal(summary.dice, undefined);
  assert.deepEqual(validateCheckResult(JSON.parse(JSON.stringify(hit))), hit);
  assert.equal(validateCheckResult({ ...hit, damage: { ...hit.damage, value: 99 } }), null);
});

test('invalid critical damage fails before drawing any dice', () => {
  const rules = new NumericRulesProvider(new CryptoDiceProvider({}, () => {
    assert.fail('An invalid check must not draw dice');
  }));
  const input = { profile: 'd20-attack', target: 15, damage: { normal: 'd6' } };
  assert.throws(() => rules.resolve(input), /Declare the critical damage formula/);
  assert.throws(() => rules.resolve({ ...input, damage: { normal: 'd6', critical: 'd0' } }), /Invalid damage expression/);
});

test('check profiles use the requested die and save its faces and critical thresholds', () => {
  const faces = [1, 12, 1, 1, 12, 1, 1, 88, 20];
  const draws = [];
  const rules = new NumericRulesProvider(new CryptoDiceProvider({}, (sides) => {
    draws.push(sides);
    return faces.shift();
  }));
  const input = { profile: 'critical', sides: 12, target: 40, damage: { normal: 'd6', critical: '2d1 + 3' } };
  const hit = rules.resolve({ ...input, mode: 'advantage' });
  const miss = rules.resolve({ ...input, mode: 'disadvantage' });
  const attack = rules.resolve({ profile: 'attack', sides: 8, target: 1 });
  const standard = rules.resolve({ profile: 'standard', sides: 100, target: 90 });
  const defaultDie = rules.resolve({ profile: 'critical', target: 40 });

  assert.equal(hit.rules.sides, 12);
  assert.equal(hit.rules.criticalSuccessMin, 12);
  assert.equal(hit.check.natural, 12);
  assert.equal(hit.check.outcome, 'critical_success');
  assert.equal(hit.damage.value, 5);
  assert.equal(miss.check.natural, 1);
  assert.equal(miss.check.outcome, 'critical_failure');
  assert.equal(miss.damage, null);
  assert.equal(attack.check.outcome, 'failure');
  assert.equal(attack.check.reason, 'natural-failure');
  assert.equal(standard.check.outcome, 'failure');
  assert.equal(standard.rules.criticalSuccessMin, 0);
  assert.equal(defaultDie.rules.sides, 20);
  assert.equal(defaultDie.check.outcome, 'critical_success');
  assert.deepEqual(draws, [12, 12, 1, 1, 12, 12, 8, 100, 20]);
  assert.deepEqual(validateCheckResult(JSON.parse(JSON.stringify(hit))), hit);
  assert.equal(validateCheckResult({ ...hit, request: { ...hit.request, sides: 10 } }), null);
});

test('invalid sides and mismatched fixed profiles are rejected before any dice are drawn', () => {
  const dice = new CryptoDiceProvider({}, () => assert.fail('An invalid check must not draw dice'));
  const rules = new NumericRulesProvider(dice);
  for (const sides of [null, '12', 1, 12.5]) {
    assert.throws(() => rules.resolve({ profile: 'critical', sides, target: 9 }), /sides must be an integer/);
  }
  assert.throws(() => rules.resolve({ profile: 'critical', sides: 1_000_001, target: 9 }), /Invalid check/);
  assert.throws(() => rules.resolve({ profile: 'd20-critical', sides: 12, target: 9 }), /uses a fixed d20/);
  const custom = new NumericRulesProvider(dice, { profiles: [{ id: 'critical', version: '1', sides: 8, criticalSuccessMin: 7 }] });
  assert.throws(() => custom.resolve({ profile: 'critical', sides: 12, target: 9 }), /uses a fixed d8/);
});
