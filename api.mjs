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
 * Send command to WIT sensor
 */
async function sendCommand(serialPort, command) {
  return new Promise((resolve, reject) => {
    if (!serialPort || !serialPort.isOpen) {
      reject(new Error("Port not open"));
      return;
    }
    serialPort.write(command, (err) => {
      if (err) reject(err);
      else {
        setTimeout(() => resolve(), 100);
      }
    });
  });
}

/**
 * Configure sensor for 100Hz output with acceleration and inclination
 */
async function configureSensor(serialPort) {
  try {
    console.log(
      "Configuring sensor for 100Hz acceleration + inclination output...",
    );

    // Unlock sensor
    await sendCommand(serialPort, Buffer.from([0xff, 0xaa, 0x69, 0x88, 0xb5]));
    console.log("✓ Sensor unlocked");

    // Set output rate to 100Hz (register 0x03, value 0x09 = 100Hz)
    await sendCommand(serialPort, Buffer.from([0xff, 0xaa, 0x03, 0x09, 0x00]));
    console.log("✓ Output rate set to 100Hz");

    // Configure output content: acceleration + inclination (0x0a = ACC|ANG)
    // Register 0x02: bit 1=ANG, bit 3=ACC
    await sendCommand(serialPort, Buffer.from([0xff, 0xaa, 0x02, 0x0a, 0x00]));
    console.log("✓ Output content set to acceleration + inclination");

    // Set baud rate to 115200 (register 0x04, value 0x06 = 115200)
    await sendCommand(serialPort, Buffer.from([0xff, 0xaa, 0x04, 0x06, 0x00]));
    console.log("✓ Baud rate set to 115200");

    // Save configuration
    await sendCommand(serialPort, Buffer.from([0xff, 0xaa, 0x00, 0x00, 0x00]));
    console.log("✓ Configuration saved");
    return true;
  } catch (error) {
    console.error("✗ Configuration error:", error.message);
    return false;
  }
}

/**
 * Test if a port has the inclination sensor by checking for valid packets
 */
async function testPort(portPath, baudRate = 115200) {
  return new Promise((resolve) => {
    let testPort;
    let timeoutId;
    let packetReceived = false;

    try {
      testPort = new SerialPort({ path: portPath, baudRate });

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
  console.log("Detecting inclination sensor at 115200 baud...");
  const availablePorts = await listSerialPorts();

  if (availablePorts.length === 0) {
    console.warn("No USB serial ports found. Retrying in 5 seconds...");
    return null;
  }

  console.log(
    `Found ${availablePorts.length} USB port(s): ${availablePorts.join(", ")}`,
  );

  // First, try to find sensor at 115200 baud
  for (const portPath of availablePorts) {
    console.log(`Testing ${portPath} at 115200 baud...`);
    const hasValidSensor = await testPort(portPath, 115200);
    if (hasValidSensor) {
      console.log(`✅ Sensor detected on ${portPath} at 115200 baud`);
      return portPath;
    }
  }

  console.log(
    "No sensor found at 115200 baud. Trying 9600 baud for configuration...",
  );

  // Try to find sensor at 9600 baud for configuration
  for (const portPath of availablePorts) {
    console.log(`Testing ${portPath} at 9600 baud...`);
    const hasValidSensor = await testPort(portPath, 9600);
    if (hasValidSensor) {
      console.log(
        `✅ Sensor detected on ${portPath} at 9600 baud. Configuring...`,
      );

      // Open port and configure
      try {
        const configPort = new SerialPort({
          path: portPath,
          baudRate: 9600,
        });

        await new Promise((resolve) => {
          configPort.on("open", async () => {
            console.log(`Connected to ${portPath} for configuration`);
            const success = await configureSensor(configPort);

            // Close port after configuration
            configPort.close();
            if (success) {
              console.log(
                "Configuration complete. Waiting for sensor at 115200 baud...",
              );
              // Wait a bit for sensor to restart with new baud rate
              setTimeout(resolve, 2000);
            } else {
              resolve();
            }
          });

          configPort.on("error", () => {
            console.error(`Failed to open ${portPath} for configuration`);
            resolve();
          });
        });

        // Now re-scan for the sensor at 115200 baud after configuration
        console.log(
          "Re-scanning ports for configured sensor at 115200 baud...",
        );
        for (const retryPort of availablePorts) {
          console.log(`Re-testing ${retryPort} at 115200 baud...`);
          const configuredSensor = await testPort(retryPort, 115200);
          if (configuredSensor) {
            console.log(`✅ Configured sensor detected on ${retryPort}`);
            return retryPort;
          }
        }

        console.warn(
          "Sensor was configured but not detected at 115200. Retrying full detection...",
        );
        return null;
      } catch (error) {
        console.error(`Failed to configure sensor: ${error.message}`);
      }
    }
  }

  console.warn("No inclination sensor detected. Retrying in 5 seconds...");
  return null;
}

/**
 * Connect to the sensor port
 */

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
