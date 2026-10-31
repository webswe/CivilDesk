import { describe, expect, it, vi } from 'vitest';
vi.mock('@tauri-apps/plugin-dialog',()=>({open:vi.fn()}));
import { open } from '@tauri-apps/plugin-dialog';
import { browseEngineeringFiles, fileName } from './filePicker';
describe('native file selection',()=>{
  it('handles cancellation and Unicode paths with spaces',async()=>{
    Object.defineProperty(window,'__TAURI_INTERNALS__',{value:{},configurable:true});
    vi.mocked(open).mockResolvedValueOnce(null).mockResolvedValueOnce(['C:\\Plans\\Café site.dwg','C:\\Plans\\模型.pdf']);
    expect(await browseEngineeringFiles()).toEqual([]);
    expect(await browseEngineeringFiles()).toEqual(['C:\\Plans\\Café site.dwg','C:\\Plans\\模型.pdf']);
    expect(fileName('C:\\Plans\\Café site.dwg')).toBe('Café site.dwg');
    Reflect.deleteProperty(window,'__TAURI_INTERNALS__');
  });
});
