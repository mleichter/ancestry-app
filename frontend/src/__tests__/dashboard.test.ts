import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Pure logic extracted from DashboardPage for testing.
 * These functions are duplicated here to avoid React/hook dependencies.
 */

function daysUntil(monthDay: string): number {
  const [m, d] = monthDay.split('-').map(Number)
  const today = new Date()
  let next = new Date(today.getFullYear(), m - 1, d)
  if (next.getTime() - today.setHours(0, 0, 0, 0) < 0)
    next = new Date(today.getFullYear() + 1, m - 1, d)
  return Math.round((next.getTime() - new Date().setHours(0, 0, 0, 0)) / 86400000)
}

// ── daysUntil ─────────────────────────────────────────────────────────────────

describe('daysUntil', () => {
  beforeEach(() => {
    // Fix "today" to 2026-06-23 for deterministic tests
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-23T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns 0 for today', () => {
    expect(daysUntil('06-23')).toBe(0)
  })

  it('returns days remaining for future date this year', () => {
    expect(daysUntil('06-30')).toBe(7)
  })

  it('returns days until next year for past date', () => {
    // Jan 01 is in the past (it was 173 days ago in 2026), so it wraps to next year
    const d = daysUntil('01-01')
    expect(d).toBeGreaterThan(0)
    expect(d).toBeLessThanOrEqual(366)
  })

  it('handles tomorrow', () => {
    expect(daysUntil('06-24')).toBe(1)
  })

  it('handles a date 30 days out', () => {
    expect(daysUntil('07-23')).toBe(30)
  })
})

// ── birthday/anniversary filtering logic ──────────────────────────────────────

interface MockPerson {
  id: string
  first_name: string
  last_name: string
  date_of_birth?: string
  is_living: boolean
}

interface MockRel {
  id: string
  type: string
  person_a_id: string
  person_b_id: string
  start_date?: string
}

function collectUpcoming(persons: MockPerson[], rels: MockRel[], withinDays = 30) {
  const events: Array<{ type: string; label: string; personId: string; days: number }> = []
  const personById = Object.fromEntries(persons.map(p => [p.id, p]))

  for (const p of persons) {
    if (!p.date_of_birth || p.date_of_birth.length < 7) continue
    const parts = p.date_of_birth.split('-')
    if (parts.length < 2) continue
    const monthDay = parts.slice(1, 3).join('-').padEnd(5, '01').slice(0, 5)
    const days = daysUntil(monthDay)
    if (days <= withinDays) {
      events.push({ type: 'birthday', label: `${p.first_name} ${p.last_name}`, personId: p.id, days })
    }
  }

  for (const r of rels) {
    if (r.type !== 'partner' || !r.start_date || r.start_date.length < 7) continue
    const parts = r.start_date.split('-')
    if (parts.length < 2) continue
    const monthDay = parts.slice(1, 3).join('-').padEnd(5, '01').slice(0, 5)
    const days = daysUntil(monthDay)
    if (days <= withinDays) {
      const a = personById[r.person_a_id]
      const b = personById[r.person_b_id]
      if (a && b) {
        events.push({ type: 'anniversary', label: `${a.first_name} & ${b.first_name} ${b.last_name}`, personId: r.person_a_id, days })
      }
    }
  }

  return events.sort((a, b) => a.days - b.days)
}

describe('collectUpcoming events', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-23T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns empty list when no persons', () => {
    expect(collectUpcoming([], [])).toHaveLength(0)
  })

  it('includes person with birthday today', () => {
    const persons: MockPerson[] = [
      { id: '1', first_name: 'Anna', last_name: 'Test', date_of_birth: '1990-06-23', is_living: true },
    ]
    const events = collectUpcoming(persons, [])
    expect(events).toHaveLength(1)
    expect(events[0].days).toBe(0)
    expect(events[0].type).toBe('birthday')
  })

  it('excludes person with birthday more than 30 days away', () => {
    const persons: MockPerson[] = [
      { id: '1', first_name: 'Bob', last_name: 'Far', date_of_birth: '1970-09-01', is_living: true },
    ]
    expect(collectUpcoming(persons, [])).toHaveLength(0)
  })

  it('includes anniversary within 30 days', () => {
    const persons: MockPerson[] = [
      { id: 'a', first_name: 'Alice', last_name: 'X', is_living: true },
      { id: 'b', first_name: 'Bob',   last_name: 'Y', is_living: true },
    ]
    const rels: MockRel[] = [
      { id: 'r1', type: 'partner', person_a_id: 'a', person_b_id: 'b', start_date: '2000-07-01' },
    ]
    const events = collectUpcoming(persons, rels)
    expect(events.some(e => e.type === 'anniversary')).toBe(true)
  })

  it('ignores non-partner relationships for anniversaries', () => {
    const persons: MockPerson[] = [
      { id: 'a', first_name: 'Alice', last_name: 'X', is_living: true },
      { id: 'b', first_name: 'Bob',   last_name: 'Y', is_living: true },
    ]
    const rels: MockRel[] = [
      { id: 'r1', type: 'parent_child', person_a_id: 'a', person_b_id: 'b', start_date: '2000-07-01' },
    ]
    expect(collectUpcoming(persons, rels).filter(e => e.type === 'anniversary')).toHaveLength(0)
  })

  it('sorts events by ascending days', () => {
    const persons: MockPerson[] = [
      { id: '1', first_name: 'A', last_name: 'X', date_of_birth: '1990-07-20', is_living: true },
      { id: '2', first_name: 'B', last_name: 'Y', date_of_birth: '1985-06-25', is_living: true },
    ]
    const events = collectUpcoming(persons, [])
    for (let i = 1; i < events.length; i++) {
      expect(events[i].days).toBeGreaterThanOrEqual(events[i - 1].days)
    }
  })

  it('skips persons without date_of_birth', () => {
    const persons: MockPerson[] = [
      { id: '1', first_name: 'A', last_name: 'X', is_living: true },
    ]
    expect(collectUpcoming(persons, [])).toHaveLength(0)
  })
})
