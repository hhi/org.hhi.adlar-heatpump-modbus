Adlar Castra Heat Pump (Modbus)

This app gives Homey Pro local Modbus TCP access to an Adlar Castra / Aurora II heat pump through an Elfin EW11A or another Modbus TCP to RS485 gateway. Daily operation does not depend on cloud access.

Current implementation status

- Pairing uses only the Modbus gateway details: IP address, TCP port (default 502) and Modbus Unit ID (default 1).
- The old Tuya fields such as Device ID, Local Key and protocol version are not used in this Modbus app.
- Polling intervals are configurable in the device settings (default superfast/fast/medium/slow: 5 s / 10 s / 30 s / 300 s). Superfast polling can adapt to 2 s after live value changes.
- The current register mapping is aimed at Adlar Castra / Aurora II units that use the R32 Modbus register map.
- Temperature register scaling is detected automatically from the refrigerant type (P119): R32 uses x1 (°C), R290 uses x10 (deci-°C).

Requirements

- Homey Pro with firmware 12.2.0 or newer
- Adlar Castra / Aurora II heat pump with Modbus/RS485 connection
- Modbus TCP gateway such as an Elfin EW11A

What works today

Readout
- Heating, cooling, DHW and floor heating setpoints
- Outlet, inlet, ambient, coil, suction, exhaust, DHW, economizer, saturation, buffer and zone temperatures
- Power, energy, voltage, current, compressor frequency, fan speed, EEV step, pump PWM and water flow
- Running state, defrost, antifreeze, sterilization and decoded fault information
- Local dashboards at http://<homey-ip>:8090/ by default, including an expert register dashboard that shows Modbus addresses plus P/L parameter IDs such as P88 and L28

Control from Homey
- Main on/off
- Operating mode and work mode
- Heating setpoint
- Cooling setpoint
- DHW setpoint
- Heating curve preset and hot water curve preset
- Desired indoor temperature for adaptive control
- Direct Modbus register read/write flow cards and a DIY heating curve flow card

Calculated values
- COP based on Modbus power, water temperature delta and water flow
- External power, flow, ambient, indoor temperature, energy prices, solar power, solar radiation and wind data can be supplied via flow cards
- Threshold, alert and fault flow cards are available for monitored Modbus values

Current limitations

- A Modbus TCP gateway is required; this app does not use Tuya cloud or Tuya local credentials.
- The floor heating setpoint is read, displayed and writable from the device capability; there is no dedicated flow action for it yet.
- Advanced Modbus write tools are available through flow cards and the expert dashboard; use them with care.
- COP can be missing or less accurate when usable power or flow data is unavailable.
- The code warns when the detected refrigerant is not R32, so other register maps are not the target of this version.

Installation

1. Connect the heat pump RS485/Modbus bus to an Elfin EW11A or equivalent Modbus TCP gateway.
2. Make sure the gateway is reachable from Homey on the local network.
3. Add the "Adlar Castra Heat Pump" device in Homey.
4. Enter the gateway IP address, TCP port and Modbus Unit ID.
5. Optionally adjust polling intervals and other device settings after pairing.

For the full setup procedure for connecting the heat pump via a Modbus TCP gateway, see docs/setup/README.md.

Local dashboards

Open the dashboards from a browser on the same local network as Homey:

- http://<homey-ip>:8090/ - live read-only dashboard with current heat pump values
- http://<homey-ip>:8090/interactive - interactive dashboard for common controls
- http://<homey-ip>:8090/expert - expert register dashboard with Modbus addresses, P/L parameter IDs and live read/write tools
- http://<homey-ip>:8090/heating-curve - DIY heating curve editor

Replace <homey-ip> with the IP address of your Homey Pro. Use the expert dashboard with care: writable Modbus registers can change heat pump behaviour.
The default dashboard port is 8090; if you changed the Dashboard port setting, use that port in the URL instead.

Device settings

- IP address of the Modbus gateway
- TCP port
- Modbus Unit ID
- Dashboard port (default 8090)
- Superfast, fast, medium and slow polling intervals
- Log level

Practical notes

- Recommended defaults: port 502, Unit ID 1.
- Give the gateway a fixed DHCP lease or static IP address to avoid reconnect issues.
