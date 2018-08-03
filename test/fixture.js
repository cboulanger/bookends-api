const util = require('util');
const osascript = require('node-osascript');
const fs = require('fs');
const { spawn } = require('child_process');
const bookendsExecutablePath = '/Applications/Bookends.app/Contents/MacOS/Bookends';
const process = require('process');

module.exports = {
  before : async function() {
    osascript.execute('tell application "Bookends" to quit');
    fs.copyFileSync( __dirname + '/test.dist.bdb', __dirname + '/test.bdb');
    this.bookendsProcess = spawn(bookendsExecutablePath, [__dirname + '/test.bdb']);
    console.log("Waiting for Bookends to start ...");
    await new Promise(resolve => setTimeout( () => resolve(), 10000));
  }, 
  after: async function() {
    osascript.execute('tell application "Bookends" to quit');
  }
};  