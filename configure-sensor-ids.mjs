import { SerialPort } from "serialport";
import readline from "node:readline/promises";
import { InclinationParser } from "./inclination.js";
import fs from "node:fs/promises";
import path from "node:path";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const OUTPUT_MODE_LOW = 0x03;
const OUTPUT_MODE_HIGH = 0x02;
const D0_MODE_REGISTER = 0x0e;
const D1_MODE_REGISTER = 0x0f;
const D2_MODE_REGISTER = 0x10;
const D3_MODE_REGISTER = 0x11;
const SAVE_REGISTER = 0x00;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function listSerialPorts() {
  try {
    const ports = await SerialPort.list();
    return ports
      .filter((port) => port.path.includes("/dev/ttyUSB"))
      .map((port) => port.path)
      .sort();
  } catch (error) {
    console.error("Error listing serial ports:", error.message);
    return [];
  }
}

async function sendCommand(serialPort, command) {
  return new Promise((resolve, reject) => {
    if (!serialPort || !serialPort.isOpen) {
      reject(new Error("Port not open"));
      return;
    }

    serialPort.write(command, (error) => {
      if (error) {
        reject(error);
        return;
      }
      setTimeout(resolve, 100);
    });
  });
}

async function openPort(portPath, baudRate = 115200) {
  return new Promise((resolve, reject) => {
    const port = new SerialPort({ path: portPath, baudRate });
    port.once("open", () => resolve(port));
    port.once("error", (error) => reject(error));
  });
}

async function configureDigitalOutputs(portPath, pattern) {
  const port = await openPort(portPath);
  const parser = port.pipe(new InclinationParser());

  try {
    await sendCommand(port, Buffer.from([0xff, 0xaa, 0x69, 0x88, 0xb5]));

    const registers = [
      { register: D0_MODE_REGISTER, value: pattern.d0 === 1 ? OUTPUT_MODE_HIGH : OUTPUT_MODE_LOW },
      { register: D1_MODE_REGISTER, value: pattern.d1 === 1 ? OUTPUT_MODE_HIGH : OUTPUT_MODE_LOW },
      { register: D2_MODE_REGISTER, value: pattern.d2 === 1 ? OUTPUT_MODE_HIGH : OUTPUT_MODE_LOW },
      { register: D3_MODE_REGISTER, value: pattern.d3 === 1 ? OUTPUT_MODE_HIGH : OUTPUT_MODE_LOW },
    ];

    for (const { register, value } of registers) {
      await sendCommand(port, Buffer.from([0xff, 0xaa, register, value, 0x00]));
    }

    await sendCommand(port, Buffer.from([0xff, 0xaa, SAVE_REGISTER, 0x00, 0x00]));
    await sleep(500);

    const status = await readDigitalStatus(portPath);
    return status;
  } finally {
    parser.removeAllListeners();
    if (port.isOpen) {
      port.close();
    }
  }
}

async function readDigitalStatus(portPath, timeoutMs = 2500) {
  const port = await openPort(portPath);
  const parser = port.pipe(new InclinationParser());

  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      cleanup();
      resolve(null);
    }, timeoutMs);

    const onData = (data) => {
      if (data.sensorId !== undefined) {
        clearTimeout(timeoutId);
        cleanup();
        resolve(data);
      }
    };

    const cleanup = () => {
      parser.off("data", onData);
      if (port.isOpen) {
        port.close();
      }
    };

    parser.on("data", onData);
  });
}

async function selectPort(availablePorts) {
  if (availablePorts.length === 0) {
    return null;
  }

  if (availablePorts.length === 1) {
    return availablePorts[0];
  }

  console.log("Available ports:");
  availablePorts.forEach((portPath, index) => {
    console.log(`  ${index + 1}. ${portPath}`);
  });

  const answer = (await rl.question("Select a port by number or path: ")).trim();
  const numericAnswer = Number(answer);

  if (!Number.isNaN(numericAnswer) && numericAnswer >= 1 && numericAnswer <= availablePorts.length) {
    return availablePorts[numericAnswer - 1];
  }

  return availablePorts.find((portPath) => portPath === answer) ?? null;
}

function buildPattern(sensorId) {
  return {
    d0: sensorId & 0x01,
    d1: (sensorId >> 1) & 0x01,
    d2: (sensorId >> 2) & 0x01,
    d3: (sensorId >> 3) & 0x01,
  };
}

async function promptForSensorCount() {
  const answer = (await rl.question("How many sensors do you want to configure? [4]: ")).trim();
  const parsed = Number(answer || "4");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 4;
}

async function main() {
  console.log("=== Sensor ID configuration ===");
  console.log("This script will guide you through assigning each sensor an ID using the D0-D3 outputs.");

  const sensorCount = await promptForSensorCount();
  const configuredSensors = [];

  for (let sensorId = 0; sensorId < sensorCount; sensorId += 1) {
    const pattern = buildPattern(sensorId);
    console.log(`\nSensor ID ${sensorId}`);
    console.log(`Expected outputs: D0=${pattern.d0}, D1=${pattern.d1}, D2=${pattern.d2}, D3=${pattern.d3}`);

    const shouldSkip = (await rl.question("Connect the sensor for this ID and press Enter when ready. Type 'skip' to skip this sensor: ")).trim().toLowerCase();
    if (shouldSkip === "skip" || shouldSkip === "s") {
      console.log(`Skipping sensor ID ${sensorId}.`);
      continue;
    }

    const availablePorts = await listSerialPorts();
    if (availablePorts.length === 0) {
      console.log("No USB serial ports detected. Please connect the sensor and try again.");
      sensorId -= 1;
      continue;
    }

    const selectedPort = await selectPort(availablePorts);
    if (!selectedPort) {
      console.log("No valid port selected. Skipping this sensor.");
      continue;
    }

    console.log(`Configuring ${selectedPort} with pattern D0=${pattern.d0}, D1=${pattern.d1}, D2=${pattern.d2}, D3=${pattern.d3}...`);
    const verifiedStatus = await configureDigitalOutputs(selectedPort, pattern);

    if (!verifiedStatus) {
      console.warn("No digital status packet was received. Please verify the sensor is connected and try again.");
      continue;
    }

    configuredSensors.push({
      sensorId,
      port: selectedPort,
      d0: verifiedStatus.d0,
      d1: verifiedStatus.d1,
      d2: verifiedStatus.d2,
      d3: verifiedStatus.d3,
      sensorIdValue: verifiedStatus.sensorId,
    });

    console.log(`Verified sensor ID ${sensorId}: D0=${verifiedStatus.d0}, D1=${verifiedStatus.d1}, D2=${verifiedStatus.d2}, D3=${verifiedStatus.d3} -> sensorId=${verifiedStatus.sensorId}`);
  }

  const outputPath = path.resolve(process.cwd(), "sensor-id-map.json");
  await fs.writeFile(outputPath, JSON.stringify(configuredSensors, null, 2));
  console.log(`\nSaved mapping to ${outputPath}`);
  console.log(JSON.stringify(configuredSensors, null, 2));
}

main()
  .catch((error) => {
    console.error("Configuration failed:", error);
    process.exitCode = 1;
  })
  .finally(() => {
    rl.close();
  });
