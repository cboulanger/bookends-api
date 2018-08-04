const util = require('util');
const osascript = require('node-osascript');
const fs = require('fs');
const { spawn } = require('child_process');
const bookendsExecutablePath = '/Applications/Bookends.app/Contents/MacOS/Bookends';
const process = require('process');

module.exports = {
  before : async function() {
    if( ! (process.env.ZOTERO_API_KEY
    && process.env.ZOTERO_USER_ID
    && process.env.ZOTERO_GROUP_ID
    && process.env.BOOKENDS_ATTACHMENT_PATH ) ) {
      throw new Error('Please rename .env.dist into .env and set the environment variables.');
    }
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