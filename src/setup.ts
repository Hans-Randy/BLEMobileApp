// Global polyfills for React Native
import { Buffer } from 'buffer';
import { Platform, PermissionsAndroid } from 'react-native';
import { BleManager } from 'react-native-ble-plx';

// Make Buffer available globally
global.Buffer = Buffer;

/**
 * Request all necessary permissions for Bluetooth and Location
 */
export async function requestPermissions(): Promise<boolean> {
  try {
    if (Platform.OS === 'ios') {
      // On iOS 13+, BLE doesn't require explicit permission request
      // The system automatically prompts when you start scanning
      // We just need the Info.plist entries (which are already there)
      console.log('iOS: Permissions will be requested when BLE scanning starts');
      return true;
    } else if (Platform.OS === 'android') {
      // Android 12+ (API 31+) requires specific Bluetooth permissions
      if (Platform.Version >= 31) {
        const granted = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        ]);
        
        return (
          granted['android.permission.BLUETOOTH_SCAN'] === PermissionsAndroid.RESULTS.GRANTED &&
          granted['android.permission.BLUETOOTH_CONNECT'] === PermissionsAndroid.RESULTS.GRANTED &&
          granted['android.permission.ACCESS_FINE_LOCATION'] === PermissionsAndroid.RESULTS.GRANTED
        );
      } else {
        // Android 11 and below - use basic location permission
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
        );
        
        return granted === PermissionsAndroid.RESULTS.GRANTED;
      }
    }
    
    return false;
  } catch (error) {
    console.error('Error requesting permissions:', error);
    return false;
  }
}

/**
 * Initialize BLE Manager
 */
export function createBleManager(): BleManager {
  return new BleManager();
}
