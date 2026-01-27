import { Transform } from "stream";

export class InclinationParser extends Transform {
  constructor(options = {}) {
    super({ ...options, objectMode: true });
    this.buffer = Buffer.alloc(0);
  }

  _transform(chunk, encoding, callback) {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (this.buffer.length >= 11) {
      const start = this.buffer.indexOf(Buffer.from([0x55, 0x53]));
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
        const roll = (((packet[3] << 8) | packet[2]) / 32768) * 180;
        const pitch = (((packet[5] << 8) | packet[4]) / 32768) * 180;
        const yaw = (((packet[7] << 8) | packet[6]) / 32768) * 180;
        const version = (packet[9] << 8) | packet[8];

        this.push({ roll, pitch, yaw, version });
      }
      // Else discard invalid packet
    }

    callback();
  }
}
