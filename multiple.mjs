import { SerialPort } from "serialport";
import { InclinationParser } from "./inclination.js";
import { createServer } from "http";
import { Server } from "socket.io";

const SCAN_INTERVAL_MS = 2000;
const BAUD_RATE = 9600;
const SOCKET_PORT = 10002;
const PORT_FILTER = /tty(USB|ACM|AMA)|usbserial|cu\.usb|cu\.acm/i;

const server = createServer();
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

server.listen(SOCKET_PORT, () => {
  console.log(`Socket.IO server listening on port ${SOCKET_PORT}`);
});

const sensors = new Map();

function buildPayload() {
  const activeSensors = [...sensors.values()]
    .filter((sensor) => sensor.isActive && sensor.lastReading)
    .sort((a, b) => a.path.localeCompare(b.path));

  const payload = {};

  activeSensors.forEach((sensor, index) => {
    payload[`dev${index + 1}`] = {
      x: sensor.lastReading.roll,
      y: sensor.lastReading.pitch,
      z: sensor.lastReading.yaw,
    };
  });

  return payload;
}

function emitSensorPayload() {
  const payload = buildPayload();
  console.log({ payload });
  io.emit("sensors", payload);
}

function emitStatus() {
  const activePaths = [...sensors.values()]
    .filter((sensor) => sensor.isActive)
    .map((sensor) => sensor.path);

  io.emit("status", {
    connected: activePaths.length > 0,
    devices: activePaths,
  });
}

function removeSensor(path, reason) {
  const sensor = sensors.get(path);
  if (!sensor) return;

  console.log(`Sensor removed: ${path}${reason ? ` (${reason})` : ""}`);

  sensor.parser?.removeAllListeners();
  sensor.port?.removeAllListeners();
  if (sensor.port.isOpen) {
    sensor.port.close(() => {
      /* closed */
    });
  }

  sensors.delete(path);
  emitStatus();
  emitSensorPayload();
}

function connectSensor(path) {
  if (sensors.has(path)) return;

  console.log(`Found new sensor port: ${path}. Attempting to connect.`);

  const port = new SerialPort({ path, baudRate: BAUD_RATE, autoOpen: true });
  const parser = port.pipe(new InclinationParser());
  const sensor = {
    path,
    port,
    parser,
    isActive: false,
    lastReading: null,
  };

  sensors.set(path, sensor);

  port.on("open", () => {
    sensor.isActive = true;
    console.log(`Connected sensor at ${path}`);
    emitStatus();
  });

  parser.on("data", (data) => {
    if (
      data.roll === undefined ||
      data.pitch === undefined ||
      data.yaw === undefined
    ) {
      return;
    }

    sensor.lastReading = {
      roll: Number(data.roll),
      pitch: Number(data.pitch),
      yaw: Number(data.yaw),
    };

    emitSensorPayload();
  });

  port.on("error", (error) => {
    console.error(`Port error on ${path}: ${error.message}`);
    sensor.isActive = false;
    emitStatus();
  });

  port.on("close", () => {
    console.log(`Port closed: ${path}`);
    removeSensor(path, "disconnected");
  });
}

async function scanForSensors() {
  try {
    const ports = await SerialPort.list();
    const available = ports
      .map((port) => port.path)
      .filter((path) => PORT_FILTER.test(path));

    available.forEach((path) => {
      if (!sensors.has(path)) {
        connectSensor(path);
      }
    });

    // Attempt to remove sensors whose ports are no longer available.
    [...sensors.keys()].forEach((path) => {
      if (!available.includes(path)) {
        removeSensor(path, "port disappeared");
      }
    });
  } catch (error) {
    console.error("Failed to scan ports:", error.message);
  }
}

setInterval(scanForSensors, SCAN_INTERVAL_MS);
scanForSensors();

console.log("Multiple sensor scanner starting...");
console.log("Searching for available 9600 baud inclination sensors...");
