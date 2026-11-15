import { describe, expect, it } from 'vitest';
import { checkHistoricalListing } from './check-baseline-bundle.mjs';

const listing = names => `Path = CivilDesk_0.1.0_x64-setup.exe\nType = Nsis\n----------\n${names.map(name => `Path = $INSTDIR/${name}`).join('\n')}`;
const known = ['civildesk.exe', 'brightspace-synthetic.exe', 'MicrosoftEdgeWebView2RuntimeInstaller.exe'];

describe('immutable historical installer exception', () => {
  it('accepts only the known synthetic executable alongside the app and WebView2 installer', () => {
    expect(checkHistoricalListing(listing(known))).toEqual([]);
    for (const name of ['other-test.exe', 'civildesk-e2e.exe', 'credentials.json', '.env', 'civildesk.sqlite3', 'test-e2e.json']) {
      expect(checkHistoricalListing(listing([...known, name]))).not.toEqual([]);
    }
  });
  it('rejects a missing or duplicated historical fixture and malformed archives', () => {
    expect(checkHistoricalListing(listing(['civildesk.exe']))).not.toEqual([]);
    expect(checkHistoricalListing(listing([...known, 'brightspace-synthetic.exe']))).not.toEqual([]);
    expect(checkHistoricalListing('not an archive listing')).not.toEqual([]);
  });
});
