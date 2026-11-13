import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BrightspaceSettings } from './BrightspaceSettings';
import * as service from './services/brightspace';

vi.mock('./services/brightspace', () => ({
  brightspaceConfiguration: vi.fn(), brightspaceSaveConfiguration: vi.fn(), brightspaceInspectCapabilities: vi.fn(), brightspaceCancel: vi.fn(),
}));
const configuration = vi.mocked(service.brightspaceConfiguration);
const save = vi.mocked(service.brightspaceSaveConfiguration);
const inspect = vi.mocked(service.brightspaceInspectCapabilities);
const base = { profileId: 'civildesk-dev', portalOrigin: 'https://learn.example.edu', executablePath: 'C:\\Tools\\d2l.exe', cliAvailable: true, cliCompatible: true, liveVerified: false };

beforeEach(() => { vi.resetAllMocks(); configuration.mockResolvedValue(null); });
afterEach(cleanup);

it('shows not configured from local settings without launching the CLI', async () => {
  render(<BrightspaceSettings />);
  expect(await screen.findByText('Not configured')).toBeInTheDocument();
  expect(inspect).not.toHaveBeenCalled();
});

it('loads nonsecret settings without launching the CLI', async () => {
  configuration.mockResolvedValueOnce({ portalOrigin: base.portalOrigin, executablePath: base.executablePath });
  render(<BrightspaceSettings />);
  expect(await screen.findByDisplayValue(base.portalOrigin)).toBeInTheDocument();
  expect(screen.getByDisplayValue(base.executablePath)).toBeInTheDocument();
  expect(screen.getByText('Not checked')).toBeInTheDocument();
  expect(inspect).not.toHaveBeenCalled();
});

it('saves only portal and executable fields', async () => {
  save.mockResolvedValueOnce({ portalOrigin: base.portalOrigin, executablePath: base.executablePath });
  render(<BrightspaceSettings />);
  fireEvent.change(screen.getByLabelText('Brightspace portal origin'), { target: { value: base.portalOrigin } });
  fireEvent.change(screen.getByLabelText('Trusted D2L-CLI executable'), { target: { value: base.executablePath } });
  fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
  await waitFor(() => expect(save).toHaveBeenCalledWith(base.portalOrigin, base.executablePath));
  expect(inspect).not.toHaveBeenCalled();
});

it.each([
  ['capabilities_verified', 'CLI capabilities verified'],
  ['cli_incompatible', 'CLI incompatible'],
  ['cli_unavailable', 'CLI unavailable'],
] as const)('presents %s without claiming a credential or live connection', async (state, label) => {
  inspect.mockResolvedValueOnce({ ...base, state, message: 'CLI capabilities verified — credentials and account connection not checked.' });
  render(<BrightspaceSettings />);
  fireEvent.click(screen.getByRole('button', { name: 'Inspect capabilities' }));
  expect(await screen.findByText(label)).toBeInTheDocument();
  expect(screen.getByText(/Capability inspection does not check credentials/)).toBeInTheDocument();
  expect(screen.queryByText('Connected')).toBeNull();
  expect(screen.queryByText('Credential stored, unverified')).toBeNull();
});

it('shows a safe error when the inspection fails', async () => {
  inspect.mockRejectedValueOnce(new Error('SYNTHETIC_SECRET'));
  render(<BrightspaceSettings />);
  fireEvent.click(screen.getByRole('button', { name: 'Inspect capabilities' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Brightspace capabilities could not be inspected.');
  expect(document.body.textContent).not.toContain('SYNTHETIC_SECRET');
});
