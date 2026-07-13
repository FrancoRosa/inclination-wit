import test from "node:test";
import assert from "node:assert/strict";
import { InclinationParser } from "../inclination.js";

function buildPacket(packetType, dataBytes) {
  const packet = Buffer.alloc(11);
  packet[0] = 0x55;
  packet[1] = packetType;
  for (let i = 0; i < dataBytes.length; i += 1) {
    packet[i + 2] = dataBytes[i];
  }

  let sum = 0;
  for (let i = 0; i < 10; i += 1) {
    sum += packet[i];
  }
  packet[10] = sum & 0xff;
  return packet;
}

test("parses D0-D3 status packets into digital values and a sensor id", (t) => {
  const parser = new InclinationParser();
  const events = [];

  parser.on("data", (data) => {
    events.push(data);
  });

  const packet = buildPacket(0x55, [0x01, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00]);
  parser.write(packet);

  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    d0: 1,
    d1: 0,
    d2: 1,
    d3: 0,
    sensorId: 5,
  });
});
