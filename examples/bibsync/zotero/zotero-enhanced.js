const zotero = require('zotero');
const util = require('util');
const crypto = require('crypto');
zotero.promisify(util.promisify.bind(Promise));

const library = new zotero.Library({ group: process.env.ZOTERO_GROUP_ID, key: process.env.ZOTERO_API_KEY });

/**
 * A model of a Zotero item
 */
class Item {

  /**
   * Send all items in the queue
   * @return {*}
   */
  static async sendAll(){
    if (Item.queue.length === 0) return;
    let message;
    let data = Item.queue.map(item => {
      //item.data.version = 0;
      return item.data;
    });
    // send to server
    message = await library.client.post(
      /* path */    library.path('items'),
      /* options */ { key:library.key },
      /* items */   data,
      // /* headers */ { 'Zotero-Write-Token': Item.createWriteToken() }
      /* headers */ { 'If-Unmodified-Since-Version': await library.getVersion() }
   );
    if ( ! message.ok ) throw message.error;
    let idsFailed = Object.getOwnPropertyNames(message.data.failed);
    if (idsFailed.length){
      let error = new Error("Some or all of the requests failed:");
      error.failedItems = idsFailed.map(id => [message.data.failed[id].message, JSON.stringify(data[id])]);
      throw error;
    }
    let idsSuccess = Object.getOwnPropertyNames(message.data.success);
    idsSuccess.forEach(id => {
      Item.queue[id].data.key = message.data.success[id];
      Item.queue[id].data.version = message.version;
      // todo add some kind of Promise resolution for all successful items
    });
    // empty queue
    Item.queue = [];
    // return the list of keys
    return message.data.success;
  }

  /**
   * Create a random 32-character string which is used to make unversioned write requests
   * @return {string}
   */
  static createWriteToken(){
    return crypto.createHash('sha1').update(""+(new Date).getTime()+Math.random()).digest('hex').substr(0,32);
  }

  /**
   * Constructor
   * @param {String} itemType The type of the item
   * @param {Boolean} debug Output debug messages (default: false)
   */
  constructor (itemType, debug = false){

    if(!itemType || typeof itemType !== "string") throw new Error("Invalid argument");

    /**
     * Show debug messages
     * @type {boolean}
     */
    this.debug = debug;

    /**
     * Whether the item has been initialized
     * @type {boolean}
     */
    this.isInitialized = false;

    /**
     * The item data
     * @type {{}}
     */
    this.data = { itemType };

  }

  /**
   * Initialize the item
   * @return {Promise<void>}
   */
  async init (){
    let itemType = this.data.itemType;
    if( Item.templates[itemType] === undefined){
      Item.templates[itemType] = (await library.client.get("/items/new?itemType=" + itemType)).data;
    }
    this.data = Object.assign(this.data, Item.templates[itemType]);
    this.isInitialized = true;
  }

  /**
   * Set or change data
   * @param data
   * @return {Promise<void>}
   */
  async set(data){
    if(! this.isInitialized) await this.init();
    Object.getOwnPropertyNames(data).forEach(field => {
      if (field in this.data) {
        this.data[field] = data[field];
      } else if(this.debug){
        console.warn(`${field} ('${data[field]}') is not a valid field for type ${this.data.itemType}`);
      }
    });
  }

  /**
   * Saves the item on the Zotero server
   * @param asBatch If true (defaults to false), do not send right away, but put on a queue to
   * send in a batch by calling this.saveAll()
   * @return {Promise<String>}
   */
  async save(asBatch=false){
    if (! this.isInitialized) await this.init();
    Item.queue.push(this);
    if (asBatch) return Promise.resolve(null);
    return (await Item.sendAll())[0];
  }
}

/**
 * A queue of items to be sent to the server
 * @type {Array}
 */
Item.queue = [];

/**
 * A map of item templates
 * @type {{}}
 */
Item.templates = {};

/**
 * Return the current sync version of the library
 * @return {Promise<Number>}
 */
library.getVersion = async function(){
  return (await library.client.get(library.path('collections/top'),{ key:library.key, format: "versions" })).version;
};

module.exports = { Item, library };