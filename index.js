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
 * Trims the result of an OSA command to the relevant data
 * @param {String} item 
 */
function trimResult(item) {
  return item.substring(1, item.length - 2);
}

/**
 * Execute a command via OSA and process the result. Returns a Promise
 * that resolves to an array of Strings (splitChar: String|undefined) or a 
 * String (splitChar: false). 
 * @param OSACommand {String}
 * @param splitChar {String|false|undefined}
 *    If string, split the result at the occurrences of this string
 *    If false, split by "\r" and re-join with "\n"
 *    If undefined, split with "\r"
 * @return {Promise}
 */
function evalOSA(OSACommand, splitChar, transformFunc) {
  return new Promise(function(resolve, reject) {
    //console.debug(OSACommand);
    try {
      osascript.execute(OSACommand, {},
        function(err, result, raw) {
          if ( (result||"").indexOf("No Bookends library window is open") !== -1) {
            err = "No Bookends library window is open";
          }
          if ( err ) {
            return reject(err);
          }
          // transform
          if (typeof transformFunc == "function") {
            result = transformFunc(result);
          }
          // split unless splitChar is false, trim the array items
          if (splitChar !== false) {
            result = result.split(new RegExp(splitChar || "\r")).map(item => item.trim());
          }
          resolve(result);
        }
      );
    } catch (e) {
      reject(e);
    }
  });
}

module.exports = 
{
  /**
   * Get the version number of Bookends
   * @param  {Array} ids       An array with one or more ids
   * @param  {String} fieldName The name of the field
   * @return {Promise} A promise that resolves to a String containing the version number
   */
  getVersion : function() {
    return evalOSA(command('VERS'),false);
  },

  /**
   * Get unique ids of the selected references or references in a group
   * @param  {String} groupName Group name (can be “All”. “Hits”, “Attachments”, “Selection”, or the name of a group you created
   * @return {Promise}  A promise resovling with an array containing
   * the unique IDs as integer values.
   */
  getGroupReferenceIds: function(groupName) {
    if ( ! groupName || !util.isString(groupName)){
      throw new Error("Parameter must be a string");
    } 
    return evalOSA(command('RUID', quote(groupName)), "\r", trimResult)
    .then( result => result.map( item => parseInt(item)) );
  },

  /**
   * Get unique ids of references found with an SQL search as detailed in the User Guide.
   * @param  {String} search Search parameters as you would enter them using Refs -> SQL/Regex Search
   * @return {Promise}  A promise resovling with an array containing
   * the unique IDs of all found references as integer values.
   */
  searchReferences: function(search) {
    if ( ! search || !util.isString(search)){
      throw new Error("Parameter must be a string");
    } 
    return evalOSA(command('SQLS', quote(search)), "\r", trimResult)
    .then( result => result.map( item => parseInt(item)));
  },

  /**
   * Ask Bookends to return formatted references.
   * Given the unique id, you can obtain the formatted reference, as plain text or RTF.
   * Returns a promise that resolves to an Array containing the formatted references. 
   * @param {Array} ids 
   * @param {String} format
   * @param {Boolean} asRtf 
   * @return {Promise}
   */
  formatReferences: function(ids, format, asRtf=false) {
    if ( ! util.isArray(ids)){
      throw new Error("First parameter must be an Array");
    } 
    if ( ! format || ! util.isString(format)){
      throw new Error("Second parameter must be a non-empty String");
    }
    let cmd = command('GUID', 
      quote(ids.join(',')), 
      `given «class RRTF»:"${asRtf?'true':'false'}", string:"${format}"`
    );
    return evalOSA(cmd, "\r\r", item => item.substring(1, item.length-3));
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
   * @return {Promise}
   */
  getGroupNames : function(includePath=false) {
    let cmd = command('RGPN',
      `given «class PATH»:"${includePath?'true':'false'}"`
    );
    return evalOSA(cmd, "\r", item => item.substring(1, item.length-2));
  },

  /**
   * Create a new static group and (optionally) populate it with references.
   * Returns a Promise that resolves to the name of the added group.  This is helpful when you specify a 
   * name that is already in use and Bookends appends a number to make it unique.
   * @param {String} groupName 
   * @param {Array|undefined} ids 
   * @return {Promise}
   */
  createStaticGroup : function(groupName, ids=[]) {
    if ( ! groupName || ! util.isString(groupName)) {
      throw new Error("First parameter must be a non-empty String");
    }       
    if ( ! util.isArray(ids)) {
      throw new Error("Second parameter must be an Array");
    } 
    let cmd = command('ADDG', quote(groupName), `given string:"${ids.join(',')}"`);
    return evalOSA(cmd);    
  },

  /**
   * Add references to an existing static group
   * Returns a Promise with the number of references added. 
   * @param {String} groupName 
   * @param {Array|undefined} ids 
   * @return {Promise}
   */
  addToStaticGroup : function(groupName, ids=[]) {
    if ( ! groupName || ! util.isString(groupName)) {
      throw new Error("First parameter must be a non-empty String");
    }       
    if ( ! util.isArray(ids)) {
      throw new Error("Second parameter must be an Array");
    } 
    let cmd = command('ADTG', quote(groupName), `given string:"${ids.join(',')}"`);
    return evalOSA(cmd);    
  },

  /**
   * Given an array of ids and an arry of field names, return an array of objects that
   * contain the data of the corresponding references with the given fields.
   * @param  {Array} ids An array with at least one id
   * @param  {Array} fieldNames An array with at least one field name
   * @return {Promise}  A promise resolving with to an array of json objects
   */
  readReferenceData : function(ids, fieldNames) {
    if ( ! util.isArray(ids) || ids.length < 1 ) {
      throw new Error("First parameter must be an Array with at least one element");
    }       
    if ( ! util.isArray(fieldNames) || fieldNames.length < 1 ) {
      throw new Error("First parameter must be an Array with at least one element");
    }     
    return evalOSA(command(
      'RJSN', quote(ids.join(',')), 'given string:', quote(fieldNames.join(','))
    ))
    .then(result => JSON.parse(result));
  },

  /**
   * Given an array of object, update the references that have a matching 'uniqueID'.
   * @param  {Array} data An array with at least one json object
   * @return {Promise}  A promise resolving with to an array of objects
   */
  updateReferenceData : function(data) {
    if ( ! util.isArray(data) ||data.length < 1 ) {
      throw new Error("First parameter must be an Array with at least one element");
    }
    let json;       
    try{
      json = JSON.stringify(data);
    } catch (e) {
      throw new Error("Data cannot be serialized to JSON: " + e.message);
    }
    return evalOSA(command( 'SJSN', quote(json) ), false)
    .then(result => {
      if ( util.isString(result) && result.includes('error')) {
        throw new Error(result);
      }
      return result;
    });
  },

  /**
   * Returns the dates when the references with the given ids were last modified
   * @param  {Array} ids An array of numeric ids
   * @return {Promise} A Promise resolving with an array of Date objects
   */
  getModificationDates: function(ids) {
    if ( ! util.isArray(ids) || ids.length < 1 ) {
      throw new Error("First parameter must be an Array with at least one element");
    }
    return evalOSA(command('RMOD', quote(ids.join(',') )), String.fromCharCode(0), trimResult)
    .then(result => {
      return result.map(timestamp => {
        return new Date(
          // Need Unix (1970) milliseconds (not 1904 seconds) for JS:
          // (drop 66 years of seconds, and convert to milliseconds)
          (parseInt(timestamp, 10) - 2.0828448E+9) * 1000
        );
      });
    });
  },

  /**
   * Adds a reference to the bookends database
   * @param {Map} data Map of key-value pairs containing the normalized field data
   * @return {Promise} A Promise resolving with the numeric id of the newly created reference
   */
  add: function(data) {
    throw new Error("Not implemented");
    // var args = "";
    // if (data.attachments) {
    //   args += '"' + data.attachments + '"';
    // }
    // if (data.type) {
    //   args += ' given «class RIST»:"';
    // }
    // for (var key in data) {
    //   if (key == "attachments") continue;
    //
    // }
    // return evalOSA(eventCode('ADDA') + args, '\n');
  },


};
