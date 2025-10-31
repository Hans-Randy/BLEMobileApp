# Treatment Screen

The `TreatmentScreen` component provides a comprehensive UI for managing BUDDHA device treatments and monitoring device status.

## Features

### Connection Management
- **Scan & Connect**: Automatically scans for and connects to BUDDHA devices (with "BUDD" name prefix)
- **Disconnect**: Safely disconnect from the device
- **Connection Status**: Real-time connection status indicator

### Device Information Display
- Hardware and firmware versions
- Battery level percentage
- Charger connection status
- Real-time device polling (every 2 seconds when connected)

### Treatment Status Monitoring
- **Current Status**: Running, Stopped, Paused, or Error states
- **Remaining Time**: Real-time countdown of treatment duration
- **Total Duration**: Configured total treatment duration
- **Intensity**: Current intensity percentage
- **Error Codes**: Displays error codes if any issues occur

### Treatment Control
- **Start**: Begin a configured treatment
- **Stop**: Stop an active treatment

### Treatment Configuration
- **Total Duration**: Set the total treatment duration in milliseconds (1+ ms)
- **Intensity**: Set the overall intensity percentage (0-100%)
- **Treatment Steps**: Configure individual treatment steps with:
  - **Amplitude**: Amplitude percentage for the step (0-100%)
  - **Duration**: Duration of the step in milliseconds (1-65535 ms)

#### Step Management
- **Add Step**: Add additional treatment steps
- **Remove Step**: Remove steps (minimum 1 step required)
- **Send Treatment**: Send the configured treatment to the device

## Usage

1. **Connect to Device**: Press "Connect" and wait for the device to be discovered
2. **Configure Treatment**:
   - Set desired total duration in milliseconds
   - Set desired intensity level (0-100%)
   - Add/remove treatment steps as needed
   - Each step has an amplitude and duration
3. **Send Treatment**: Press "Send Treatment" to upload the configuration to the device
4. **Start Treatment**: Press "Start" to begin the treatment
5. **Monitor**: Watch the remaining time and status update in real-time
6. **Stop**: Press "Stop" to halt an active treatment

## Input Validation

The screen includes validation for all inputs:
- **Amplitude**: 0-100%
- **Duration**: 1-65535 ms per step
- **Intensity**: 0-100%
- **Total Duration**: 1+ ms

## Real-time Updates

The screen receives real-time updates via subscriptions to:
- Battery level changes
- Treatment status changes
- Remaining time updates

Additionally, it polls for a comprehensive status update every 2 seconds when connected.

## Error Handling

- Connection failures show alerts with error details
- Invalid input values trigger validation error messages
- Device communication errors are logged and reported to the user
- Error codes from the device are displayed in the treatment status section
