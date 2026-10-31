import { open } from '@tauri-apps/plugin-dialog';

const formats = ['dwg','dxf','rvt','rfa','rte','pdf','png','jpg','jpeg','tif','tiff','csv','xlsx','xls','docx','txt','ifc','landxml','xml'];

/** The dialog returns paths only. Rust validates existence and stores references, not file bytes. */
export async function browseEngineeringFiles(multiple = true): Promise<string[]> {
  if (!('__TAURI_INTERNALS__' in window)) return [];
  const selected = await open({ title: 'Select engineering files', multiple, directory: false, filters: [{ name: 'Engineering documents', extensions: formats }] });
  return selected === null ? [] : Array.isArray(selected) ? selected : [selected];
}

export function fileName(path: string): string { return path.split(/[\\/]/).pop() || path; }
