# Adlar Heat Pump Modbus - Project Context

This is a Homey Pro app developed in TypeScript that provides local Modbus TCP control and advanced optimization for Adlar Castra and Aurora II heat pumps.

## Project Overview

- **Target Device:** Adlar Castra / Aurora II series heat pumps.
- **Communication:** Modbus TCP (Local network, no cloud dependency).
- **Technology Stack:**
  - **Runtime:** Node.js (Homey Pro SDK 3)
  - **Language:** TypeScript
  - **Modbus Library:** `jsmodbus`
  - **Tooling:** ESLint, Prettier, TypeScript Compiler (`tsc`)

## Architecture

The project follows a service-oriented architecture centered around the Homey Device lifecycle.

### Core Components

1.  **`MyApp` (`app.ts`):** The main entry point. Initializes global services like `Logger`, `SelfHealingRegistry`, and `DashboardService`.
2.  **`AdlarModbusDevice` (`drivers/intelligent-heatpump-modbus/device.ts`):** The primary device controller. It manages Homey capabilities, settings, and delegates hardware interaction to the `ServiceCoordinator`.
3.  **`ServiceCoordinator` (`lib/services/service-coordinator.ts`):** The orchestrator for all background services. It manages the Modbus connection, polling, and coordinates data flow between the hardware and higher-level logic.
4.  **`Adlar2ModbusService` (`lib/modbus/adlar2-modbus-service.ts`):** Handles the low-level Modbus TCP communication, including register mapping, polling cycles (superfast, fast, medium, slow), and snapshot generation.
5.  **Adaptive Control (`lib/adaptive/`):** A collection of specialized services for performance optimization:
    - `BuildingModelLearner`: Learns thermal characteristics of the building.
    - `EnergyPriceOptimizer`: Adjusts setpoints based on dynamic electricity prices.
    - `COPOptimizer`: Optimizes for maximum efficiency.
    - `HeatingController`: The main control loop for adaptive temperature management.
6.  **Dashboard Service (`lib/services/dashboard-service.ts`):** Serves local HTML dashboards (found in `public/`) for live monitoring and expert-level register access.

### Data Flow

1.  `Adlar2ModbusService` polls registers and creates a `DataSnapshot`.
2.  `ServiceCoordinator` receives the snapshot and notifies interested services.
3.  `AdlarModbusDevice.applyModbusSnapshot()` updates Homey capability values based on the snapshot.
4.  Adaptive control services analyze snapshots and may issue write commands via the coordinator.

## Development and Building

### Key Commands

- **Build:** `npm run build` (Runs `tsc` to compile TypeScript).
- **Lint:** `npm run lint` (Runs `eslint`).
- **Run (Development):** `homey app run` (Requires Homey CLI).
- **Install:** `homey app install` (Requires Homey CLI).
- **Simulation Testing:** The `test/` directory contains scripts like `test-modbus-service.ts` and `test-sim-registers.ts` that can be run with `tsx` to simulate Modbus communication without hardware.

### Environment Variables

- `DEBUG=1`: Enables the debug inspector and sets the default log level to DEBUG.

## Development Conventions

- **Surgical Updates:** When modifying capabilities or Modbus logic, ensure consistency between `app.json` (manifest), `device.ts` (mapping), and `adlar-modbus-registers.ts` (addresses).
- **Service Pattern:** New business logic should be implemented as a service and registered within the `ServiceCoordinator`.
- **Logging:** Always use the structured `Logger` class. Avoid `console.log`.
- **Type Safety:** Maintain strict TypeScript types for snapshots and register values.
- **Safety First:** Modbus writes should be validated against safe ranges to prevent hardware damage.

## Key Files

- `app.ts`: App lifecycle and global services.
- `drivers/intelligent-heatpump-modbus/device.ts`: Homey device logic and capability mapping.
- `lib/modbus/adlar-modbus-registers.ts`: The source of truth for Modbus addresses and scaling.
- `lib/modbus/adlar2-modbus-service.ts`: Core Modbus polling and communication logic.
- `lib/services/service-coordinator.ts`: Orchestration of all background services.
- `.homeycompose/app.json`: Manifest for capabilities, flows, and app metadata.
