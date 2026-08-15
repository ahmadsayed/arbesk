'use strict';
const renderTs = require('./render-ts');
renderTs().catch((err) => {
    console.error('### ERROR: TS emit failed', err);
    process.exit(1);
});
