/**
 * This module implements the BibSync API for Zotero
 * @module bibsync/zotero
 */

const debug = require('debug')('bibsync-zotero');
const path = require('path');
const fs = require('fs');
const process = require('process');
const util = require('util');
const crypto = require('crypto');
const EventEmitter = require('events');

const zotero = require('zotero');
const request = require('request');
const bibsync = require('../api');

zotero.promisify(util.promisify.bind(Promise));

const pathRegExp = /(groups|users)\/([0-9]+)/;

class Library extends bibsync.Library {
  init(){
    /**
     * The path prefix to the library in the Zotero web API. 
     * Is either "groups/<number>" or "users/<number>"
     * @type {String}
     */
    this.prefix ="";

    return {
      prefix: v => v.match(pathRegExp).length ? true : `'${v}' is not a valid zotero path prefix`
    }
  }
}