/**
 * This module provides abstract classes for BibSync
 * @module bibsync
 */

const debug = require('debug')('bibsync-base');
const util = require('util');
const EventEmitter = require('events');

const Translator = require('./translator');

/** @module zotero-plus */

/**
 * Base class, provided a mechanism to declare properties in the init() method, which can then be
 * set via a config object passed to the constructor.
 */
class Base extends EventEmitter {
  /**
   * The constructor receives an object from which the properties of the instance are set, after
   * being validated. It calls the class-specific init() method, which sets instance property defaults
   * and returns a validator object. The keys of this object are  the property names, the values 
   * are functions which, when passed a property value, return a) true if validation is successful
   * or b) false (for generic rejection) or a string (custom error message) if validation fails. 
   * @param {{}} config 
   */
  constructor(config = {}) {
    if (typeof config !== "object") {
      throw new TypeError("(Last) constructor argument must be an object");
    }
    // define the instance properties and get their types
    const validators = this.init();
    Object.getOwnPropertyNames(config).forEach(name => {
      if (this[name] === undefined) {
        throw new Error(`Property ${name} has not been declared in the init() method.`);
      }
      if (validators && typeof validators === "object") {
        if (typeof validators[name] === "function") {
          let result = validators[name](config[name]);
          switch (result) {
            case true: 
              return;
            case false:
              throw new Error(`Property ${name} does not validate '${validators[name]}'.`);
            default:
              throw new Error(result);
          }
        }  
      }
      this[name] = config[name];
    });
  }
  /**
   * Empty stub to be overridden by subclasses
   */
  init() {}
}

class Synchronization extends Base {
  init() {
    /**
     * The source library
     * @type {Library}
     */
    this.source = null;
    /**
     * The target library
     * @type {null}
     */
    this.target = null;
    /**
     * Whether this synchronization is bidirectional (default false)
     * @type {boolean}
     */
    this.bidirectional = false;

    return {
      source: v => v instanceof Library,
      target: v => v instanceof Library,
      bidirectional: v => typeof v === "boolean"
    }
  }
}

class Library extends Base {

  init(){
    /**
     * The version of the library. Can be an monotonically incremented integer (Zotero)
     * or a UNIX time stamp (Bookends)
     * @type {Number}
     */
    this.version = 0;
    return {
      version: v => (typeof v === "number" && parseInt(v) === v) ? true : "Version must be an integer."
    }
  }
}


module.exports = { 
  Base,
  Library,
  Synchronization, 
  Translator,
};


