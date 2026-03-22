# Adlar Castra Heat Pump (Modbus)

This app gives Homey Pro local Modbus TCP access to an Adlar Castra / Aurora II heat pump through an Elfin EW11A or another Modbus TCP to RS485 gateway. Daily operation does not depend on cloud access.

## Current Implementation Status

- Pairing uses only the Modbus gateway details: IP address, TCP port (default `502`) and Modbus Unit ID (default `1`).
- The old Tuya fields such as Device ID, Local Key and protocol version are not used in this Modbus app.
- Polling intervals are configurable in the device settings (default `10 s / 30 s / 300 s`).
- The current register mapping is aimed at Adlar Castra / Aurora II units that use the `R32` Modbus register map.

## Requirements

- Homey Pro with firmware `12.2.0` or newer
- Adlar Castra / Aurora II heat pump with Modbus/RS485 connection
- Modbus TCP gateway such as an Elfin EW11A

## What Works Today

### Readout

- Heating, cooling and DHW setpoints
- Outlet, inlet, ambient, coil, suction, exhaust, DHW, economizer, saturation, buffer and zone temperatures
- Power, energy, voltage, current, compressor frequency, fan speed, EEV step, pump PWM and water flow
- Running state, defrost, antifreeze, sterilization and decoded fault information

### Control From Homey

- Main on/off
- Operating mode
- Heating setpoint
- Cooling setpoint
- DHW setpoint

### Calculated Values

- COP based on Modbus power, water temperature delta and water flow
- If no physical flow meter is connected, a fallback flow value can be configured in the device settings

## Current Limitations

- A Modbus TCP gateway is required; this app does not use Tuya cloud or Tuya local credentials.
- The floor heating setpoint and several advanced Modbus write functions exist in the service layer, but are not yet exposed in the current Homey UI/flow implementation.
- COP can be missing or less accurate when usable power or flow data is unavailable.
- The code warns when the detected refrigerant is not `R32`, so other register maps are not the target of this version.

## Installation

1. Connect the heat pump RS485/Modbus bus to an Elfin EW11A or equivalent Modbus TCP gateway.
2. Make sure the gateway is reachable from Homey on the local network.
3. Add the `Adlar Castra Heat Pump` device in Homey.
4. Enter the gateway IP address, TCP port and Modbus Unit ID.
5. Optionally adjust the flow meter and polling settings after pairing.

## Device Settings

- IP address of the Modbus gateway
- TCP port
- Modbus Unit ID
- External flow meter connected: yes/no
- Default flow rate in `L/min` for COP fallback
- Fast, medium and slow polling intervals
- Log level

## Practical Notes

- Recommended defaults: port `502`, Unit ID `1`, fallback flow `20 L/min`.
- Give the gateway a fixed DHCP lease or static IP address to avoid reconnect issues.
