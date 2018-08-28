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

const zotero = require('zotero');
const request = require('request');
const bibsync = require('..');

zotero.promisify(util.promisify.bind(Promise));

const pathRegExp = /(groups|users)\/([0-9]+)/;

// symbols


/**
 * A class modeling a Zotero library
 */
class Library extends bibsync.Library {

  constructor(config) {
    // this calls the init() method implicitly
    super(config);
    const options = {};
    options.key = this.apiKey;
    let [,type,id] = this.prefix.match(pathRegExp);
    if ( ! type || ! id || isNaN(parseInt(id)) ){
      throw new Error(`Invalid 'prefix' config "${this.prefix}"`);
    }
    options[type.substr(0,type.length-1)] = parseInt(id); // strip off "s"
    this._library = new zotero.Library(options);
  }

  init(){

    /**
     * The path prefix to the library in the Zotero web API. 
     * Is either "groups/<number>" or "users/<number>"
     * @type {String}
     */
    this.prefix = "";

    /**
     * The zotero.org API key needed for access to this library
     */
    this.apiKey = "";

    // call parent method and merge validators
    return Object.assign(super.init(),{
      prefix: {
        validate: v => v.match(pathRegExp).length ? true : `'${v}' is not a valid zotero path prefix`,
        required: true
      },
      apiKey: {
        validate: v => v && typeof v === "string",
        required: true
      }
    });
  }

  
}

