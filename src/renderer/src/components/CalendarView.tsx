import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { MentionGroup } from '../../../shared/types'
import { MONTHS, WEEKDAYS_LONG, WEEKDAYS_SHORT, addMonths, isoWeek, monthGrid, sameDay } from '../lib/calendar'
import { dailyNotePath, dailyNoteSettings } from '../lib/daily'
import { flattenFiles } from '../lib/attachments'
import { useIndex } from '../state/index-store'
import { useVault } from '../state/vault-store'
import styles from './CalendarView.module.css'

/*
 * Calendário: cada dia corresponde a uma nota diária (AAAA-MM-DD.md).
 * Dias com nota ganham um ponto (maior quanto mais conexões a nota tem);
 * clicar abre a nota do dia, criando-a se ainda não existir.
 * Abaixo, as notas que citam o dia selecionado ([[2026-11-12]]).
 */

export function CalendarView() {
  const today = new Date()
  const [{ year, month }, setMonth] = useState({ year: today.getFullYear(), month: today.getMonth() })
  const [selected, setSelected] = useState<Date>(today)
  const tree = useVault((s) => s.tree)
  const version = useIndex((s) => s.version)
  const notes = useIndex((s) => s.notes)
  const settings = dailyNoteSettings()

  const existing = useMemo(() => new Set(flattenFiles(tree).map((f) => f.path)), [tree])
  const grid = useMemo(() => monthGrid(year, month), [year, month])
  const weeks = useMemo(() => Array.from({ length: 6 }, (_, i) => grid.slice(i * 7, i * 7 + 7)), [grid])
  const tagCount = useMemo(() => new Map(notes.map((n) => [n.path, n.tags.length + n.aliases.length])), [notes])

  const selectedPath = dailyNotePath(selected, settings)
  const [mentions, setMentions] = useState<MentionGroup[]>([])
  useEffect(() => {
    let alive = true
    window.opalite.index
      .backlinks(selectedPath)
      .then((b) => alive && setMentions(b.linked))
      .catch(() => alive && setMentions([]))
    return () => {
      alive = false
    }
  }, [selectedPath, version])

  const open = (date: Date, newTab = false) => {
    setSelected(date)
    const offset = Math.round((new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86400000)
    if (newTab) {
      const path = dailyNotePath(date, settings)
      if (existing.has(path)) return void useVault.getState().openFile(path, { newTab: true })
    }
    void useVault.getState().openDailyNote(offset)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key]
    if (step) {
      e.preventDefault()
      const next = new Date(selected.getFullYear(), selected.getMonth(), selected.getDate() + step)
      setSelected(next)
      if (next.getMonth() !== month) setMonth({ year: next.getFullYear(), month: next.getMonth() })
    } else if (e.key === 'Enter') {
      open(selected, e.ctrlKey || e.metaKey)
    }
  }

  return (
    <div className={styles.calendar}>
      <div className={styles.header}>
        <div className={styles.title}>
          <strong>{MONTHS[month]}</strong> <span>{year}</span>
        </div>
        <div className={styles.nav}>
          <button onClick={() => setMonth(addMonths(year, month, -1))} aria-label="Mês anterior">
            <ChevronLeft size={15} strokeWidth={1.75} />
          </button>
          <button
            className={styles.today}
            onClick={() => {
              setMonth({ year: today.getFullYear(), month: today.getMonth() })
              setSelected(today)
            }}
          >
            Hoje
          </button>
          <button onClick={() => setMonth(addMonths(year, month, 1))} aria-label="Próximo mês">
            <ChevronRight size={15} strokeWidth={1.75} />
          </button>
        </div>
      </div>

      <div className={styles.grid} role="grid" aria-label={`${MONTHS[month]} de ${year}`} tabIndex={0} onKeyDown={onKeyDown} key={`${year}-${month}`}>
        <div className={styles.week} role="row">
          <span className={styles.weekNo} aria-hidden="true" />
          {WEEKDAYS_SHORT.map((d, i) => (
            <span key={i} className={styles.weekday} role="columnheader" aria-label={WEEKDAYS_LONG[i]}>
              {d}
            </span>
          ))}
        </div>
        {weeks.map((week) => (
          <div key={week[0]!.toISOString()} className={styles.week} role="row">
            <span className={styles.weekNo} title={`Semana ${isoWeek(week[1]!)}`}>
              {isoWeek(week[1]!)}
            </span>
            {week.map((date) => {
              const path = dailyNotePath(date, settings)
              const has = existing.has(path)
              const weight = Math.min(3, 1 + (tagCount.get(path) ?? 0))
              return (
                <button
                  key={date.toISOString()}
                  role="gridcell"
                  className={styles.day}
                  data-outside={date.getMonth() !== month || undefined}
                  data-today={sameDay(date, today) || undefined}
                  data-selected={sameDay(date, selected) || undefined}
                  aria-selected={sameDay(date, selected)}
                  aria-label={`${date.getDate()} de ${MONTHS[date.getMonth()]}${has ? ', tem nota' : ''}`}
                  title={has ? `Abrir nota de ${date.toLocaleDateString('pt-BR')}` : `Criar nota de ${date.toLocaleDateString('pt-BR')}`}
                  onClick={(e) => open(date, e.ctrlKey || e.metaKey)}
                  tabIndex={-1}
                >
                  <span>{date.getDate()}</span>
                  {has && <i className={styles.dot} data-weight={weight} />}
                </button>
              )
            })}
          </div>
        ))}
      </div>

      <div className={styles.details}>
        <div className={styles.detailsHeader}>
          <span>{selected.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
          <button className={styles.openDay} onClick={() => open(selected)}>
            {existing.has(selectedPath) ? 'Abrir nota' : 'Criar nota'}
          </button>
        </div>
        {mentions.length === 0 ? (
          <p className={styles.empty}>Nenhuma nota cita este dia. Escreva [[{selectedPath.slice(selectedPath.lastIndexOf('/') + 1, -3)}]] numa nota para ligá-la aqui.</p>
        ) : (
          <ul className={styles.mentions}>
            {mentions.map((m) => (
              <li key={m.path}>
                <button onClick={(e) => void useVault.getState().openFile(m.path, { newTab: e.ctrlKey || e.metaKey })}>
                  <strong>{m.title}</strong>
                  <span>{m.mentions[0]?.text}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
