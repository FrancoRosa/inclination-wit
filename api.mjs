import { SerialPort } from "serialport";
import { InclinationParser } from "./inclination.js";
import { createServer } from "http";
import { Server } from "socket.io";

const server = createServer();
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

server.listen(10001);

let port = null;
let parser = null;
let isConnected = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 1000;
const RECONNECT_DELAY = 10000; // 2 seconds
const DETECTION_TIMEOUT = 3000; // 3 seconds to detect valid sensor

/**
 * List all available USB serial ports
 */
async function listSerialPorts() {
  try {
    const ports = await SerialPort.list();
    return ports
      .filter((p) => p.path.includes("/dev/ttyUSB"))
      .map((p) => p.path)
      .sort();
  } catch (error) {
    console.error("Error listing serial ports:", error.message);
    return [];
  }
}

/**
 * Test if a port has the inclination sensor by checking for valid packets
 */
async function testPort(portPath) {
  return new Promise((resolve) => {
    let testPort;
    let timeoutId;
    let packetReceived = false;

    try {
      testPort = new SerialPort({ path: portPath, baudRate: 115200 });

      timeoutId = setTimeout(() => {
        if (testPort && testPort.isOpen) {
          testPort.close();
        }
        resolve(packetReceived); // Return whether packet was received
      }, DETECTION_TIMEOUT);

      const testParser = testPort.pipe(new InclinationParser());

      testParser.on("data", () => {
        packetReceived = true;
        clearTimeout(timeoutId);
        testParser.destroy();
        if (testPort && testPort.isOpen) {
          testPort.close();
        }
        resolve(true);
      });

      testPort.on("error", () => {
        clearTimeout(timeoutId);
        resolve(false);
      });
    } catch (error) {
      clearTimeout(timeoutId);
      resolve(false);
    }
  });
}

/**
 * Auto-detect the correct USB port with the sensor
 */
async function detectSensorPort() {
  console.log("Detecting inclination sensor...");
  const availablePorts = await listSerialPorts();

  if (availablePorts.length === 0) {
    console.warn("No USB serial ports found. Retrying in 5 seconds...");
    return null;
  }

  console.log(
    `Found ${availablePorts.length} USB port(s): ${availablePorts.join(", ")}`,
  );

  for (const portPath of availablePorts) {
    console.log(`Testing ${portPath}...`);
    const hasValidSensor = await testPort(portPath);
    if (hasValidSensor) {
      console.log(`✅ Sensor detected on ${portPath}`);
      return portPath;
    }
  }

  console.warn("No inclination sensor detected. Retrying in 5 seconds...");
  return null;
}

/**
 * Connect to the sensor port
 */

let countf = 0;
let count = 0;
let maxAcc = 0;
let avrAcc = 0;
async function connectToSensor() {
  const detectedPort = await detectSensorPort();

  if (!detectedPort) {
    // Retry in 5 seconds
    setTimeout(connectToSensor, 5000);
    return;
  }

  try {
    port = new SerialPort({
      path: detectedPort,
      baudRate: 115200,
    });

    parser = port.pipe(new InclinationParser());

    port.on("open", () => {
      isConnected = true;
      reconnectAttempts = 0;
      console.log(`Connected to sensor on ${detectedPort}`);
      io.emit("status", { connected: true, port: detectedPort });
    });

    parser.on("data", (data) => {
      const { accX, accY, accZ } = data;
      const magAcc = Math.sqrt(accX ** 2 + accY ** 2 + accZ ** 2);
      maxAcc = Math.max(magAcc, maxAcc);
      avrAcc = magAcc + avrAcc;
      count++;
      if (count >= 20) {
        const payload = { ...data, maxAcc, avrAcc: avrAcc / 20 };
        io.emit("inclination", payload);
        console.log(payload);
        maxAcc = 0;
        avrAcc = 0;
        count = 0;
      }
    });

    port.on("error", (error) => {
      console.error(`Port error: ${error.message}`);
      handleDisconnect();
    });

    port.on("close", () => {
      handleDisconnect();
    });
  } catch (error) {
    console.error(`Failed to open port: ${error.message}`);
    handleDisconnect();
  }
}

/**
 * Handle disconnection and attempt to reconnect
 */
function handleDisconnect() {
  if (!isConnected) return; // Already disconnected

  isConnected = false;
  console.log("Sensor disconnected. Searching for sensor...");
  io.emit("status", { connected: false, port: null });

  // Clean up existing connections
  if (parser) {
    parser.destroy();
    parser = null;
  }
  if (port && port.isOpen) {
    port.close();
  }

  reconnectAttempts++;

  if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
    console.log(
      `Max reconnection attempts (${MAX_RECONNECT_ATTEMPTS}) reached.`,
    );
    // Full reset after max attempts
    reconnectAttempts = 0;
    setTimeout(connectToSensor, 10000); // Wait 10 seconds before full reset
  } else {
    // Try to reconnect in 2 seconds
    setTimeout(connectToSensor, RECONNECT_DELAY);
  }
}

// Start the connection
console.log("Inclination sensor server starting on port 10001");
connectToSensor();
