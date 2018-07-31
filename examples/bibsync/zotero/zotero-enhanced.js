const zotero = require('zotero');
const util = require('util');
zotero.promisify(util.promisify.bind(Promise));
let templates = {};
const library = new zotero.Library({ group: process.env.ZOTERO_GROUP_ID, key: process.env.ZOTERO_API_KEY });
module.exports = {
  library,
  /**
   * A
   * @param itemType
   * @constructor
   */
  Item : function(itemType){
    if(!itemType || typeof itemType !== "string") throw new Error("Invalid argument");
    let item = this;
    item.itemType = itemType;
    const api = {
      init: async function(){
        if( templates[itemType] === undefined){
          templates[itemType] = (await library.client.get("/items/new?itemType=" + itemType)).data;
        }
        item.data = Object.assign({}, templates[itemType]);
        item.isInitialized = true;
      },
      set: async function(data){
        if(! item.isInitialized) await api.init();
        Object.getOwnPropertyNames(data).forEach(field => {
          if (field in item.data) {
            item.data[field] = data[field];
          } else {
            console.warn(`${field} ('${data[field]}') is not a valid field for type ${item.itemType}`);
          }
        });
      },
      save: async function(){
        if(! item.isInitialized) await api.init();
        let result = await library.client.post(library.path('items'),{key:library.key},[item.data]);
        //if ( ! result.ok ) throw result.error;
        let error = result.data.failed['0'];
        if( error !== undefined) {
          throw new Error(error.message);
        }
        console.log(result);
      }
    };
    return api;
  }
};