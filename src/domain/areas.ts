/**
 * Life areas used to organise the unified task list.
 *
 * Tasks already carry a free-text `category`. Rather than adding a schema field, an area is
 * derived from that text, so School, Personal and Engineering views all read the same tasks
 * that the Calendar, My Day and Pip already use.
 */
export type Area = 'school' | 'personal' | 'engineering';
export const areaLabels: Record<Area, string> = { school: 'School', personal: 'Personal', engineering: 'Engineering' };
export const areaOrder: Area[] = ['school', 'personal', 'engineering'];

const schoolWords = /\b(school|class|classes|course|courses|homework|study|studying|exam|exams|quiz|assignment|assignments|lecture|lab|academic|university|college|semester)\b/;
const engineeringWords = /\b(engineering|civil|cad|autocad|revit|civil 3d|structural|drainage|survey|project)\b/;

export function taskArea(category: string, hasProject = false): Area {
  const text = category.trim().toLowerCase();
  if (text === 'school') return 'school';
  if (text === 'engineering') return 'engineering';
  if (text === 'personal' || text === '') return hasProject ? 'engineering' : 'personal';
  if (schoolWords.test(text)) return 'school';
  if (engineeringWords.test(text)) return 'engineering';
  return hasProject ? 'engineering' : 'personal';
}
