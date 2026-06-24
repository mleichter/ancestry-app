import { describe, it, expect } from 'vitest'
import { initialCheckedFields } from '../DocumentScanModal'
import type { ExtractionResult } from '../../types'

function makeResult(overrides: Record<string, { value: unknown; confidence: string }>): ExtractionResult {
  const base: ExtractionResult['fields'] = {}
  for (const [k, v] of Object.entries(overrides)) {
    base[k] = { value: v.value as string | string[] | null, confidence: v.confidence as any }
  }
  return { fields: base, portrait_b64: null, document_type: null }
}

describe('initialCheckedFields', () => {
  it('pre-checks high confidence field when current is empty', () => {
    const result = makeResult({ first_name: { value: 'Johann', confidence: 'high' } })
    const checked = initialCheckedFields(result, {})
    expect(checked.has('first_name')).toBe(true)
  })

  it('pre-checks medium confidence field', () => {
    const result = makeResult({ date_of_birth: { value: '1892-03', confidence: 'medium' } })
    expect(initialCheckedFields(result, {}).has('date_of_birth')).toBe(true)
  })

  it('does not pre-check low confidence field', () => {
    const result = makeResult({ biography: { value: 'some text', confidence: 'low' } })
    expect(initialCheckedFields(result, {}).has('biography')).toBe(false)
  })

  it('does not pre-check field with confidence none', () => {
    const result = makeResult({ birth_name: { value: null, confidence: 'none' } })
    expect(initialCheckedFields(result, {}).has('birth_name')).toBe(false)
  })

  it('does not pre-check field matching current string value', () => {
    const result = makeResult({ first_name: { value: 'Johann', confidence: 'high' } })
    const checked = initialCheckedFields(result, { first_name: 'Johann' })
    expect(checked.has('first_name')).toBe(false)
  })

  it('pre-checks field when extracted differs from current', () => {
    const result = makeResult({ last_name: { value: 'Müller', confidence: 'high' } })
    const checked = initialCheckedFields(result, { last_name: 'Mueller' })
    expect(checked.has('last_name')).toBe(true)
  })

  it('does not pre-check null value field', () => {
    const result = makeResult({ place_of_death: { value: null, confidence: 'high' } })
    expect(initialCheckedFields(result, {}).has('place_of_death')).toBe(false)
  })

  it('compares array values as JSON strings', () => {
    const result = makeResult({ occupations: { value: ['Bäcker'], confidence: 'high' } })
    const checked = initialCheckedFields(result, { occupations: ['Bäcker'] })
    expect(checked.has('occupations')).toBe(false)
  })

  it('handles multiple fields correctly', () => {
    const result = makeResult({
      first_name: { value: 'Anna', confidence: 'high' },
      biography: { value: 'text', confidence: 'low' },
      nationality: { value: 'Deutsch', confidence: 'medium' },
    })
    const checked = initialCheckedFields(result, {})
    expect(checked.has('first_name')).toBe(true)
    expect(checked.has('biography')).toBe(false)
    expect(checked.has('nationality')).toBe(true)
  })
})
