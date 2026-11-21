import { resolveRulesConfig, normalizeCheck, checkRolls } from './check.mjs'
import { buildCheckResult } from './result.mjs'

export class NumericRulesProvider {
  constructor(dice, config = {}) {
    this.dice = dice
    this.config = resolveRulesConfig(config)
    this.usesDefaultProfiles = config.profiles == null
    for (const profile of this.config.profiles) {
      for (const sides of [profile.sides, profile.criticalFailureEffects.length].filter(Boolean)) {
        if (dice.validate({ pool: `d${sides}` }).errors.length) throw new TypeError('Rules profile dice must fit the Dice provider limits')
      }
    }
  }
  profiles() { return structuredClone(this.config.profiles) }
  resolve(input, { signal } = {}) {
    signal?.throwIfAborted()
    const request = normalizeCheck(input)
    let rules = this.profiles().find(profile => profile.id === request.profile)
    if (!rules) throw new TypeError(`Unknown rules profile: ${request.profile}`)
    if (request.sides !== undefined && request.sides !== rules.sides) {
      if (!this.usesDefaultProfiles || !['standard', 'critical', 'attack'].includes(rules.id)) {
        throw new TypeError(`Profile ${rules.id} uses a fixed d${rules.sides}`)
      }
      rules = { ...rules, sides: request.sides, criticalSuccessMin: rules.criticalSuccessMin ? request.sides : 0 }
    }
    if (request.damage && rules.criticalSuccessMin && !request.damage.critical) throw new TypeError('Declare the critical damage formula before rolling for this profile')
    if (Math.abs(request.modifier) + rules.sides > Number.MAX_SAFE_INTEGER || Math.abs(request.modifier) + rules.sides + Math.abs(request.target) > Number.MAX_SAFE_INTEGER) throw new TypeError('Check totals and margin must fit the safe numeric range')
    if (request.damage) {
      for (const formula of Object.values(request.damage)) {
        const preview = this.dice.validate({ damage: `(${formula}) + 0` })
        if (preview.errors.length) throw new TypeError(`Invalid damage expression: ${preview.errors[0].message}`)
      }
    }
    const rolls = checkRolls(request, rules)
    const preview = this.dice.validate(rolls, { purpose: input.purpose })
    if (preview.errors.length) throw new TypeError(`Invalid check: ${preview.errors[0].message}`)
    const dice = this.dice.roll(rolls, { signal, purpose: request.purpose })
    return buildCheckResult(request, rules, dice)
  }
}
