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
 * Returns the quoted string
 * @param {String} str 
 */
function quote(str){
  return '"' + str + '"';
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
          // split unless splitChar is false
          if (splitChar !== false){
            result = result.split(new RegExp(splitChar || "\r"));
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
    return evalOSA(command('RUID', quote(groupName)), "\r", item => {
      return item.substring(1, item.length - 2);
    })
    .then( result => result.map( item => parseInt(item)));
  },

  /**
   * Get unique ids of references found with an SQL search as detailed in the User Guide.
   * @param  {String} search Search parameters as you would enter them using Refs -> SQL/Regex Search
   * @return {Promise}  A promise resovling with an array containing
   * the unique IDs of all found references as integer values.
   */
  search: function(search) {
    if ( ! search || !util.isString(search)){
      throw new Error("Parameter must be a string");
    } 
    return evalOSA(command('SQLS', quote(search)), "\r", item => {
      return item.substring(1, item.length - 2);
    })
    .then( result => result.map( item => parseInt(item)));
  },

  /**
   * Adds a collection. Not implemented in Bookends since collections cannot
   * be programmatically created yet.
   * @param {Map} data A Map containing the collection data. Must have at least
   *                   these keys: name {String}, parent : {String}
   * @return {Promise}  A Promise which resolves with the newly created key of the
   *                    collection
   */
  addGroup : async function(name){
    throw new Error("Collections cannot be created in Bookends.");
  },

  /**
   * Given one or more ids and a field name, return the local content of the field(s)
   * of the reference(s) having this/these id(s).
   * @param  {Array} ids       An array with one or more ids
   * @param  {String} fieldName The name of the field
   * @return {Promise}  A promise resovling with an array containing
   * the field contents.
   */
  getFieldValues : function(ids, fieldName) {
    return evalOSA(command(
      'RFLD', quote(ids.join(','), 'given string:', quote(fieldName)
    )), String.fromCharCode(0));
  },

  /**
   * Returns the dates when the references with the given ids were last modified
   * @param  {Array} ids An array of numeric ids
   * @return {Promise} A Promise resolving with an array of Date objects
   */
  getModificationDates: function(ids) {
    if (!(ids instanceof Array)) throw new Error("ids must be an array.");
    var args = ' "' + ids.join(',') + '"';
    return evalOSA(command('RMOD') + args, String.fromCharCode(0))
    .then(function(result) {
      return result.map(function(s) {
        return new Date(
          // Need Unix (1970) milliseconds (not 1904 seconds) for JS:
          // (drop 66 years of seconds, and convert to milliseconds)
          (parseInt(s, 10) - 2.0828448E+9) * 1000
        );
      });
    });
  },

  /*
  -------------------------------------------------------------------------
  Bookends-specific API
  -------------------------------------------------------------------------
  */

  /**
   * Get the names of all groups
   * @param withFullPath {Boolean} Whether to return the full path of the
   *    group name
   * @return {Promise} resolves with an Array of names
   */
  getBookendsGroups: function(withFullPath) {
    var args = withFullPath ? ' given «class PATH»: "true"' : "";
    return evalOSA(command('RGPN') + args, "\r", function(result) {
        return result.substring(1, result.length - 2);
      })
      .then(function(result) {
        var map = {};
        cache.keyMap = {};
        for (var j = 0; j < result.length; j++) {
          var collectionName = result[j];
          // escape "/"
          collectionName = collectionName.replace(/\/\//g, "<<slash>>");
          var slugs = collectionName.split(/\//);
          //...

          for (var i = slugs.length - 1; i >= 0; i--) {
            var slug = slugs[i].replace(/<<slash\>\>/g, "/");
            var key = md5(slug);
            map[slug] = {
              key: key,
              name: slug,
              parentKey: i > 0 ? slugs[i - 1].replace(/<<slash\>\>/g, "/") : false
            };
            cache.keyMap[key] = slug;
          }
        }
        //console.dir(map);
        cache.treeData = map;
        return map;
      });
  },




  /**
   * Formats references
   * @param  {Array} ids   An array of numeric ids
   * @param  {String} style The style. Must be one of the styles defined in bookendsAPI
   * @return {Array}  An array of strings which contain the formatted references
   */
  getFormattedRefs: function(ids, style) {
    if (!(ids instanceof Array)) throw new Error("ids must be an array.");
    // max 500 entries
    if (ids.length > 100) {
      ids = ids.slice(0, 99);
    }
    var args = ' "' + ids.join(',') + '" given «class RRTF»:"false", string:"' + (style || '') + '"';
    return evalOSA(command('GUID') + args, "\n", function(result) {
      return result.replace(/\[\#\!\#\]/g, "\n").substring(2, result.length - 2);
    });

    // Retrieve in smaller chunks
    // var promises = [];
    //
    // while (ids.length) {
    //   var s = ids.splice(-50, 50);
    //   var args = ' "' + s.join(',') + '" given «class RRTF»:"false", string:"' + (style || '') + '"';
    //   promises.push(evalOSA(eventCode('GUID') + args, "\r\r\r", function(result) {
    //     return result.substring(1, result.length - 2);
    //   }));
    // }
    // return Promise.all(promises);
  },

  /**
   * Given an array of ids, return the normalized reference data
   * @param ids {Array}
   * @return {Promise} A Promise resolving with an array of maps with the reference data
   */
  getReferenceData: function(ids) {
    return this.getFormattedRefs(ids, "Export")
    .then(function(result) {
      var data = [], i = 1;
      result.forEach(function(taggedData) {
        var dict = {};
        var fieldName = "", content="";
        taggedData.split(/\r/).map(function(line) {
          var i = line.indexOf(":");
          var maybeFieldName = i > 0 ? line.substring(0, i) : false;
          if ( maybeFieldName && dictionary.isLocalField(maybeFieldName) ) {
            fieldName = maybeFieldName;
            content = line.substring(i + 2);
            dict[fieldName] = slashes.strip(content);
          } else if (fieldName ) {
            // append to current mulit-line field
            if ( fieldName == "abstract" || fieldName == "notes") {
              dict[fieldName] += "\n" + line;
            }
          }
        });
        if (fieldName) {
          data.push(dict);
        }
      });
      return data;
    });
  },

  // return «event ToySADDA» "/Users/username/Desktop/myPaper.pdf" given
  // «class RIST»:"TY - JOUR" & return & "T1 - The Title" & return &
  // "AU - Harrington Joseph" & return & "PY - 2015" & return &
  // "UR - http:// www.sonnysoftware.com" & return


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

  // fieldWrite :: String -> String -> String -> ()
  // authors, title, editors, journal, volume, pages, thedate,
  // publisher, location, url, title2, abstract, notes, user1...user20
  set: function(strID, strFieldName, strValue) {
    var args = ' "' + strID + '" given «class FLDN»:"' + strFieldName + '", string:"' + strValue + '"';
    return evalOSA(command('SFLD') + args);
  },


  // sqlMatchIDs :: String -> [String]
  // SELECT clause without the leading SELECT keyword
  sqlMatchIDs: function(strClause) {
    return evalOSA(command('SQLS') + ' "' + strClause + '"');
  },
};
