import { homedir } from 'node:os';
import { join } from 'node:path';

export const BASE = process.env.TODOER_URL ?? 'http://localhost:3000/api/v1';
export const TOKEN = process.env.TODOER_TOKEN ?? '';
export const STATE = join(homedir(), '.config', 'todoer', 'state.json');
