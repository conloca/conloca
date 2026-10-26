'use strict';

require('../forgejo-artifact.cjs').run({
  repository: 'https://code.forgejo.org/forgejo/upload-artifact',
  commit: 'cb8afe72b42edc798abfb8fcb556cf660d894245', // v5
  entry: 'dist/upload/index.js',
});
