import { describe, expect, it } from 'vitest';
import { checkArchiveListing, checkTargets } from './check-release-bundle.mjs';

const targets = [
  { name: 'civildesk', kind: ['bin'] },
  { name: 'brightspace-synthetic', kind: ['bin'], 'required-features': ['e2e-brightspace-fixture'] },
];
const listing = names => `Path = installer.exe\nType = Nsis\n----------\n${names.map(name => `Path = $INSTDIR/${name}`).join('\n')}`;

describe('ordinary release bundle isolation', () => {
  it('requires the dedicated fixture feature and explicit binary targets', () => {
    expect(checkTargets('autobins = false\n', targets)).toEqual([]);
    expect(checkTargets('', targets)).not.toEqual([]);
    expect(checkTargets('autobins = false\n', [...targets, { name: 'other', kind: ['bin'] }])).not.toEqual([]);
    expect(checkTargets('autobins = false\n', [targets[0], { ...targets[1], 'required-features': [] }])).not.toEqual([]);
    expect(checkTargets('autobins = false\ndefault = ["e2e-brightspace-fixture"]', targets)).not.toEqual([]);
  });
  it('requires the app and rejects test executables and credential/configuration data', () => {
    expect(checkArchiveListing(listing(['civildesk.exe', 'uninstall.exe']))).toEqual([]);
    for (const name of ['brightspace-synthetic.exe', 'civildesk-e2e.exe', 'other-e2e.exe', 'test-e2e.json', '.env', 'credentials.json', 'civildesk.sqlite3']) {
      expect(checkArchiveListing(listing(['civildesk.exe', name]))).not.toEqual([]);
    }
    expect(checkArchiveListing(listing(['uninstall.exe']))).not.toEqual([]);
    expect(checkArchiveListing('not a listing')).not.toEqual([]);
  });
});
