'use strict';
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const run = promisify(execFile);

async function youtubeShare(id) {
  if (typeof id !== 'string' || id.length !== 11 || !/^[A-Za-z0-9_-]+$/.test(id))
    throw new Error('Ungültiges YouTube-Video.');
  const url = 'https://youtu.be/' + id;
  let image = null;
  try {
    const { stdout } = await run('/usr/bin/qrencode', ['-t', 'PNG', '-s', '8', '-m', '4', '-o', '-', url], {
      encoding: 'buffer', timeout: 3000, maxBuffer: 32768,
    });
    image = 'data:image/png;base64,' + stdout.toString('base64');
  } catch {
    // The official link is still available if an older installation lacks qrencode.
  }
  return { url, image };
}

module.exports = { youtubeShare };
