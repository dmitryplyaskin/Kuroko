import { DICE_RESULT_VERSION, validateDiceResult } from '../dice/result.mjs'
import { projectDiceGroup } from '../dice/pool.mjs'
import { normalizeCheck, validateProfile, checkRolls, checkMeaning } from './check.mjs'

export function buildCheckResult(request, rules, dice) {
  const check = checkMeaning(request, rules, dice.values)
  const damage = request.damage && check && ['success', 'critical_success'].includes(check.outcome) && typeof dice.values.damage === 'number'
    ? { value: dice.values.damage, expression: check.outcome === 'critical_success' ? request.damage.critical ?? request.damage.normal : request.damage.normal } : null
  let consequence = null
  if (check?.outcome === 'critical_failure' && rules.criticalFailureEffects.length) {
    const index = dice.values.effect
    if (Number.isSafeInteger(index) && index >= 1 && index <= rules.criticalFailureEffects.length) consequence = { text: rules.criticalFailureEffects[index - 1], index }
  } else if (check && ['failure', 'critical_failure'].includes(check.outcome) && rules.failureEffect) consequence = { text: rules.failureEffect }
  return { schemaVersion: 1, ...(request.purpose ? { purpose: request.purpose } : {}), request, rules, check, damage, consequence, errors: dice.errors, dice }
}

export function compactCheckResult(result) {
  const check = result.check ? Object.fromEntries(Object.entries(result.check).filter(([key]) => key !== 'margin')) : null
  return { rollId: result.rollId, check,
    ...(result.damage ? { damage: result.damage.value } : {}),
    ...(result.consequence ? { consequence: result.consequence.text } : {}),
    ...(result.errors.length ? { errors: result.errors } : {}) }
}

export function validateCheckResult(full) {
  try {
    if (!full || full.schemaVersion !== 1 || full.dice?.schemaVersion !== DICE_RESULT_VERSION || !validateDiceResult(full.dice)) return null
    if (Object.hasOwn(full, 'rollId') && (typeof full.rollId !== 'string' || !full.rollId.trim())) return null
    const request = normalizeCheck(full.request), rules = validateProfile(full.rules)
    if (request.profile !== rules.id || (request.sides !== undefined && request.sides !== rules.sides) || full.dice.purpose !== request.purpose) return null
    const expected = checkRolls(request, rules)
    if (Object.keys(expected).length !== full.dice.details.length || full.dice.details.some(detail => detail.path.length !== 1 || expected[detail.path[0]] !== detail.expression)) return null
    const group = full.dice.details.find(detail => detail.path[0] === 'pool')
    if (!group?.error) {
      if (group?.dice.length !== 1) return null
      const pool = projectDiceGroup(group.dice[0])
      if (pool.sides !== rules.sides || pool.faces.length !== 1 || pool.faces[0] !== full.dice.values.natural) return null
    }
    const rebuilt = buildCheckResult(request, rules, full.dice)
    const payload = Object.fromEntries(Object.entries(full).filter(([key]) => key !== 'rollId'))
    if (JSON.stringify(rebuilt) !== JSON.stringify(payload)) return null
    return full
  } catch { return null }
}
