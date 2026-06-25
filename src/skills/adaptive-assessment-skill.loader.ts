import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const SKILL_PATH = resolve(process.cwd(), 'skills', 'adaptive-assessment-loop', 'SKILL.md');

let cachedSkill: string | null = null;

export async function loadAdaptiveAssessmentSkill(): Promise<string> {
  if (cachedSkill !== null) {
    return cachedSkill;
  }

  cachedSkill = await readFile(SKILL_PATH, 'utf8');
  return cachedSkill;
}
