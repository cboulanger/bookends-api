const util = require('util');
const osascript = require('node-osascript');
const fs = require('fs');
const { spawn } = require('child_process');
const bookendsExecutablePath = '/Applications/Bookends.app/Contents/MacOS/Bookends';
const bookendsLibraryPath = __dirname + '/bookends.bdb';
const process = require('process');

module.exports = {
  before : async function() {
    fs.copyFileSync( bookendsLibraryPath + '.dist', bookendsLibraryPath );
    this.bookendsProcess = spawn(bookendsExecutablePath, [bookendsLibraryPath]);
    await new Promise(resolve => setTimeout( () => resolve(), 5000));
  }, 
  after: async function() {
    this.bookendsProcess.kill();
    fs.unlinkSync(bookendsLibraryPath);
    fs.unlinkSync(bookendsLibraryPath + ".journal");
  }
};  