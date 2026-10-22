import { truncateToWidth } from '@earendil-works/pi-tui';
import { describeRule } from './fields.js';
import type { Pane } from './pi/app-shell.js';
import { sgr } from './style.js';
import type { Topics$ } from './topics.js';

const text = (value: unknown) =>
  typeof value === 'string' && value !== '' ? value : '—';

/**
 * The selected task's fields, read only: the TUI edits no field until Task
 * 2.1 makes these rows editable in place.
 */
export class DetailPane implements Pane {
  private taskId: string | null = null;

  constructor(private readonly deps: { topics: Topics$ }) {}

  show(taskId: string | null): void {
    this.taskId = taskId;
  }

  render(width: number): string[] {
    const { topics } = this.deps;
    const task =
      this.taskId === null ? null : (topics.task(this.taskId)?.task ?? null);
    if (task === null) return [sgr(2, 'no task selected')];
    const priority = Number(task.priority ?? 4);
    const status = topics
      .get('catalog')
      ?.statuses.find((s) => s.id === task.column)?.name;
    const rows: [string, string][] = [
      ['Project', text(task.project)],
      ['Tags', task.tags.length === 0 ? '—' : task.tags.join(' ')],
      ['Priority', priority < 4 ? `p${String(priority)}` : '—'],
      ['Status', text(status)],
      ['Scheduled', text(task.scheduledOn)],
      ['Due', text(task.dueOn)],
      [
        'Repeat',
        typeof task.parentId === 'string'
          ? 'with its parent'
          : describeRule(task.rrule),
      ],
      ['Notes', task.notes === null ? '—' : (task.notes.split('\n')[0] ?? '')],
    ];
    const lines = [
      sgr(1, String(task.title)),
      '',
      ...rows.map(([label, value]) => `${sgr(2, label.padEnd(10))} ${value}`),
      ...(task.subtasks.length === 0
        ? []
        : [
            '',
            sgr(2, 'SUBTASKS'),
            ...task.subtasks.map((s) => `${s.closed ? '✓' : '○'} ${s.title}`),
          ]),
    ];
    return lines.map((l) => truncateToWidth(l, width, '…'));
  }

  invalidate(): void {}
}
