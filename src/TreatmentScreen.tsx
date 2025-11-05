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
    remainingSec: number;       // UPDATED: seconds
    intensityPct: number;
    totalDurationSec: number;   // UPDATED: seconds
  };
}

interface StepInput {
  id: string;
  amplitude: string;  // 0-100
  duration: string;   // ms, multiple of 10
}

export const TreatmentScreen: React.FC = () => {
  const clientRef = useRef<BuddhaBleClient | null>(null);
  const [deviceStatus, setDeviceStatus] = useState<DeviceStatus>({ connected: false });
  const [loading, setLoading] = useState(false);

  // default 1 step
  const [steps, setSteps] = useState<StepInput[]>([{ id: '1', amplitude: '50', duration: '1000' }]);
  const [intensity, setIntensity] = useState('100');
  const [totalSeconds, setTotalSeconds] = useState('5');      // UPDATED: seconds (0–600)
  const [pauseDurationMs, setPauseDurationMs] = useState('0'); // UPDATED: ms, multiple of 10

  // Initialize BLE client
  useEffect(() => {
    if (!clientRef.current) clientRef.current = new BuddhaBleClient();

    const client = clientRef.current;
    let unsubscribeBattery: (() => void) | null = null;
    let unsubscribeTreatment: (() => void) | null = null;

    const setupSubscriptions = async () => {
      try {
        unsubscribeBattery = client.subscribeBatteryLevel((level: number) => {
          setDeviceStatus((prev) => ({ ...prev, batteryLevel: level }));
        });

        // UPDATED: subscribe in seconds
        unsubscribeTreatment = client.subscribeTreatmentNotifies({
          onStatus: (status: 0 | 1 | 2 | 3) => {
            setDeviceStatus((prev) => ({
              ...prev,
              treatmentStatus: prev.treatmentStatus
                ? { ...prev.treatmentStatus, status }
                : undefined,
            }));
          },
          onRemainingSec: (remainingSec: number) => {
            setDeviceStatus((prev) => ({
              ...prev,
              treatmentStatus: prev.treatmentStatus
                ? { ...prev.treatmentStatus, remainingSec }
                : undefined,
            }));
          },
        });
      } catch (error) {
        console.warn('Could not set up subscriptions:', error);
      }
    };

    if (deviceStatus.connected) setupSubscriptions();

    return () => {
      if (unsubscribeBattery) unsubscribeBattery();
      if (unsubscribeTreatment) unsubscribeTreatment();
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
      pollStatus();
      pollInterval = setInterval(pollStatus, 2000);
    }

    return () => {
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [deviceStatus.connected]);

  const handleScanAndConnect = async () => {
    setLoading(true);
    try {
      await clientRef.current!.scanAndConnect({ timeoutMs: 10000 });
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
    if (steps.length >= 40) {
      Alert.alert('Limit reached', 'Maximum of 40 steps per protocol.');
      return;
    }
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
    setSteps(steps.map((s) => (s.id === id ? { ...s, [field]: value } : s)));
  };

  const parseIntOrNaN = (v: string) => (v.trim() === '' ? NaN : parseInt(v, 10));

  const handleSendTreatment = async () => {
    try {
      if (!clientRef.current || !deviceStatus.connected) {
        Alert.alert('Error', 'Not connected to device');
        return;
      }

      // Validate steps
      const parsedSteps: Step[] = steps.map((s, idx) => {
        const amp = parseIntOrNaN(s.amplitude);
        const dur = parseIntOrNaN(s.duration);

        if (!Number.isInteger(amp) || amp < 0 || amp > 100) {
          throw new Error(`Step ${idx + 1}: amplitude must be 0–100`);
        }
        if (!Number.isInteger(dur) || dur < 0 || dur > 65530) {
          throw new Error(`Step ${idx + 1}: duration must be 0–65530 ms`);
        }
        if (dur % 10 !== 0) {
          throw new Error(`Step ${idx + 1}: duration must be a multiple of 10 ms`);
        }

        return { amplitudePct: amp, durationMs: dur };
      });

      // Validate pause
      const pauseMs = parseIntOrNaN(pauseDurationMs);
      if (!Number.isInteger(pauseMs) || pauseMs < 0 || pauseMs > 65530) {
        throw new Error('Pause Duration must be 0–65530 ms');
      }
      if (pauseMs % 10 !== 0) {
        throw new Error('Pause Duration must be a multiple of 10 ms');
      }

      // Validate intensity
      const intensityValue = parseIntOrNaN(intensity);
      if (!Number.isInteger(intensityValue) || intensityValue < 0 || intensityValue > 100) {
        throw new Error('Intensity must be 0–100%');
      }

      // Validate total seconds
      const totalSec = parseIntOrNaN(totalSeconds);
      if (!Number.isInteger(totalSec) || totalSec < 0 || totalSec > 600) {
        throw new Error('Total Duration must be 0–600 seconds');
      }

      setLoading(true);

      // Send treatment configuration (122 bytes payload + total seconds + intensity)
      await clientRef.current.writeStepList({ steps: parsedSteps, pauseDurationMs: pauseMs });
      await clientRef.current.writeTotalDurationSec(totalSec);
      await clientRef.current.writeIntensity(intensityValue);
      await clientRef.current.writeLraEnables({ lra1: 1, lra2: 1, lra3: 1 });

      // Read back treatment status
      const t = await clientRef.current.readTreatment();
      setDeviceStatus((prev) => ({
        ...prev,
        treatmentStatus: {
          status: t.status,
          errorCode: t.errorCode,
          remainingSec: t.remainingSec,         // UPDATED
          intensityPct: t.intensityPct,
          totalDurationSec: t.totalDurationSec, // UPDATED
        },
      }));

      Alert.alert('Success', 'Treatment sent to device');
    } catch (error: any) {
      Alert.alert('Error', `Failed to send treatment: ${error?.message ?? error}`);
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
      case 0: return 'Stopped';
      case 1: return 'Running';
      case 2: return 'Paused';
      case 3: return 'Error';
      default: return 'Unknown';
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
            {loading ? <ActivityIndicator color="#fff" /> : (
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
                  deviceStatus.treatmentStatus.status === 1 ? styles.statusRunning : styles.statusNotRunning,
                ]}
              >
                {getStatusText(deviceStatus.treatmentStatus.status)}
              </Text>
            </View>
            <View style={styles.statusRow}>
              <Text style={styles.label}>Remaining Time:</Text>
              <Text style={styles.value}>{deviceStatus.treatmentStatus.remainingSec}s</Text>
            </View>
            <View style={styles.statusRow}>
              <Text style={styles.label}>Total Duration:</Text>
              <Text style={styles.value}>{deviceStatus.treatmentStatus.totalDurationSec}s</Text>
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

        {/* Total Duration (seconds) */}
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Total Duration (seconds, 0–600)</Text>
          <TextInput
            style={styles.input}
            value={totalSeconds}
            onChangeText={setTotalSeconds}
            placeholder="5"
            keyboardType="number-pad"
            editable={!loading}
            maxLength={3}
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

        {/* Pause Duration */}
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Pause Duration (ms, multiple of 10)</Text>
          <TextInput
            style={styles.input}
            value={pauseDurationMs}
            onChangeText={setPauseDurationMs}
            placeholder="0"
            keyboardType="number-pad"
            editable={!loading}
          />
        </View>

        {/* Steps */}
        <View style={styles.stepsContainer}>
          <View style={styles.stepsHeader}>
            <Text style={styles.label}>Treatment Steps (max 40)</Text>
            <TouchableOpacity
              style={[styles.addStepButton, steps.length >= 40 && { opacity: 0.6 }]}
              onPress={handleAddStep}
              disabled={loading || steps.length >= 40}
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
                    onChangeText={(value) => handleUpdateStep(step.id, 'amplitude', value)}
                    placeholder="0–100"
                    keyboardType="number-pad"
                    maxLength={3}
                    editable={!loading}
                  />
                </View>

                <View style={[styles.inputGroup, styles.stepInput]}>
                  <Text style={styles.label}>Duration (ms, ×10)</Text>
                  <TextInput
                    style={styles.input}
                    value={step.duration}
                    onChangeText={(value) => handleUpdateStep(step.id, 'duration', value)}
                    placeholder="e.g. 1000"
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
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Send Treatment</Text>}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  section: {
    margin: 12, padding: 16, backgroundColor: '#fff', borderRadius: 8,
    elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2, shadowRadius: 1.41,
  },
  sectionTitle: { fontSize: 18, fontWeight: '600', marginBottom: 12, color: '#333' },
  statusBox: { backgroundColor: '#f9f9f9', borderRadius: 6, padding: 12, marginBottom: 12 },
  statusRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#eee' },
  label: { fontSize: 14, color: '#666', fontWeight: '500' },
  value: { fontSize: 14, color: '#333', fontWeight: '600' },
  buttonRow: { flexDirection: 'row', gap: 8 },
  button: { flex: 1, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 6, alignItems: 'center', justifyContent: 'center', minHeight: 44 },
  buttonText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  connectButton: { backgroundColor: '#4CAF50' },
  disconnectButton: { backgroundColor: '#FF6B6B' },
  startButton: { backgroundColor: '#4CAF50' },
  stopButton: { backgroundColor: '#FF6B6B' },
  sendButton: { backgroundColor: '#2196F3', marginTop: 12 },
  inputGroup: { marginBottom: 12 },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 6, padding: 10, marginTop: 4, fontSize: 14, color: '#333' },
  stepsContainer: { marginTop: 12, marginBottom: 16 },
  stepsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  addStepButton: { paddingVertical: 6, paddingHorizontal: 12, backgroundColor: '#2196F3', borderRadius: 4 },
  addStepButtonText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  stepCard: { backgroundColor: '#f9f9f9', borderLeftWidth: 4, borderLeftColor: '#2196F3', padding: 12, marginBottom: 8, borderRadius: 4 },
  stepNumber: { fontSize: 13, fontWeight: '600', color: '#666', marginBottom: 10 },
  stepInputRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-end' },
  stepInput: { flex: 1, marginBottom: 0 },
  removeStepButton: { paddingVertical: 8, paddingHorizontal: 10, backgroundColor: '#FFE5E5', borderRadius: 4, justifyContent: 'center' },
  removeStepButtonText: { color: '#FF6B6B', fontSize: 12, fontWeight: '600' },
  statusConnected: { color: '#4CAF50' },
  statusDisconnected: { color: '#FF6B6B' },
  statusRunning: { color: '#4CAF50' },
  statusNotRunning: { color: '#FFA500' },
  errorText: { color: '#FF6B6B' },
});
