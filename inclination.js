import { Transform } from "stream";

export class InclinationParser extends Transform {
  constructor(options = {}) {
    super({ ...options, objectMode: true });
    this.buffer = Buffer.alloc(0);
    this.currentData = {}; // Store incomplete data
  }

  _transform(chunk, encoding, callback) {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (this.buffer.length >= 11) {
      const start = this.buffer.indexOf(0x55);
      if (start === -1) {
        // No header found, discard all
        this.buffer = Buffer.alloc(0);
        break;
      }

      if (start + 11 > this.buffer.length) {
        // Not enough data, wait
        break;
      }

      const packet = this.buffer.slice(start, start + 11);
      this.buffer = this.buffer.slice(start + 11);

      // Verify checksum
      let sum = 0;
      for (let i = 0; i < 10; i++) {
        sum += packet[i];
      }
      sum &= 0xff;

      if (sum === packet[10]) {
        // Valid packet
        const packetType = packet[1];

        if (packetType === 0x51) {
          // Acceleration data (ACC)
          // console.log(packet);
          // const accX = (((packet[3] << 8) | packet[2]) / 32768) * 16; // in g
          // const accY = (((packet[5] << 8) | packet[4]) / 32768) * 16; // in g
          // const accZ = (((packet[7] << 8) | packet[6]) / 32768) * 16; // in g

          // Proper signed 16-bit handling
          let rawAccX = (packet[3] << 8) | packet[2];
          let rawAccY = (packet[5] << 8) | packet[4];
          let rawAccZ = (packet[7] << 8) | packet[6];

          // Sign extend from 16-bit to 32-bit
          rawAccX = (rawAccX << 16) >> 16;
          rawAccY = (rawAccY << 16) >> 16;
          rawAccZ = (rawAccZ << 16) >> 16;

          const accX = (rawAccX / 32768) * 16; // in g
          const accY = (rawAccY / 32768) * 16; // in g
          const accZ = (rawAccZ / 32768) * 16; // in g
          this.currentData.accX = accX;
          this.currentData.accY = accY;
          this.currentData.accZ = accZ;
        } else if (packetType === 0x53) {
          // Angle/Inclination data (ANG)
          const roll = (((packet[3] << 8) | packet[2]) / 32768) * 180;
          const pitch = (((packet[5] << 8) | packet[4]) / 32768) * 180;
          const yaw = (((packet[7] << 8) | packet[6]) / 32768) * 180;
          this.currentData.roll = roll;
          this.currentData.pitch = pitch;
          this.currentData.yaw = yaw;

          // Emit when we have both acceleration and angle data
          if (
            this.currentData.accX !== undefined &&
            this.currentData.accY !== undefined &&
            this.currentData.accZ !== undefined
          ) {
            this.push({
              accX: this.currentData.accX,
              accY: this.currentData.accY,
              accZ: this.currentData.accZ,
              roll: this.currentData.roll,
              pitch: this.currentData.pitch,
              yaw: this.currentData.yaw,
            });
            this.currentData = {};
          }
        }
      }
      // Else discard invalid packet
    }

    callback();
  }
}
