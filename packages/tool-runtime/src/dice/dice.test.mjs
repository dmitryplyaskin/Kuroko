import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CryptoDiceProvider } from './provider.mjs';

function fixture(faces, config = {}) {
  const draws = [];
  const dice = new CryptoDiceProvider(config, (sides) => {
    draws.push(sides);
    assert.ok(faces.length, 'Unexpected draw');
    return faces.shift();
  });
  return { dice, draws };
}

test('rolls conditional damage only after a hit and reuses the selected natural face', () => {
  const { dice, draws } = fixture([8, 17, 4, 5]);
  const result = dice.roll({
    damage: 'if($hit, 2d6 + 3, 0)', pool: '2d20kh1', natural: 'face($pool)', hit: '$natural + 5 >= 15',
  });
  assert.deepEqual(result.values, { damage: 12, pool: 17, natural: 17, hit: true });
  assert.deepEqual(draws, [20, 20, 6, 6]);
  assert.deepEqual(result.details[1].dice[0].keptIndices, [1]);

  const miss = fixture([1, 3]);
  assert.equal(miss.dice.roll({ damage: 'if($hit,d6!,0)', hit: '2d20kh1 >= 15' }).values.damage, 0);
  assert.deepEqual(miss.draws, [20, 20]);
});

test('explosions, rerolls, kept chains and repeated counts retain the original draws', () => {
  const { dice, draws } = fixture([1, 10, 8, 9, 4]);
  const result = dice.roll({
    pools: ['3d10!ro<3kh2'], pool: 'ref(["pools",0])',
    chains: 'count($pool, >=8)', faces: 'countFaces($pool, >=8 and !=9)',
  });
  assert.deepEqual(result.values, { pools: [27], pool: 27, chains: 2, faces: 2 });
  assert.deepEqual(draws, [10, 10, 10, 10, 10]);
  assert.deepEqual(result.details[0].dice[0].draws.map((draw) => draw.reason), ['initial', 'reroll', 'explode', 'initial', 'initial']);
  assert.deepEqual(result.observations[0].groups[0], { sides: 10, faces: [10, 8, 9], totals: [18, 9] });
});

test('preserves independent results, detects cycles, and checks limits without drawing', () => {
  const { dice, draws } = fixture([4], { maxDice: 2 });
  const rolls = { a: '$b', b: '$a', bad: 'd1!', good: 'd6' };
  assert.deepEqual(dice.validate(rolls).errors.map((error) => error.code), ['reference_cycle', 'reference_cycle', 'invalid_expression']);
  assert.throws(() => dice.roll(['if(true, 2d6, d6)']), /potential initial dice/);
  assert.throws(() => dice.roll(['d6'], { signal: AbortSignal.abort() }), { name: 'AbortError' });
  assert.deepEqual(draws, []);
  assert.deepEqual(dice.roll(rolls).values, { a: null, b: null, bad: null, good: 4 });
  assert.deepEqual(draws, [6]);
});
