const zotero = require('zotero');
const util = require('util');
const crypto = require('crypto');
const EventEmitter = require('events');
zotero.promisify(util.promisify.bind(Promise));

const library = new zotero.Library({ group: process.env.ZOTERO_GROUP_ID, key: process.env.ZOTERO_API_KEY });

/**
 * A model of a Zotero item
 */
class Item extends EventEmitter {

  /**
   * Send all items in the queue
   * @return {*}
   */
  static async sendAll(){
    let keyList = {};
    while (Item.queue.length) {
      let version = await library.getVersion();
      let data = Item.queue.map(item => {
        //This should work, but doesn't
        //if (!item.data.key) item.data.version = 0;
        return item.data;
      });
      // send to server
      let message = await library.client.post(
      /* path */    library.path('items'),
      /* options */ {key: library.key},
      /* items */   data,
      // /* headers */ { 'Zotero-Write-Token': Item.createWriteToken() }
      /* headers */ {'If-Unmodified-Since-Version': version}
      );
      if (!message.ok) throw message.error;
      let idsFailed = Object.getOwnPropertyNames(message.data.failed);
      if (idsFailed.length) {
        let error = new Error("Some or all of the requests failed:");
        error.failedItems = idsFailed.map(id => [message.data.failed[id].message, JSON.stringify(data[id])]);
        throw error;
      }
      let idsSuccess = Object.getOwnPropertyNames(message.data.success);
      let queueCopy = [].concat(Item.queue);
      // empty queue
      Item.queue = [];
      // add server data to items and emit events
      idsSuccess.forEach(id => {
        let item = queueCopy[id];
        item.data.key = message.data.success[id];
        item.data.version = message.version;
        item.saved = true;
        item.emit("saved", message.data.success[id]);
      });
      Object.assign(keyList, message.data.success);
    } // end while
    // return the list of keys
    return keyList;
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
    super();

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
     * Whether this item has been saved to the server
     * @type {boolean}
     */
    this.saved = false;

    /**
     * The item data
     * @type {{}}
     */
    this.data = { itemType };

    /**
     * The parent of this item, if any
     * @type {null|Item}
     */
    this.parent = null;

  }

  /**
   * Initialize the item
   * @return {Promise<void>}
   */
  async init (){
    let itemType = this.data.itemType;
    if( Item.templates[itemType] === undefined) {
      Item.templates[itemType] = await this.downloadTemplate(itemType);
    }
    this.data = Object.assign(this.data, Item.templates[itemType]);
    this.isInitialized = true;
  }

  /**
   * Downloads the item template
   * @return {Promise<void>}
   */
  async downloadTemplate(itemType){
    return (await library.client.get("/items/new?itemType=" + itemType)).data;
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
   * Sets the parent of this item
   * @param {Item} item
   */
  setParent(item) {
    if (! item instanceof Item) throw new TypeError('Argument must be instance of zotero.Item. ');
    this.parent = item;
  }

  /**
   * Saves the item on the Zotero server. Returns a Promise.
   * @param asBatch
   *    If true (defaults to false), do not send right away, but put on a queue to
   *    send in a batch by calling Item.saveAll()
   * @return {Promise<String|null>}
   *    The Promise resolves to the item key if asBatch is false or null asBatch is true or if the item has a parent
   *    that needs to be saved to the server first.
   */
  async save(asBatch=false){
    if (! this.isInitialized) await this.init();
    if (this.parent) {
      if (this.parent.saved){
        this.data.parentItem = this.parent.data.key;
      } else {
        this.parent.on("saved", key => {
          this.data.parentItem = key;
          this.save(asBatch);
        });
        return Promise.resolve(null);
      }
    }
    Item.queue.push(this);
    if (asBatch) return Promise.resolve(null);
    return (await Item.sendAll())[0];
  }
}

class Note extends Item {
  constructor(note, parent){
    super('note');
    if( parent ){
      if (! parent instanceof Item) throw new Error("Parent must be instance of Item");
      this.setParent(parent);
    }
    this.set({note});
  }
}

class Attachment extends Item {

  constructor() {
    super('attachment');
    /**
     * its link mode
     */
    this.linkMode = linkMode;
  }

  /**
   * Downloads the item template
   * @return {Promise<void>}
   */
  async downloadTemplate(itemType){
    if (!this.linkMode) throw new Error("You have to set the linkMode first");
    return (await library.client.get(`/items/new?itemType=${itemType}&linkMode=${this.linkMode}`)).data;
  }

  setLinkMode(linkMode) {
    if ( this.data.itemType !== "attachment" ) throw new Error("Item is not an attachment");
    if ( ! "imported_file,imported_url,linked_file,linked_url".split(/,/).includes(linkMode) ) throw new Error("Invalid Argument");
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
 * @todo There must be a better way than making a bogus request
 * @return {Promise<Number>}
 */
library.getVersion = async function(){
  return (await library.client.get(library.path('collections/top'),{ key:library.key, format: "versions" })).version;
};

module.exports = { library, Item, Note, Attachment };