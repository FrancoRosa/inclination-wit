# inclination

> This repo contains a nodejs script `api.mjs` that reads inclination value from the sensor

## Main goal

The api.mjs automatically detects the inclination sensor, then reads it using serialport library and lineparser (preferible), then displays the inclination value 5 times per second and emits it over Socket.IO on port 10001

## About the project

This project contains a library based on the protocol pdf file on this repository then the api.mjs uses that library to decode the inclination information

## Installation

1. Ensure Node.js is installed.
2. Run `npm install` to install dependencies.

## Running

1. Connect the sensor to `/dev/ttyUSB0`.
2. Run `npm start` or `node api.mjs`.
3. The server will start on port 10001, emitting inclination data (roll, pitch, yaw) over Socket.IO.
4. Console will display the values 5 times per second.

## Dependencies

- serialport: For serial communication
- socket.io: For real-time communication
- @serialport/parser-delimiter: For parsing binary data
