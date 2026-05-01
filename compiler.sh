 npx esbuild api.mjs  \
 --bundle   \
 --platform=node   \
 --target=node20   \
 --outfile=dist/inclination.cjs   \
 --external:serialport   \
 --external:@serialport/*