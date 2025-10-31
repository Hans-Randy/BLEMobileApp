import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Text,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { BuddhaBleClient, Step } from './BuddhaBleClient';

interface DeviceStatus {
  connected: boolean;
  batteryLevel?: number;
  chargerConnected?: 0 | 1;
  deviceInfo?: {
    hwMajor: number;
    hwMinor: number;
    fwMajor: number;
    fwMinor: number;
  };
  treatmentStatus?: {
    status: 0 | 1 | 2 | 3;
    errorCode: number;
    remainingSec: number;
    intensityPct: number;
    totalDurationSec: number;
  };
}

interface StepInput {
  id: string;
  amplitude: string;
  duration: string;
}

export const TreatmentScreen: React.FC = () => {
  const clientRef = useRef<BuddhaBleClient | null>(null);
  const [deviceStatus, setDeviceStatus] = useState<DeviceStatus>({
    connected: false,
  });
  const [loading, setLoading] = useState(false);
  const [steps, setSteps] = useState<StepInput[]>([
    { id: '1', amplitude: '50', duration: '1000' },
  ]);
  const [intensity, setIntensity] = useState('100');
  const [duration, setDuration] = useState('5000');

  // Initialize BLE client
  useEffect(() => {
    if (!clientRef.current) {
      clientRef.current = new BuddhaBleClient();
    }

    const client = clientRef.current;
    let unsubscribeBattery: (() => void) | null = null;
    let unsubscribeStatus: (() => void) | null = null;

    const setupSubscriptions = async () => {
      try {
        // Set up battery level subscription
        unsubscribeBattery = client.subscribeBatteryLevel((level: number) => {
          setDeviceStatus((prev) => ({
            ...prev,
            batteryLevel: level,
          }));
        });

        // Set up status subscription
        unsubscribeStatus = client.subscribeStatus((status: 0 | 1 | 2 | 3) => {
          setDeviceStatus((prev) => ({
            ...prev,
            treatmentStatus: prev.treatmentStatus
              ? { ...prev.treatmentStatus, status }
              : undefined,
          }));
        });
      } catch (error) {
        console.warn('Could not set up subscriptions:', error);
      }
    };

    if (deviceStatus.connected) {
      setupSubscriptions();
    }

    return () => {
      if (unsubscribeBattery) unsubscribeBattery();
      if (unsubscribeStatus) unsubscribeStatus();
    };
  }, [deviceStatus.connected]);

  // Polling for device status
  useEffect(() => {
    let pollInterval: NodeJS.Timeout;

    const pollStatus = async () => {
      if (!clientRef.current || !deviceStatus.connected) return;

      try {
        const [battery, info] = await Promise.all([
          clientRef.current.readBattery(),
          clientRef.current.readDeviceInfo(),
        ]);

        setDeviceStatus((prev) => ({
          ...prev,
          batteryLevel: battery.level,
          chargerConnected: battery.chargerConnected,
          deviceInfo: info,
        }));
      } catch (error) {
        console.warn('Error polling device status:', error);
      }
    };

    if (deviceStatus.connected) {
      pollStatus(); // Initial read
      pollInterval = setInterval(pollStatus, 2000); // Poll every 2 seconds
    }

    return () => {
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [deviceStatus.connected]);

  const handleScanAndConnect = async () => {
    setLoading(true);
    try {
      await clientRef.current!.scanAndConnect({
        timeoutMs: 10000,
      });
      setDeviceStatus((prev) => ({ ...prev, connected: true }));
      Alert.alert('Success', 'Connected to device');
    } catch (error) {
      Alert.alert('Error', `Failed to connect: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await clientRef.current!.disconnect();
      setDeviceStatus({ connected: false });
      Alert.alert('Success', 'Disconnected from device');
    } catch (error) {
      Alert.alert('Error', `Failed to disconnect: ${error}`);
    }
  };

  const handleAddStep = () => {
    const newId = (Math.max(...steps.map((s) => parseInt(s.id, 10)), 0) + 1).toString();
    setSteps([...steps, { id: newId, amplitude: '50', duration: '1000' }]);
  };

  const handleRemoveStep = (id: string) => {
    if (steps.length > 1) {
      setSteps(steps.filter((s) => s.id !== id));
    } else {
      Alert.alert('Error', 'Must have at least one step');
    }
  };

  const handleUpdateStep = (id: string, field: 'amplitude' | 'duration', value: string) => {
    setSteps(
      steps.map((s) =>
        s.id === id ? { ...s, [field]: value } : s
      )
    );
  };

  const handleSendTreatment = async () => {
    try {
      if (!clientRef.current || !deviceStatus.connected) {
        Alert.alert('Error', 'Not connected to device');
        return;
      }

      // Validate inputs
      const parsedSteps: Step[] = steps.map((s) => {
        const amp = parseInt(s.amplitude, 10);
        const dur = parseInt(s.duration, 10);

        if (isNaN(amp) || amp < 0 || amp > 100) {
          throw new Error(`Invalid amplitude: ${s.amplitude}`);
        }
        if (isNaN(dur) || dur < 1 || dur > 65535) {
          throw new Error(`Invalid duration: ${s.duration}`);
        }

        return {
          amplitudePct: amp,
          durationMs: dur,
        };
      });

      const intensityValue = parseInt(intensity, 10);
      if (isNaN(intensityValue) || intensityValue < 0 || intensityValue > 100) {
        throw new Error('Invalid intensity percentage');
      }

      const durationMs = parseInt(duration, 10);
      if (isNaN(durationMs) || durationMs < 1) {
        throw new Error('Invalid total duration');
      }

      setLoading(true);

      // Send treatment configuration
      await clientRef.current.writeSteps(parsedSteps);
      await clientRef.current.writeTotalDurationMs(durationMs);
      await clientRef.current.writeIntensity(intensityValue);

      Alert.alert('Success', 'Treatment sent to device');
    } catch (error) {
      Alert.alert('Error', `Failed to send treatment: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  const handleStartTreatment = async () => {
    try {
      if (!clientRef.current || !deviceStatus.connected) {
        Alert.alert('Error', 'Not connected to device');
        return;
      }

      setLoading(true);
      await clientRef.current.writeControl(1); // 1 = start
      Alert.alert('Success', 'Treatment started');
    } catch (error) {
      Alert.alert('Error', `Failed to start treatment: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  const handleStopTreatment = async () => {
    try {
      if (!clientRef.current || !deviceStatus.connected) {
        Alert.alert('Error', 'Not connected to device');
        return;
      }

      setLoading(true);
      await clientRef.current.writeControl(0); // 0 = stop
      Alert.alert('Success', 'Treatment stopped');
    } catch (error) {
      Alert.alert('Error', `Failed to stop treatment: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  const getStatusText = (status?: number): string => {
    switch (status) {
      case 0:
        return 'Stopped';
      case 1:
        return 'Running';
      case 2:
        return 'Paused';
      case 3:
        return 'Error';
      default:
        return 'Unknown';
    }
  };

  return (
    <ScrollView style={styles.container}>
      {/* Connection Status */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Connection</Text>
        <View style={styles.statusBox}>
          <View style={styles.statusRow}>
            <Text style={styles.label}>Status:</Text>
            <Text
              style={[
                styles.value,
                deviceStatus.connected ? styles.statusConnected : styles.statusDisconnected,
              ]}
            >
              {deviceStatus.connected ? 'Connected' : 'Disconnected'}
            </Text>
          </View>

          {deviceStatus.deviceInfo && (
            <>
              <View style={styles.statusRow}>
                <Text style={styles.label}>HW Version:</Text>
                <Text style={styles.value}>
                  {deviceStatus.deviceInfo.hwMajor}.{deviceStatus.deviceInfo.hwMinor}
                </Text>
              </View>
              <View style={styles.statusRow}>
                <Text style={styles.label}>FW Version:</Text>
                <Text style={styles.value}>
                  {deviceStatus.deviceInfo.fwMajor}.{deviceStatus.deviceInfo.fwMinor}
                </Text>
              </View>
            </>
          )}

          {deviceStatus.batteryLevel !== undefined && (
            <View style={styles.statusRow}>
              <Text style={styles.label}>Battery:</Text>
              <Text style={styles.value}>{deviceStatus.batteryLevel}%</Text>
            </View>
          )}

          {deviceStatus.chargerConnected !== undefined && (
            <View style={styles.statusRow}>
              <Text style={styles.label}>Charger:</Text>
              <Text style={styles.value}>
                {deviceStatus.chargerConnected ? 'Connected' : 'Disconnected'}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={[styles.button, styles.connectButton]}
            onPress={handleScanAndConnect}
            disabled={deviceStatus.connected || loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>
                {deviceStatus.connected ? 'Connected' : 'Connect'}
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, styles.disconnectButton]}
            onPress={handleDisconnect}
            disabled={!deviceStatus.connected || loading}
          >
            <Text style={styles.buttonText}>Disconnect</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Treatment Status */}
      {deviceStatus.treatmentStatus && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Treatment Status</Text>
          <View style={styles.statusBox}>
            <View style={styles.statusRow}>
              <Text style={styles.label}>Status:</Text>
              <Text
                style={[
                  styles.value,
                  deviceStatus.treatmentStatus.status === 1
                    ? styles.statusRunning
                    : styles.statusNotRunning,
                ]}
              >
                {getStatusText(deviceStatus.treatmentStatus.status)}
              </Text>
            </View>
            <View style={styles.statusRow}>
              <Text style={styles.label}>Remaining Time:</Text>
              <Text style={styles.value}>
                {(deviceStatus.treatmentStatus.remainingSec / 1000).toFixed(1)}s
              </Text>
            </View>
            <View style={styles.statusRow}>
              <Text style={styles.label}>Total Duration:</Text>
              <Text style={styles.value}>
                {(deviceStatus.treatmentStatus.totalDurationSec / 1000).toFixed(1)}s
              </Text>
            </View>
            <View style={styles.statusRow}>
              <Text style={styles.label}>Intensity:</Text>
              <Text style={styles.value}>{deviceStatus.treatmentStatus.intensityPct}%</Text>
            </View>
            {deviceStatus.treatmentStatus.errorCode !== 0 && (
              <View style={styles.statusRow}>
                <Text style={styles.label}>Error Code:</Text>
                <Text style={[styles.value, styles.errorText]}>
                  {deviceStatus.treatmentStatus.errorCode}
                </Text>
              </View>
            )}
          </View>

          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={[styles.button, styles.startButton]}
              onPress={handleStartTreatment}
              disabled={loading}
            >
              <Text style={styles.buttonText}>Start</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.button, styles.stopButton]}
              onPress={handleStopTreatment}
              disabled={loading}
            >
              <Text style={styles.buttonText}>Stop</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Treatment Configuration */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Treatment Configuration</Text>

        {/* Total Duration */}
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Total Duration (ms)</Text>
          <TextInput
            style={styles.input}
            value={duration}
            onChangeText={setDuration}
            placeholder="5000"
            keyboardType="number-pad"
            editable={!loading}
          />
        </View>

        {/* Intensity */}
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Intensity (%)</Text>
          <TextInput
            style={styles.input}
            value={intensity}
            onChangeText={setIntensity}
            placeholder="100"
            keyboardType="number-pad"
            maxLength={3}
            editable={!loading}
          />
        </View>

        {/* Steps */}
        <View style={styles.stepsContainer}>
          <View style={styles.stepsHeader}>
            <Text style={styles.label}>Treatment Steps</Text>
            <TouchableOpacity
              style={styles.addStepButton}
              onPress={handleAddStep}
              disabled={loading}
            >
              <Text style={styles.addStepButtonText}>+ Add Step</Text>
            </TouchableOpacity>
          </View>

          {steps.map((step, index) => (
            <View key={step.id} style={styles.stepCard}>
              <Text style={styles.stepNumber}>Step {index + 1}</Text>

              <View style={styles.stepInputRow}>
                <View style={[styles.inputGroup, styles.stepInput]}>
                  <Text style={styles.label}>Amplitude (%)</Text>
                  <TextInput
                    style={styles.input}
                    value={step.amplitude}
                    onChangeText={(value) =>
                      handleUpdateStep(step.id, 'amplitude', value)
                    }
                    placeholder="0-100"
                    keyboardType="number-pad"
                    maxLength={3}
                    editable={!loading}
                  />
                </View>

                <View style={[styles.inputGroup, styles.stepInput]}>
                  <Text style={styles.label}>Duration (ms)</Text>
                  <TextInput
                    style={styles.input}
                    value={step.duration}
                    onChangeText={(value) => handleUpdateStep(step.id, 'duration', value)}
                    placeholder="1-65535"
                    keyboardType="number-pad"
                    editable={!loading}
                  />
                </View>

                {steps.length > 1 && (
                  <TouchableOpacity
                    style={styles.removeStepButton}
                    onPress={() => handleRemoveStep(step.id)}
                    disabled={loading}
                  >
                    <Text style={styles.removeStepButtonText}>Remove</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          ))}
        </View>

        {/* Send Treatment Button */}
        <TouchableOpacity
          style={[styles.button, styles.sendButton]}
          onPress={handleSendTreatment}
          disabled={!deviceStatus.connected || loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Send Treatment</Text>
          )}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  section: {
    margin: 12,
    padding: 16,
    backgroundColor: '#fff',
    borderRadius: 8,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 1.41,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
    color: '#333',
  },
  statusBox: {
    backgroundColor: '#f9f9f9',
    borderRadius: 6,
    padding: 12,
    marginBottom: 12,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  label: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
  },
  value: {
    fontSize: 14,
    color: '#333',
    fontWeight: '600',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 8,
  },
  button: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  buttonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  connectButton: {
    backgroundColor: '#4CAF50',
  },
  disconnectButton: {
    backgroundColor: '#FF6B6B',
  },
  startButton: {
    backgroundColor: '#4CAF50',
  },
  stopButton: {
    backgroundColor: '#FF6B6B',
  },
  sendButton: {
    backgroundColor: '#2196F3',
    marginTop: 12,
  },
  inputGroup: {
    marginBottom: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 6,
    padding: 10,
    marginTop: 4,
    fontSize: 14,
    color: '#333',
  },
  stepsContainer: {
    marginTop: 12,
    marginBottom: 16,
  },
  stepsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  addStepButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: '#2196F3',
    borderRadius: 4,
  },
  addStepButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  stepCard: {
    backgroundColor: '#f9f9f9',
    borderLeftWidth: 4,
    borderLeftColor: '#2196F3',
    padding: 12,
    marginBottom: 8,
    borderRadius: 4,
  },
  stepNumber: {
    fontSize: 13,
    fontWeight: '600',
    color: '#666',
    marginBottom: 10,
  },
  stepInputRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-end',
  },
  stepInput: {
    flex: 1,
    marginBottom: 0,
  },
  removeStepButton: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: '#FFE5E5',
    borderRadius: 4,
    justifyContent: 'center',
  },
  removeStepButtonText: {
    color: '#FF6B6B',
    fontSize: 12,
    fontWeight: '600',
  },
  statusConnected: {
    color: '#4CAF50',
  },
  statusDisconnected: {
    color: '#FF6B6B',
  },
  statusRunning: {
    color: '#4CAF50',
  },
  statusNotRunning: {
    color: '#FFA500',
  },
  errorText: {
    color: '#FF6B6B',
  },
});
