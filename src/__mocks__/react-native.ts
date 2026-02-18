export const Platform = {
  OS: 'ios' as 'ios' | 'android',
  select: (obj: Record<string, unknown>) => obj[Platform.OS],
};

export const Dimensions = {
  get: (_dim: string) => ({ width: 390, height: 844 }),
};

export const NativeModules = {
  Mobana: {
    getInstallReferrer: jest.fn().mockResolvedValue(null),
  },
};

export const Linking = {
  openURL: jest.fn().mockResolvedValue(undefined),
  openSettings: jest.fn().mockResolvedValue(undefined),
};

export const StyleSheet = {
  create: <T extends Record<string, unknown>>(styles: T): T => styles,
};

export const StatusBar = {};

export const Modal = 'Modal';
export const View = 'View';
export const ActivityIndicator = 'ActivityIndicator';

export const useColorScheme = jest.fn(() => 'light');

export default {
  Platform,
  Dimensions,
  NativeModules,
  Linking,
  StyleSheet,
  StatusBar,
  Modal,
  View,
  ActivityIndicator,
  useColorScheme,
};
