const util = require('util');

/**
 * Translates a reference, using dictionaries of "local dialects" and a global exchange format (yet to be fixed & specified)
 */
const api = {

  /**
   * Translates a reference
   * @param {Object} dictionary The translation dictionary
   * @param {Object} item The item to be translated
   * @param {Boolean} toGlobal
   *    If true (default), translate from a local dialect to the global exchange format.
   *    If false, translate from global to local.
   * @return {Object} The translated item
   */
  translate : function(dictionary, item, toGlobal=true){
    let translated_item = {};
    const toLocal = ! toGlobal;
    const map = toGlobal ? dictionary.fields.toGlobal : dictionary.fields.toLocal;
    // 'extra' field for untranslateable fields
    if (typeof item.extra === "string") {
      // unpack if exists in string form
      translated_item.extra = {};
      item.extra.split(/\n/).forEach(item=>{
        let [key,value] = item.split(/:/);
        translated_item.extra[key]=value;
      });
    } else {
      translated_item.extra = {};
    }
    Object.getOwnPropertyNames(item).forEach((field)=>{
      if (item[field]==="") return;
      let translated_name  = api.translateFieldName(map, field, item);
      let translated_content = api.translateFieldContent(map, field, item);
      // we have a direct equivalent in the target language
      if (translated_name !== false) {
        translated_item[translated_name]=translated_content;
        return;
      }
      // no direct equivalent of field name, but content exists
      if (util.isObject(translated_content)) {
        // if content is an object, field name depends on content, merge result into item
        Object.getOwnPropertyNames(translated_content).forEach(key => {
          if ((dictionary.fields.toGlobal[key] || dictionary.fields.toLocal[key]) !== undefined){
            // the field exists in source or target language
            translated_item[key] = translated_content[key];
          } else {
            // otherwise, put in 'extra' field
            translated_item.extra[key] = translated_content[key];
          }
        });
      } else {
        // otherwise, store content in 'extra' field
        translated_item.extra[field] = translated_content || item[field];
      }
    });
    // pack 'extra' field to as a string (HTTP header format) for readability
    let extra = translated_item.extra;
    if (typeof extra === "object" && Object.getOwnPropertyNames(extra).length > 0) {
      translated_item.extra =
        Object.getOwnPropertyNames(translated_item.extra)
        .map(key => `${key}:${translated_item.extra[key]}`).join("\n");
    }
    return translated_item;
  },

  /**
   * Translates a reference from the local dialect to the global exchange format.
   * @param {Object} dictionary The translation dictionary
   * @param {Object} item The item to be translated
   * @return {Object} The translated item
   */
  toGlobal : function(dictionary, item){
    return api.translate(dictionary, item, true);
  },

  /**
   * Translates a reference from the global exchange format to the local dialect.
   * @param {Object} dictionary The translation dictionary
   * @param {Object} item The item to be translated
   * @return {Object} The translated item
   */
  toLocal : function(dictionary, item){
    return api.translate(dictionary, item, false);
  },

  /**
   * Translates the name of a field (== key)
   * @param {Object} map The translation dictionary
   * @param {String} field The field name
   * @param {Object} item The item to be translated
   * @return {String} The translated field name
   */
  translateFieldName: function (map, field, item) {
    // the field name translation can be a simple function
    if (typeof map[field] === "function") {
      return map[field](item);
    }
    // or a method of an object
    if (typeof map[field] === "object" && typeof map[field].translateName === "function") {
      return map[field].translateName(item);
    }
    return map[field];
  },

  /**
   * Translates the name of a field (== key)
   * @param {Object} map The translation dictionary
   * @param {String} field The field name
   * @param {Object} item The item to be translated
   * @return {*} The translated field content
   */
  translateFieldContent: function (map, field, item) {
    if (typeof map[field] === "object" && typeof map[field].translateContent === "function") {
      return map[field].translateContent(item);
    }
    return item[field];
  }
};

module.exports = api;