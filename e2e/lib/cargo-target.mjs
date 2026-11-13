// Use Cargo's active target directory for both the application and the synthetic CLI.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const targetDir = JSON.parse(execFileSync('cargo', ['metadata', '--no-deps', '--format-version', '1', '--manifest-path', path.join(root, 'src-tauri', 'Cargo.toml')], { encoding: 'utf8' })).target_directory;
