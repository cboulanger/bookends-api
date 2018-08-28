/**
 * This module provides abstract classes for BibSync
 * @module bibsync
 */

const debug = require('debug')('bibsync-base');
const util = require('util');
const EventEmitter = require('events');

const Translator = require('./translator');

// symbols
const symbolValidatorObject = Symbol("validator");


/** @module zotero-plus */


/**
 * Base class, provided a mechanism to declare properties in the init() method, which can then be
 * set via a config object passed to the constructor.
 */
class Base extends EventEmitter {
  /**
   * The constructor receives an object from which the properties of the instance are set, after
   * being validated. It calls the class-specific {@see init()} method, which sets instance property defaults
   * and returns a validator object.
   * @param {{}} config 
   */
  constructor(config = {}) {
    super();
    // initialize 
    this[symbolValidatorObject] = this.init();
    // enforce required properties
    Object.getOwnPropertyNames(this[symbolValidatorObject]).forEach( name => {
      let validationData = this[symbolValidatorObject][name];
      if (!validationData || typeof validationData !== "object" || validationData.required !== true) return; 
      if (config[name] === undefined) {
        throw new Error(`Constructor config object must contain a '${name}' key.`);
      }
    });
    // set properties
    this.set(config);    
  }

  /**
   * Validates the config objec of the Base class constructor or the argument of the Base.set() method
   * @param {{}}
   */
  validate(config) {
    if (! config || typeof config !== "object") throw new TypeError("Argument must be an object");
    let validatorObj = this[symbolValidatorObject];
    Object.getOwnPropertyNames(config).forEach(name => {
      if (this[name] === undefined) {
        throw new Error(`Property ${name} has not been declared in the init() method.`);
      }
      if (validatorObj && typeof validatorObj === "object" && validatorObj[name] ) {
        let validationFunc;
        if ( typeof validatorObj[name] === "function" ) {
          validationFunc = validatorObj[name];
        } else if ( typeof validatorObj[name] === "object" && typeof validatorObj[name].validate === "function" ) {
          validationFunc = validatorObj[name].validate;
        }
        let result = validationFunc(config[name]);
        switch (result) {
          case true:  return;
          case false: throw new Error(`Property ${name} does not validate '${validationFunc}'.`);
          default: throw new Error(result);
        }
      }
    });
  }  

  /**
   * The init() method declares the instance properties by setting their default values. Only those
   * properties initialized in this method can be set via the config object passed to the constructor.
   * The method returns a validator object. The keys of this object are the property names to be 
   * validated. The value is either a validator function (see below) or an object. The object can take
   * two properties, a) "validate", which contains a validator function (see below), and b) "required", which, if true
   * indicates that the property must be set when calling the constructor. Validator functions which, 
   * when passed a property value, return a) true if validation is successful or b) false (for generic 
   * rejection) or a string (custom error message) if validation fails. When overriding the init method(),
   * make sure to include the object returned from super.init() by merging it into the return value
   * (return Object.assign(super.init(),{...});)
   *
   * @return {{}}
   */
  init() { 
    return {};
  };

  /**
   * Sets instance properties using the validation rules defined in the init() method
   * @param {{}} map 
   */
  set(map) {
    this.validate(map);
    Object.getOwnPropertyNames(map).forEach(name => this[name] = map[name]);
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

    /**
     * The id of this library. Will be used to identify the library in synchronization data,
     * therefore must be unique among all synchronized libraries.
     * @type {String}
     */
    this.id = "";

    

    return Object.assign(super.init(),{
      version: v => (typeof v === "number" && parseInt(v) === v) ? true : "Version must be an integer.",
      id: {
        validate: v => (v && typeof v === "string") ? true : "id property must be a non-empty string",
        required: true
      }
    });
  }

  /**
   * Returns an array of the ids of the records that have changed since the given version of
   * the library
   */
  getIdsModifiedSinceVersion(version) {
    throw new Error("Method not implemented");
  }


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

    return Object.assign(super.init(),{
      source: {
        validate: v => v instanceof Library,
        required: true
      },
      target: {
        validate: v => v instanceof Library,
        required: true
      },
      bidirectional: v => typeof v === "boolean"
    });
  }

  start() {

  }
}

module.exports = { 
  Base,
  Library,
  Synchronization, 
  Translator,
};


