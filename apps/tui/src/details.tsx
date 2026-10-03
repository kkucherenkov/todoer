import { Box, Text, useApp, useInput } from 'ink';
import { useState, type ReactNode } from 'react';
import {
  ALL,
  type Result,
  type Rule,
  type TaskChanges,
  type TaskDetails,
} from '@todoer/client-core';
import { useTui } from './context.js';
import { editText } from './editor.js';
import {
  customRule,
  describeRule,
  parseDate,
  parsePriority,
  parseTags,
  presets,
} from './fields.js';
import { useTask, useTopic } from './topics.js';
import { LineInput } from './ui/line-input.js';
import { Picker } from './ui/picker.js';
import { StatusPicker } from './ui/status-picker.js';
import { useWrite } from './use-write.js';

type FieldId =
  | 'title'
  | 'project'
  | 'tags'
  | 'priority'
  | 'status'
  | 'scheduledOn'
  | 'dueOn'
  | 'repeat'
  | 'notes';
const FIELDS: { id: FieldId; label: string }[] = [
  { id: 'title', label: 'Title' },
  { id: 'project', label: 'Project' },
  { id: 'tags', label: 'Tags' },
  { id: 'priority', label: 'Priority' },
  { id: 'status', label: 'Status' },
  { id: 'scheduledOn', label: 'Scheduled' },
  { id: 'dueOn', label: 'Due' },
  { id: 'repeat', label: 'Repeat' },
  { id: 'notes', label: 'Notes' },
];

type Editing = null | FieldId | 'custom-rule';

const dateOf = (value: unknown) => (typeof value === 'string' ? value : '');
const priorityOf = (task: TaskDetails) => {
  const p = Number(task.priority ?? 0);
  return p > 0 ? `p${String(p)}` : '';
};

const linesOf = (text: string) => {
  const n = text.split('\n').length;
  return n === 1 ? '1 line' : `${String(n)} lines`;
};

/** What each row shows; '' reads as "—". */
function shownOf(
  task: TaskDetails,
  statusName: string | undefined,
): Record<FieldId, string> {
  const enter = 'Enter opens $EDITOR';
  return {
    title: String(task.title),
    project: task.project ?? '',
    tags: task.tags.join(' '),
    priority: priorityOf(task),
    status: statusName ?? '',
    scheduledOn: dateOf(task.scheduledOn),
    dueOn: dateOf(task.dueOn),
    repeat:
      typeof task.parentId === 'string'
        ? 'with its parent'
        : describeRule(task.rrule),
    notes:
      task.notes === null
        ? `— · ${enter}`
        : `${linesOf(task.notes)} · ${enter}`,
  };
}

/**
 * One task's fields, one row each: j/k move, Enter edits the row, Esc or q
 * goes back. Every field saves on its own, as one write.
 */
function Details({ taskId, close }: { taskId: string; close: () => void }) {
  const { topics, status, today } = useTui();
  const write = useWrite();
  const { suspendTerminal } = useApp();
  const published = useTask(topics, taskId);
  const statuses = useTopic(topics, 'catalog')?.statuses ?? [];
  const [at, setAt] = useState(0);
  const [editing, setEditing] = useState<Editing>(null);
  const task = published?.task ?? null;

  const done = () => setEditing(null);
  const edit = (changes: TaskChanges) =>
    write((newId) => ({ kind: 'edit', opId: newId(), taskId, changes }));
  const setRule = (rule: Rule | null) =>
    write((newId) => ({ kind: 'setRule', opId: newId(), taskId, rule }));
  const isSubtask = typeof task?.parentId === 'string';
  const dtstart =
    task?.dtstart ??
    (typeof task?.scheduledOn === 'string' ? task.scheduledOn : today());

  const open = async (id: FieldId) => {
    if (task === null) return;
    if (id === 'repeat' && isSubtask) {
      status.say({ tone: 'info', text: 'a subtask repeats with its parent' });
    } else if (id !== 'notes') {
      setEditing(id);
    } else {
      // Assigned in the callback, which TS does not follow: no narrowing to null.
      let next = null as string | null;
      await suspendTerminal(() => {
        next = editText(task.notes ?? '', process.env);
      });
      if (next !== null) void edit({ notes: next });
    }
  };

  useInput(
    (input, key) => {
      status.clear();
      if (key.escape || input === 'q') return close();
      if (input === 'j' || key.downArrow) {
        setAt((i) => Math.min(FIELDS.length - 1, i + 1));
      } else if (input === 'k' || key.upArrow) {
        setAt((i) => Math.max(0, i - 1));
      } else if (key.return) {
        const field = FIELDS[at];
        if (field !== undefined) void open(field.id);
      }
    },
    { isActive: editing === null },
  );

  if (published === undefined) return <Text dimColor>loading…</Text>;
  if (task === null) {
    return <Text color="yellow">this task is gone · Esc to go back</Text>;
  }
  const shown = shownOf(task, statuses.find((s) => s.id === task.column)?.name);

  /** A line that saves through `save`: a string back is the refusal, said
   *  on the status line. Open until the write is taken, so a refusal of
   *  either kind keeps the text. */
  const line = (
    label: string,
    initial: string,
    save: (text: string) => Promise<Result> | string,
  ) => (
    <LineInput
      label={`${label}:`}
      initial={initial}
      onCancel={done}
      onSubmit={(text) => {
        const saved = save(text);
        if (typeof saved === 'string') {
          status.say({ tone: 'error', text: saved });
        } else {
          void saved.then((r) => r.ok && done());
        }
      }}
    />
  );
  const date = (field: 'scheduledOn' | 'dueOn', label: string) =>
    line(label, shown[field], (text) => {
      const value = parseDate(text);
      if (value === false) return 'a date is YYYY-MM-DD; empty clears it';
      return edit(
        field === 'dueOn' ? { dueOn: value } : { scheduledOn: value },
      );
    });

  const editor = (): ReactNode => {
    switch (editing) {
      case 'title':
        return line('Title', shown.title, (title) => edit({ title }));
      case 'project':
        return line('Project', shown.project, (text) => {
          const name = text.trim().replace(/^#/, '');
          return edit({ project: name === '' ? null : name });
        });
      case 'tags':
        return line('Tags', shown.tags, (text) =>
          edit({ tags: parseTags(text) }),
        );
      case 'priority':
        return line('Priority', shown.priority, (text) => {
          const priority = parsePriority(text);
          return priority === 'invalid'
            ? 'priority is p0 to p4'
            : edit({ priority });
        });
      case 'status':
        return (
          <StatusPicker
            taskId={taskId}
            current={task.column}
            view={ALL}
            onDone={done}
          />
        );
      case 'scheduledOn':
        return date('scheduledOn', 'Scheduled');
      case 'dueOn':
        return date('dueOn', 'Due');
      case 'repeat': {
        const choices = presets(dtstart);
        return (
          <Picker
            title="Repeat"
            items={[
              ...choices.map((p) => ({ id: p.id, label: p.label })),
              { id: 'custom', label: 'custom RRULE…' },
            ]}
            onCancel={done}
            onPick={(id) => {
              if (id === 'custom') return setEditing('custom-rule');
              const preset = choices.find((p) => p.id === id);
              if (preset === undefined) return;
              // The picker has no text to keep: it closes either way.
              done();
              void setRule(preset.rule(dtstart));
            }}
          />
        );
      }
      case 'custom-rule':
        return line('RRULE', task.rrule ?? '', (text) => {
          const rule = customRule(text, dtstart);
          return typeof rule === 'string' ? rule : setRule(rule);
        });
      default:
        return null;
    }
  };

  return (
    <Box flexDirection="column">
      <Text bold>{shown.title}</Text>
      {FIELDS.map((f, i) => (
        <Box key={f.id}>
          <Box width={11} flexShrink={0}>
            <Text dimColor>{f.label}</Text>
          </Box>
          <Text inverse={editing === null && i === at}>
            {shown[f.id] || '—'}
          </Text>
        </Box>
      ))}
      {task.subtasks.length === 0 ? null : (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>Subtasks</Text>
          {task.subtasks.map((s) => (
            <Text key={s.id}>
              {s.closed ? '✓ ' : '· '}
              {s.title}
            </Text>
          ))}
        </Box>
      )}
      {editor()}
      <Text dimColor>j/k field · Enter edit · Esc back</Text>
    </Box>
  );
}

/** A component, not a render function: `App` calls `SCREENS.details(…)`
 *  inline, so the screen's hooks must live below this boundary. */
export const DetailsScreen = (p: { taskId: string; close: () => void }) => (
  <Details {...p} />
);
