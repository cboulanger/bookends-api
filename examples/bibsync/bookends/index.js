/**
 * This module implements the BibSync API for Bookends
 * @module bibsync/bookends
 */

const debug = require('debug')('bibsync-bookends');
const bookends = require('../../../index');

/**
 * A class modeling a Bookends library
 */
class Library extends bibsync.Library {
  
    init(){
  
      /**
       * The name of the Bookends database
       * @type {String}
       */
      this.name = "";
  
      // call parent method and merge validators
      return Object.assign(super.init(),{
        name: v => v && typeof v === "string"
      });
    }
  }
