const util = require('util');

 // @todo Store "extra" data in note, not "extra" field

/**
 * Translates a reference, using dictionaries of "local dialects" and a global exchange format (yet to be fixed & specified)
 */
class Translator
{
  /**
   * Translates a reference
   * @param {Object} dictionary The translation dictionary
   * @param {Object} item The item to be translated
   * @param {Boolean} toGlobal
   *    If true (default), translate from a local dialect to the global exchange format.
   *    If false, translate from global to local.
   * @return {Object} The translated item
   */
  static translate (dictionary, item, toGlobal=true){
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
      let translated_name    = this.translateFieldName(map, field, item);
      let translated_content = this.translateFieldContent(map, field, item);
      // set default value of field
      if (translated_item[translated_name] === undefined
        && util.isObject(map[field])
        && typeof map[field].default === "function") {
        translated_item[translated_name] = map[field].default();
      }
      // we have a direct equivalent in the target language
      if (translated_name !== false) {
        this.append(translated_item, translated_name, translated_content);
        return;
      }
      // no direct equivalent of field name, but content exists
      if (util.isObject(translated_content)) {
        // if content is an object, field name depends on content, merge result into item
        Object.getOwnPropertyNames(translated_content).forEach(key => {
          if ((dictionary.fields.toGlobal[key] || dictionary.fields.toLocal[key]) !== undefined){
            // the field exists in source or target language
            this.append(translated_item,key,translated_content[key]);
          } else {
            // otherwise, put in 'extra' field
            this.append( translated_item.extra, key, translated_content[key]);
          }
        });
      } else if (! (field.startsWith("user") || field.startsWith('default'))){ // @todo make this configurable
        // otherwise, store content in 'extra' field
        this.append( translated_item.extra, field, translated_content || item[field]);
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
  }

  /**
   * If the field is not empty, append the content using an appropriate strategy that depends
   * on the type
   * @param {{}} item
   * @param {String} field
   * @param {*} content
   * @param {String} separator Separator for string type fields, defaults to "; "
   */
  static append(item, field, content, separator="; ") {
    let oldContent = item[field];
    if ( oldContent === undefined || oldContent === ""){
      item[field] = content;
      return;
    }
    if (Array.isArray(oldContent)) {
      if( Array.isArray(content)){
        // arrays will be concatenated
        item[field] = item[field].concat(content);
      } else {
        // other types will be appended
        item[field].push(content);
      }
    } else if (typeof oldContent === "string") {
      item[field] += separator + content;
    }
  }

  /**
   * Translates a reference from the local dialect to the global exchange format.
   * @param {Object} dictionary The translation dictionary
   * @param {Object} item The item to be translated
   * @return {Object} The translated item
   */
  static toGlobal (dictionary, item){
    return this.translate(dictionary, item, true);
  }

  /**
   * Translates a reference from the global exchange format to the local dialect.
   * @param {Object} dictionary The translation dictionary
   * @param {Object} item The item to be translated
   * @return {Object} The translated item
   */
  static toLocal (dictionary, item){
    return this.translate(dictionary, item, false);
  }

  /**
   * Translates the name of a field (== key)
   * @param {Object} map The translation dictionary
   * @param {String} field The field name
   * @param {Object} item The item to be translated
   * @return {String} The translated field name
   */
  static translateFieldName (map, field, item) {
    // the field name translation can be a  function
    if (typeof map[field] === "function") {
      return map[field](item);
    }
    // or a method of an object
    if (typeof map[field] === "object") {
      // translate name
      if (typeof map[field].translateName === "function") {
        return map[field].translateName(item);
      }
    }
    // or a simple string or boolean false
    if (typeof map[field] === "string" || map[field] === false) {
      return map[field];
    }

    // if not defined no translation
    if (map[field]===undefined) return false;

    throw new Error(`Invalid field definition for '${field}'`);
  }

  /**
   * Translates the name of a field (== key)
   * @param {Object} map The translation dictionary
   * @param {String} field The field name
   * @param {Object} item The item to be translated
   * @return {*} The translated field content
   */
  static translateFieldContent (map, field, item) {
    if (typeof map[field] === "object") {
      if (typeof map[field].translateContent === "function") {
        return map[field].translateContent(item);
      }
    }
    return item[field];
  }
}

module.exports = Translator;