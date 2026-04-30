import { SerialPort } from "serialport";
import { InclinationParser } from "./inclination.js";
import { createServer } from "http";
import { Server } from "socket.io";

const SENSOR_PORT = "/dev/ttyUSB0";
const OUTPUT_RATE = 100; // Hz

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

/**
 * Send command to WIT sensor
 */
async function sendCommand(command) {
  return new Promise((resolve, reject) => {
    if (!port || !port.isOpen) {
      reject(new Error("Port not open"));
      return;
    }
    port.write(command, (err) => {
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
async function configureSensor() {
  try {
    console.log(
      "Configuring sensor for 100Hz acceleration + inclination output...",
    );

    // Unlock sensor
    await sendCommand(Buffer.from([0xff, 0xaa, 0x69, 0x88, 0xb5]));
    console.log("✓ Sensor unlocked");

    // Set output rate to 100Hz (register 0x03, value 0x09 = 100Hz)
    await sendCommand(Buffer.from([0xff, 0xaa, 0x03, 0x09, 0x00]));
    console.log("✓ Output rate set to 100Hz");

    // Configure output content: acceleration + inclination (0x0a = ACC|ANG)
    // Register 0x02: bit 1=ANG, bit 3=ACC
    await sendCommand(Buffer.from([0xff, 0xaa, 0x02, 0x0a, 0x00]));
    console.log("✓ Output content set to acceleration + inclination");

    // Set baud rate to 115200 (register 0x04, value 0x06 = 115200)
    await sendCommand(Buffer.from([0xff, 0xaa, 0x04, 0x06, 0x00]));
    console.log("✓ Baud rate set to 115200");

    // Save configuration
    await sendCommand(Buffer.from([0xff, 0xaa, 0x00, 0x00, 0x00]));
    console.log("✓ Configuration saved");
  } catch (error) {
    console.error("✗ Configuration error:", error.message);
    process.exit(1);
  }
}

/**
 * Connect to the sensor
 */
async function connectToSensor() {
  try {
    console.log(`Connecting to sensor on ${SENSOR_PORT}...`);

    port = new SerialPort({
      path: SENSOR_PORT,
      baudRate: 115200,
    });

    parser = port.pipe(new InclinationParser());

    port.on("open", async () => {
      isConnected = true;
      console.log(`✓ Connected to ${SENSOR_PORT}`);

      // Configure sensor
      await configureSensor();

      io.emit("status", {
        connected: true,
        port: SENSOR_PORT,
        frequency: OUTPUT_RATE,
        dataType: "acceleration + inclination",
      });
      console.log(
        "Server ready. Broadcasting acceleration + inclination data at 100Hz",
      );
    });

    parser.on("data", (data) => {
      // Emit combined acceleration and inclination data
      if (
        data.accX !== undefined &&
        data.accY !== undefined &&
        data.accZ !== undefined &&
        data.roll !== undefined &&
        data.pitch !== undefined &&
        data.yaw !== undefined
      ) {
        const sensorData = {
          acceleration: {
            x: data.accX,
            y: data.accY,
            z: data.accZ,
          },
          inclination: {
            roll: data.roll,
            pitch: data.pitch,
            yaw: data.yaw,
          },
          timestamp: Date.now(),
        };
        io.emit("sensor-data", sensorData);
        console.log(
          `Acc: [${sensorData.acceleration.x.toFixed(2)}, ${sensorData.acceleration.y.toFixed(2)}, ${sensorData.acceleration.z.toFixed(2)}] g | ` +
            `Incl: Roll=${sensorData.inclination.roll.toFixed(2)}° Pitch=${sensorData.inclination.pitch.toFixed(2)}° Yaw=${sensorData.inclination.yaw.toFixed(2)}°`,
        );
      }
    });

    port.on("error", (error) => {
      console.error(`✗ Port error: ${error.message}`);
      isConnected = false;
      io.emit("status", { connected: false, port: null });
    });

    port.on("close", () => {
      console.log("✗ Port closed");
      isConnected = false;
      io.emit("status", { connected: false, port: null });
    });
  } catch (error) {
    console.error(`✗ Failed to connect: ${error.message}`);
    process.exit(1);
  }
}

// Start the connection
console.log("Inclination sensor server (10Hz, fixed port)");
console.log("=".repeat(50));
connectToSensor();
