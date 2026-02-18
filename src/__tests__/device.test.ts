import { Platform, Dimensions } from 'react-native';
import { getDeviceInfo } from '../device';

beforeEach(() => {
  (Platform as { OS: string }).OS = 'ios';
  (Dimensions.get as jest.Mock) = jest.fn(() => ({ width: 390, height: 844 }));
});

describe('getDeviceInfo', () => {
  it('returns ios platform when Platform.OS is ios', () => {
    (Platform as { OS: string }).OS = 'ios';
    const info = getDeviceInfo();
    expect(info.platform).toBe('ios');
  });

  it('returns android platform when Platform.OS is android', () => {
    (Platform as { OS: string }).OS = 'android';
    const info = getDeviceInfo();
    expect(info.platform).toBe('android');
  });

  it('includes screen dimensions', () => {
    (Dimensions.get as jest.Mock) = jest.fn(() => ({ width: 412, height: 915 }));
    const info = getDeviceInfo();
    expect(info.screenWidth).toBe(412);
    expect(info.screenHeight).toBe(915);
  });

  it('rounds fractional screen dimensions', () => {
    (Dimensions.get as jest.Mock) = jest.fn(() => ({ width: 390.5, height: 844.3 }));
    const info = getDeviceInfo();
    expect(info.screenWidth).toBe(391);
    expect(info.screenHeight).toBe(844);
  });

  it('includes timezone from Intl', () => {
    const info = getDeviceInfo();
    expect(typeof info.timezone).toBe('string');
  });

  it('includes language from Intl', () => {
    const info = getDeviceInfo();
    expect(typeof info.language).toBe('string');
  });
});
