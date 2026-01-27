import { SerialPort } from "serialport";
import { InclinationParser } from "./inclination.js";
import { createServer } from "http";
import { Server } from "socket.io";

const port = new SerialPort({
  path: "/dev/ttyUSB0",
  baudRate: 9600, // Assuming default, may need to adjust
});

const parser = port.pipe(new InclinationParser());

const server = createServer();
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

server.listen(10001);

let latestData = null;

parser.on("data", (data) => {
  latestData = data;
  // Emit to all connected clients
  io.emit("inclination", data);
});

// Display 5 times per second
setInterval(() => {
  if (latestData) {
    console.log(
      `Roll: ${latestData.roll.toFixed(2)}°, Pitch: ${latestData.pitch.toFixed(2)}°, Yaw: ${latestData.yaw.toFixed(2)}°`,
    );
  }
}, 200);

console.log("Inclination sensor server started on port 10001");
