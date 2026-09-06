const fs = require('fs');
const path = require('path');

const destPath = path.resolve(__dirname, '../dist');
fs.rmSync(destPath, { recursive: true, force: true });
