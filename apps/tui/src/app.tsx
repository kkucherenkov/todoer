import { Box, Text, useApp, useInput, useWindowSize } from 'ink';
import { useEffect, useState } from 'react';
import { ALL } from '@todoer/client-core';
import { useTui } from './context.js';
import { SCREENS, type Screen } from './screens.js';
import { Sidebar, viewEntries } from './sidebar.js';
import { StatusBar } from './status-bar.js';
import { useTopic, useView } from './topics.js';
import { Picker } from './ui/picker.js';
import { ViewPane } from './view-pane.js';

const HINTS =
  'j/k move · o new · x done · e details · m status · [ ] views · ? help · q quit';
const HELP = [
  'j k ↓ ↑   move           o O     new task / subtask',
  'h l ← →   fold / column  Enter i edit the line',
  'J K       move the task  x Space done / undo',
  'H L       board column   s       skip occurrence',
  'Tab S-Tab indent         m       status',
  'e         details        dd y    delete',
  'S         statuses       [ ] v   views',
  'r         sync now       q       quit',
];

export function App() {
  const { engine, topics, status } = useTui();
  const { exit } = useApp();
  const { columns } = useWindowSize();
  const session = useTopic(topics, 'session');
  const catalog = useTopic(topics, 'catalog');
  const entries = viewEntries(catalog);
  const [key, setKey] = useState(ALL);
  const [screen, setScreen] = useState<Screen>({ kind: 'view' });
  const [picking, setPicking] = useState(false);
  const [help, setHelp] = useState(false);
  const view = useView(topics, key);

  // A deleted view falls back to All open.
  const known = entries.some((e) => e.key === key);
  useEffect(() => {
    if (catalog !== undefined && !known) setKey(ALL);
  }, [catalog, known]);

  useEffect(() => {
    void engine.handle(
      {
        kind: 'watch',
        view: key,
        task: screen.kind === 'details' ? screen.taskId : null,
      },
      'tui',
    );
  }, [engine, key, screen]);

  /** A screen whose plan has not landed yet says so instead of opening. */
  const openScreen = (next: Screen) => {
    if (
      (next.kind === 'details' && SCREENS.details === undefined) ||
      (next.kind === 'statuses' && SCREENS.statuses === undefined)
    ) {
      status.say({ tone: 'info', text: `${next.kind} is not built yet` });
      return;
    }
    setScreen(next);
  };

  const onView = screen.kind === 'view' && !picking && !help;
  useInput(
    (input) => {
      const i = entries.findIndex((e) => e.key === key);
      const step = (d: number) => {
        const next = entries[(i + d + entries.length) % entries.length];
        if (next !== undefined) setKey(next.key);
      };
      if (input === 'q') exit();
      else if (input === ']') step(1);
      else if (input === '[') step(-1);
      else if (input === 'v') setPicking(true);
      else if (input === '?') setHelp(true);
      else if (input === 'r')
        void engine.handle({ kind: 'sync', reason: 'manual' }, 'tui');
      else if (input === 'S') openScreen({ kind: 'statuses' });
    },
    { isActive: onView },
  );
  useInput(() => setHelp(false), { isActive: help });

  if (session?.state === 'signed-out') {
    return (
      <Box flexDirection="column">
        <Text>
          Not signed in. Run `todoer login`, then start todoer-tui again.
        </Text>
        <Text dimColor>q quit</Text>
        <QuitOnQ />
      </Box>
    );
  }

  const close = () => setScreen({ kind: 'view' });
  const body =
    screen.kind === 'details' && SCREENS.details !== undefined
      ? SCREENS.details({ taskId: screen.taskId, close })
      : screen.kind === 'statuses' && SCREENS.statuses !== undefined
        ? SCREENS.statuses({ close })
        : null;

  return (
    <Box flexDirection="column">
      <Box>
        {columns >= 80 ? <Sidebar entries={entries} current={key} /> : null}
        <Box
          flexDirection="column"
          flexGrow={1}
          borderStyle="round"
          paddingX={1}
        >
          {help ? (
            HELP.map((line) => <Text key={line}>{line}</Text>)
          ) : picking ? (
            <Picker
              title="View"
              items={entries.map((e) => ({ id: e.key, label: e.name }))}
              initial={key}
              onPick={(id) => {
                setKey(id);
                setPicking(false);
              }}
              onCancel={() => setPicking(false)}
            />
          ) : body !== null ? (
            body
          ) : view === undefined ? (
            <Text dimColor>loading…</Text>
          ) : (
            <ViewPane view={view} active={onView} open={openScreen} />
          )}
        </Box>
      </Box>
      <StatusBar hints={HINTS} />
    </Box>
  );
}

function QuitOnQ() {
  const { exit } = useApp();
  useInput((input) => input === 'q' && exit());
  return null;
}
