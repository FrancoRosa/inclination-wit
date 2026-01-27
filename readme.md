# inclination

> This repo contains a nodejs script `api.mjs` that reads inclination value from the sensor

## Main goal

The api.mjs automatically detects the inclination sensor, then reads it using serialport library and lineparser (preferible), then displays the inclination value 5 times per second and emits it over websocekts on port 100001

## About the project

This project contains a library based on the protocol pdf file on this repository then the api.mjs uses that library to decode the inclination information
