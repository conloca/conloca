'use strict';

require('../forgejo-artifact.cjs').run({
  repository: 'https://code.forgejo.org/forgejo/download-artifact',
  commit: '769f970437aa3291b13f35dc23fc87967d7fb19f', // v7
  entry: 'dist/index.js',
});
