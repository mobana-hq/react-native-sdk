import { Platform, NativeModules } from 'react-native';
import { getInstallReferrer } from '../NativeMobana';

const mockGetInstallReferrer = NativeModules.Mobana.getInstallReferrer as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  (Platform as { OS: string }).OS = 'android';
  mockGetInstallReferrer.mockResolvedValue(null);
});

describe('getInstallReferrer', () => {
  it('returns null on iOS', async () => {
    (Platform as { OS: string }).OS = 'ios';
    const result = await getInstallReferrer();
    expect(result).toBeNull();
    expect(mockGetInstallReferrer).not.toHaveBeenCalled();
  });

  it('extracts dacid from referrer string on Android', async () => {
    mockGetInstallReferrer.mockResolvedValueOnce(
      'utm_source=google&dacid=click_abc&utm_medium=cpc'
    );
    const result = await getInstallReferrer();
    expect(result).toBe('click_abc');
  });

  it('returns null when referrer has no dacid param', async () => {
    mockGetInstallReferrer.mockResolvedValueOnce('utm_source=google&utm_medium=cpc');
    const result = await getInstallReferrer();
    expect(result).toBeNull();
  });

  it('returns null when native module returns null', async () => {
    mockGetInstallReferrer.mockResolvedValueOnce(null);
    const result = await getInstallReferrer();
    expect(result).toBeNull();
  });

  it('returns null when native module throws', async () => {
    mockGetInstallReferrer.mockRejectedValueOnce(new Error('not available'));
    const result = await getInstallReferrer();
    expect(result).toBeNull();
  });
});
