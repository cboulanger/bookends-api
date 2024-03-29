/*
 * Bookends (>=v13.1.1) API client
 *
 * Uses code by ComplexPoint at https://www.sonnysoftware.com/phpBB3/viewtopic.php?f=2&t=4017
 * @author Christian Boulanger (cboulanger)
 */

const osascript = require('node-osascript');
const util = require('util');

/**
 * Given an event code and additional parameters, return the AppleScript command.
 * @param {String} eventCode
 * @param {mixed} param1, param2, ...
 * @return {String}
 * TODO : move into module
 */
function command(eventCode, ...parameters) {
  // "beginning with Mac OS X Snow Leopard, creator codes are ignored by the operating system"  https://en.wikipedia.org/wiki/Creator_code
  return 'tell application "Bookends" to «event XXXX' + eventCode + '» ' + parameters.join(' ');
}

/**
 * Returns the string enclosed by double quotes, with all double quotes escaped
 * @param {String} str
 */
function quote(str){
  if( ! util.isString(str) ) throw new Error("Argument must be a string.");
  return '"' + str.replace(/"/g,'\\"') + '"';
}

/**
 * Trims the result of an OSA call to Bookends, removing the quotes at the beginning/end
 * @param {String} item
 */
function removeQuotes(item) {
  return item.substring(1, item.length - 2);
}

/**
 * Execute a command via OSA and process the result. Returns a Promise
 * that resolves to an array of Strings (splitChar: String|undefined) or a
 * String (splitChar: false).
 * @param {String} cmd
 * @param {Boolean} debug If true, log diagnostic information to the console
 * @return {Promise<*>}
 */
function runOsaCmd(cmd, debug=false) {
  // error list, must be expanded
  const errors = ["No Bookends library window is open"];
  return new Promise(function(resolve, reject) {
    if (debug) console.log( " >>> OSA Command:" + cmd);
    try {
      osascript.execute(cmd, {},
        function(err, result, raw) {
          if (debug) {
            console.debug( " >>> OSA Result:" + result);
          }
          // normalize
          if (typeof result === "string") {
            result = result.normalize("NFC");
          }
          // check for errors
          if (util.isString(result) && errors.some(item => result.includes(item))) err = result;
          if (err) {
            if (debug) console.log(` >>> Error returned by callback of osascript.execute():${err}`);
            return reject(err);
          }
          resolve(result);
        }
      );
    } catch (e) {
      if (debug) console.log(` >>> Error calling osascript.execute():${e.message}`);
      reject(e);
    }
  });
}

/**
 * @module bookends-api
 */
let bookends = {
  /**
   * The reference types
   * @return {Array}
   */
  getTypes : function() {
    return [
      "Artwork",
      "Audiovisual material",
      "Book",
      "Book chapter",
      "Conference proceedings",
      "Dissertation",
      "Edited book",
      "Editorial",
      "In press",
      "Journal article",
      "Letter",
      "Map",
      "Newspaper article",
      "Patent",
      "Personal communication",
      "Review",
      "Internet"
    ];
  },

  /**
   * Returns a list of fields that Bookends uses
   * @return {Array}
   */
  getFields: function() {
    return [
      "uniqueID",
      "authors",
      "title",
      "editors",
      "journal",
      "volume",
      "pages",
      "publisher",
      "thedate",
      "location",
      "title2",
      "abstract",
      "keywords",
      "notes",
      "user1",
      "user2",
      "user3",
      "user4",
      "user5",
      "user6",
      "user7",
      "user8",
      "user9",
      "user10",
      "user11",
      "user12",
      "user13",
      "user14",
      "user15",
      "user16",
      "user17",
      "user18",
      "user19",
      "user20",
      "attachments",
      "type",
      "groups"
    ];
  },

  /**
   * Given a reference type, return the internal numeric code that Bookends uses
   * @param {String} type
   * @return {Number}
   */
  codeFromType : function(type) {
    if ( ! type || !util.isString(type)){
      throw new Error("Parameter must be a string");
    }
    let code = this.getTypes().findIndex(item => type === item);
    if (code === -1) {
      throw new Error(`Invalid type '${type}'`);
    }
    return code;
  },

  /**
   * Given a reference type code, return its string representation.
   * @param {Number} code
   * @return {String}
   */
  typeFromCode : function(code) {
    if ( ! util.isNumber(code)) {
      throw new Error("Parameter must be a number");
    }
    if ( code < 0 || code >= 40 ) {
      throw new Error("Code out of range");
    }
    if (this.getTypes()[code] === undefined) {
      throw new Error(`No type with code ${code}.`);
    }
    return this.getTypes()[code];
  },

  /**
   * Get the version number of Bookends
   * @return {Promise} A promise that resolves to a String containing the version number
   */
  getVersion : function() {
    return runOsaCmd(command('VERS'));
  },

  /**
   * Get unique ids of the selected references or references in a group
   * @param  {String} groupName Group name (can be “All”. “Hits”, “Attachments”, “Selection”, or the name of a group you created
   * @return {Promise<Number[]>}  A promise resovling with an array containing
   * the unique IDs as integer values.
   */
  getGroupReferenceIds: function(groupName) {
    if ( ! groupName || !util.isString(groupName)){
      throw new Error("Parameter must be a string");
    }
    return runOsaCmd(command('RUID', quote(groupName)))
    .then( result => removeQuotes(result).split(/\r/).map( item => parseInt(item)) );
  },

  /**
   * Get unique ids of references found with an SQL search as detailed in the User Guide.
   * @param  {String} search Search parameters as you would enter them using Refs -> SQL/Regex Search
   * @return {Promise<Number[]>}  A promise resovling with an array containing
   * the unique IDs of all found references as integer values.
   */
  findIdsWhere: function(search) {
    if ( ! search || !util.isString(search)){
      throw new Error("Parameter must be a string");
    }
    return runOsaCmd(command('SQLS', quote(search)))
    .then( result => removeQuotes(result).split(/\r/).map( item => parseInt(item)));
  },

  /**
   * Ask Bookends to return formatted references.
   * Given the unique id, you can obtain the formatted reference, as plain text or RTF.
   * Returns a promise that resolves to an Array containing the formatted references.
   * @param {Array} ids
   * @param {String} format
   * @param {Boolean} asRtf
   * @return {Promise<String[]>}
   */
  formatReferences: function(ids, format, asRtf=false) {
    if ( ! Array.isArray(ids)){
      throw new Error("First parameter must be an Array");
    }
    if ( ! format || ! util.isString(format)){
      throw new Error("Second parameter must be a non-empty String");
    }
    let cmd = command('GUID',
      quote(ids.join(',')),
      `given «class RRTF»:"${asRtf?'true':'false'}", string:"${format}"`
    );
    return runOsaCmd(cmd)
    .then(result => result.substring(1, result.length-3).split(/\r/).map(item => item.trim()));
  },

  /**
   * Get group names.
   * Returns a Promise that resolves to an array of names of all user-created groups, static and smart,
   * in the frontmost library window, sorted alphabetically by group name.
   *
   * @param {Boolean} includePath
   *  if True Bookends will return the folder hierarchy for each group, where slashes separates the folders
   *  and groups: "top folder/inner folder/group name". Note that the items will be ordered by group name,
   *  not the full path, so that zfolder/a comes before afolder/b. If a group name contains a slash (/),
   *  it will be escaped as //.
   * @return {Promise<String[]>}
   */
  getGroupNames : function(includePath=false) {
    let cmd = command('RGPN',
      `given «class PATH»:"${includePath?'true':'false'}"`
    );
    return runOsaCmd(cmd).then(result => removeQuotes(result).split(/\r/));
  },

  /**
   * Create a new static group and (optionally) populate it with references.
   * Returns a Promise that resolves to the name of the added group.  This is helpful when you specify a
   * name that is already in use and Bookends appends a number to make it unique.
   * @param {String} groupName
   * @param {Array|undefined} ids
   * @return {Promise<String>}
   */
  createStaticGroup : function(groupName, ids=[]) {
    if ( ! groupName || ! util.isString(groupName)) {
      throw new Error("First parameter must be a non-empty String");
    }
    if ( ! Array.isArray(ids)) {
      throw new Error("Second parameter must be an Array");
    }
    let cmd = command('ADDG', quote(groupName), `given string:"${ids.join(',')}"`);
    return runOsaCmd(cmd);
  },

  /**
   * Add references to an existing static group
   * Returns a Promise with the number of references added.
   * @param {String} groupName
   * @param {Array|undefined} ids
   * @return {Promise<Number>}
   */
  addToStaticGroup : function(groupName, ids=[]) {
    if ( ! groupName || ! util.isString(groupName)) {
      throw new Error("First parameter must be a non-empty String");
    }
    if ( ! Array.isArray(ids)) {
      throw new Error("Second parameter must be an Array");
    }
    let cmd = command('ADTG', quote(groupName), `given string:"${ids.join(',')}"`);
    return runOsaCmd(cmd);
  },

  /**
   * Given an array of ids and an arry of field names, return an array of objects that
   * contain the data of the corresponding references with the given fields.
   * @param {Array} ids An array with at least one id
   * @param {Array} fieldNames An array with at least one field name
   * @param {Boolean} convertType
   *    If true, convert the numeric reference type codess into their string representation
   *    (i.e. 0 => "Journal Article").
   * @return {Promise<Object[]>}  A promise resolving with to an array of json objects
   */
  readReferences : function(ids, fieldNames, convertType=true) {
    if ( ! Array.isArray(ids) || ids.length < 1 ) {
      throw new Error("First parameter must be an Array with at least one element");
    }
    if ( ! Array.isArray(fieldNames) || fieldNames.length < 1 ) {
      throw new Error("First parameter must be an Array with at least one element");
    }
    fieldNames.forEach( fieldName => {
      if ( ! this.getFields().includes(fieldName) ) {
        throw new Error(`Unknown field '${fieldName}'`);
      }
    });
    return runOsaCmd(command(
      'RJSN', quote(ids.filter(id => !!id).join(',')), 'given string:', quote(fieldNames.join(','))
    ))
    .then(result => {
      let refs;
      try {
        refs = JSON.parse(result);
      } catch (e) {
        throw new Error(result);
      }
      if( convertType ) {
        refs = refs.map( item => {
          if( typeof item.type === "number") {
            item.type = this.typeFromCode(item.type);
          }
          return item;
        });
      }
      return refs;
    });
  },

  /**
   * Given an array of object, update the references that have a matching 'uniqueID'.
   * Reference types are automatically converted into their internal numeric code.
   * @param  {Array} data An array with at least one json object
   * @return {Promise<void>}
   */
  updateReferences : function(data) {
    if ( ! Array.isArray(data) ||data.length < 1 ) {
      throw new Error("First parameter must be an Array with at least one element");
    }
    data = data.map( (item, index) => {
      if ( item.type !== undefined && typeof item.type !== "number" ) {
        try {
          item.type = this.codeFromType(item.type);
        } catch (e) {
          throw new Error(`Invalid reference type '${item.type}' in reference ${index}.`);
        }
        return item;
      }
      Object.getOwnPropertyNames(item).forEach( fieldName => {
        if ( ! this.getFields().includes(fieldName) ) {
          throw new Error(`Unknown field '${fieldName}'`);
        }
      });
      return item;
    });
    let json;
    try{
      json = JSON.stringify(data).replace(/\\/g,'\\\\');
    } catch (e) {
      throw new Error("Data cannot be serialized to JSON: " + e.message);
    }
    return runOsaCmd(command( 'SJSN', quote(json) ))
    .then(result => {
      if ( result === null) return;
      throw new Error( `updateReferences() failed.\n >>> Error:\n${result}\n >>> Data:\n${json}`);
    });
  },

  /**
   * Add a reference and/or attachment to a library
   * @param {Map} data Map of key-value pairs containing the reference data
   * @return {Promise<Number>} A Promise resolving with the numeric id of the newly created reference
   */
  addReferences: async function(data) {
    if ( ! Array.isArray(data) || data.length < 1 ) {
      throw new Error("Parameter must be an array with at least one element");
    }
    for ( let i=0; i < data.length; i++) {
      let item = data[i];
      if ( ! util.isObject(item) || item.type === undefined ) {
        throw new Error(`Invalid element ${i}: must be an object with at least the key 'type'`);
      }
      // create entry
      let result = (await runOsaCmd(command( 'ADDA', '""', `given «class RIST»:"TY - JOUR\n"` ), false));
      item.uniqueID = parseInt(result.trim());
    }
    // update values
    return this.updateReferences(data);
  },

  /**
   * Returns the dates when the references with the given ids were last modified
   * @param  {Array} ids An array of numeric ids
   * @return {Promise<Date[]>} A Promise resolving with an array of Date objects (UTC timezone), in the
   * order of the given array of ids.
   */
  modificationDates: function(ids) {
    if ( ! Array.isArray(ids) || ids.length < 1 ) {
      throw new Error("First parameter must be an Array with at least one element");
    }
    return runOsaCmd(command('RMOD', quote(ids.join(','))))
    .then(result => {
      return removeQuotes(result).split(new RegExp(String.fromCharCode(0))).map(timestamp => {
        // Need Unix (1970) milliseconds (not seconds since 1904) for JS:
        // (drop 66 years of seconds, and convert to milliseconds)
        let localDate = new Date((parseInt(timestamp, 10) - 2.0828448E+9) * 1000);
        // convert into UTC date
        let utc = new Date(localDate.getTime() + localDate.getTimezoneOffset() * 60000);
        return utc;
      });
    })
    .catch(err => {
      throw new Error("modificationDates() failed: is the database empty?");
    });
  }
};

module.exports = bookends;
